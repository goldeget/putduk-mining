begin;

-- Immutable principal portion clocks; this migration never posts money,
-- qualifies retention, repairs old history, schedules jobs or releases events.
create table app_private.funding_portion_transitions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 kind text not null check(kind in('CREDIT','HOLD','RELEASE','FINALIZE')),
 revision bigint not null check(revision>0),previous_transition_id uuid,
 original_id uuid not null,effective_at timestamptz not null check(isfinite(effective_at)),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),unique(kind,original_id),unique(id,user_id),unique(user_id,revision),
 foreign key(previous_transition_id,user_id) references app_private.funding_portion_transitions(id,user_id),
 check((revision=1 and previous_transition_id is null) or(revision>1 and previous_transition_id is not null))
);
create table app_private.funding_principal_portions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 lot_id uuid not null references public.funding_principal_lots(id),
 parent_portion_id uuid references app_private.funding_principal_portions(id),
 amount_micro_krw bigint not null check(amount_micro_krw>0),
 introduced_by_transition_id uuid not null references app_private.funding_portion_transitions(id),
 recorded_at timestamptz not null default clock_timestamp(),unique(id,user_id)
);
create unique index funding_portion_one_root on app_private.funding_principal_portions(lot_id) where parent_portion_id is null;
create table app_private.funding_portion_clock_receipts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 portion_id uuid not null,revision bigint not null check(revision>=0),
 previous_clock_id uuid references app_private.funding_portion_clock_receipts(id),
 transition_id uuid not null,
 status text not null check(status in('AVAILABLE','HELD','SPLIT','RECOVERED')),
 effective_at timestamptz not null check(isfinite(effective_at)),
 accumulated_eligible_microseconds bigint not null check(accumulated_eligible_microseconds>=0),
 resumed_at timestamptz,hold_allocation_id uuid references public.funding_principal_recovery_allocations(id),
 recorded_at timestamptz not null default clock_timestamp(),unique(portion_id,revision),unique(previous_clock_id),unique(id,user_id),
 foreign key(portion_id,user_id) references app_private.funding_principal_portions(id,user_id),
 foreign key(transition_id,user_id) references app_private.funding_portion_transitions(id,user_id),
 check((status='AVAILABLE' and resumed_at is not null and resumed_at=effective_at and isfinite(resumed_at)) or(status<>'AVAILABLE' and resumed_at is null)),
 check((revision=0 and previous_clock_id is null) or(revision>0 and previous_clock_id is not null))
);
create view app_private.funding_portion_clock_state with(security_invoker=true) as
 select distinct on(portion_id) * from app_private.funding_portion_clock_receipts order by portion_id,revision desc;

