begin;
-- Serialize enrollment against both signup and retained financial writers.
-- No existing ledger, deposit, activation or point row is updated/deleted.
lock table app_private.workroom_accounts, app_private.funding_engine_activations,
 app_private.funding_earned_receipts, app_private.funding_engine_jobs,
 public.money_source_movements, public.withdrawal_requests,
 public.funding_principal_recovery_allocations in share row exclusive mode;

create table app_private.workroom_cash_enrollments (
 user_id uuid primary key references app_private.workroom_accounts(user_id),
 preserved_activation_id uuid unique references app_private.funding_engine_activations(id),
 reason text not null check(reason in('DIRECT_CASH','INERT_ACTIVATION_PRESERVED')),
 enrolled_at timestamptz not null default clock_timestamp(),
 check((preserved_activation_id is null)=(reason='DIRECT_CASH'))
);
alter table app_private.workroom_cash_enrollments enable row level security;
alter table app_private.workroom_cash_enrollments force row level security;
revoke all on app_private.workroom_cash_enrollments from public,anon,authenticated,service_role;
grant select on app_private.workroom_cash_enrollments to service_role;
create trigger workroom_cash_enrollments_immutable before update or delete
 on app_private.workroom_cash_enrollments for each row execute function app_private.workroom_immutable();

-- Adopt only WORKROOM-origin direct cash. Historical funded members keep their
-- original mode. An accidentally initialized engine is eligible only before any
-- job, accrual, allocation or withdrawal, with its exact initial state intact.
insert into app_private.workroom_cash_enrollments(user_id,preserved_activation_id,reason)
select w.user_id,a.id,case when a.id is null then 'DIRECT_CASH' else 'INERT_ACTIVATION_PRESERVED' end
from app_private.workroom_accounts w
left join app_private.funding_engine_activations a on a.user_id=w.user_id
where not exists(select 1 from public.funding_principal_recovery_allocations r where r.user_id=w.user_id)
 and not exists(select 1 from app_private.funding_allocation_originals r where r.user_id=w.user_id)
 and not exists(select 1 from app_private.funding_earned_receipts r where r.user_id=w.user_id)
 and not exists(select 1 from app_private.funding_engine_jobs r where r.user_id=w.user_id)
 and not exists(select 1 from public.money_source_movements m where m.user_id=w.user_id
   and m.movement_kind='CREDIT' and (not app_private.workroom_cash_credit(m) or m.effective_at<w.created_at))
 and (a.id is null or (
   a.runtime_version=2 and a.input_original->>'input_contract_version'='2'
   and a.allocation_original_id is null and a.effective_at>=w.created_at
   and not exists(select 1 from public.withdrawal_requests r where r.user_id=w.user_id)
   and not exists(select 1 from app_private.workroom_cash_intents r where r.user_id=w.user_id)
   and (select count(*) from app_private.funding_engine_state_receipts s where s.user_id=w.user_id)=1
   and exists(select 1 from app_private.funding_engine_state_receipts s where s.user_id=w.user_id
     and s.activation_id=a.id and s.revision=0 and s.previous_state_id is null
     and s.earned_receipt_id is null and s.cursor_at=a.effective_at)
   and (select count(*) from app_private.funding_condition_originals c where c.user_id=w.user_id)=1
   and exists(select 1 from app_private.funding_condition_originals c where c.user_id=w.user_id
     and c.activation_id=a.id and c.revision=0 and c.effective_at=a.effective_at
     and c.allocation_original_id is null and c.current_allocation_original_id is null)
   and (select count(*) from app_private.funding_cycle_windows c where c.user_id=w.user_id)=1
   and exists(select 1 from public.money_source_movements m where m.id=a.trigger_credit_movement_id
     and m.user_id=w.user_id and m.effective_at=a.effective_at and app_private.workroom_cash_credit(m))
   and a.principal_atomic=(select coalesce(sum(m.amount_atomic),0) from public.money_source_movements m
     where m.user_id=w.user_id and app_private.workroom_cash_credit(m))
   and exists(select 1 from public.money_source_summaries s where s.user_id=w.user_id and s.coverage='COMPLETE')
   and not exists(select 1 from public.wallet_ledger l join public.wallet_accounts q on q.id=l.wallet_account_id
     where q.user_id=w.user_id and q.currency='KRW' and l.direction='DEBIT')
 ));

