begin;

-- A metadata flag is service-writable and is never producer authority. This
-- closed producer reads owner/amount from the existing request, admits locks,
-- captures DB time, and seals an immutable original. It creates no hold money,
-- principal confirmation, engine condition, reward, payout or automatic job.
create table app_private.funding_withdrawal_clock_admissions(
 id uuid primary key default gen_random_uuid(),schema_version integer not null default 1 check(schema_version=1),
 user_id uuid not null references auth.users(id),withdrawal_id uuid not null references public.withdrawal_requests(id),
 phase text not null check(phase in('HOLD','RELEASE')),
 hold_admission_id uuid references app_private.funding_withdrawal_clock_admissions(id),
 amount_atomic bigint not null check(amount_atomic>0),journal_request_id uuid not null,
 effective_at timestamptz not null check(isfinite(effective_at)),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 request_snapshot jsonb not null check(jsonb_typeof(request_snapshot)='object'),
 unique(withdrawal_id,phase),unique(id,user_id),
 check((phase='HOLD' and hold_admission_id is null) or(phase='RELEASE' and hold_admission_id is not null))
);
create index funding_withdrawal_clock_admissions_member on app_private.funding_withdrawal_clock_admissions(user_id,effective_at,id);
create index funding_withdrawal_clock_admissions_hold on app_private.funding_withdrawal_clock_admissions(hold_admission_id);
alter table app_private.funding_withdrawal_clock_admissions enable row level security;
alter table app_private.funding_withdrawal_clock_admissions force row level security;
revoke all on app_private.funding_withdrawal_clock_admissions from public,anon,authenticated,service_role;
grant select on app_private.funding_withdrawal_clock_admissions to service_role;
create trigger funding_withdrawal_clock_admissions_append_only before update or delete
 on app_private.funding_withdrawal_clock_admissions for each row execute function app_private.prevent_row_mutation();

create function app_private.funding_withdrawal_request_snapshot(p public.withdrawal_requests)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('withdrawal_id',p.id,'user_id',p.user_id,'wallet_account_id',p.wallet_account_id,
 'policy_id',p.withdrawal_policy_id,'destination_id',p.withdrawal_destination_id,'currency',p.currency,
 'amount_atomic',p.amount_atomic::text,'fee_atomic',p.fee_atomic::text,'method',p.destination_type,'idempotency_key',p.idempotency_key);
$$;
create function app_private.funding_withdrawal_clock_snapshot(p app_private.funding_withdrawal_clock_admissions)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('schema_version',p.schema_version,'user_id',p.user_id,'withdrawal_id',p.withdrawal_id,
 'phase',p.phase,'hold_admission_id',p.hold_admission_id,'amount_atomic',p.amount_atomic::text,
 'journal_request_id',p.journal_request_id,'effective_at_microseconds',((extract(epoch from p.effective_at)*1000000)::bigint)::text,
 'request_snapshot',p.request_snapshot,'executor_sql_role','service_role');
$$;