do $private_clocks$
declare t text;
begin
 foreach t in array array['funding_portion_transitions','funding_principal_portions','funding_portion_clock_receipts'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('alter table app_private.%I force row level security',t);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert on app_private.%I to service_role',t);
  execute format('create trigger %I before update or delete on app_private.%I for each row execute function app_private.prevent_row_mutation()',t||'_append_only',t);
 end loop;
end;
$private_clocks$;
revoke all on app_private.funding_portion_clock_state from public,anon,authenticated,service_role;
grant select on app_private.funding_portion_clock_state to service_role;

create function app_private.funding_portion_eligible_age(
 p_accumulated bigint,p_resumed_at timestamptz,p_effective_at timestamptz,p_available boolean
) returns bigint language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare elapsed numeric;
begin
 if p_accumulated is null or p_accumulated<0 or p_effective_at is null or not isfinite(p_effective_at) or p_available is null
  or(p_available and(p_resumed_at is null or not isfinite(p_resumed_at) or p_effective_at<p_resumed_at))
  or(not p_available and p_resumed_at is not null) then
  raise exception using errcode='22023',message='FUNDING_PORTION_CLOCK_INVALID'; end if;
 elapsed:=case when p_available then extract(epoch from p_effective_at-p_resumed_at)*1000000 else 0 end;
 if elapsed+p_accumulated>9223372036854775807 then raise exception using errcode='22003',message='FUNDING_PORTION_CLOCK_OVERFLOW'; end if;
 return(p_accumulated+elapsed)::bigint;
end;
$$;

create function app_private.assert_funding_portion_executor(p_user uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user='service_role' then
  null;
 elsif current_user='postgres' then
  -- Explicit member-writer validation is NULL-safe; an owner fixture without
  -- authenticated owner claims must not silently acquire producer authority.
  perform app_private.assert_funding_member_writer(p_user);
 else
  raise exception using errcode='42501',message='FUNDING_PORTION_EXECUTOR_REQUIRED'; end if;
 if p_user is null or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_PORTION_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
end;
$$;

create function app_private.assert_funding_portion_transition(p_transition app_private.funding_portion_transitions)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 movement public.money_source_movements%rowtype;
begin
 if p_transition.effective_at>clock_timestamp() then raise exception using errcode='55000',message='FUNDING_PORTION_FUTURE_ORIGINAL'; end if;
 if p_transition.kind='CREDIT' then
  select * into lot from public.funding_principal_lots where id=p_transition.original_id;
  select * into movement from public.money_source_movements where id=lot.money_source_movement_id;
  if lot.user_id is distinct from p_transition.user_id or lot.effective_at is distinct from p_transition.effective_at
   or movement.user_id is distinct from lot.user_id or movement.source_bucket is distinct from 'PRINCIPAL'
   or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or not exists(select 1 from app_private.funding_engine_activations where user_id=lot.user_id and runtime_version=2)
   then
   raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  perform app_private.assert_money_source_credit(movement);
 elsif p_transition.kind='HOLD' then
  select * into allocation from public.funding_principal_recovery_allocations where id=p_transition.original_id;
  select * into movement from public.money_source_movements where ledger_transaction_id=allocation.hold_ledger_transaction_id
   and origin_code='PRINCIPAL_RECOVERY_HOLD';
  if allocation.user_id is distinct from p_transition.user_id or allocation.policy_code is distinct from 'NEWEST_FIRST'
   or allocation.effective_at is distinct from p_transition.effective_at or movement.user_id is distinct from allocation.user_id then
   raise exception using errcode='55000',message='FUNDING_PORTION_HOLD_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_movement(movement);
 elsif p_transition.kind='RELEASE' then
  select * into release from public.funding_principal_recovery_releases where id=p_transition.original_id;
  select * into movement from public.money_source_movements where ledger_transaction_id=release.release_ledger_transaction_id
   and origin_code='PRINCIPAL_RECOVERY_RELEASE';
  if release.user_id is distinct from p_transition.user_id or release.effective_at is distinct from p_transition.effective_at
   or movement.user_id is distinct from release.user_id then
   raise exception using errcode='55000',message='FUNDING_PORTION_RELEASE_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_movement(movement);
 elsif p_transition.kind='FINALIZE' then
  select * into request from public.withdrawal_requests where id=p_transition.original_id;
  select * into movement from public.money_source_movements where ledger_transaction_id=request.finalize_ledger_transaction_id
   and origin_code='PRINCIPAL_RECOVERY_FINALIZE';
  if request.user_id is distinct from p_transition.user_id or request.status<>'COMPLETED' or request.fee_atomic<>0
   or request.currency<>'KRW' or request.finalize_ledger_transaction_id is null
   or movement.user_id is distinct from request.user_id or movement.amount_atomic is distinct from request.amount_atomic
   or not exists(select 1 from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=request.hold_ledger_transaction_id)
   or not exists(select 1 from public.withdrawal_external_sends where withdrawal_id=request.id)
   or not app_private.withdrawal_coverage_entries_verified(request.finalize_ledger_transaction_id,request.user_id,request.amount_atomic,'FINALIZE')
   or p_transition.effective_at is distinct from(select posted_at from public.ledger_transactions where id=request.finalize_ledger_transaction_id) then
   raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_movement(movement);
 else raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_KIND_INVALID';
 end if;
 if(select coverage from public.money_source_summaries where user_id=p_transition.user_id) is distinct from 'COMPLETE' then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;

create function app_private.guard_funding_principal_portion() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; parent app_private.funding_principal_portions%rowtype;
 transition app_private.funding_portion_transitions%rowtype; clock app_private.funding_portion_clock_receipts%rowtype;
begin
 perform app_private.assert_funding_portion_executor(new.user_id);
 select * into lot from public.funding_principal_lots where id=new.lot_id;
 select * into transition from app_private.funding_portion_transitions where id=new.introduced_by_transition_id;
 perform app_private.assert_funding_portion_transition(transition);
 if lot.user_id is distinct from new.user_id or transition.user_id is distinct from new.user_id then
  raise exception using errcode='55000',message='FUNDING_PORTION_OWNER_MISMATCH'; end if;
 if new.parent_portion_id is null then
  if transition.kind<>'CREDIT' or transition.original_id is distinct from lot.id or new.amount_micro_krw<>lot.amount_micro_krw
   or exists(select 1 from public.funding_principal_recovery_allocations where lot_id=lot.id) then
   raise exception using errcode='55000',message='FUNDING_PORTION_ROOT_MISMATCH'; end if;
 else
  select * into parent from app_private.funding_principal_portions where id=new.parent_portion_id;
  select * into clock from app_private.funding_portion_clock_state where portion_id=parent.id;
  if parent.user_id is distinct from new.user_id or parent.lot_id is distinct from new.lot_id
   or new.amount_micro_krw>=parent.amount_micro_krw or transition.kind<>'HOLD'
   or clock.status is distinct from 'SPLIT' or clock.transition_id is distinct from transition.id then
   raise exception using errcode='55000',message='FUNDING_PORTION_SPLIT_ORIGINAL_REQUIRED'; end if;
 end if;
 return new;
end;
$$;
create trigger funding_portion_original_validate before insert on app_private.funding_principal_portions
 for each row execute function app_private.guard_funding_principal_portion();

create function app_private.guard_funding_portion_clock() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare portion app_private.funding_principal_portions%rowtype; previous app_private.funding_portion_clock_receipts%rowtype;
 parent_clock app_private.funding_portion_clock_receipts%rowtype; transition app_private.funding_portion_transitions%rowtype;
 hold public.funding_principal_recovery_allocations%rowtype; release public.funding_principal_recovery_releases%rowtype;
 request public.withdrawal_requests%rowtype; age bigint;
begin
 perform app_private.assert_funding_portion_executor(new.user_id);
 select * into portion from app_private.funding_principal_portions where id=new.portion_id;
 select * into transition from app_private.funding_portion_transitions where id=new.transition_id;
 perform app_private.assert_funding_portion_transition(transition);
 if portion.user_id is distinct from new.user_id or transition.user_id is distinct from new.user_id
  or new.effective_at is distinct from transition.effective_at then
  raise exception using errcode='55000',message='FUNDING_PORTION_CLOCK_OWNER_MISMATCH'; end if;
 if new.revision=0 then
  if new.transition_id is distinct from portion.introduced_by_transition_id then
   raise exception using errcode='55000',message='FUNDING_PORTION_INITIAL_CLOCK_MISMATCH'; end if;
  if portion.parent_portion_id is null then
   if transition.kind<>'CREDIT' or new.status<>'AVAILABLE' or new.accumulated_eligible_microseconds<>0 or new.hold_allocation_id is not null then
    raise exception using errcode='55000',message='FUNDING_PORTION_INITIAL_CLOCK_MISMATCH'; end if;
  else
   select * into parent_clock from app_private.funding_portion_clock_state where portion_id=portion.parent_portion_id;
   if parent_clock.status is distinct from 'SPLIT' or parent_clock.transition_id is distinct from transition.id
    or new.status not in('AVAILABLE','HELD') or new.accumulated_eligible_microseconds is distinct from parent_clock.accumulated_eligible_microseconds
    or(new.status='AVAILABLE' and new.hold_allocation_id is not null)
    or(new.status='HELD' and new.hold_allocation_id is distinct from transition.original_id) then
    raise exception using errcode='55000',message='FUNDING_PORTION_SPLIT_CLOCK_MISMATCH'; end if;
  end if;
 else
  select * into previous from app_private.funding_portion_clock_state where portion_id=new.portion_id;
  if previous.id is distinct from new.previous_clock_id or new.revision is distinct from previous.revision+1
   or new.effective_at<previous.effective_at or previous.status in('SPLIT','RECOVERED') then
   raise exception using errcode='55000',message='FUNDING_PORTION_CLOCK_STALE'; end if;
  age:=app_private.funding_portion_eligible_age(previous.accumulated_eligible_microseconds,previous.resumed_at,new.effective_at,previous.status='AVAILABLE');
  if new.accumulated_eligible_microseconds is distinct from age then
   raise exception using errcode='55000',message='FUNDING_PORTION_ELIGIBLE_AGE_MISMATCH'; end if;
  if transition.kind='HOLD' then
   select * into hold from public.funding_principal_recovery_allocations where id=transition.original_id;
   if previous.status<>'AVAILABLE' or new.status not in('HELD','SPLIT') or hold.lot_id is distinct from portion.lot_id
    or new.hold_allocation_id is distinct from hold.id then
    raise exception using errcode='55000',message='FUNDING_PORTION_HOLD_CLOCK_MISMATCH'; end if;
  elsif transition.kind='RELEASE' then
   select * into release from public.funding_principal_recovery_releases where id=transition.original_id;
   select * into hold from public.funding_principal_recovery_allocations where id=previous.hold_allocation_id;
   if previous.status<>'HELD' or new.status<>'AVAILABLE' or hold.hold_ledger_transaction_id is distinct from release.hold_ledger_transaction_id
    or new.hold_allocation_id is not null then
    raise exception using errcode='55000',message='FUNDING_PORTION_RELEASE_CLOCK_MISMATCH'; end if;
  elsif transition.kind='FINALIZE' then
   select * into request from public.withdrawal_requests where id=transition.original_id;
   select * into hold from public.funding_principal_recovery_allocations where id=previous.hold_allocation_id;
   if previous.status<>'HELD' or new.status<>'RECOVERED' or hold.hold_ledger_transaction_id is distinct from request.hold_ledger_transaction_id
    or new.hold_allocation_id is distinct from previous.hold_allocation_id then
    raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_CLOCK_MISMATCH'; end if;
  else raise exception using errcode='55000',message='FUNDING_PORTION_CLOCK_CAUSE_MISMATCH'; end if;
 end if;
 return new;
end;
$$;
create trigger funding_portion_clock_validate before insert on app_private.funding_portion_clock_receipts
 for each row execute function app_private.guard_funding_portion_clock();

create function app_private.funding_portion_transition_snapshot(p_transition app_private.funding_portion_transitions)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_transition.user_id,'kind',p_transition.kind,'original_id',p_transition.original_id,
  'revision',p_transition.revision::text,'previous_transition_id',p_transition.previous_transition_id,
  'effective_at_microseconds',((extract(epoch from p_transition.effective_at)*1000000)::bigint)::text);
$$;

create function app_private.guard_funding_portion_transition() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare previous app_private.funding_portion_transitions%rowtype;
begin
 perform app_private.assert_funding_portion_executor(new.user_id);
 perform app_private.assert_funding_portion_transition(new);
 select * into previous from app_private.funding_portion_transitions where user_id=new.user_id order by revision desc limit 1;
 if new.revision is distinct from coalesce(previous.revision,0)+1
  or new.previous_transition_id is distinct from previous.id
  or(previous.id is not null and new.effective_at<previous.effective_at)
  or exists(select 1 from app_private.funding_engine_state where user_id=new.user_id and cursor_at>new.effective_at)
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_STALE'; end if;
 return new;
end;
$$;
create trigger funding_portion_transition_validate before insert on app_private.funding_portion_transitions
 for each row execute function app_private.guard_funding_portion_transition();

create function app_private.verify_funding_portion_fact(p_transition app_private.funding_portion_transitions) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 candidate record; expected jsonb:='[]'; actual jsonb; left_micro bigint; take_micro bigint; amount_micro bigint;
begin
 perform app_private.assert_funding_portion_transition(p_transition);
 if p_transition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(p_transition)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_DIGEST_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(p_transition.id,'FUNDING_PORTION_CLOCK_CHANGED',p_transition.user_id,p_transition.input_digest,
  p_transition.audit_id,p_transition.source_event_id,app_private.funding_portion_transition_snapshot(p_transition));
 if p_transition.kind='CREDIT' then
  if not exists(select 1 from app_private.funding_principal_portions p join app_private.funding_portion_clock_receipts c
   on c.portion_id=p.id where p.introduced_by_transition_id=p_transition.id and p.parent_portion_id is null
   and c.transition_id=p_transition.id and c.revision=0)
   or(select count(*) from app_private.funding_principal_portions where introduced_by_transition_id=p_transition.id)<>1
   or(select count(*) from app_private.funding_portion_clock_receipts where transition_id=p_transition.id)<>1 then
   raise exception using errcode='55000',message='FUNDING_PORTION_INITIAL_CLOCK_MISSING'; end if;
 elsif p_transition.kind='HOLD' then
  select * into allocation from public.funding_principal_recovery_allocations where id=p_transition.original_id;
  perform app_private.assert_funding_portion_lot_order(allocation.hold_ledger_transaction_id);
  left_micro:=allocation.allocation_micro_krw;
  -- Reconstruct only the immediately preceding immutable clock, never a guessed
  -- present-day age. Source order and same-lot shortest-age order are distinct.
  for candidate in
   select p.id,p.amount_micro_krw,
    app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,p_transition.effective_at,true) as age
   from app_private.funding_principal_portions p
   join lateral(select * from app_private.funding_portion_clock_receipts old_clock
    join app_private.funding_portion_transitions old_transition on old_transition.id=old_clock.transition_id
    where old_clock.portion_id=p.id and old_transition.revision<p_transition.revision
    order by old_clock.revision desc limit 1)c on true
   where p.lot_id=allocation.lot_id and c.status='AVAILABLE'
   order by age,p.id
  loop
   take_micro:=least(left_micro,candidate.amount_micro_krw);
   if take_micro=0 then exit; end if;
   expected:=expected||jsonb_build_array(jsonb_build_object('portion_id',candidate.id,'amount_micro_krw',take_micro::text));
   left_micro:=left_micro-take_micro;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('portion_id',p.id,'amount_micro_krw',
   case when c.status='HELD' then p.amount_micro_krw::text else
    (select sum(child.amount_micro_krw)::bigint::text from app_private.funding_principal_portions child
     join app_private.funding_portion_clock_receipts child_clock on child_clock.portion_id=child.id
     where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id and child_clock.transition_id=p_transition.id and child_clock.status='HELD') end)
    order by c.accumulated_eligible_microseconds,p.id),'[]') into actual
  from app_private.funding_portion_clock_receipts c join app_private.funding_principal_portions p on p.id=c.portion_id
  where c.transition_id=p_transition.id and c.revision>0 and c.status in('HELD','SPLIT');
  if left_micro<>0 or actual is distinct from expected then
   raise exception using errcode='55000',message='FUNDING_PORTION_SHORTEST_AGE_ORDER_REQUIRED'; end if;
  if exists(select 1 from app_private.funding_portion_clock_receipts c join app_private.funding_principal_portions p on p.id=c.portion_id
   where c.transition_id=p_transition.id and c.status='SPLIT' and
    ((select count(*) from app_private.funding_principal_portions child where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id)<>2
     or(select sum(child.amount_micro_krw) from app_private.funding_principal_portions child where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id)<>p.amount_micro_krw
     or(select count(*) from app_private.funding_principal_portions child join app_private.funding_portion_clock_receipts cc on cc.portion_id=child.id
       where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id and cc.transition_id=p_transition.id and cc.status='HELD')<>1
     or(select count(*) from app_private.funding_principal_portions child join app_private.funding_portion_clock_receipts cc on cc.portion_id=child.id
       where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id and cc.transition_id=p_transition.id and cc.status='AVAILABLE')<>1)) then
   raise exception using errcode='55000',message='FUNDING_PORTION_SPLIT_CONSERVATION_REQUIRED'; end if;
 elsif p_transition.kind='RELEASE' then
  select * into release from public.funding_principal_recovery_releases where id=p_transition.original_id;
  select sum(allocation_micro_krw) into amount_micro from public.funding_principal_recovery_allocations
   where hold_ledger_transaction_id=release.hold_ledger_transaction_id and user_id=p_transition.user_id;
  if(select sum(p.amount_micro_krw) from app_private.funding_portion_clock_receipts c
   join app_private.funding_principal_portions p on p.id=c.portion_id where c.transition_id=p_transition.id and c.status='AVAILABLE') is distinct from amount_micro then
   raise exception using errcode='55000',message='FUNDING_PORTION_RELEASE_CONSERVATION_REQUIRED'; end if;
 else
  select * into request from public.withdrawal_requests where id=p_transition.original_id;
  if(select sum(p.amount_micro_krw) from app_private.funding_portion_clock_receipts c
   join app_private.funding_principal_portions p on p.id=c.portion_id where c.transition_id=p_transition.id and c.status='RECOVERED') is distinct from request.amount_atomic*1000000 then
   raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_CONSERVATION_REQUIRED'; end if;
 end if;
 return;
