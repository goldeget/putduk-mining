begin;


create function app_private.validate_principal_boundary_condition(p_condition app_private.funding_condition_originals) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 previous app_private.funding_condition_originals%rowtype; state app_private.funding_engine_state_receipts%rowtype; inputs jsonb;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_condition.cause_principal_boundary_id;
 perform app_private.assert_principal_input_executor(preparation.user_id);
 perform app_private.assert_funding_withdrawal_clock_completion(preparation.clock_admission_id);
 select s.* into state from app_private.funding_engine_state s where s.user_id=preparation.user_id;
 select c.* into previous from app_private.funding_condition_originals c where c.id=state.condition_id;
 inputs:=app_private.read_principal_portion_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,preparation.effective_at);
 if preparation.id is null or not preparation.settlement_expected or state.id is distinct from preparation.previous_state_id
  or p_condition.user_id is distinct from preparation.user_id or p_condition.activation_id is distinct from state.activation_id
  or p_condition.previous_condition_id is distinct from previous.id or p_condition.revision is distinct from previous.revision+1
  or p_condition.allocation_original_id is not null or p_condition.cause_credit_boundary_id is not null
  or p_condition.current_allocation_original_id is distinct from preparation.current_allocation_original_id
  or p_condition.effective_at is distinct from preparation.effective_at or p_condition.recorded_at is distinct from preparation.effective_at
  or p_condition.inputs is distinct from inputs or inputs->>'input_contract_version' is distinct from '3'
  or p_condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(p_condition)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CONDITION_ORIGINAL_MISMATCH';end if;
 perform app_private.principal_boundary_expected_capacities(preparation.id,inputs);
end;
$$;
create function app_private.validate_principal_boundary_state(p_state app_private.funding_engine_state_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype;earned app_private.funding_earned_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;caps numeric[];
begin
 select e.* into earned from app_private.funding_earned_receipts e where e.id=p_state.earned_receipt_id;
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=earned.cause_principal_boundary_id;
 perform app_private.assert_principal_input_executor(preparation.user_id);
 select s.* into previous from app_private.funding_engine_state s where s.user_id=preparation.user_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=p_state.condition_id;
 perform app_private.verify_principal_boundary_earned(earned);
 if preparation.id is null or not preparation.settlement_expected or previous.id is distinct from preparation.previous_state_id
  or p_state.previous_state_id is distinct from previous.id or p_state.id is distinct from earned.next_state_id
  or p_state.user_id is distinct from preparation.user_id or p_state.activation_id is distinct from previous.activation_id
  or p_state.cycle_id is distinct from previous.cycle_id or p_state.revision is distinct from previous.revision+1
  or p_state.cursor_at is distinct from preparation.effective_at or p_state.recorded_at is distinct from preparation.effective_at
  or p_state.cycle_closed or condition.user_id is distinct from preparation.user_id
  or p_state.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
  or p_state.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
  or p_state.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
  or p_state.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
  or p_state.carry_num::text is distinct from earned.calculation->>'carryNum'
  or p_state.carry_den::text is distinct from earned.calculation->>'carryDen' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_STATE_ORIGINAL_MISMATCH';end if;
 if condition.id=previous.condition_id then caps:=app_private.funding_state_effective_capacities(previous.id);
 else
  if condition.cause_principal_boundary_id is distinct from preparation.id then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_STATE_CONDITION_MISMATCH';end if;
  caps:=app_private.principal_boundary_expected_capacities(preparation.id,condition.inputs);
 end if;
 if (select array[c.base_capacity_num,c.base_capacity_den,c.retention_capacity_num,c.retention_capacity_den] from app_private.funding_effective_capacity_receipts c where c.state_id=p_state.id and c.user_id=p_state.user_id) is distinct from caps then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_STATE_CAPACITY_MISMATCH';end if;
end;
$$;


create or replace function app_private.validate_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; successor app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; calculation jsonb;
begin
 if p_earned.cause_principal_boundary_id is not null then perform app_private.validate_principal_boundary_earned(p_earned);return;end if;
 if p_earned.cause_credit_boundary_id is not null then perform app_private.validate_credit_boundary_earned(p_earned); return; end if;
 if p_earned.cause_allocation_id is not null and(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=p_earned.condition_id)='2' then
  perform app_private.validate_forward_allocation_earned(p_earned); return; end if;
 if p_earned.job_id is not null then perform app_private.validate_neutral_funding_job_earned(p_earned); return; end if;
 -- Jobs cannot use the foreground branch or gain a fake successful lease.
 if p_earned.job_id is not null then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_JOB_ADAPTER_REQUIRED'; end if;
 perform app_private.assert_funding_member_writer(p_earned.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_earned.user_id::text,0));
 select * into activation from app_private.funding_engine_activations where id=p_earned.activation_id;
 select * into state from app_private.funding_engine_state_receipts where id=p_earned.previous_state_id;
 select * into condition from app_private.funding_condition_originals where id=p_earned.condition_id;
 select * into original from app_private.funding_allocation_originals where id=p_earned.cause_allocation_id;
 select * into successor from app_private.funding_condition_originals where allocation_original_id=original.id;
 select * into cycle from app_private.funding_cycle_windows where id=p_earned.cycle_id;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,p_earned.settled_to);
 if activation.runtime_version<>2 or activation.user_id is distinct from p_earned.user_id
  or state.user_id is distinct from p_earned.user_id or state.activation_id is distinct from activation.id
  or state.id is distinct from(select id from app_private.funding_engine_state where user_id=p_earned.user_id)
  or p_earned.condition_id is distinct from state.condition_id or inputs is distinct from condition.inputs
  or original.user_id is distinct from p_earned.user_id or successor.previous_condition_id is distinct from condition.id
  or successor.effective_at is distinct from original.effective_at
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to is distinct from original.effective_at
  or p_earned.settled_to>clock_timestamp() or p_earned.settled_to>=cycle.cycle_end
  or p_earned.cycle_id is distinct from activation.first_cycle_id then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_EARNED_MISMATCH'; end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from p_earned.settled_to-p_earned.settled_from)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;