create function app_private.assert_funding_withdrawal_clock_admission(p_original uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;journal public.ledger_transactions%rowtype;
 hold_original app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 select a.* into original from app_private.funding_withdrawal_clock_admissions a where a.id=p_original;
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 if original.id is null or request.user_id is distinct from original.user_id
  or original.amount_atomic is distinct from request.amount_atomic+request.fee_atomic
  or request.currency<>'KRW' or request.fee_atomic<>0
  or original.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(request)
  or original.effective_at>clock_timestamp()
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_withdrawal_clock_snapshot(original)) then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 if not exists(select 1 from public.audit_logs a where a.id=original.audit_id
   and a.actor_user_id=original.user_id and a.request_id=original.journal_request_id and a.created_at=original.effective_at)
  or not exists(select 1 from public.outbox_events e where e.id=original.source_event_id
   and e.request_id=original.journal_request_id and e.correlation_id=original.journal_request_id
   and e.occurred_at=original.effective_at and e.created_at=original.effective_at) then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.funding_withdrawal_clock_snapshot(original));
 select t.* into journal from public.ledger_transactions t
  where t.id=case when original.phase='HOLD' then request.hold_ledger_transaction_id else request.release_ledger_transaction_id end;
 if journal.id is null or journal.member_user_id is distinct from original.user_id or journal.currency<>'KRW'
  or journal.reference_type is distinct from 'withdrawal_request' or journal.reference_id is distinct from request.id
  or journal.request_id is distinct from original.journal_request_id or journal.posted_at is distinct from original.effective_at
  or journal.created_at is distinct from original.effective_at
  or journal.metadata->>'phase' is distinct from original.phase
  or journal.metadata->>'portion_clock_contract' is distinct from 'HOLD_CANCEL_V1'
  or journal.metadata->>'clock_admission_id' is distinct from original.id::text
  or journal.metadata->>'admitted_at_microseconds' is distinct from ((extract(epoch from original.effective_at)*1000000)::bigint)::text
  or not app_private.withdrawal_coverage_entries_verified(journal.id,original.user_id,original.amount_atomic,original.phase) then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_JOURNAL_MISSING'; end if;
 if original.phase='HOLD' then
  if journal.idempotency_key is distinct from request.idempotency_key||':hold' or journal.category<>'WITHDRAWAL' or journal.metadata->>'amount_atomic' is distinct from original.amount_atomic::text
   or request.hold_posted_at is distinct from original.effective_at then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_HOLD_MISMATCH'; end if;
 else
  select a.* into hold_original from app_private.funding_withdrawal_clock_admissions a where a.id=original.hold_admission_id;
  if hold_original.user_id is distinct from original.user_id or hold_original.withdrawal_id is distinct from original.withdrawal_id
   or hold_original.phase is distinct from 'HOLD' or original.effective_at<hold_original.effective_at
   or journal.category<>'REVERSAL' or journal.reversal_of_transaction_id is distinct from request.hold_ledger_transaction_id
   or request.hold_released_at is distinct from original.effective_at or request.status not in('CANCELLED','REJECTED') then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_RELEASE_MISMATCH'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(hold_original.id);
 end if;
end;
$$;

