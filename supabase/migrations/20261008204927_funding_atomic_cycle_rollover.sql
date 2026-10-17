begin;
-- One canonical earned writer owns terminal payment and the following window.
-- This internal extension accepts an earned original, never caller money/time.
create table app_private.funding_cycle_rollovers(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 activation_id uuid not null references app_private.funding_engine_activations(id),
 earned_receipt_id uuid not null unique references app_private.funding_earned_receipts(id),
 closed_state_id uuid not null unique references app_private.funding_engine_state_receipts(id),
 next_state_id uuid not null unique references app_private.funding_engine_state_receipts(id) deferrable initially deferred,
 previous_cycle_id uuid not null unique references app_private.funding_cycle_windows(id),
 next_cycle_id uuid not null unique references app_private.funding_cycle_windows(id),
 condition_id uuid not null references app_private.funding_condition_originals(id),
 base_capacity_num numeric not null,base_capacity_den numeric not null,
 retention_capacity_num numeric not null,retention_capacity_den numeric not null,
 carry_num numeric not null,carry_den numeric not null,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 recorded_at timestamptz not null default clock_timestamp());
alter table app_private.funding_cycle_rollovers enable row level security;
alter table app_private.funding_cycle_rollovers force row level security;
revoke all on app_private.funding_cycle_rollovers from public,anon,authenticated,service_role;
grant select,insert on app_private.funding_cycle_rollovers to service_role;
create trigger funding_cycle_rollovers_immutable before update or delete on app_private.funding_cycle_rollovers
for each row execute function app_private.prevent_row_mutation();
alter table app_private.funding_engine_state_receipts add column rollover_id uuid unique references app_private.funding_cycle_rollovers(id) deferrable initially deferred;
alter table app_private.funding_engine_state_receipts drop constraint funding_engine_state_receipts_check1,
 add constraint funding_state_single_cause check(
 (revision=0 and previous_state_id is null and earned_receipt_id is null and rollover_id is null)
 or(revision>0 and previous_state_id is not null and ((earned_receipt_id is not null and rollover_id is null)
 or(earned_receipt_id is null and rollover_id is not null))));
create or replace view app_private.funding_engine_state with(security_invoker=true) as
select distinct on(user_id) * from app_private.funding_engine_state_receipts order by user_id,revision desc;
create function app_private.funding_cycle_rollover_snapshot(p app_private.funding_cycle_rollovers) returns jsonb
language sql immutable security invoker set search_path=pg_catalog as $$
 select to_jsonb(p)-array['input_digest','audit_id','source_event_id','recorded_at'];