end;
$$;
create function app_private.verify_funding_portion_transition() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare transition app_private.funding_portion_transitions%rowtype; transition_id uuid; v_role text;
begin
 if tg_table_schema<>'app_private' or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW'
  or tg_table_name not in('funding_portion_transitions','funding_principal_portions','funding_portion_clock_receipts') then
  raise exception using errcode='55000',message='FUNDING_PORTION_COMMIT_TRIGGER_CONTEXT_INVALID'; end if;
 if tg_table_name='funding_portion_transitions' then transition_id:=new.id;
 elsif tg_table_name='funding_principal_portions' then transition_id:=new.introduced_by_transition_id;
 else transition_id:=new.transition_id; end if;
 select * into transition from app_private.funding_portion_transitions t where t.id=transition_id;
 -- Deferred validation executes after the canonical definer returned. Read
 -- privileges are limited to this trigger's exact NEW original; no private
 -- relation or helper EXECUTE grant is restored to authenticated callers.
 v_role:=current_setting('role',true);
 if v_role='authenticated' then
  if auth.role() is distinct from 'authenticated' or auth.uid() is distinct from transition.user_id then
   raise exception using errcode='42501',message='FUNDING_PORTION_COMMIT_CONTEXT_FORBIDDEN'; end if;
 elsif v_role='service_role' then
  null;
 elsif not(v_role in('none','postgres') and session_user='postgres') or v_role is null then
  raise exception using errcode='42501',message='FUNDING_PORTION_COMMIT_CONTEXT_FORBIDDEN';
 end if;
 perform app_private.verify_funding_portion_fact(transition);
 return null;