create function app_private.assert_funding_withdrawal_clock_completion(p_original uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;journal public.ledger_transactions%rowtype;movement public.money_source_movements%rowtype;
 principal_count bigint;v_key text;
begin
 perform app_private.assert_funding_withdrawal_clock_admission(p_original);
 select a.* into original from app_private.funding_withdrawal_clock_admissions a where a.id=p_original;
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 select t.* into journal from public.ledger_transactions t
  where t.id=case when original.phase='HOLD' then request.hold_ledger_transaction_id else request.release_ledger_transaction_id end;
 if not exists(select 1 from public.transaction_receipts r where r.source_type='withdrawal_request' and r.source_id=request.id
   and r.user_id=original.user_id and r.currency='KRW' and r.amount_atomic=request.amount_atomic)
  or not exists(select 1 from public.outbox_events e join public.ledger_transactions h on h.id=request.hold_ledger_transaction_id
   where e.event_type='WITHDRAWAL_REQUESTED.v1' and e.schema_version=1 and e.aggregate_type='withdrawal_request'
    and e.aggregate_id=request.id and e.actor_user_id=original.user_id and e.request_id=h.request_id
    and e.idempotency_key=request.idempotency_key||':event'
    and e.payload->>'hold_ledger_transaction_id'=h.id::text and e.payload->>'amount_atomic'=request.amount_atomic::text
    and e.payload->>'fee_atomic'='0') then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_COMMAND_ORIGINAL_MISSING'; end if;
 if original.phase='RELEASE' then
  v_key:=left(journal.idempotency_key,length(journal.idempotency_key)-8);
  if right(journal.idempotency_key,8) is distinct from ':release'
   or (select count(*) from public.audit_logs a where a.action='release_withdrawal_hold'
     and a.target_type='withdrawal_request' and a.target_id=request.id::text and a.actor_user_id=journal.created_by
     and a.metadata->>'operation'='release_withdrawal_hold' and a.metadata->>'result_id'=journal.id::text
     and a.metadata->>'actor_user_id'=journal.created_by::text and a.metadata->>'amount_atomic'=request.amount_atomic::text
     and a.metadata->>'destination_id'=request.withdrawal_destination_id::text and a.metadata->>'currency'='KRW'
     and a.metadata->>'idempotency_key'=v_key)<>1
   or not exists(select 1 from public.outbox_events e where e.event_type='WITHDRAWAL_HOLD_RELEASED.v1'
     and e.schema_version=1 and e.aggregate_type='withdrawal_request' and e.aggregate_id=request.id
     and e.actor_user_id=journal.created_by and e.request_id=journal.request_id and e.idempotency_key=v_key||':event'
     and e.payload->>'release_ledger_transaction_id'=journal.id::text
     and e.payload->>'reason'=journal.metadata->>'reason' and e.payload->>'disposition'=request.status::text) then
   raise exception using errcode='55000',message='FUNDING_RELEASE_COMMAND_COMPLETION_MISSING'; end if;
 end if;
 select count(*) into principal_count from public.money_source_movements m where m.ledger_transaction_id=journal.id
  and m.user_id=original.user_id and m.origin_code=case when original.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' else 'PRINCIPAL_RECOVERY_RELEASE' end;
 if principal_count=1 then
  select m.* into movement from public.money_source_movements m where m.ledger_transaction_id=journal.id
   and m.user_id=original.user_id and m.origin_code=case when original.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' else 'PRINCIPAL_RECOVERY_RELEASE' end;
  perform app_private.assert_principal_recovery_movement(movement);
  if movement.amount_atomic is distinct from original.amount_atomic then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_SOURCE_ORIGINAL_MISSING'; end if;
 elsif principal_count<>0 or app_private.non_principal_withdrawal_coverage_verified(request) is not true then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_SOURCE_ORIGINAL_MISSING';
 end if;
end;
$$;

create function app_private.capture_funding_withdrawal_clock_admission(p_withdrawal uuid,p_phase text,p_request uuid)
returns table(admission_id uuid,effective_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;owner_id uuid;wallet_id uuid;hold_original uuid;
 snapshot jsonb;
begin
 -- Preserve the existing SQL-only service financial caller contract. This is
 -- not a member command and cannot be reached under authenticated SQL role,
 -- even if a forged JWT says service_role. No caller amount/time is accepted.
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='WITHDRAWAL_CLOCK_SERVICE_ROLE_REQUIRED'; end if;
 if p_withdrawal is null or p_request is null or p_phase not in('HOLD','RELEASE') or p_phase is null then
  raise exception using errcode='22023',message='WITHDRAWAL_CLOCK_ADMISSION_INVALID'; end if;
 select r.user_id into owner_id from public.withdrawal_requests r where r.id=p_withdrawal;
 if owner_id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=owner_id for update;
 if request.id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 select a.* into original from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=request.id and a.phase=p_phase;
 if original.id is not null then
  if original.journal_request_id is distinct from p_request then
   raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REUSED'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(original.id);
  admission_id:=original.id;effective_at:=original.effective_at;return next;return;
 end if;
 -- Immutable phase replay precedes current fresh-admission requirements.
 -- Advisory/row locks do not refresh a REPEATABLE READ snapshot after waiting.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='WITHDRAWAL_CLOCK_FRESH_SNAPSHOT_REQUIRED'; end if;
 if request.currency<>'KRW' or request.fee_atomic<>0
  or(p_phase='HOLD' and(request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null))
  or(p_phase='RELEASE' and(request.status not in('REQUESTED','HELD','ADMIN_PROCESSING','REVIEWING','APPROVED','PROCESSING')
   or request.hold_ledger_transaction_id is null or request.release_ledger_transaction_id is not null
   or exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id))) then
  raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_ADMISSION_ORIGINAL_REQUIRED'; end if;
 if p_phase='RELEASE' then
  select a.id into hold_original from app_private.funding_withdrawal_clock_admissions a
   where a.withdrawal_id=request.id and a.phase='HOLD';
  if hold_original is null then raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_HOLD_ADMISSION_REQUIRED'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(hold_original);
 end if;
 select w.id into wallet_id from public.wallet_accounts w where w.id=request.wallet_account_id
  and w.user_id=owner_id and w.currency='KRW' and w.closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND'; end if;
 -- Ensure controlled ledger accounts BEFORE the sole financial clock; an
 -- account uniqueness wait must not introduce a pre-admission effective time.
 perform 1 from app_private.ensure_withdrawal_hold_accounts(owner_id);
 original.id:=gen_random_uuid();original.schema_version:=1;original.user_id:=owner_id;original.withdrawal_id:=request.id;
 original.phase:=p_phase;original.hold_admission_id:=hold_original;original.amount_atomic:=request.amount_atomic+request.fee_atomic;
 original.journal_request_id:=p_request;original.request_snapshot:=app_private.funding_withdrawal_request_snapshot(request);
 original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 original.effective_at:=clock_timestamp();
 -- A concurrent canonical control may start AFTER this statement began.
 -- Authorize against this SAME admitted financial clock, never statement time.
 if exists(select 1 from public.safe_mode_controls c
   where c.component in('GLOBAL','WITHDRAWAL') and c.is_paused and c.starts_at<=original.effective_at) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
 snapshot:=app_private.funding_withdrawal_clock_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.funding_withdrawal_clock_admissions select original.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(original.audit_id,owner_id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED','FUNDING_ENGINE_V1',original.id::text,
  'canonical source-bound withdrawal clock admission',p_request,snapshot,
  jsonb_build_object('input_digest',original.input_digest,'engine_contract',2),original.effective_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at,available_at,last_error_code)
 values(original.source_event_id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED.v1',1,'funding_engine_v1',original.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',original.audit_id,'input_digest',original.input_digest),p_request,p_request,
  'funding:'||original.id::text||':seal',original.effective_at,original.effective_at,'infinity','FUNDING_PRINCIPAL_CONDITION_ADAPTER_NOT_ENABLED');
 admission_id:=original.id;effective_at:=original.effective_at;return next;