$$;
create function app_private.validate_funding_rollover_state(p app_private.funding_engine_state_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r app_private.funding_cycle_rollovers%rowtype;old app_private.funding_engine_state_receipts%rowtype;
 previous_cycle app_private.funding_cycle_windows%rowtype;next_cycle app_private.funding_cycle_windows%rowtype;
begin
 select * into r from app_private.funding_cycle_rollovers where id=p.rollover_id;
 select * into old from app_private.funding_engine_state_receipts where id=r.closed_state_id;
 select * into previous_cycle from app_private.funding_cycle_windows where id=r.previous_cycle_id;
 select * into next_cycle from app_private.funding_cycle_windows where id=r.next_cycle_id;
 if r.id is null or not old.cycle_closed or old.earned_receipt_id is distinct from r.earned_receipt_id
  or p.id is distinct from r.next_state_id or p.user_id is distinct from r.user_id
  or old.user_id is distinct from p.user_id or p.activation_id is distinct from r.activation_id
  or p.previous_state_id is distinct from old.id or p.revision is distinct from old.revision+1
  or p.earned_receipt_id is not null or p.condition_id is distinct from r.condition_id
  or p.cycle_id is distinct from next_cycle.id or p.cursor_at is distinct from previous_cycle.cycle_end
  or p.cursor_at is distinct from next_cycle.cycle_started_at or p.cycle_closed
  or next_cycle.user_id is distinct from p.user_id or next_cycle.cycle_ordinal<>previous_cycle.cycle_ordinal+1
  or next_cycle.cycle_days<>30 or previous_cycle.cycle_days<>30
  or p.base_used_num<>0 or p.base_used_den<>1 or p.retention_used_num<>0 or p.retention_used_den<>1
  or p.carry_num is distinct from old.carry_num or p.carry_den is distinct from old.carry_den
  or p.carry_num is distinct from r.carry_num or p.carry_den is distinct from r.carry_den then
  raise exception using errcode='55000',message='FUNDING_ROLLOVER_STATE_INVALID';end if;
end;
$$;
create function app_private.verify_funding_cycle_rollover() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare s app_private.funding_engine_state_receipts%rowtype;e app_private.funding_earned_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;expected_base numeric[];expected_retention numeric[];
begin
 select * into s from app_private.funding_engine_state_receipts where id=new.next_state_id;
 select * into e from app_private.funding_earned_receipts where id=new.earned_receipt_id;
 select * into condition from app_private.funding_condition_originals where id=new.condition_id;
 perform app_private.validate_funding_rollover_state(s);
 perform app_private.verify_neutral_funding_job_earned(e);
 expected_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
 expected_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
 if new.user_id is distinct from e.user_id or new.activation_id is distinct from e.activation_id
  or new.closed_state_id is distinct from e.next_state_id or condition.id is distinct from e.condition_id
  or array[new.base_capacity_num,new.base_capacity_den] is distinct from expected_base
  or array[new.retention_capacity_num,new.retention_capacity_den] is distinct from expected_retention
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_cycle_rollover_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_ROLLOVER_SOURCE_INVALID';end if;
 perform app_private.assert_funding_engine_seal(new.id,'FUNDING_CYCLE_ROLLED',new.user_id,new.input_digest,
  new.audit_id,new.source_event_id,app_private.funding_cycle_rollover_snapshot(new));
 return null;
end;
$$;
create constraint trigger funding_cycle_rollover_complete after insert on app_private.funding_cycle_rollovers
deferrable initially deferred for each row execute function app_private.verify_funding_cycle_rollover();
create function app_private.open_next_funding_cycle(p_earned uuid) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e app_private.funding_earned_receipts%rowtype;old app_private.funding_engine_state_receipts%rowtype;
 previous_cycle app_private.funding_cycle_windows%rowtype;next_cycle app_private.funding_cycle_windows%rowtype;
 condition app_private.funding_condition_originals%rowtype;r app_private.funding_cycle_rollovers%rowtype;
 base numeric[];retention numeric[];
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED';end if;
 select * into e from app_private.funding_earned_receipts where id=p_earned;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||e.user_id::text,0));
 select * into r from app_private.funding_cycle_rollovers where earned_receipt_id=e.id;
 if r.id is not null then
  perform app_private.assert_funding_engine_seal(r.id,'FUNDING_CYCLE_ROLLED',r.user_id,r.input_digest,r.audit_id,r.source_event_id,
   app_private.funding_cycle_rollover_snapshot(r));return r.next_state_id;end if;
 select * into old from app_private.funding_engine_state_receipts where id=e.next_state_id;
 select * into previous_cycle from app_private.funding_cycle_windows where id=old.cycle_id;
 select * into condition from app_private.funding_condition_originals where id=old.condition_id;
 if e.id is null or not old.cycle_closed or old.id is distinct from(select id from app_private.funding_engine_state where user_id=e.user_id)
  or e.settled_to is distinct from previous_cycle.cycle_end or e.settled_to>clock_timestamp()
  or not(e.calculation ? 'retentionComponentOriginal') then
  raise exception using errcode='55000',message='FUNDING_ROLLOVER_TERMINAL_REQUIRED';end if;
 perform app_private.verify_neutral_funding_job_earned(e);
 select * into next_cycle from app_private.funding_cycle_windows where user_id=e.user_id and cycle_ordinal=previous_cycle.cycle_ordinal+1;
 if next_cycle.id is null then
  insert into app_private.funding_cycle_windows(user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end)
  values(e.user_id,previous_cycle.cycle_ordinal+1,30,previous_cycle.cycle_end,previous_cycle.cycle_end+interval '30 days') returning * into next_cycle;
 end if;
 if next_cycle.cycle_started_at is distinct from previous_cycle.cycle_end or next_cycle.cycle_days<>30 then
  raise exception using errcode='55000',message='FUNDING_CYCLE_BOUNDARY_MISMATCH';end if;
 base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
 retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
 r.id:=gen_random_uuid();r.user_id:=e.user_id;r.activation_id:=e.activation_id;r.earned_receipt_id:=e.id;
 r.closed_state_id:=old.id;r.next_state_id:=gen_random_uuid();r.previous_cycle_id:=old.cycle_id;r.next_cycle_id:=next_cycle.id;
 r.condition_id:=old.condition_id;r.base_capacity_num:=base[1];r.base_capacity_den:=base[2];
 r.retention_capacity_num:=retention[1];r.retention_capacity_den:=retention[2];r.carry_num:=old.carry_num;r.carry_den:=old.carry_den;
 r.audit_id:=gen_random_uuid();r.source_event_id:=gen_random_uuid();r.recorded_at:=clock_timestamp();
 r.input_digest:=app_private.funding_engine_digest(app_private.funding_cycle_rollover_snapshot(r));
 insert into app_private.funding_cycle_rollovers select r.*;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
 cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,cycle_closed,condition_id,rollover_id)
 values(r.next_state_id,e.user_id,e.activation_id,next_cycle.id,old.revision+1,old.id,next_cycle.cycle_started_at,
  0,1,0,1,old.carry_num,old.carry_den,false,old.condition_id,r.id);
 perform app_private.write_funding_engine_seal(r.id,'FUNDING_CYCLE_ROLLED',r.user_id,r.input_digest,r.audit_id,r.source_event_id,
  app_private.funding_cycle_rollover_snapshot(r));
 return r.next_state_id;
end;
$$;
revoke all on function app_private.open_next_funding_cycle(uuid),app_private.funding_cycle_rollover_snapshot(app_private.funding_cycle_rollovers),
 app_private.validate_funding_rollover_state(app_private.funding_engine_state_receipts),app_private.verify_funding_cycle_rollover()
 from public,anon,authenticated,service_role;
grant execute on function app_private.open_next_funding_cycle(uuid),app_private.funding_cycle_rollover_snapshot(app_private.funding_cycle_rollovers),
 app_private.validate_funding_rollover_state(app_private.funding_engine_state_receipts),app_private.verify_funding_cycle_rollover() to service_role;
-- A receipt binds immutable audit and event payloads; queue lease/status remain operational.
create function app_private.guard_funding_rollover_envelope() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare bound boolean;mutable text[];
begin
 if tg_table_name='outbox_events' then
  bound:=exists(select 1 from app_private.funding_cycle_rollovers where source_event_id=old.id);
  mutable:=array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'];
 else
  bound:=exists(select 1 from app_private.funding_cycle_rollovers where audit_id=old.id);
  mutable:=array[]::text[];
 end if;
 if bound and(tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable) then
  raise exception using errcode='55000',message='FUNDING_ROLLOVER_ENVELOPE_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