end;
$$;
create constraint trigger funding_portion_transition_complete after insert on app_private.funding_portion_transitions
 deferrable initially deferred for each row execute function app_private.verify_funding_portion_transition();
create constraint trigger funding_portion_original_complete after insert on app_private.funding_principal_portions
 deferrable initially deferred for each row execute function app_private.verify_funding_portion_transition();
create constraint trigger funding_portion_clock_complete after insert on app_private.funding_portion_clock_receipts
 deferrable initially deferred for each row execute function app_private.verify_funding_portion_transition();

create function app_private.assert_funding_portion_lot_order(p_hold uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare hold record; lot record; remaining bigint; take_micro bigint; expected jsonb:='[]'; actual jsonb;
begin
 select user_id,sum(allocation_micro_krw)::bigint as amount,min(effective_at) as effective_at,max(effective_at) as latest
 into hold from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=p_hold group by user_id;
 if hold.user_id is null or hold.effective_at is distinct from hold.latest
  or(select count(distinct user_id) from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=p_hold)<>1 then
  raise exception using errcode='55000',message='FUNDING_PORTION_HOLD_ORIGINAL_REQUIRED'; end if;
 remaining:=hold.amount;
 for lot in select p.id,p.amount_micro_krw-coalesce((select sum(a.allocation_micro_krw) from public.funding_principal_recovery_allocations a
   where a.lot_id=p.id and a.hold_ledger_transaction_id<>p_hold and a.effective_at<=hold.effective_at
    and not exists(select 1 from public.funding_principal_recovery_releases r
     where r.hold_ledger_transaction_id=a.hold_ledger_transaction_id and r.effective_at<=hold.effective_at)),0) as available
  from public.funding_principal_lots p where p.user_id=hold.user_id and p.effective_at<=hold.effective_at
  order by p.effective_at desc,p.recorded_at desc,p.id desc loop
  if lot.available<0 then raise exception using errcode='55000',message='FUNDING_PORTION_LOT_BALANCE_INVALID'; end if;
  take_micro:=least(remaining,lot.available);
  if take_micro>0 then expected:=expected||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'amount_micro_krw',take_micro::text)); end if;
  remaining:=remaining-take_micro; exit when remaining=0;
 end loop;
 select jsonb_agg(jsonb_build_object('lot_id',lot_id,'amount_micro_krw',allocation_micro_krw::text) order by ordinal) into actual
 from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=p_hold;
 if remaining<>0 or expected is distinct from actual then
  raise exception using errcode='55000',message='FUNDING_PORTION_NEWEST_LOT_ORDER_REQUIRED'; end if;