create or replace function app_private.verify_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare successor app_private.funding_engine_state_receipts%rowtype; transition app_private.funding_condition_originals%rowtype;
 movement public.money_source_movements%rowtype;
begin
 if p_earned.cause_principal_boundary_id is not null then perform app_private.assert_principal_boundary_complete(p_earned.cause_principal_boundary_id);return;end if;
 if p_earned.cause_credit_boundary_id is not null then perform app_private.verify_credit_boundary_earned(p_earned); return; end if;
 if p_earned.job_id is not null then perform app_private.verify_neutral_funding_job_earned(p_earned); return; end if;
 select * into successor from app_private.funding_engine_state_receipts where id=p_earned.next_state_id;
 select * into transition from app_private.funding_condition_originals where id=successor.condition_id;
 if successor.earned_receipt_id is distinct from p_earned.id or successor.user_id is distinct from p_earned.user_id
  or transition.allocation_original_id is distinct from p_earned.cause_allocation_id or p_earned.job_id is not null then
  raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
 perform app_private.assert_allocation_boundary_complete(p_earned.cause_allocation_id,transition.id);
 if p_earned.amount_atomic>0 then
  select m.* into movement from public.money_source_movements m join public.mining_reward_credits c
   on c.ledger_transaction_id=m.ledger_transaction_id where c.id=p_earned.credit_id and c.funding_earned_receipt_id=p_earned.id;
  if movement.user_id is distinct from p_earned.user_id or movement.amount_atomic is distinct from p_earned.amount_atomic
   or movement.source_bucket is distinct from 'MINING_REWARD' or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at is distinct from p_earned.settled_to
   or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=p_earned.id)
   or not exists(select 1 from public.mining_settlements where id=p_earned.settlement_id and funding_earned_receipt_id=p_earned.id) then
   raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
  perform app_private.assert_money_source_credit(movement);
 end if;
 if p_earned.calculation->>'qualifiedRetentionNum' is distinct from '0' then
  raise exception using errcode='55000',message='FUNDING_RETENTION_BOUNDARY_ADAPTER_REQUIRED'; end if;
 perform app_private.assert_funding_engine_seal(p_earned.id,'FUNDING_EARNED_ACCEPTED',p_earned.user_id,p_earned.input_digest,
  p_earned.audit_id,p_earned.source_event_id,app_private.funding_earned_snapshot(p_earned));