revoke all on function app_private.guard_funding_rollover_envelope() from public,anon,authenticated,service_role;
grant execute on function app_private.guard_funding_rollover_envelope() to service_role;
create trigger funding_rollover_outbox_immutable before update or delete on public.outbox_events
for each row execute function app_private.guard_funding_rollover_envelope();
create trigger funding_rollover_audit_immutable before update or delete on public.audit_logs
for each row execute function app_private.guard_funding_rollover_envelope();
-- Existing reader/guard/writer linkage generated from verified current source.
create or replace function app_private.guard_funding_state_receipt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a app_private.funding_engine_activations%rowtype; v_previous app_private.funding_engine_state_receipts%rowtype;
  v_earned app_private.funding_earned_receipts%rowtype; v_cycle app_private.funding_cycle_windows%rowtype;
begin
 if new.rollover_id is not null then perform app_private.validate_funding_rollover_state(new);return new;end if;
 if (select runtime_version from app_private.funding_engine_activations where id=new.activation_id)=2 then perform app_private.validate_prospective_state(new); return new; end if;
 if new.condition_id is not null then raise exception using errcode='55000',message='FUNDING_STATE_ORIGINAL_MISMATCH'; end if;
  select * into v_a from app_private.funding_engine_activations where id=new.activation_id;
  select * into v_cycle from app_private.funding_cycle_windows where id=new.cycle_id;
  if new.user_id is distinct from v_a.user_id or new.cycle_id is distinct from v_a.first_cycle_id
    or new.cursor_at<v_cycle.cycle_started_at or new.cursor_at>v_cycle.cycle_end
    or new.cycle_closed is distinct from (new.cursor_at=v_cycle.cycle_end)
    or app_private.funding_exact_ratio(new.base_used_num,new.base_used_den) is distinct from array[new.base_used_num,new.base_used_den]
    or app_private.funding_exact_ratio(new.retention_used_num,new.retention_used_den) is distinct from array[new.retention_used_num,new.retention_used_den]
    or app_private.funding_exact_ratio(new.carry_num,new.carry_den) is distinct from array[new.carry_num,new.carry_den] then
    raise exception using errcode='55000',message='FUNDING_STATE_ORIGINAL_MISMATCH'; end if;
  if new.revision=0 then
    if new.cursor_at<>v_a.effective_at or new.base_used_num<>0 or new.base_used_den<>1
      or new.retention_used_num<>0 or new.retention_used_den<>1 or new.carry_num<>0 or new.carry_den<>1 then
      raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
  else
    select * into v_previous from app_private.funding_engine_state_receipts where id=new.previous_state_id;
    select * into v_earned from app_private.funding_earned_receipts where id=new.earned_receipt_id;
    if v_previous.user_id is distinct from new.user_id or v_previous.activation_id is distinct from new.activation_id
      or new.revision is distinct from v_previous.revision+1 or v_previous.cycle_closed
      or v_earned.next_state_id is distinct from new.id or v_earned.previous_state_id is distinct from v_previous.id
      or new.cursor_at is distinct from v_earned.settled_to
      or new.base_used_num::text is distinct from v_earned.calculation->>'baseUsedNum'
      or new.base_used_den::text is distinct from v_earned.calculation->>'baseUsedDen'
      or new.retention_used_num::text is distinct from v_earned.calculation->>'retentionUsedNum'
      or new.retention_used_den::text is distinct from v_earned.calculation->>'retentionUsedDen'
      or new.carry_num::text is distinct from v_earned.calculation->>'carryNum'
      or new.carry_den::text is distinct from v_earned.calculation->>'carryDen' then
      raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.funding_state_effective_capacities(p_state uuid) returns numeric[]
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare receipt app_private.funding_effective_capacity_receipts%rowtype; inputs jsonb; base numeric[]; retention numeric[];
begin
 if exists(select 1 from app_private.funding_engine_state_receipts where id=p_state and rollover_id is not null) then
  perform app_private.validate_funding_rollover_state((select s from app_private.funding_engine_state_receipts s where s.id=p_state));
  return(select array[r.base_capacity_num,r.base_capacity_den,r.retention_capacity_num,r.retention_capacity_den]
   from app_private.funding_cycle_rollovers r where r.next_state_id=p_state);
 end if;
 select * into receipt from app_private.funding_effective_capacity_receipts where state_id=p_state;
 if receipt.state_id is not null then
  return array[receipt.base_capacity_num,receipt.base_capacity_den,receipt.retention_capacity_num,receipt.retention_capacity_den]; end if;
 select c.inputs into inputs from app_private.funding_engine_state_receipts s join app_private.funding_condition_originals c
 on c.id=s.condition_id where s.id=p_state;
 if inputs is null or inputs->>'input_contract_version'='2' then
  raise exception using errcode='55000',message='FUNDING_EFFECTIVE_CAPACITY_ORIGINAL_REQUIRED'; end if;
 base:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
 retention:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000);
 return array[base[1],base[2],retention[1],retention[2]];
end;
$$;