end;
$$;

create function app_private.begin_funding_portion_transition(p_kind text,p_original uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare transition app_private.funding_portion_transitions%rowtype; previous app_private.funding_portion_transitions%rowtype;
 instant timestamptz; owner_id uuid;
 request_id uuid:=gen_random_uuid(); snapshot jsonb;
begin
 if p_kind='CREDIT' then select user_id,effective_at into owner_id,instant from public.funding_principal_lots where id=p_original;
 elsif p_kind='HOLD' then select user_id,effective_at into owner_id,instant from public.funding_principal_recovery_allocations where id=p_original;
 elsif p_kind='RELEASE' then select user_id,effective_at into owner_id,instant from public.funding_principal_recovery_releases where id=p_original;
 elsif p_kind='FINALIZE' then select r.user_id,j.posted_at into owner_id,instant from public.withdrawal_requests r
  join public.ledger_transactions j on j.id=r.finalize_ledger_transaction_id where r.id=p_original;
 else raise exception using errcode='22023',message='FUNDING_PORTION_TRANSITION_KIND_INVALID'; end if;
 perform app_private.assert_funding_portion_executor(owner_id);
 select * into transition from app_private.funding_portion_transitions where kind=p_kind and original_id=p_original;
 if transition.id is not null then
  perform app_private.verify_funding_portion_fact(transition);
  return transition.id;
 end if;
 select * into previous from app_private.funding_portion_transitions where user_id=owner_id order by revision desc limit 1;
 transition.id:=gen_random_uuid(); transition.user_id:=owner_id; transition.kind:=p_kind;
 transition.revision:=coalesce(previous.revision,0)+1; transition.previous_transition_id:=previous.id;
 transition.original_id:=p_original; transition.effective_at:=instant; transition.recorded_at:=clock_timestamp();
 transition.audit_id:=gen_random_uuid(); transition.source_event_id:=gen_random_uuid();
 perform app_private.assert_funding_portion_transition(transition);
 snapshot:=app_private.funding_portion_transition_snapshot(transition);
 transition.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.funding_portion_transitions select transition.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata)
 values(transition.audit_id,owner_id,'FUNDING_PORTION_CLOCK_CHANGED','FUNDING_ENGINE_V1',transition.id::text,
  'immutable principal portion clock original',request_id,snapshot,jsonb_build_object('input_digest',transition.input_digest,'engine_contract',2));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(transition.source_event_id,'FUNDING_PORTION_CLOCK_CHANGED.v1',1,'funding_engine_v1',transition.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',transition.audit_id,'input_digest',transition.input_digest),request_id,request_id,
  'funding:'||transition.id::text||':seal','infinity','FUNDING_PORTION_CONSUMER_NOT_ENABLED');
 return transition.id;