end;
$$;

create function app_private.verify_funding_withdrawal_clock_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if tg_table_schema<>'app_private' or tg_table_name<>'funding_withdrawal_clock_admissions'
  or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' then
  raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_COMMIT_CONTEXT_INVALID'; end if;
 if(current_setting('role',true)='service_role'
  or(current_setting('role',true) in('none','postgres') and session_user='postgres')) is not true then
  raise exception using errcode='42501',message='WITHDRAWAL_CLOCK_COMMIT_CONTEXT_FORBIDDEN'; end if;
 perform app_private.assert_funding_withdrawal_clock_completion(new.id);
 return null;
end;
$$;
create constraint trigger funding_withdrawal_clock_complete after insert on app_private.funding_withdrawal_clock_admissions
 deferrable initially deferred for each row execute function app_private.verify_funding_withdrawal_clock_commit();

create function app_private.guard_funding_withdrawal_clock_original_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if tg_table_schema='public' and tg_table_name='audit_logs' then
  if exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.audit_id=old.id) then
   raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_AUDIT_IMMUTABLE'; end if;
 elsif tg_table_schema='public' and tg_table_name='outbox_events' then
  if exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.source_event_id=old.id)
   and(tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
     is distinct from to_jsonb(old)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
   raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_EVENT_IMMUTABLE'; end if;
 elsif tg_table_schema='public' and tg_table_name='withdrawal_requests' then
  if exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=old.id)
   and(tg_op='DELETE' or app_private.funding_withdrawal_request_snapshot(new)
    is distinct from app_private.funding_withdrawal_request_snapshot(old)
    or(old.hold_ledger_transaction_id is not null and new.hold_ledger_transaction_id is distinct from old.hold_ledger_transaction_id)
    or(old.release_ledger_transaction_id is not null and new.release_ledger_transaction_id is distinct from old.release_ledger_transaction_id)
    or(old.hold_posted_at is not null and new.hold_posted_at is distinct from old.hold_posted_at)
    or(old.hold_released_at is not null and new.hold_released_at is distinct from old.hold_released_at)) then
   raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_REQUEST_ORIGINAL_IMMUTABLE'; end if;
 else raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_LINK_CONTEXT_INVALID'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_withdrawal_clock_audit_original before update or delete on public.audit_logs
 for each row execute function app_private.guard_funding_withdrawal_clock_original_links();
create trigger funding_withdrawal_clock_event_original before update or delete on public.outbox_events
 for each row execute function app_private.guard_funding_withdrawal_clock_original_links();
create trigger funding_withdrawal_clock_request_original before update or delete on public.withdrawal_requests
 for each row execute function app_private.guard_funding_withdrawal_clock_original_links();

alter function app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid) owner to postgres;
alter function app_private.verify_funding_withdrawal_clock_commit() owner to postgres;
revoke all on function app_private.funding_withdrawal_request_snapshot(public.withdrawal_requests),
 app_private.funding_withdrawal_clock_snapshot(app_private.funding_withdrawal_clock_admissions),
 app_private.assert_funding_withdrawal_clock_admission(uuid),app_private.assert_funding_withdrawal_clock_completion(uuid),app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid),
 app_private.verify_funding_withdrawal_clock_commit(),app_private.guard_funding_withdrawal_clock_original_links()
 from public,anon,authenticated,service_role;
grant execute on function app_private.funding_withdrawal_request_snapshot(public.withdrawal_requests),
 app_private.funding_withdrawal_clock_snapshot(app_private.funding_withdrawal_clock_admissions),
 app_private.assert_funding_withdrawal_clock_admission(uuid),app_private.assert_funding_withdrawal_clock_completion(uuid),app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid),
 app_private.guard_funding_withdrawal_clock_original_links() to service_role;

commit;