create or replace function app_private.validate_credit_state(p_state app_private.funding_engine_state_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 preparation app_private.funding_credit_boundary_preparations%rowtype; cycle app_private.funding_cycle_windows%rowtype;
begin
 select * into activation from app_private.funding_engine_activations where id=p_state.activation_id;
 select * into condition from app_private.funding_condition_originals where id=p_state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_state.cycle_id;
 if activation.runtime_version<>2 or activation.user_id is distinct from p_state.user_id or condition.user_id is distinct from p_state.user_id
  or condition.activation_id is distinct from activation.id or (p_state.cycle_id is distinct from activation.first_cycle_id and not exists(
 select 1 from app_private.funding_cycle_rollovers r where r.next_cycle_id=p_state.cycle_id and r.activation_id=activation.id))
  or p_state.cursor_at<cycle.cycle_started_at or p_state.cursor_at>cycle.cycle_end or p_state.cycle_closed is distinct from(p_state.cursor_at=cycle.cycle_end)
  or condition.effective_at>p_state.cursor_at
  or app_private.funding_exact_ratio(p_state.base_used_num,p_state.base_used_den) is distinct from array[p_state.base_used_num,p_state.base_used_den]
  or app_private.funding_exact_ratio(p_state.retention_used_num,p_state.retention_used_den) is distinct from array[p_state.retention_used_num,p_state.retention_used_den]
  or app_private.funding_exact_ratio(p_state.carry_num,p_state.carry_den) is distinct from array[p_state.carry_num,p_state.carry_den] then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_STATE_MISMATCH'; end if;
 if p_state.cursor_at=cycle.cycle_end then
  select * into earned from app_private.funding_earned_receipts where id=p_state.earned_receipt_id;
  if p_state.revision=0 or earned.job_id is null or earned.settled_to is distinct from cycle.cycle_end
   or not(earned.calculation ? 'retentionComponentOriginal') then
   raise exception using errcode='55000',message='FUNDING_TERMINAL_SOURCE_PROOF_REQUIRED';end if;
 end if;
 if p_state.revision=0 then
  if condition.revision<>0 or p_state.cursor_at<>activation.effective_at or p_state.base_used_num<>0 or p_state.base_used_den<>1
   or p_state.retention_used_num<>0 or p_state.retention_used_den<>1 or p_state.carry_num<>0 or p_state.carry_den<>1 then
   raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_engine_state_receipts where id=p_state.previous_state_id;
  select * into earned from app_private.funding_earned_receipts where id=p_state.earned_receipt_id;
  if previous.user_id is distinct from p_state.user_id or previous.activation_id is distinct from p_state.activation_id
   or previous.id is distinct from(select id from app_private.funding_engine_state where user_id=p_state.user_id)
   or p_state.revision is distinct from previous.revision+1 or previous.cycle_closed or earned.runtime_version<>2
   or earned.next_state_id is distinct from p_state.id or earned.previous_state_id is distinct from previous.id
   or p_state.cursor_at is distinct from earned.settled_to
   or p_state.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
   or p_state.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
   or p_state.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
   or p_state.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
   or p_state.carry_num::text is distinct from earned.calculation->>'carryNum'
   or p_state.carry_den::text is distinct from earned.calculation->>'carryDen' then
   raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
  if earned.cause_credit_boundary_id is not null then
   select * into preparation from app_private.funding_credit_boundary_preparations where id=earned.cause_credit_boundary_id;
   if preparation.previous_state_id is distinct from previous.id or preparation.effective_at is distinct from p_state.cursor_at
    or (condition.id is distinct from previous.condition_id and condition.cause_credit_boundary_id is distinct from preparation.id) then
    raise exception using errcode='55000',message='FUNDING_CREDIT_STATE_CAUSE_MISMATCH'; end if;
  elsif earned.cause_allocation_id is not null then
   if condition.allocation_original_id is distinct from earned.cause_allocation_id then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_STATE_CAUSE_MISMATCH'; end if;
  elsif earned.job_id is not null then
   if condition.id is distinct from previous.condition_id then
    raise exception using errcode='55000',message='FUNDING_JOB_STATE_CAUSE_MISMATCH'; end if;
  else raise exception using errcode='55000',message='FUNDING_STATE_CAUSE_REQUIRED'; end if;
 end if;
end;
$$;

create or replace function app_private.validate_prospective_state(p_state app_private.funding_engine_state_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;
begin
 if exists(select 1 from app_private.funding_earned_receipts e where e.id=p_state.earned_receipt_id and e.cause_principal_boundary_id is not null) then
  perform app_private.validate_principal_boundary_state(p_state);return;end if;
 if(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=p_state.condition_id) in('2','3')
  or exists(select 1 from app_private.funding_earned_receipts where id=p_state.earned_receipt_id and cause_credit_boundary_id is not null) then
  perform app_private.validate_credit_state(p_state); return; end if;
 select * into activation from app_private.funding_engine_activations where id=p_state.activation_id;
 select * into condition from app_private.funding_condition_originals where id=p_state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_state.cycle_id;
 if p_state.user_id is distinct from activation.user_id or condition.user_id is distinct from p_state.user_id
  or condition.activation_id is distinct from activation.id or (p_state.cycle_id is distinct from activation.first_cycle_id and not exists(
 select 1 from app_private.funding_cycle_rollovers r where r.next_cycle_id=p_state.cycle_id and r.activation_id=activation.id))
  or p_state.cursor_at<cycle.cycle_started_at or p_state.cursor_at>cycle.cycle_end or p_state.cycle_closed is distinct from(p_state.cursor_at=cycle.cycle_end)
  or condition.effective_at>p_state.cursor_at
  or app_private.funding_exact_ratio(p_state.base_used_num,p_state.base_used_den) is distinct from array[p_state.base_used_num,p_state.base_used_den]
  or app_private.funding_exact_ratio(p_state.retention_used_num,p_state.retention_used_den) is distinct from array[p_state.retention_used_num,p_state.retention_used_den]
  or app_private.funding_exact_ratio(p_state.carry_num,p_state.carry_den) is distinct from array[p_state.carry_num,p_state.carry_den] then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_STATE_MISMATCH'; end if;
 if p_state.revision=0 then
  if condition.revision<>0 or p_state.cursor_at<>activation.effective_at
   or p_state.base_used_num<>0 or p_state.base_used_den<>1 or p_state.retention_used_num<>0 or p_state.retention_used_den<>1
   or p_state.carry_num<>0 or p_state.carry_den<>1 then
   raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_engine_state_receipts where id=p_state.previous_state_id;
  select * into earned from app_private.funding_earned_receipts where id=p_state.earned_receipt_id;
  if previous.user_id is distinct from p_state.user_id or previous.activation_id is distinct from p_state.activation_id
   or previous.id is distinct from(select id from app_private.funding_engine_state where user_id=p_state.user_id)
   or p_state.revision is distinct from previous.revision+1 or previous.cycle_closed or earned.runtime_version<>2
   or earned.next_state_id is distinct from p_state.id or earned.previous_state_id is distinct from previous.id
   or p_state.cursor_at is distinct from earned.settled_to
   or (earned.cause_allocation_id is not null and (condition.allocation_original_id is distinct from earned.cause_allocation_id or p_state.cycle_closed))
   or (earned.job_id is not null and p_state.condition_id is distinct from previous.condition_id)
   or p_state.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
   or p_state.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
   or p_state.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
   or p_state.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
   or p_state.carry_num::text is distinct from earned.calculation->>'carryNum'
   or p_state.carry_den::text is distinct from earned.calculation->>'carryDen' then
   raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
 end if;
end;
$$;

create or replace function app_private.read_neutral_funding_job_inputs(p_activation uuid,p_state uuid,p_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 portion record; inputs jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 select * into activation from app_private.funding_engine_activations where id=p_activation;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||activation.user_id::text,0));
 select * into state from app_private.funding_engine_state where user_id=activation.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if p_at is null or not isfinite(p_at) or activation.runtime_version is distinct from 2 or state.id is distinct from p_state
  or state.activation_id is distinct from activation.id or state.cycle_closed
  or condition.activation_id is distinct from activation.id or condition.user_id is distinct from activation.user_id
  or (cycle.id is distinct from activation.first_cycle_id and not exists(
 select 1 from app_private.funding_cycle_rollovers r where r.next_cycle_id=cycle.id and r.activation_id=activation.id)) or p_at<state.cursor_at or p_at>cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',activation.user_id,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 if p_at=cycle.cycle_end then
  if exists(select 1 from app_private.funding_principal_boundary_completions b
   where b.user_id=activation.user_id and b.runtime_outcome='UNRESOLVED')
   or exists(select 1 from app_private.funding_credit_boundary_completions b
   where b.user_id=activation.user_id and b.runtime_outcome='UNRESOLVED') then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_UNRESOLVED';end if;
  -- Terminal history is reconstructed from sealed as-of-end sources. Live
  -- input readers deliberately cannot erase later HOLD/recovery history.
  perform app_private.read_cycle_retention_components(state.id,p_at);
  return condition.inputs;
 end if;
 if condition.inputs->>'input_contract_version'='3' then
  -- No held-at-cycle-end qualification rule or rollover is inferred.
  if p_at>=cycle.cycle_end then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CYCLE_END_QUALIFICATION_UNAPPROVED';end if;
  if exists(select 1 from app_private.funding_principal_boundary_completions c
   join app_private.funding_principal_boundary_preparations b on b.id=c.boundary_id
   where c.user_id=activation.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_UNRESOLVED';end if;
  perform app_private.assert_input3_condition_snapshot(condition.id);
  inputs:=app_private.read_verified_input3_funding_inputs(activation.user_id,condition.current_allocation_original_id,p_at);
  if inputs is distinct from condition.inputs or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED';end if;
  return inputs;
 end if;
 if condition.inputs->>'input_contract_version'='2' then
  return app_private.read_forward_neutral_job_inputs(p_activation,p_state,p_at); end if;
 if condition.allocation_original_id is not null then
  perform app_private.assert_allocation_boundary_complete(condition.allocation_original_id,condition.id);
 end if;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,p_at);
 if inputs is distinct from condition.inputs then
  raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 select c.*,p.lot_id,p.parent_portion_id,p.amount_micro_krw into portion
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 where c.user_id=activation.user_id;
 if(select count(*) from app_private.funding_portion_clock_state where user_id=activation.user_id)<>1
  or portion.status is distinct from 'AVAILABLE' or portion.parent_portion_id is not null
  or portion.accumulated_eligible_microseconds is distinct from 0::bigint
  or portion.resumed_at is distinct from activation.effective_at
  or portion.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(activation.principal_atomic)
  or portion.lot_id is distinct from(select id from public.funding_principal_lots where money_source_movement_id=activation.trigger_credit_movement_id) then
  raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 if p_at=cycle.cycle_end and app_private.funding_portion_eligible_age(portion.accumulated_eligible_microseconds,
  portion.resumed_at,p_at,true) is distinct from(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint then
  raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 return inputs;
end;
$$;

create or replace function app_private.read_cycle_retention_components(p_state uuid,p_asof timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare s app_private.funding_engine_state_receipts%rowtype;c app_private.funding_cycle_windows%rowtype;
 activation app_private.funding_engine_activations%rowtype;condition app_private.funding_condition_originals%rowtype;
 transition app_private.funding_portion_transitions%rowtype;leaf record;segment record;
 total numeric[]:=array[0::numeric,1::numeric];qualified numeric[]:=array[0::numeric,1::numeric];piece numeric[];
 timeline jsonb;components jsonb:='[]';conditions jsonb:='[]';last_revision bigint:=-1;previous uuid;duration bigint;
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED';end if;
 select * into s from app_private.funding_engine_state_receipts where id=p_state;
 select * into c from app_private.funding_cycle_windows where id=s.cycle_id;
 select * into activation from app_private.funding_engine_activations where id=s.activation_id;
 if s.id is null or c.id is null or activation.id is null or activation.user_id is distinct from s.user_id
  or c.user_id is distinct from s.user_id or (c.id is distinct from activation.first_cycle_id and not exists(
 select 1 from app_private.funding_cycle_rollovers r where r.next_cycle_id=c.id and r.activation_id=activation.id))
  or p_asof is distinct from c.cycle_end or c.cycle_end-c.cycle_started_at<>interval '30 days'
  or s.cursor_at>p_asof then raise exception using errcode='55000',message='FUNDING_RETENTION_CYCLE_ORIGINAL_REQUIRED';end if;
 if p_asof>clock_timestamp() then raise exception using errcode='55000',message='FUNDING_RETENTION_END_NOT_MATURE';end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||s.user_id::text,0));
 duration:=(extract(epoch from c.cycle_end-c.cycle_started_at)*1000000)::bigint;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 for condition in select * from app_private.funding_condition_originals
  where activation_id=activation.id and effective_at<p_asof order by revision loop
  if condition.user_id is distinct from s.user_id or condition.revision<>last_revision+1
   or condition.previous_condition_id is distinct from previous
   or condition.inputs->>'cycle_days'<>'30'
   or coalesce((condition.inputs->>'retention_bps')::integer,-1) not between 0 and 10000 then
   raise exception using errcode='55000',message='FUNDING_RETENTION_CONDITION_CHAIN_INVALID';end if;
  perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',s.user_id,condition.input_digest,
   condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
  conditions:=conditions||jsonb_build_array(jsonb_build_object('id',condition.id,'digest',condition.input_digest));
  previous:=condition.id;last_revision:=condition.revision;
 end loop;
 if last_revision<0 or previous is distinct from s.condition_id then
  raise exception using errcode='55000',message='FUNDING_RETENTION_CONDITION_CHAIN_INVALID';end if;
 for transition in select * from app_private.funding_portion_transitions
  where user_id=s.user_id and effective_at<=p_asof order by revision loop
  perform app_private.verify_funding_portion_fact(transition);
 end loop;
 -- Each as-of-end leaf owns its fractional amount through all parent clocks.
 -- Parent intervals end at SPLIT; descendants inherit prior eligible history
 -- without duplicating the parent amount, and HOLD intervals contribute zero.
 for leaf in
  with clocks as(select distinct on(portion_id) * from app_private.funding_portion_clock_receipts
   where user_id=s.user_id and effective_at<=p_asof order by portion_id,revision desc)
  select p.*,cl.id clock_id,cl.status from app_private.funding_principal_portions p join clocks cl on cl.portion_id=p.id
  join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
  where p.user_id=s.user_id and t.effective_at<=p_asof
   and not exists(select 1 from app_private.funding_principal_portions child
    join app_private.funding_portion_transitions ct on ct.id=child.introduced_by_transition_id
    where child.parent_portion_id=p.id and ct.effective_at<=p_asof) order by p.id loop
  if leaf.status not in('AVAILABLE','HELD','RECOVERED') then
   raise exception using errcode='55000',message='FUNDING_RETENTION_PORTION_LEAF_INVALID';end if;
  for segment in
   with recursive ancestry as(
    select p.id,p.parent_portion_id,p.user_id,array[p.id] path from app_private.funding_principal_portions p where p.id=leaf.id
    union all select p.id,p.parent_portion_id,p.user_id,a.path||p.id from app_private.funding_principal_portions p
     join ancestry a on p.id=a.parent_portion_id where not p.id=any(a.path) and cardinality(a.path)<1024),
   clocks as(select cl.*,lead(cl.effective_at) over(partition by cl.portion_id order by cl.revision) until_at
    from app_private.funding_portion_clock_receipts cl join ancestry a on a.id=cl.portion_id where a.user_id=s.user_id),
   policies as(select x.*,lead(x.effective_at) over(order by x.revision) until_at
    from app_private.funding_condition_originals x where x.activation_id=activation.id),
   windows as(select cl.id clock_id,p.id condition_id,(p.inputs->>'retention_bps')::integer bps,
    greatest(cl.effective_at,p.effective_at,c.cycle_started_at) from_at,
    least(coalesce(cl.until_at,p_asof),coalesce(p.until_at,p_asof),p_asof) to_at
    from clocks cl cross join policies p where cl.status='AVAILABLE')
   select * from windows where to_at>from_at order by from_at,clock_id,condition_id loop
   timeline:=app_private.funding_global_eligible_interval(segment.from_at,segment.to_at);
   piece:=app_private.funding_portion_cycle_retention(leaf.amount_micro_krw,segment.bps,
    (timeline->>'eligible_microseconds')::bigint,duration,true);
   total:=app_private.funding_exact_sum(total,piece);
   if leaf.status='AVAILABLE' then qualified:=app_private.funding_exact_sum(qualified,piece);end if;
   components:=components||jsonb_build_array(jsonb_build_object('portionId',leaf.id,'lotId',leaf.lot_id,
    'terminalClockId',leaf.clock_id,'terminalStatus',leaf.status,'amountMicroKrw',leaf.amount_micro_krw::text,
    'clockId',segment.clock_id,'conditionId',segment.condition_id,'from',segment.from_at,'to',segment.to_at,
    'eligibleMicroseconds',timeline->>'eligible_microseconds','retentionBps',segment.bps,
    'conditionalNum',piece[1]::text,'conditionalDen',piece[2]::text,'qualified',leaf.status='AVAILABLE',
    'globalControlOriginalIds',timeline->'control_original_ids'));
  end loop;
 end loop;
 return jsonb_build_object('contractVersion',1,'userId',s.user_id,'cycleId',c.id,'terminalAt',p_asof,
  'durationMicroseconds',duration::text,'conditionOriginals',conditions,'components',components,
  'qualifiedNum',qualified[1]::text,'qualifiedDen',qualified[2]::text,
  'conditionalNum',total[1]::text,'conditionalDen',total[2]::text);
end; $$;

create or replace function app_private.process_neutral_funding_condition_job(p_job uuid,p_worker text,p_attempt integer)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_j app_private.funding_engine_jobs%rowtype; v_job public.system_jobs%rowtype;
 v_a app_private.funding_engine_activations%rowtype; v_state app_private.funding_engine_state_receipts%rowtype;
 v_cycle app_private.funding_cycle_windows%rowtype; v_e app_private.funding_earned_receipts%rowtype;
 v_input jsonb; v_calc jsonb; v_wallet uuid; v_until timestamptz; v_now timestamptz; v_target timestamptz;
 v_key text; v_journal uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_credit_event uuid:=gen_random_uuid();
 v_request uuid:=gen_random_uuid(); v_correlation uuid:=gen_random_uuid(); v_count integer;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 select * into v_j from app_private.funding_engine_jobs where job_id=p_job;
 if v_j.job_id is null then raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||v_j.user_id::text,0));
 select * into v_job from public.system_jobs where id=p_job for update;
 select * into v_e from app_private.funding_earned_receipts where job_id=p_job;
 if v_e.id is not null then
   if v_e.worker_id is distinct from p_worker or v_e.attempt_number is distinct from p_attempt
     or v_job.status is distinct from 'SUCCEEDED'
     or not exists(select 1 from public.system_job_attempts where job_id=p_job and attempt_number=p_attempt
       and worker_id=p_worker and status='SUCCEEDED') then
     raise exception using errcode='22023',message='FUNDING_ACCEPTED_JOB_CONFLICT'; end if;
   perform app_private.assert_funding_engine_seal(v_e.id,'FUNDING_EARNED_ACCEPTED',v_e.user_id,v_e.input_digest,
     v_e.audit_id,v_e.source_event_id,app_private.funding_earned_snapshot(v_e));
   return v_e.id;
 end if;
 perform app_private.assert_funding_global_execution_allowed();
 perform app_private.assert_funding_job_fence(p_job,p_worker,p_attempt);
 if v_job.payload is distinct from app_private.funding_job_snapshot(v_j)
   or v_job.job_type is distinct from 'FUNDING_MINING_TICK_V1' or v_job.payload_version<>1
   or v_job.idempotency_key is distinct from 'funding:state:'||v_j.expected_state_id::text then
   raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(p_job,'FUNDING_JOB_PREPARED',v_j.user_id,v_j.input_digest,
   v_j.audit_id,v_j.source_event_id,app_private.funding_job_snapshot(v_j));
 select * into v_a from app_private.funding_engine_activations where id=v_j.activation_id;
 perform app_private.assert_funding_engine_seal(v_a.id,'FUNDING_ACTIVATED',v_a.user_id,v_a.input_digest,
   v_a.audit_id,v_a.source_event_id,app_private.funding_activation_snapshot(v_a));
 select * into v_state from app_private.funding_engine_state where user_id=v_j.user_id;
 if v_state.id is distinct from v_j.expected_state_id or v_state.activation_id is distinct from v_a.id
   or v_state.cycle_closed then raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 select id into v_wallet from public.wallet_accounts where user_id=v_j.user_id and currency='KRW' and closed_at is null for update;
 if v_wallet is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 -- READ COMMITTED source read after wallet serialization rejects any concurrent
 -- deposit/source transition; no late AFTER-credit advisory lock is introduced.
 v_now:=clock_timestamp();
 select * into v_cycle from app_private.funding_cycle_windows where id=v_state.cycle_id;
 select effective_until into v_until from app_private.economy_policy_published where publication_id=v_a.policy_publication_id;
 v_target:=least(v_now,v_cycle.cycle_end,coalesce(v_until,'infinity'::timestamptz));
 v_input:=app_private.read_neutral_funding_job_inputs(v_a.id,v_state.id,v_target);
 if v_target<=v_state.cursor_at then raise exception using errcode='55000',message='FUNDING_BOUNDARY_ADAPTER_REQUIRED'; end if;
 if v_input->>'input_contract_version' in('2','3') or v_target=v_cycle.cycle_end then
  v_calc:=app_private.calculate_credit_boundary_interval(v_state.id,v_target);
 else
 v_calc:=app_private.funding_exact_condition_interval(v_a.principal_atomic,
   (v_input->>'base_bps')::integer,(v_input->>'retention_bps')::integer,(v_input->>'allocation_bps')::integer,
   (extract(epoch from v_cycle.cycle_end-v_cycle.cycle_started_at)*1000000)::bigint,
   (extract(epoch from v_target-v_state.cursor_at)*1000000)::bigint,
   v_state.base_used_num,v_state.base_used_den,v_state.retention_used_num,v_state.retention_used_den,
   v_state.carry_num,v_state.carry_den,v_target=v_cycle.cycle_end);
 end if;
 v_e.id:=gen_random_uuid(); v_e.user_id:=v_j.user_id; v_e.activation_id:=v_a.id; v_e.cycle_id:=v_cycle.id;
 v_e.job_id:=p_job; v_e.attempt_number:=p_attempt; v_e.worker_id:=p_worker;
 v_e.fence_expires_at:=v_job.lease_expires_at;
 v_e.previous_state_id:=v_state.id; v_e.next_state_id:=gen_random_uuid();
 v_e.settled_from:=v_state.cursor_at; v_e.settled_to:=v_target; v_e.calculation:=v_calc;
 v_e.amount_atomic:=(v_calc->>'amountAtomic')::bigint;
 if v_e.amount_atomic>0 then v_e.credit_id:=gen_random_uuid(); v_e.settlement_id:=gen_random_uuid(); end if;
 v_e.runtime_version:=2; v_e.condition_id:=v_state.condition_id;
 v_e.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(v_e));
 v_e.audit_id:=gen_random_uuid(); v_e.source_event_id:=gen_random_uuid(); v_e.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select v_e.*;
 if v_input->>'input_contract_version' in('2','3') then
  perform app_private.carry_forward_funding_capacity(v_e.next_state_id,v_state.id,v_e.id); end if;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
   earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,cycle_closed,condition_id)
 values(v_e.next_state_id,v_e.user_id,v_a.id,v_cycle.id,v_state.revision+1,v_state.id,v_e.id,v_target,
   (v_calc->>'baseUsedNum')::numeric,(v_calc->>'baseUsedDen')::numeric,
   (v_calc->>'retentionUsedNum')::numeric,(v_calc->>'retentionUsedDen')::numeric,
   (v_calc->>'carryNum')::numeric,(v_calc->>'carryDen')::numeric,v_target=v_cycle.cycle_end,v_state.condition_id);
 if (v_calc->>'qualifiedRetentionNum')::numeric>0 or v_calc ? 'retentionComponentOriginal' then
   insert into app_private.funding_retention_qualifications(user_id,cycle_id,earned_receipt_id,qualified_num,qualified_den,
     principal_input_digest,qualified_at,component_original)
   values(v_e.user_id,v_cycle.id,v_e.id,(v_calc->>'qualifiedRetentionNum')::numeric,
     (v_calc->>'qualifiedRetentionDen')::numeric,v_a.input_digest,v_cycle.cycle_end,v_calc->'retentionComponentOriginal');
 end if;
 if v_e.amount_atomic>0 then
   -- Stable sealed logical-job identity, not a freshly generated posting key.
   -- Job/previous-state uniqueness plus input/interval digest owns acceptance.
   v_key:='funding:job:'||p_job::text;
   insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,
     member_user_id,request_id,correlation_id,description,posted_at,metadata)
   values(v_journal,'MINING_REWARD','KRW',v_key||':ledger','mining_reward_credit',v_e.credit_id,
     v_e.user_id,v_request,v_correlation,'verified funded mining reward',v_target,
     jsonb_build_object('funding_earned_receipt_id',v_e.id,'fee_atomic','0'));
   insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic) values
    (v_journal,(select id from public.ledger_accounts where code='PUTDUK:MINING_REWARD_EXPENSE:KRW'),0,'DEBIT',v_e.amount_atomic),
    (v_journal,(select id from public.ledger_accounts where code='USER:'||upper(v_e.user_id::text)||':KRW:LIABILITY'),1,'CREDIT',v_e.amount_atomic);
   insert into public.wallet_ledger(id,wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
   values(v_projection,v_wallet,v_e.user_id,'CREDIT','MINING_REWARD',v_e.amount_atomic,v_key||':wallet','mining_reward_credit',v_e.credit_id);
   insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
     correlation_id,request_id,idempotency_key,available_at,last_error_code)
   values(v_credit_event,'MINING_REWARD_CREDITED.v1',1,'mining_reward_credit',v_e.credit_id,v_e.user_id,
     jsonb_build_object('user_id',v_e.user_id,'amount_atomic',v_e.amount_atomic,'currency','KRW',
       'ledger_transaction_id',v_journal,'wallet_ledger_id',v_projection),v_correlation,v_request,v_key||':event',
     'infinity','FUNDING_ENGINE_CONSUMER_NOT_ENABLED');
   insert into public.mining_reward_credits(id,user_id,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at,funding_earned_receipt_id)
   values(v_e.credit_id,v_e.user_id,v_e.amount_atomic,v_journal,v_projection,v_credit_event,v_target,v_e.id);
   insert into public.money_source_movements(user_id,source_bucket,movement_kind,origin_code,amount_atomic,
     ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at)
   values(v_e.user_id,'MINING_REWARD','CREDIT','MINING_REWARD',v_e.amount_atomic,v_journal,v_projection,v_credit_event,v_target);
   insert into public.mining_settlements(id,user_id,settled_from,settled_to,amount_atomic,currency,segment_count,idempotency_key,funding_earned_receipt_id)
   values(v_e.settlement_id,v_e.user_id,v_e.settled_from,v_target,v_e.amount_atomic,'KRW',1,v_key||':settlement',v_e.id);
   insert into public.mining_settlement_segments(mining_settlement_id,user_id,sequence,settled_from,settled_to,
     amount_atomic,equipment_efficiency_bps,world_multiplier_bps,event_multiplier_bps,status_multiplier_bps,funding_earned_receipt_id)
   values(v_e.settlement_id,v_e.user_id,0,v_e.settled_from,v_target,v_e.amount_atomic,10000,10000,10000,10000,v_e.id);
 end if;
 perform app_private.write_funding_engine_seal(v_e.id,'FUNDING_EARNED_ACCEPTED',v_e.user_id,v_e.input_digest,
   v_e.audit_id,v_e.source_event_id,app_private.funding_earned_snapshot(v_e));
 -- Fence at actual completion clock; a lease lost during calculation/posting
 -- rolls back earned/state/ledger/source/outbox/audit together.
 perform app_private.assert_funding_job_fence(p_job,p_worker,p_attempt);
 v_now:=clock_timestamp();
 update public.system_jobs set status='SUCCEEDED',completed_at=v_now,lease_owner=null,lease_expires_at=null,last_error_code=null
 where id=p_job and status='RUNNING' and lease_owner=p_worker and attempts=p_attempt and lease_expires_at>v_now;
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception using errcode='55000',message='FUNDING_JOB_FENCE_NOT_OWNED'; end if;
 update public.system_job_attempts set status='SUCCEEDED',completed_at=v_now
 where job_id=p_job and attempt_number=p_attempt and worker_id=p_worker and status='RUNNING';
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception using errcode='55000',message='FUNDING_JOB_FENCE_NOT_OWNED'; end if;
 if v_target=v_cycle.cycle_end then perform app_private.open_next_funding_cycle(v_e.id);end if;
 return v_e.id;
end;
$$;
commit;