end;
$$;

create function app_private.initialize_funding_portion_clock(p_lot uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; transition uuid; portion uuid;
begin
 select * into lot from public.funding_principal_lots where id=p_lot;
 perform app_private.assert_funding_portion_executor(lot.user_id);
 select id into portion from app_private.funding_principal_portions where lot_id=p_lot and parent_portion_id is null;
 if portion is not null then
  perform app_private.begin_funding_portion_transition('CREDIT',p_lot);
  return portion;
 end if;
 if exists(select 1 from public.funding_principal_recovery_allocations where lot_id=p_lot) then
  raise exception using errcode='55000',message='FUNDING_PORTION_EXISTING_HOLD_HISTORY_UNSUPPORTED'; end if;
 transition:=app_private.begin_funding_portion_transition('CREDIT',p_lot); portion:=gen_random_uuid();
 insert into app_private.funding_principal_portions(id,user_id,lot_id,amount_micro_krw,introduced_by_transition_id)
 values(portion,lot.user_id,lot.id,lot.amount_micro_krw,transition);
 insert into app_private.funding_portion_clock_receipts(user_id,portion_id,revision,transition_id,status,effective_at,
  accumulated_eligible_microseconds,resumed_at)
 values(lot.user_id,portion,0,transition,'AVAILABLE',lot.effective_at,0,lot.effective_at);
 return portion;
end;
$$;

create function app_private.apply_funding_portion_hold(p_allocation uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype; transition uuid; current_clock record;
 next_clock uuid; held_child uuid; available_child uuid; left_micro bigint; take_micro bigint; age bigint;
begin
 select * into allocation from public.funding_principal_recovery_allocations where id=p_allocation;
 perform app_private.assert_funding_portion_executor(allocation.user_id);
 select id into transition from app_private.funding_portion_transitions where kind='HOLD' and original_id=p_allocation;
 if transition is not null then
  perform app_private.begin_funding_portion_transition('HOLD',p_allocation);
  return transition;
 end if;
 perform app_private.assert_funding_portion_lot_order(allocation.hold_ledger_transaction_id);
 transition:=app_private.begin_funding_portion_transition('HOLD',p_allocation);
 left_micro:=allocation.allocation_micro_krw;
 for current_clock in select c.*,p.amount_micro_krw,p.lot_id,
  app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,allocation.effective_at,true) as eligible_age
  from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
  where p.lot_id=allocation.lot_id and c.status='AVAILABLE' order by eligible_age,p.id loop
  take_micro:=least(left_micro,current_clock.amount_micro_krw); exit when take_micro=0;
  age:=current_clock.eligible_age; next_clock:=gen_random_uuid();
  insert into app_private.funding_portion_clock_receipts(id,user_id,portion_id,revision,previous_clock_id,transition_id,status,
   effective_at,accumulated_eligible_microseconds,hold_allocation_id)
  values(next_clock,allocation.user_id,current_clock.portion_id,current_clock.revision+1,current_clock.id,transition,
   case when take_micro=current_clock.amount_micro_krw then 'HELD' else 'SPLIT' end,allocation.effective_at,age,p_allocation);
  if take_micro<current_clock.amount_micro_krw then
   held_child:=gen_random_uuid(); available_child:=gen_random_uuid();
   insert into app_private.funding_principal_portions(id,user_id,lot_id,parent_portion_id,amount_micro_krw,introduced_by_transition_id) values
    (held_child,allocation.user_id,current_clock.lot_id,current_clock.portion_id,take_micro,transition),
    (available_child,allocation.user_id,current_clock.lot_id,current_clock.portion_id,current_clock.amount_micro_krw-take_micro,transition);
   insert into app_private.funding_portion_clock_receipts(user_id,portion_id,revision,transition_id,status,effective_at,
    accumulated_eligible_microseconds,resumed_at,hold_allocation_id) values
    (allocation.user_id,held_child,0,transition,'HELD',allocation.effective_at,age,null,p_allocation),
    (allocation.user_id,available_child,0,transition,'AVAILABLE',allocation.effective_at,age,allocation.effective_at,null);
  end if;
  left_micro:=left_micro-take_micro;
 end loop;
 if left_micro<>0 then raise exception using errcode='55000',message='FUNDING_PORTION_AVAILABLE_ORIGINAL_REQUIRED'; end if;
 return transition;
end;
$$;

create function app_private.apply_funding_portion_disposition(p_kind text,p_original uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 transition uuid; owner_id uuid; hold_id uuid; instant timestamptz; clock record;
begin
 if p_kind='RELEASE' then
  select * into release from public.funding_principal_recovery_releases where id=p_original;
  owner_id:=release.user_id; hold_id:=release.hold_ledger_transaction_id; instant:=release.effective_at;
 elsif p_kind='FINALIZE' then
  select * into request from public.withdrawal_requests where id=p_original;
  owner_id:=request.user_id; hold_id:=request.hold_ledger_transaction_id;
  select posted_at into instant from public.ledger_transactions where id=request.finalize_ledger_transaction_id;
 else raise exception using errcode='22023',message='FUNDING_PORTION_DISPOSITION_INVALID'; end if;
 perform app_private.assert_funding_portion_executor(owner_id);
 select id into transition from app_private.funding_portion_transitions where kind=p_kind and original_id=p_original;
 if transition is not null then
  perform app_private.begin_funding_portion_transition(p_kind,p_original);
  return transition;
 end if;
 transition:=app_private.begin_funding_portion_transition(p_kind,p_original);
 for clock in select c.* from app_private.funding_portion_clock_state c
  join public.funding_principal_recovery_allocations a on a.id=c.hold_allocation_id
  where c.user_id=owner_id and c.status='HELD' and a.hold_ledger_transaction_id=hold_id order by c.portion_id loop
  insert into app_private.funding_portion_clock_receipts(user_id,portion_id,revision,previous_clock_id,transition_id,status,effective_at,
   accumulated_eligible_microseconds,resumed_at,hold_allocation_id)
  values(owner_id,clock.portion_id,clock.revision+1,clock.id,transition,
   case when p_kind='RELEASE' then 'AVAILABLE' else 'RECOVERED' end,instant,clock.accumulated_eligible_microseconds,
   case when p_kind='RELEASE' then instant else null end,case when p_kind='FINALIZE' then clock.hold_allocation_id else null end);
 end loop;
 return transition;
end;
$$;

-- Seed only the newly accepted V2 activation's genuine fresh credit. This does
-- not attach to deposits, fabricate historical clocks, schedule jobs, or widen
-- the foreground source-history support in 126.
create function app_private.initialize_activated_funding_portion() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot_id uuid;
begin
 if new.runtime_version=2 then
  select id into lot_id from public.funding_principal_lots where money_source_movement_id=new.trigger_credit_movement_id;
  if lot_id is null then raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  perform app_private.initialize_funding_portion_clock(lot_id);
 end if;
 return new;
end;
$$;
create trigger funding_activation_portion_initialize after insert on app_private.funding_engine_activations
 for each row execute function app_private.initialize_activated_funding_portion();

create function app_private.guard_funding_portion_event() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from app_private.funding_portion_transitions where source_event_id=old.id)
  and(tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
    is distinct from to_jsonb(old)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
  raise exception using errcode='55000',message='FUNDING_OPERATIONAL_ORIGINAL_IMMUTABLE'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_portion_event_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_funding_portion_event();

do $close_portion_functions$
declare f record;
begin
 for f in select oid::regprocedure identity from pg_proc where pronamespace='app_private'::regnamespace
  and proname in('funding_portion_eligible_age','assert_funding_portion_executor','assert_funding_portion_transition',
   'guard_funding_principal_portion','guard_funding_portion_clock','funding_portion_transition_snapshot',
   'guard_funding_portion_transition','verify_funding_portion_fact','verify_funding_portion_transition',
   'assert_funding_portion_lot_order','begin_funding_portion_transition','initialize_funding_portion_clock',
   'apply_funding_portion_hold','apply_funding_portion_disposition','initialize_activated_funding_portion','guard_funding_portion_event') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity);
  execute format('grant execute on function %s to service_role',f.identity);
 end loop;
end;
$close_portion_functions$;
comment on table app_private.funding_portion_clock_receipts is
 'Receipt-bound principal eligible age: PAUSE held interval, prospective resume, immutable split ancestry; no retention payout authority.';
comment on function app_private.apply_funding_portion_hold(uuid) is
 'Canonical actual NEWEST_FIRST allocation original only; same-lot shortest eligible age then immutable portion UUID ASC. No money posting or generic source label.';
alter function app_private.verify_funding_portion_transition() owner to postgres;
revoke all on function app_private.verify_funding_portion_transition() from public,anon,authenticated,service_role;

commit;