end;
$$;


create or replace function app_private.guard_funding_condition() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; previous app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; inputs jsonb;
begin
 if new.cause_principal_boundary_id is not null then perform app_private.validate_principal_boundary_condition(new);return new;end if;
 if new.inputs->>'input_contract_version'='3' then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CONDITION_CAUSE_REQUIRED';end if;
 if new.inputs->>'input_contract_version'='2' then perform app_private.validate_credit_condition(new); return new; end if;
 perform app_private.assert_funding_member_writer(new.user_id);
 select * into activation from app_private.funding_engine_activations where id=new.activation_id;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,new.allocation_original_id,new.effective_at);
 if activation.user_id is distinct from new.user_id or activation.runtime_version<>2
  or new.inputs is distinct from inputs
  or new.inputs->>'policy_publication_id' is distinct from activation.policy_publication_id::text
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_CONDITION_ORIGINAL_MISMATCH'; end if;
 if new.revision=0 then
  if new.effective_at is distinct from activation.effective_at or new.inputs is distinct from activation.input_original then
   raise exception using errcode='55000',message='FUNDING_ZERO_CONDITION_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_condition_originals where id=new.previous_condition_id;
  select * into original from app_private.funding_allocation_originals where id=new.allocation_original_id;
  if previous.user_id is distinct from new.user_id or previous.activation_id is distinct from new.activation_id
   or new.revision is distinct from previous.revision+1 or new.revision is distinct from original.revision
   or new.effective_at is distinct from original.effective_at or new.effective_at<previous.effective_at
   or new.previous_condition_id is distinct from(select id from app_private.funding_condition_originals
     where user_id=new.user_id order by revision desc limit 1) then
   raise exception using errcode='55000',message='FUNDING_CONDITION_SUCCESSOR_MISMATCH'; end if;
 end if;
 return new;
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
  or condition.activation_id is distinct from activation.id or p_state.cycle_id is distinct from activation.first_cycle_id
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