-- Runs inside the existing owner-controlled signup/initialization transaction;
-- the caller gains no table INSERT permission or new callable definer.
create function app_private.workroom_cash_enroll_signup() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$begin
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 if not exists(select 1 from app_private.funding_engine_activations a where a.user_id=new.user_id)
  and not exists(select 1 from public.funding_principal_recovery_allocations a where a.user_id=new.user_id)
  and not exists(select 1 from app_private.funding_allocation_originals a where a.user_id=new.user_id)
  and not exists(select 1 from public.money_source_movements m where m.user_id=new.user_id) then
  insert into app_private.workroom_cash_enrollments(user_id,reason) values(new.user_id,'DIRECT_CASH');
 end if;return new;
end$$;
create trigger workroom_cash_enroll_signup after insert on app_private.workroom_accounts
 for each row execute function app_private.workroom_cash_enroll_signup();

-- Enrollment is a durable mode boundary. Preserved initial engine receipts are
-- historical only; no worker can subsequently turn them into a monetary reward.
create function app_private.workroom_cash_block_engine() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$begin
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 if exists(select 1 from app_private.workroom_cash_enrollments e where e.user_id=new.user_id)then
  raise exception using errcode='55000',message='WORKROOM_DIRECT_CASH_ENGINE_DISABLED';end if;
 return new;
end$$;
create trigger a0_workroom_cash_no_activation before insert on app_private.funding_engine_activations
 for each row execute function app_private.workroom_cash_block_engine();
create trigger a0_workroom_cash_no_earned before insert on app_private.funding_earned_receipts
 for each row execute function app_private.workroom_cash_block_engine();
create trigger a0_workroom_cash_no_job before insert on app_private.funding_engine_jobs
 for each row execute function app_private.workroom_cash_block_engine();
create trigger a0_workroom_cash_no_state before insert on app_private.funding_engine_state_receipts
 for each row execute function app_private.workroom_cash_block_engine();
create trigger a0_workroom_cash_no_condition before insert on app_private.funding_condition_originals
 for each row execute function app_private.workroom_cash_block_engine();
create trigger a0_workroom_cash_no_recovery before insert on public.funding_principal_recovery_allocations
 for each row execute function app_private.workroom_cash_block_engine();
create trigger a0_workroom_cash_no_allocation before insert on app_private.funding_allocation_originals
 for each row execute function app_private.workroom_cash_block_engine();