create or replace function app_private.assert_funding_capacity_state_complete(p_state uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare state app_private.funding_engine_state_receipts%rowtype; previous app_private.funding_engine_state_receipts%rowtype;
 earned app_private.funding_earned_receipts%rowtype; caps numeric[]; old_caps numeric[];
begin
 select * into state from app_private.funding_engine_state_receipts where id=p_state;
 select * into previous from app_private.funding_engine_state_receipts where id=state.previous_state_id;
 select * into earned from app_private.funding_earned_receipts where id=state.earned_receipt_id;
 if earned.cause_principal_boundary_id is not null then perform app_private.assert_principal_boundary_complete(earned.cause_principal_boundary_id);return;end if;
 if state.id is null or previous.id is null or earned.id is null or earned.cause_credit_boundary_id is not null
  or state.user_id is distinct from previous.user_id then
  raise exception using errcode='55000',message='FUNDING_CAPACITY_STATE_ORIGINAL_REQUIRED'; end if;
 caps:=app_private.funding_state_effective_capacities(state.id);
 old_caps:=app_private.funding_state_effective_capacities(previous.id);
 if caps is distinct from old_caps then raise exception using errcode='55000',message='FUNDING_FORWARD_CAPACITY_RECEIPT_MISMATCH'; end if;
 if earned.cause_allocation_id is not null then
  perform app_private.assert_allocation_boundary_complete(earned.cause_allocation_id,state.condition_id);
 elsif earned.job_id is not null then perform app_private.verify_neutral_funding_job_earned(earned);
 else raise exception using errcode='55000',message='FUNDING_CAPACITY_STATE_CAUSE_REQUIRED'; end if;
end;
$$;


create or replace function app_private.carry_forward_funding_capacity(p_next uuid,p_previous uuid,p_earned uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare earned app_private.funding_earned_receipts%rowtype; caps numeric[]; role_name text;
begin
 select * into earned from app_private.funding_earned_receipts where id=p_earned;
 role_name:=current_setting('role',true);
 if ((role_name='service_role' and auth.role()='service_role')
  or(role_name='authenticated' and auth.role()='authenticated' and auth.uid()=earned.user_id)) is not true then
  raise exception using errcode='42501',message='FUNDING_CAPACITY_EXECUTOR_FORBIDDEN'; end if;
 if earned.id is null or (earned.cause_credit_boundary_id is not null or earned.cause_principal_boundary_id is not null) or earned.previous_state_id is distinct from p_previous
  or earned.next_state_id is distinct from p_next or p_previous is distinct from(select id from app_private.funding_engine_state where user_id=earned.user_id) then
  raise exception using errcode='55000',message='FUNDING_CAPACITY_EARNED_ORIGINAL_REQUIRED'; end if;
 caps:=app_private.funding_state_effective_capacities(p_previous);
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(p_next,earned.user_id,caps[1],caps[2],caps[3],caps[4]);
end;
$$;


create or replace function app_private.guard_funded_canonical_insert() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_e app_private.funding_earned_receipts%rowtype; v_settlement public.mining_settlements%rowtype;
begin
 if new.funding_earned_receipt_id is null then
   if current_user='service_role' then raise exception using errcode='42501',message='FUNDING_EARNED_ORIGINAL_REQUIRED'; end if;
   return new; -- Preserve immutable owner-only legacy fixtures/history.
 end if;
 select * into v_e from app_private.funding_earned_receipts where id=new.funding_earned_receipt_id;
 if v_e.id is null or new.user_id is distinct from v_e.user_id or new.amount_atomic is distinct from v_e.amount_atomic or v_e.amount_atomic<=0 then
   raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 if tg_table_name='mining_reward_credits' then
   if new.id is distinct from v_e.credit_id or new.effective_at is distinct from v_e.settled_to then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 elsif tg_table_name='mining_settlements' then
   if new.id is distinct from v_e.settlement_id or new.settled_from is distinct from v_e.settled_from
     or new.settled_to is distinct from v_e.settled_to or new.currency<>'KRW' or new.segment_count<>1
     or new.idempotency_key is distinct from (case when v_e.cause_principal_boundary_id is not null then
       (select 'funding:principal:'||a.withdrawal_id::text||':'||b.phase||':settlement' from app_private.funding_principal_boundary_preparations b
        join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id where b.id=v_e.cause_principal_boundary_id)
      when v_e.cause_credit_boundary_id is not null then
       (select 'funding:credit:'||b.origin_code||':'||b.command_original_id::text||':settlement'
        from app_private.funding_credit_boundary_preparations b where b.id=v_e.cause_credit_boundary_id)
      when v_e.cause_allocation_id is not null then 'funding:allocation:'||v_e.cause_allocation_id::text||':settlement' else 'funding:job:'||v_e.job_id::text||':settlement' end) then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 else
   select * into v_settlement from public.mining_settlements where id=new.mining_settlement_id;
   if v_settlement.funding_earned_receipt_id is distinct from v_e.id or new.sequence<>0
     or new.settled_from is distinct from v_e.settled_from or new.settled_to is distinct from v_e.settled_to
     or new.equipment_efficiency_bps<>10000 or new.world_multiplier_bps<>10000
     or new.event_multiplier_bps<>10000 or new.status_multiplier_bps<>10000 then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 end if;
 return new;
end;
$$;


create or replace function app_private.verify_funding_integrity_at_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_snapshot jsonb; v_kind text; v_user uuid; v_id uuid; v_digest text; v_audit uuid; v_event uuid;
 v_e app_private.funding_earned_receipts%rowtype; v_move public.money_source_movements%rowtype;
 v_role text;
begin
 if tg_table_schema<>'app_private' or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW'
  or tg_table_name not in('funding_engine_activations','funding_engine_jobs','funding_earned_receipts','funding_condition_originals') then
  raise exception using errcode='55000',message='FUNDING_COMMIT_TRIGGER_CONTEXT_INVALID'; end if;
 v_role:=current_setting('role',true);
 if v_role='authenticated' then
  if auth.role() is distinct from 'authenticated' or auth.uid() is distinct from new.user_id
   or tg_table_name='funding_engine_jobs' then
   raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN'; end if;
  if tg_table_name in('funding_engine_activations','funding_earned_receipts') then
   if new.runtime_version is distinct from 2 then
    raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN'; end if;
  end if;
  if tg_table_name='funding_earned_receipts' then
   if new.job_id is not null then
    raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN'; end if;
  end if;
 elsif v_role='service_role' then
  -- Exact inherited SQL role preserves the existing trusted service boundary;
  -- the definer's current_user must never replace this caller-context proof.
  null;
 elsif not(v_role in('none','postgres') and session_user='postgres') or v_role is null then
  raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN';
 end if;
 if tg_table_name='funding_condition_originals' then
  if new.cause_principal_boundary_id is not null then
   if v_role is distinct from 'service_role' or auth.role() is distinct from 'service_role' or(auth.uid() is not null and auth.uid() is distinct from new.user_id) then
    raise exception using errcode='42501',message='FUNDING_PRINCIPAL_COMMIT_SUBJECT_FORBIDDEN';end if;
   perform app_private.assert_principal_boundary_complete(new.cause_principal_boundary_id);return null;end if;
  if new.cause_credit_boundary_id is not null then
   perform app_private.assert_credit_boundary_complete(new.cause_credit_boundary_id);
   perform app_private.assert_funding_engine_seal(new.id,'FUNDING_CONDITION_CHANGED',new.user_id,new.input_digest,
    new.audit_id,new.source_event_id,app_private.funding_condition_snapshot(new));
   return null; end if;
  perform app_private.assert_funding_engine_seal(new.id,'FUNDING_CONDITION_CHANGED',new.user_id,new.input_digest,
   new.audit_id,new.source_event_id,app_private.funding_condition_snapshot(new));
  if new.revision=0 then
   if not exists(select 1 from app_private.funding_engine_state_receipts where condition_id=new.id and revision=0) then
    raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
  else
   perform app_private.assert_allocation_boundary_complete(new.allocation_original_id,new.id);
   if not exists(select 1 from app_private.funding_engine_state_receipts s join app_private.funding_earned_receipts e
    on e.id=s.earned_receipt_id where s.condition_id=new.id and e.cause_allocation_id=new.allocation_original_id
     and e.condition_id=new.previous_condition_id) then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_ACCEPTANCE_MISSING'; end if;
  end if;
  return null;
 end if;
 if tg_table_name='funding_engine_activations' then
  if new.runtime_version=2 then
   if new.input_original->>'input_contract_version'='2' then
    perform app_private.assert_credit_boundary_complete((select boundary_id from app_private.funding_credit_boundary_completions
     where activation_id=new.id and accepted_state_id in(select id from app_private.funding_engine_state_receipts where activation_id=new.id and revision=0)));
   end if;
   perform app_private.verify_prospective_activation(new); return null; end if;
 end if;
 if tg_table_name='funding_earned_receipts' then
  if new.runtime_version=2 then perform app_private.verify_prospective_earned(new); return null; end if;
 end if;
 if tg_table_name='funding_engine_activations' then
   v_id:=new.id;
   v_snapshot:=app_private.funding_activation_snapshot(new); v_kind:='FUNDING_ACTIVATED';
   if not exists(select 1 from app_private.funding_engine_state_receipts where activation_id=new.id and revision=0) then
     raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
 elsif tg_table_name='funding_engine_jobs' then
   v_id:=new.job_id;
   v_snapshot:=app_private.funding_job_snapshot(new); v_kind:='FUNDING_JOB_PREPARED';
 else
   v_id:=new.id;
   v_e:=new; v_snapshot:=app_private.funding_earned_snapshot(v_e); v_kind:='FUNDING_EARNED_ACCEPTED';
   if not exists(select 1 from public.system_jobs job join public.system_job_attempts attempt
       on attempt.job_id=job.id and attempt.attempt_number=job.attempts
     where job.id=v_e.job_id and job.status='SUCCEEDED' and job.attempts=v_e.attempt_number
       and attempt.worker_id=v_e.worker_id and attempt.status='SUCCEEDED'
       and job.completed_at=attempt.completed_at and job.completed_at>=v_e.recorded_at
       and job.completed_at<v_e.fence_expires_at and job.completed_at<=clock_timestamp()) then
     raise exception using errcode='55000',message='FUNDING_ACCEPTED_JOB_COMPLETION_MISSING'; end if;
   if not exists(select 1 from app_private.funding_engine_state_receipts where id=v_e.next_state_id
       and earned_receipt_id=v_e.id and user_id=v_e.user_id) then
     raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
   if v_e.amount_atomic>0 then
     select movement.* into v_move from public.money_source_movements movement
     join public.mining_reward_credits credit on credit.ledger_transaction_id=movement.ledger_transaction_id
     where credit.id=v_e.credit_id and credit.funding_earned_receipt_id=v_e.id;
     if v_move.user_id is distinct from v_e.user_id or v_move.amount_atomic is distinct from v_e.amount_atomic
       or v_move.source_bucket is distinct from 'MINING_REWARD' or v_move.movement_kind is distinct from 'CREDIT'
       or v_move.effective_at is distinct from v_e.settled_to
       or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=v_e.id) then
       raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
     perform app_private.assert_money_source_credit(v_move);
   end if;
   if (v_e.calculation->>'qualifiedRetentionNum')::numeric>0
     and not exists(select 1 from app_private.funding_retention_qualifications where earned_receipt_id=v_e.id) then
     raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 end if;
 v_user:=new.user_id; v_digest:=new.input_digest; v_audit:=new.audit_id; v_event:=new.source_event_id;
 perform app_private.assert_funding_engine_seal(v_id,v_kind,v_user,v_digest,v_audit,v_event,v_snapshot);
 return null;
end;
$$;


create or replace function app_private.assert_principal_recovery_intent_completion(p_intent uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_principal_recovery_intent_originals%rowtype;
 request public.withdrawal_requests%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 movement public.money_source_movements%rowtype; transition app_private.funding_portion_transitions%rowtype;
 previous_transition app_private.funding_portion_transitions%rowtype; allocation record;
 total_micro numeric:=0; last_revision bigint; boundary_id uuid;
begin
 select i.* into original from app_private.funding_principal_recovery_intent_originals i where i.id=p_intent;
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=original.previous_state_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=original.previous_condition_id;
 select t.* into previous_transition from app_private.funding_portion_transitions t where t.id=original.previous_portion_transition_id;
 if original.id is null or original.intent_kind is distinct from 'SERVER_PRINCIPAL_RECOVERY'
  or request.user_id is distinct from original.user_id or request.currency<>'KRW' or request.fee_atomic<>0
  or request.welcome_reward_conversion_id is not null or request.amount_atomic is distinct from original.amount_atomic
  or original.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(request)
  or state.user_id is distinct from original.user_id or state.condition_id is distinct from condition.id
  or condition.user_id is distinct from original.user_id or condition.inputs is distinct from original.source_inputs
  or coalesce(condition.current_allocation_original_id,condition.allocation_original_id) is distinct from original.current_allocation_original_id
  or previous_transition.user_id is distinct from original.user_id
  or original.source_inputs->>'input_contract_version' is distinct from '2'
  or original.source_epoch_at is distinct from (select introduced_at from app_private.money_source_epochs where version=1)
  or original.principal_epoch_at is distinct from (select introduced_at from app_private.funding_principal_epochs where version=1)
  or original.engine_epoch_at is distinct from (select introduced_at from app_private.funding_engine_epochs where version=1)
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(original)) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 if condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
  condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 if not exists(select 1 from public.audit_logs a where a.id=original.audit_id and a.actor_user_id=original.user_id
    and a.request_id=original.journal_request_id and a.created_at=original.prepared_at)
  or not exists(select 1 from public.outbox_events e where e.id=original.source_event_id
    and e.request_id=original.journal_request_id and e.correlation_id=original.journal_request_id
    and e.occurred_at=original.prepared_at and e.created_at=original.prepared_at) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.funding_principal_recovery_intent_snapshot(original));
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=original.withdrawal_id and a.phase='HOLD';
 if admission.id is null or admission.user_id is distinct from original.user_id
  or admission.journal_request_id is distinct from original.journal_request_id
  or admission.amount_atomic is distinct from original.amount_atomic or admission.effective_at<original.prepared_at then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_HOLD_COMPLETION_REQUIRED'; end if;
 perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 if exists(select 1 from public.mining_reward_withdrawal_reservations r
   where r.hold_ledger_transaction_id=request.hold_ledger_transaction_id)
  or (select count(*) from public.money_source_movements m where m.ledger_transaction_id=request.hold_ledger_transaction_id
    and m.user_id=original.user_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD')<>1 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_SOURCE_REQUIRED'; end if;
 select m.* into movement from public.money_source_movements m where m.ledger_transaction_id=request.hold_ledger_transaction_id
  and m.user_id=original.user_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD';
 perform app_private.assert_principal_recovery_movement(movement);
 if movement.amount_atomic is distinct from original.amount_atomic or movement.effective_at is distinct from admission.effective_at then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_SOURCE_REQUIRED'; end if;
 -- The first bounded type requires a contiguous genuine HOLD from the exact
 -- pre-finance portion predecessor. Existing verifier independently proves
 -- newest lot, shortest eligible age, stable UUID tie, split age and conservation.
 select b.id into boundary_id from app_private.funding_principal_boundary_preparations b
  join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
  where b.intent_id=original.id and b.clock_admission_id=admission.id and b.phase='HOLD'
   and b.previous_state_id=state.id and b.user_id=original.user_id and c.runtime_outcome='ACCEPTED';
 last_revision:=previous_transition.revision;
 for allocation in select a.* from public.funding_principal_recovery_allocations a
  where a.hold_ledger_transaction_id=request.hold_ledger_transaction_id order by a.ordinal loop
  select t.* into transition from app_private.funding_portion_transitions t where t.kind='HOLD' and t.original_id=allocation.id;
  if allocation.user_id is distinct from original.user_id or allocation.policy_code is distinct from 'NEWEST_FIRST'
   or allocation.effective_at is distinct from admission.effective_at or transition.id is null
   or transition.user_id is distinct from original.user_id or transition.revision is distinct from last_revision+1
   or transition.previous_transition_id is distinct from previous_transition.id then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_COMPLETION_REQUIRED'; end if;
  if boundary_id is null then perform app_private.verify_funding_portion_fact(transition);
  else perform app_private.verify_principal_history_portion_fact(transition,boundary_id);end if;
  total_micro:=total_micro+allocation.allocation_micro_krw;
  last_revision:=transition.revision;previous_transition:=transition;
 end loop;
 if total_micro is distinct from original.amount_atomic::numeric*1000000 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_COMPLETION_REQUIRED'; end if;
 -- This authority-only version cannot authorize an engine advancement before
 -- finance. A later adapter must add its own earned/condition/capacity proof.
 if exists(select 1 from app_private.funding_engine_state_receipts s where s.user_id=original.user_id
   and s.revision>state.revision and s.cursor_at<=admission.effective_at
   and not exists(select 1 from app_private.funding_principal_boundary_preparations b
    join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
    join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
    where b.intent_id=original.id and b.clock_admission_id=admission.id and b.phase='HOLD'
     and b.previous_state_id=state.id and b.settlement_expected and b.user_id=original.user_id
     and c.accepted_state_id=s.id and s.previous_state_id=state.id and s.revision=state.revision+1
     and e.id=s.earned_receipt_id and e.next_state_id=s.id and s.cursor_at=admission.effective_at
     and ((c.runtime_outcome='ACCEPTED' and c.condition_id=s.condition_id)
      or(c.runtime_outcome='UNRESOLVED' and c.condition_id is null and s.condition_id=state.condition_id)))) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_STATE_ADVANCED'; end if;
end;
$$;


revoke all on function app_private.validate_principal_boundary_condition(app_private.funding_condition_originals), app_private.validate_principal_boundary_state(app_private.funding_engine_state_receipts) from public,anon,authenticated,service_role;

commit;