create or replace function app_private.workroom_cash_owner_ready(p_user uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select p_user is not null and exists(select 1 from auth.users u
   join app_private.workroom_accounts a on a.user_id=u.id
   where u.id=p_user and u.email_confirmed_at is not null and u.deleted_at is null
     and(u.banned_until is null or u.banned_until<=clock_timestamp()))
 and not exists(select 1 from public.funding_principal_recovery_allocations a where a.user_id=p_user)
 and not exists(select 1 from app_private.funding_engine_activations a where a.user_id=p_user
   and not exists(select 1 from app_private.workroom_cash_enrollments e
     where e.user_id=p_user and e.preserved_activation_id=a.id))
 and not exists(select 1 from app_private.funding_earned_receipts r where r.user_id=p_user)
 and not exists(select 1 from app_private.funding_engine_jobs r where r.user_id=p_user)
$$;

revoke all on function app_private.workroom_cash_enroll_signup(),app_private.workroom_cash_block_engine()
 from public,anon,authenticated,service_role;

-- Keep canonical actual-deposit clocks, originals, seals and completion proof.
-- Only legacy engine execution is inapplicable to enrolled direct-cash owners.
create or replace function app_private.begin_funding_credit_boundary(p_original uuid,p_origin text) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 activation app_private.funding_engine_activations%rowtype; earned app_private.funding_earned_receipts%rowtype;
 wallet_id uuid; calculation jsonb; message text; locked_owner uuid;
begin
 perform app_private.assert_credit_boundary_executor();
 if p_origin='KRW_DEPOSIT' then select user_id into preparation.user_id from public.deposit_requests where id=p_original;
 elsif p_origin='USDT_KRW_DEPOSIT' then select user_id into preparation.user_id from public.usdt_manual_deposits where id=p_original;
 else raise exception using errcode='22023',message='FUNDING_CREDIT_ORIGIN_INVALID'; end if;
 if preparation.user_id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_COMMAND_ORIGINAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 perform app_private.assert_funding_global_credit_allowed();
 if p_origin='KRW_DEPOSIT' then select user_id into locked_owner from public.deposit_requests where id=p_original for update;
 else select user_id into locked_owner from public.usdt_manual_deposits where id=p_original for update; end if;
 if locked_owner is distinct from preparation.user_id then raise exception using errcode='40001',message='FUNDING_CREDIT_COMMAND_OWNER_CHANGED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||preparation.user_id::text,0));
 select id into wallet_id from public.wallet_accounts where user_id=preparation.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 select * into state from app_private.funding_engine_state where user_id=preparation.user_id;
 select * into activation from app_private.funding_engine_activations where user_id=preparation.user_id;
 preparation.id:=gen_random_uuid(); preparation.origin_code:=p_origin; preparation.command_original_id:=p_original;
 preparation.previous_state_id:=state.id; preparation.settlement_expected:=false;
 select coalesce(current_allocation_original_id,allocation_original_id) into preparation.current_allocation_original_id
 from app_private.funding_condition_originals where id=state.condition_id;
 preparation.effective_at:=clock_timestamp(); preparation.recorded_at:=preparation.effective_at;
 if exists(select 1 from app_private.workroom_cash_enrollments e where e.user_id=preparation.user_id)then
  preparation.unresolved_reason_code:='WORKROOM_DIRECT_CASH_MODE';
 elsif activation.id is not null then
  if activation.runtime_version<>2 or state.id is null then preparation.unresolved_reason_code:='FUNDING_EXISTING_RUNTIME_UNSUPPORTED';
  else
   begin
    -- SETTLEMENT stops old mining execution, not the principal credit command.
    -- Its refusal becomes an audited engine exception; finance still commits.
    perform app_private.assert_funding_global_execution_allowed();
    perform app_private.assert_credit_condition_inputs(state.condition_id,preparation.effective_at);
    calculation:=app_private.calculate_credit_boundary_interval(state.id,preparation.effective_at);
    preparation.settlement_expected:=true;
   exception when sqlstate '55000' or sqlstate '42501' then
    get stacked diagnostics message=message_text;
    preparation.unresolved_reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
   end;
  end if;
 end if;
 preparation.audit_id:=gen_random_uuid(); preparation.source_event_id:=gen_random_uuid();
 preparation.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_preparation_snapshot(preparation));
 insert into app_private.funding_credit_boundary_preparations select preparation.*;
 perform app_private.write_credit_boundary_seal(preparation.id,'FUNDING_CREDIT_BOUNDARY_PREPARED',preparation.user_id,
 preparation.input_digest,preparation.audit_id,preparation.source_event_id,app_private.funding_credit_preparation_snapshot(preparation),preparation.effective_at);
 if preparation.settlement_expected then
  earned.id:=gen_random_uuid(); earned.user_id:=preparation.user_id; earned.activation_id:=activation.id; earned.cycle_id:=state.cycle_id;
  earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.settled_from:=state.cursor_at;
  earned.settled_to:=preparation.effective_at; earned.calculation:=calculation; earned.amount_atomic:=(calculation->>'amountAtomic')::bigint;
  earned.runtime_version:=2; earned.condition_id:=state.condition_id; earned.cause_credit_boundary_id:=preparation.id;
  if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
  earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
  earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
  insert into app_private.funding_earned_receipts select earned.*;
  perform app_private.post_credit_boundary_earned(earned.id);
  perform app_private.write_credit_boundary_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,earned.input_digest,
  earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned),preparation.effective_at);
 end if;
 return preparation.id;
end;
$$;


commit;
