begin;

create or replace function app_private.assert_credit_condition_inputs(p_condition uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare condition app_private.funding_condition_originals%rowtype; inputs jsonb; original jsonb;
begin
 select * into condition from app_private.funding_condition_originals where id=p_condition;
 if condition.inputs->>'input_contract_version'='3' then
  perform app_private.assert_input3_condition_snapshot(condition.id);
  inputs:=app_private.read_verified_input3_funding_inputs(condition.user_id,
   coalesce(condition.current_allocation_original_id,condition.allocation_original_id),p_at);
  if inputs is distinct from condition.inputs then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED';end if;
  return inputs;
 end if;
 inputs:=app_private.read_verified_credit_funding_inputs(condition.user_id,
 coalesce(condition.current_allocation_original_id,condition.allocation_original_id),p_at);
 if condition.inputs->>'input_contract_version'='2' then
  if condition.inputs is distinct from inputs then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 else
  original:=inputs->'credit_originals'->0;
  if jsonb_array_length(inputs->'credit_originals')<>1
   or inputs->>'principal_atomic' is distinct from condition.inputs->>'principal_atomic'
   or inputs->>'allocation_id' is distinct from condition.inputs->>'allocation_id'
   or inputs->>'allocation_bps' is distinct from condition.inputs->>'allocation_bps'
   or inputs->>'policy_publication_id' is distinct from condition.inputs->>'policy_publication_id'
   or inputs->>'policy_config_digest' is distinct from condition.inputs->>'policy_config_digest'
   or inputs->>'cycle_days' is distinct from condition.inputs->>'cycle_days'
   or inputs->>'base_bps' is distinct from condition.inputs->>'base_bps'
   or inputs->>'retention_bps' is distinct from condition.inputs->>'retention_bps'
   or original->>'credit_id' is distinct from condition.inputs->>'credit_id'
   or original->>'principal_revision_id' is distinct from condition.inputs->>'principal_revision_id' then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
 condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 return inputs;
end;
$$;

create or replace function app_private.validate_credit_condition(p_condition app_private.funding_condition_originals) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; previous app_private.funding_condition_originals%rowtype;
 preparation app_private.funding_credit_boundary_preparations%rowtype; original app_private.funding_allocation_originals%rowtype; inputs jsonb;
begin
 if p_condition.cause_credit_boundary_id is not null or p_condition.revision=0 then perform app_private.assert_credit_boundary_executor();
 else perform app_private.assert_funding_member_writer(p_condition.user_id); end if;
 select * into activation from app_private.funding_engine_activations where id=p_condition.activation_id;
 if p_condition.inputs->>'input_contract_version'='3' then
  if p_condition.revision=0 or p_condition.cause_principal_boundary_id is not null then
   raise exception using errcode='55000',message='FUNDING_INPUT3_CONDITION_CAUSE_REQUIRED';end if;
  inputs:=app_private.read_verified_input3_funding_inputs(p_condition.user_id,p_condition.current_allocation_original_id,p_condition.effective_at);
 else
  inputs:=app_private.read_verified_credit_funding_inputs(p_condition.user_id,p_condition.current_allocation_original_id,p_condition.effective_at);
 end if;
 if activation.user_id is distinct from p_condition.user_id or activation.runtime_version<>2
  or p_condition.inputs is distinct from inputs or inputs->>'tier_activated' is distinct from 'true'
  or p_condition.inputs->>'policy_publication_id' is distinct from activation.policy_publication_id::text
  or p_condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(p_condition)) then
  raise exception using errcode='55000',message='FUNDING_CONDITION_ORIGINAL_MISMATCH'; end if;
 if p_condition.revision=0 then
  if p_condition.effective_at is distinct from activation.effective_at or p_condition.inputs is distinct from activation.input_original
   or p_condition.cause_credit_boundary_id is not null or p_condition.current_allocation_original_id is not null then
   raise exception using errcode='55000',message='FUNDING_ZERO_CONDITION_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_condition_originals where id=p_condition.previous_condition_id;
  if previous.user_id is distinct from p_condition.user_id or previous.activation_id is distinct from p_condition.activation_id
   or p_condition.revision is distinct from previous.revision+1 or p_condition.effective_at<previous.effective_at
   or previous.id is distinct from(select id from app_private.funding_condition_originals where user_id=p_condition.user_id order by revision desc limit 1) then
   raise exception using errcode='55000',message='FUNDING_CONDITION_SUCCESSOR_MISMATCH'; end if;
  if p_condition.cause_credit_boundary_id is not null then
   select * into preparation from app_private.funding_credit_boundary_preparations where id=p_condition.cause_credit_boundary_id;
   if preparation.user_id is distinct from p_condition.user_id or not preparation.settlement_expected
    or preparation.previous_state_id is distinct from(select id from app_private.funding_engine_state where user_id=p_condition.user_id)
    or p_condition.effective_at is distinct from preparation.effective_at or p_condition.allocation_original_id is not null
    or p_condition.current_allocation_original_id is distinct from preparation.current_allocation_original_id then
    raise exception using errcode='55000',message='FUNDING_CREDIT_CONDITION_CAUSE_MISMATCH'; end if;
  else
   select * into original from app_private.funding_allocation_originals where id=p_condition.allocation_original_id;
   if original.user_id is distinct from p_condition.user_id or p_condition.current_allocation_original_id is distinct from original.id
    or original.effective_at is distinct from p_condition.effective_at then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_CONDITION_CAUSE_MISMATCH'; end if;
  end if;
 end if;
end;
$$;

create or replace function app_private.guard_funding_condition() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; previous app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; inputs jsonb;
begin
 if new.cause_principal_boundary_id is not null then perform app_private.validate_principal_boundary_condition(new);return new;end if;
 if new.inputs->>'input_contract_version'='3' and(new.cause_credit_boundary_id is not null or new.allocation_original_id is not null) then
  perform app_private.validate_credit_condition(new);return new;end if;
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

create or replace function app_private.apply_funding_allocation_boundary(p_allocation uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; earned app_private.funding_earned_receipts%rowtype;
 transition uuid; credit uuid; calculation jsonb; inputs jsonb; wallet_id uuid;
begin
 if(select c.inputs->>'input_contract_version' from app_private.funding_engine_state s
  join app_private.funding_condition_originals c on c.id=s.condition_id
  join app_private.funding_allocation_originals a on a.user_id=s.user_id where a.id=p_allocation) in('2','3') then
  return app_private.apply_forward_allocation_boundary(p_allocation); end if;
 if exists(select 1 from app_private.funding_credit_boundary_completions b join app_private.funding_allocation_originals a
   on a.user_id=b.user_id where a.id=p_allocation) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 perform app_private.assert_funding_member_writer(original.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 select id into transition from app_private.funding_condition_originals where allocation_original_id=p_allocation;
 if transition is not null then
  perform app_private.assert_allocation_boundary_complete(p_allocation,transition);
  return transition;
 end if;
 -- Member lock precedes wallet serialization. All source facts are read again
 -- after the wallet lock; a simultaneous unsupported credit cannot be ignored.
 select id into wallet_id from public.wallet_accounts where user_id=original.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 if activation.id is null then
  if original.revision<>1 or (select count(*) from app_private.funding_allocation_originals where user_id=original.user_id)<>1 then
   raise exception using errcode='55000',message='FUNDING_INITIAL_ALLOCATION_HISTORY_UNSUPPORTED'; end if;
  select id into credit from public.money_source_movements where user_id=original.user_id and source_bucket='PRINCIPAL' and movement_kind='CREDIT';
  if credit is null then raise exception using errcode='55000',message='FUNDING_FRESH_PRINCIPAL_REQUIRED'; end if;
  perform app_private.activate_zero_funding_allocation(credit);
  select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 end if;
 if activation.runtime_version<>2 then raise exception using errcode='55000',message='FUNDING_EXISTING_RUNTIME_UNSUPPORTED'; end if;
 select * into state from app_private.funding_engine_state where user_id=original.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if original.revision is distinct from condition.revision+1 or state.activation_id is distinct from activation.id
  or original.effective_at<state.cursor_at or original.effective_at>=cycle.cycle_end or state.cycle_closed then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_BOUNDARY_UNSUPPORTED'; end if;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,original.effective_at);
 if inputs is distinct from condition.inputs then raise exception using errcode='55000',message='FUNDING_CONDITION_BOUNDARY_ADAPTER_REQUIRED'; end if;
 transition:=app_private.create_prospective_funding_condition(activation.id,p_allocation,condition.id);
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from original.effective_at-state.cursor_at)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 earned.id:=gen_random_uuid(); earned.user_id:=original.user_id; earned.activation_id:=activation.id; earned.cycle_id:=cycle.id;
 earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.settled_from:=state.cursor_at;
 earned.settled_to:=original.effective_at; earned.calculation:=calculation; earned.amount_atomic:=(calculation->>'amountAtomic')::bigint;
 earned.runtime_version:=2; earned.condition_id:=condition.id; earned.cause_allocation_id:=p_allocation;
 if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
 earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
 earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select earned.*;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
  earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,original.user_id,activation.id,cycle.id,state.revision+1,state.id,earned.id,original.effective_at,
  (calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric,
  (calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric,
  (calculation->>'carryNum')::numeric,(calculation->>'carryDen')::numeric,transition);
 perform app_private.post_prospective_funding_earned(earned.id);
 perform app_private.write_prospective_funding_seal(earned.id,'FUNDING_EARNED_ACCEPTED',original.user_id,earned.input_digest,
  earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned));
 return transition;
end;
$$;

create or replace function app_private.apply_forward_allocation_boundary(p_allocation uuid) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 earned app_private.funding_earned_receipts%rowtype; wallet_id uuid; inputs jsonb; calculation jsonb; caps numeric[]; transition uuid;
begin
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 perform app_private.assert_funding_member_writer(original.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 select id into transition from app_private.funding_condition_originals where allocation_original_id=p_allocation;
 if transition is not null then perform app_private.assert_allocation_boundary_complete(p_allocation,transition); return transition; end if;
 perform app_private.assert_funding_global_execution_allowed();
 select id into wallet_id from public.wallet_accounts where user_id=original.user_id and currency='KRW' and closed_at is null for update;
 select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 select * into state from app_private.funding_engine_state where user_id=original.user_id;
 if wallet_id is null or activation.runtime_version<>2 or state.id is null
  or exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
   on b.id=c.boundary_id where c.user_id=original.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 perform app_private.assert_credit_condition_inputs(condition.id,original.effective_at);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,original.effective_at);
 caps:=app_private.funding_state_effective_capacities(state.id);
 if condition.inputs->>'input_contract_version'='3' then
  inputs:=app_private.read_verified_input3_funding_inputs(original.user_id,p_allocation,original.effective_at);
 else
  inputs:=app_private.read_verified_credit_funding_inputs(original.user_id,p_allocation,original.effective_at);
 end if;
 condition.id:=gen_random_uuid(); condition.revision:=condition.revision+1; condition.previous_condition_id:=state.condition_id;
 condition.cause_principal_boundary_id:=null;
 condition.allocation_original_id:=p_allocation; condition.cause_credit_boundary_id:=null; condition.current_allocation_original_id:=p_allocation;
 condition.effective_at:=original.effective_at; condition.inputs:=inputs; condition.recorded_at:=clock_timestamp();
 condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid();
 condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
 insert into app_private.funding_condition_originals select condition.*;
 perform app_private.write_prospective_funding_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
 condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 earned.id:=gen_random_uuid(); earned.user_id:=original.user_id; earned.activation_id:=activation.id; earned.cycle_id:=state.cycle_id;
 earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.condition_id:=state.condition_id;
 earned.settled_from:=state.cursor_at; earned.settled_to:=original.effective_at; earned.calculation:=calculation;
 earned.amount_atomic:=(calculation->>'amountAtomic')::bigint; earned.runtime_version:=2; earned.cause_allocation_id:=p_allocation;
 if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
 earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
 earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select earned.*;
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(earned.next_state_id,original.user_id,caps[1],caps[2],caps[3],caps[4]);
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
 earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,original.user_id,activation.id,state.cycle_id,state.revision+1,state.id,earned.id,original.effective_at,
 (calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric,(calculation->>'retentionUsedNum')::numeric,
 (calculation->>'retentionUsedDen')::numeric,(calculation->>'carryNum')::numeric,(calculation->>'carryDen')::numeric,condition.id);
 perform app_private.post_prospective_funding_earned(earned.id);
 perform app_private.write_prospective_funding_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,
 earned.input_digest,earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned));
 return condition.id;
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
 if p_earned.cause_allocation_id is not null and(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=p_earned.condition_id) in('2','3') then
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

create function app_private.finish_input3_credit_funding_boundary(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype;
 completion app_private.funding_credit_boundary_completions%rowtype;source public.money_source_movements%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;earned app_private.funding_earned_receipts%rowtype;
 caps numeric[];old_base numeric[];old_retention numeric[];next_base numeric[];next_retention numeric[];
 inputs jsonb;message text;lot_id uuid;span bigint;remaining bigint;
begin
 perform app_private.assert_credit_boundary_executor();
 select b.* into preparation from app_private.funding_credit_boundary_preparations b where b.id=p_boundary;
 source:=app_private.read_credit_boundary_source(p_boundary);
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=preparation.previous_state_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 select c.* into cycle from app_private.funding_cycle_windows c where c.id=state.cycle_id;
 select e.* into earned from app_private.funding_earned_receipts e where e.cause_credit_boundary_id=preparation.id;
 if not preparation.settlement_expected or condition.inputs->>'input_contract_version' is distinct from '3'
  or state.user_id is distinct from preparation.user_id or earned.id is null
  or earned.previous_state_id is distinct from state.id then
  raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_OLD_INTERVAL_REQUIRED';end if;
 -- Genuine new credit root clocks are initialized before the fresh input3
 -- snapshot and successor cursor. No earlier root/age is rebuilt or rewritten.
 for lot_id in select l.id from public.funding_principal_lots l where l.user_id=preparation.user_id
  and l.money_source_movement_id=source.id
  and not exists(select 1 from app_private.funding_principal_portions p where p.lot_id=l.id and p.parent_portion_id is null)
  order by l.effective_at,l.recorded_at,l.id loop
  perform app_private.initialize_funding_portion_clock(lot_id);
 end loop;
 completion.id:=gen_random_uuid();completion.boundary_id:=preparation.id;completion.user_id:=preparation.user_id;
 completion.credit_movement_id:=source.id;completion.activation_id:=state.activation_id;
 completion.accepted_state_id:=earned.next_state_id;completion.reason_code:=preparation.unresolved_reason_code;
 caps:=app_private.funding_state_effective_capacities(state.id);
 next_base:=array[caps[1],caps[2]];next_retention:=array[caps[3],caps[4]];
 if completion.reason_code is null then
  begin
   inputs:=app_private.read_verified_input3_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,preparation.effective_at);
   span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
   remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
   if inputs->>'tier_activated' is distinct from 'true' or remaining<=0 or state.cycle_closed then
    raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_FIRST_CYCLE_REQUIRED';end if;
   old_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
   old_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
   next_base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000,remaining,span);
   next_retention:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_retention[1],old_retention[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000,remaining,span);
   if next_base[1]*(earned.calculation->>'baseUsedDen')::numeric<
      (earned.calculation->>'baseUsedNum')::numeric*next_base[2]
    or next_retention[1]*(earned.calculation->>'retentionUsedDen')::numeric<
      (earned.calculation->>'retentionUsedNum')::numeric*next_retention[2] then
    raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_CAPACITY_BELOW_USED';end if;
  exception when sqlstate '55000' or sqlstate '42501' then
   get stacked diagnostics message=message_text;
   completion.reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
   next_base:=array[caps[1],caps[2]];next_retention:=array[caps[3],caps[4]];
  end;
 end if;
 completion.input_original:=coalesce(inputs,jsonb_build_object('input_contract_version',3,'user_id',preparation.user_id,
  'credit_id',source.id,'runtime_input_unresolved',true));
 if completion.reason_code is null then
  condition.id:=gen_random_uuid();condition.revision:=condition.revision+1;condition.previous_condition_id:=state.condition_id;
  condition.cause_principal_boundary_id:=null;condition.allocation_original_id:=null;condition.cause_credit_boundary_id:=preparation.id;
  condition.current_allocation_original_id:=preparation.current_allocation_original_id;condition.effective_at:=preparation.effective_at;
  condition.inputs:=inputs;condition.audit_id:=gen_random_uuid();condition.source_event_id:=gen_random_uuid();condition.recorded_at:=clock_timestamp();
  condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
  insert into app_private.funding_condition_originals select condition.*;
  perform app_private.write_credit_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
   condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),preparation.effective_at);
  completion.condition_id:=condition.id;completion.runtime_outcome:='ACCEPTED';
 else completion.condition_id:=state.condition_id;completion.runtime_outcome:='UNRESOLVED';end if;
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(earned.next_state_id,preparation.user_id,next_base[1],next_base[2],next_retention[1],next_retention[2]);
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
  earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,preparation.user_id,state.activation_id,state.cycle_id,state.revision+1,state.id,earned.id,preparation.effective_at,
  (earned.calculation->>'baseUsedNum')::numeric,(earned.calculation->>'baseUsedDen')::numeric,
  (earned.calculation->>'retentionUsedNum')::numeric,(earned.calculation->>'retentionUsedDen')::numeric,
  (earned.calculation->>'carryNum')::numeric,(earned.calculation->>'carryDen')::numeric,completion.condition_id);
 completion.audit_id:=gen_random_uuid();completion.source_event_id:=gen_random_uuid();completion.recorded_at:=clock_timestamp();
 completion.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(completion));
 insert into app_private.funding_credit_boundary_completions select completion.*;
 perform app_private.write_credit_boundary_seal(completion.id,'FUNDING_CREDIT_BOUNDARY_COMPLETED',completion.user_id,
  completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_credit_completion_snapshot(completion),preparation.effective_at);
end;
$$;

create or replace function app_private.finish_funding_credit_boundary(p_boundary uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; completion app_private.funding_credit_boundary_completions%rowtype;
 source public.money_source_movements%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; message text; caps numeric[]; old_base numeric[]; old_retention numeric[]; next_base numeric[]; next_retention numeric[];
 next_state uuid; lot_id uuid; span bigint; remaining bigint;
begin
 perform app_private.assert_credit_boundary_executor();
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_boundary;
 if preparation.id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_PREPARATION_MISSING'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 if exists(select 1 from app_private.funding_credit_boundary_completions where boundary_id=p_boundary) then
  perform app_private.assert_credit_boundary_complete(p_boundary); return; end if;
 source:=app_private.read_credit_boundary_source(p_boundary);
 if preparation.settlement_expected and(select c.inputs->>'input_contract_version' from app_private.funding_engine_state_receipts s
  join app_private.funding_condition_originals c on c.id=s.condition_id where s.id=preparation.previous_state_id)='3' then
  perform app_private.finish_input3_credit_funding_boundary(p_boundary);return;
 end if;
 completion.id:=gen_random_uuid(); completion.boundary_id:=preparation.id; completion.user_id:=preparation.user_id;
 completion.credit_movement_id:=source.id; completion.reason_code:=preparation.unresolved_reason_code;
 if completion.reason_code is null then
  begin inputs:=app_private.read_verified_credit_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,preparation.effective_at);
  exception when sqlstate '55000' or sqlstate '42501' then
   get stacked diagnostics message=message_text;
   completion.reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
  end;
 end if;
 completion.input_original:=coalesce(inputs,jsonb_build_object('input_contract_version',2,'user_id',preparation.user_id,
 'credit_id',source.id,'runtime_input_unresolved',true));
 select * into activation from app_private.funding_engine_activations where user_id=preparation.user_id;
 select * into state from app_private.funding_engine_state_receipts where id=preparation.previous_state_id;
 select * into earned from app_private.funding_earned_receipts where cause_credit_boundary_id=preparation.id;
 if preparation.settlement_expected then
  -- The accepted old interval must remain committed exactly even if the new
  -- policy/input becomes unsupported. No pre-boundary earning is discarded.
  completion.activation_id:=activation.id;
  if completion.reason_code is null then
   select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
   select * into condition from app_private.funding_condition_originals where id=state.condition_id;
   span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
   remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
   caps:=app_private.funding_state_effective_capacities(state.id);
   old_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
   old_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
   next_base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000,remaining,span);
   next_retention:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_retention[1],old_retention[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000,remaining,span);
   condition.id:=gen_random_uuid(); condition.revision:=condition.revision+1; condition.previous_condition_id:=state.condition_id;
   condition.allocation_original_id:=null; condition.cause_credit_boundary_id:=preparation.id;
   condition.current_allocation_original_id:=preparation.current_allocation_original_id;
   condition.effective_at:=preparation.effective_at; condition.inputs:=inputs;
   condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid(); condition.recorded_at:=clock_timestamp();
   condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
   insert into app_private.funding_condition_originals select condition.*;
   perform app_private.write_credit_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
    condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),preparation.effective_at);
   completion.condition_id:=condition.id; completion.runtime_outcome:='ACCEPTED';
  else
   completion.condition_id:=state.condition_id; completion.runtime_outcome:='UNRESOLVED';
   caps:=app_private.funding_state_effective_capacities(state.id);
   next_base:=array[caps[1],caps[2]]; next_retention:=array[caps[3],caps[4]];
  end if;
  next_state:=earned.next_state_id; completion.accepted_state_id:=next_state;
  -- Exact capacities are inserted first with a deferred same-owner state link.
  insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
  values(next_state,preparation.user_id,next_base[1],next_base[2],next_retention[1],next_retention[2]);
  insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
   earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
  values(next_state,preparation.user_id,activation.id,state.cycle_id,state.revision+1,state.id,earned.id,preparation.effective_at,
   (earned.calculation->>'baseUsedNum')::numeric,(earned.calculation->>'baseUsedDen')::numeric,
   (earned.calculation->>'retentionUsedNum')::numeric,(earned.calculation->>'retentionUsedDen')::numeric,
   (earned.calculation->>'carryNum')::numeric,(earned.calculation->>'carryDen')::numeric,completion.condition_id);
 elsif activation.id is not null or completion.reason_code is not null then
  completion.runtime_outcome:='UNRESOLVED';
  completion.reason_code:=coalesce(completion.reason_code,'FUNDING_EXISTING_RUNTIME_UNSUPPORTED');
 elsif inputs->>'tier_activated' is distinct from 'true' then
  completion.runtime_outcome:='INACTIVE'; completion.reason_code:='FUNDING_BELOW_MINIMUM';
 elsif exists(select 1 from app_private.funding_cycle_windows where user_id=preparation.user_id)
  or preparation.current_allocation_original_id is not null then
  completion.runtime_outcome:='UNRESOLVED'; completion.reason_code:='FUNDING_EXISTING_ANCHOR_UNSUPPORTED';
 else
  -- First actual receipt-bound activation is prospective at this credit clock.
  -- No earlier source receives pre-activation catch-up or a fabricated product.
  cycle.id:=gen_random_uuid(); cycle.user_id:=preparation.user_id; cycle.cycle_ordinal:=0;
  cycle.cycle_days:=(inputs->>'cycle_days')::integer; cycle.cycle_started_at:=preparation.effective_at;
  cycle.cycle_end:=preparation.effective_at+cycle.cycle_days*interval '24 hours';
  insert into app_private.funding_cycle_windows(id,user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end)
  values(cycle.id,cycle.user_id,cycle.cycle_ordinal,cycle.cycle_days,cycle.cycle_started_at,cycle.cycle_end);
  activation.id:=gen_random_uuid(); activation.user_id:=preparation.user_id; activation.trigger_credit_movement_id:=source.id;
  select id into activation.trigger_principal_revision_id from public.funding_principal_revisions where money_source_movement_id=source.id;
  activation.policy_publication_id:=(inputs->>'policy_publication_id')::uuid; activation.first_cycle_id:=cycle.id;
  activation.principal_atomic:=(inputs->>'principal_atomic')::bigint; activation.effective_at:=preparation.effective_at;
  activation.runtime_version:=2; activation.input_original:=inputs; activation.input_digest:=app_private.funding_engine_digest(inputs);
  activation.audit_id:=gen_random_uuid(); activation.source_event_id:=gen_random_uuid(); activation.recorded_at:=clock_timestamp();
  insert into public.ledger_accounts(code,currency,account_class,normal_side)
  values('PUTDUK:MINING_REWARD_EXPENSE:KRW','KRW','EXPENSE','DEBIT') on conflict(code) do nothing;
  insert into app_private.funding_engine_activations select activation.*;
  perform app_private.write_credit_boundary_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
   activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation),preparation.effective_at);
  condition.id:=gen_random_uuid(); condition.user_id:=preparation.user_id; condition.activation_id:=activation.id;
  condition.revision:=0; condition.effective_at:=preparation.effective_at; condition.inputs:=inputs;
  condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid(); condition.recorded_at:=clock_timestamp();
  condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
  insert into app_private.funding_condition_originals select condition.*;
  perform app_private.write_credit_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
   condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),preparation.effective_at);
  -- The activation AFTER hook initialized only the verified input manifest,
  -- in immutable source order, before any initial accepted cursor existed.
  next_state:=gen_random_uuid();
  next_base:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
  next_retention:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000);
  insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
  values(next_state,preparation.user_id,next_base[1],next_base[2],next_retention[1],next_retention[2]);
  insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,cursor_at,
   base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
  values(next_state,preparation.user_id,activation.id,cycle.id,0,preparation.effective_at,0,1,0,1,0,1,condition.id);
  completion.runtime_outcome:='ACCEPTED'; completion.activation_id:=activation.id;
  completion.condition_id:=condition.id; completion.accepted_state_id:=next_state;
 end if;
 if completion.runtime_outcome='ACCEPTED' and preparation.settlement_expected then
  for lot_id in select id from public.funding_principal_lots where user_id=preparation.user_id
   order by effective_at,recorded_at,id loop
   perform app_private.initialize_funding_portion_clock(lot_id);
  end loop;
 end if;
 completion.audit_id:=gen_random_uuid(); completion.source_event_id:=gen_random_uuid(); completion.recorded_at:=clock_timestamp();
 completion.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(completion));
 insert into app_private.funding_credit_boundary_completions select completion.*;
 perform app_private.write_credit_boundary_seal(completion.id,'FUNDING_CREDIT_BOUNDARY_COMPLETED',completion.user_id,
 completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_credit_completion_snapshot(completion),preparation.effective_at);
end;
$$;

create or replace function app_private.assert_credit_boundary_complete(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; completion app_private.funding_credit_boundary_completions%rowtype;
 source public.money_source_movements%rowtype; earned app_private.funding_earned_receipts%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 activation app_private.funding_engine_activations%rowtype; caps numeric[]; old_caps numeric[]; expected_base numeric[]; expected_retention numeric[];
 cycle app_private.funding_cycle_windows%rowtype; previous_condition app_private.funding_condition_originals%rowtype; previous app_private.funding_engine_state_receipts%rowtype;
 span bigint; remaining bigint;
begin
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_boundary;
 select * into completion from app_private.funding_credit_boundary_completions where boundary_id=p_boundary;
 source:=app_private.read_credit_boundary_source(p_boundary);
 if completion.boundary_id is null or completion.user_id is distinct from preparation.user_id
  or completion.credit_movement_id is distinct from source.id
  or completion.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(completion))
  or preparation.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_preparation_snapshot(preparation)) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_BOUNDARY_COMPLETION_MISSING'; end if;
 perform app_private.assert_funding_engine_seal(preparation.id,'FUNDING_CREDIT_BOUNDARY_PREPARED',preparation.user_id,preparation.input_digest,
 preparation.audit_id,preparation.source_event_id,app_private.funding_credit_preparation_snapshot(preparation));
 perform app_private.assert_funding_engine_seal(completion.id,'FUNDING_CREDIT_BOUNDARY_COMPLETED',completion.user_id,completion.input_digest,
 completion.audit_id,completion.source_event_id,app_private.funding_credit_completion_snapshot(completion));
 select * into earned from app_private.funding_earned_receipts where cause_credit_boundary_id=p_boundary;
 select * into previous from app_private.funding_engine_state_receipts where id=preparation.previous_state_id;
 if preparation.settlement_expected is distinct from(earned.id is not null) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_OLD_INTERVAL_ACCEPTANCE_MISSING'; end if;
 if completion.runtime_outcome='ACCEPTED' then
  select * into activation from app_private.funding_engine_activations where id=completion.activation_id;
  select * into state from app_private.funding_engine_state_receipts where id=completion.accepted_state_id;
  select * into condition from app_private.funding_condition_originals where id=completion.condition_id;
  select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
  if activation.user_id is distinct from preparation.user_id or activation.runtime_version<>2
   or state.user_id is distinct from preparation.user_id or state.activation_id is distinct from activation.id
   or state.condition_id is distinct from condition.id or state.cursor_at is distinct from preparation.effective_at
   or condition.user_id is distinct from preparation.user_id or condition.effective_at is distinct from preparation.effective_at
   or condition.inputs is distinct from completion.input_original then
   raise exception using errcode='55000',message='FUNDING_CREDIT_ACCEPTED_STATE_MISSING'; end if;
  if condition.inputs->>'input_contract_version'='3' then
   perform app_private.assert_input3_condition_snapshot(condition.id);
  end if;
  if preparation.settlement_expected then
   if state.earned_receipt_id is distinct from earned.id or state.id is distinct from earned.next_state_id
    or condition.cause_credit_boundary_id is distinct from preparation.id or condition.previous_condition_id is distinct from previous.condition_id then
    raise exception using errcode='55000',message='FUNDING_CREDIT_ACCEPTED_CAUSE_MISMATCH'; end if;
   select * into previous_condition from app_private.funding_condition_originals where id=previous.condition_id;
   old_caps:=app_private.funding_state_effective_capacities(previous.id);
   span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
   remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
   expected_base:=app_private.funding_exact_forward_capacity(old_caps[1],old_caps[2],
    (previous_condition.inputs->>'principal_atomic')::numeric*(previous_condition.inputs->>'base_bps')::numeric,10000,
    (condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000,remaining,span);
   expected_retention:=app_private.funding_exact_forward_capacity(old_caps[3],old_caps[4],
    (previous_condition.inputs->>'principal_atomic')::numeric*(previous_condition.inputs->>'retention_bps')::numeric,10000,
    (condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000,remaining,span);
  else
   if previous.id is not null or state.revision<>0 or condition.revision<>0
    or activation.trigger_credit_movement_id is distinct from source.id or activation.effective_at is distinct from preparation.effective_at then
    raise exception using errcode='55000',message='FUNDING_CREDIT_INITIAL_STATE_MISSING'; end if;
   expected_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
   expected_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
  end if;
  caps:=app_private.funding_state_effective_capacities(state.id);
  if caps is distinct from array[expected_base[1],expected_base[2],expected_retention[1],expected_retention[2]] then
   raise exception using errcode='55000',message='FUNDING_FORWARD_CAPACITY_RECEIPT_MISMATCH'; end if;
  if not exists(select 1 from app_private.funding_portion_clock_state s join app_private.funding_principal_portions p on p.id=s.portion_id
    join public.funding_principal_lots l on l.id=p.lot_id where l.money_source_movement_id=source.id and s.user_id=preparation.user_id
    and s.status='AVAILABLE' and p.parent_portion_id is null and p.amount_micro_krw=l.amount_micro_krw
    and s.accumulated_eligible_microseconds=0 and s.resumed_at=l.effective_at) then
   raise exception using errcode='55000',message='FUNDING_CREDIT_PORTION_CLOCK_MISSING'; end if;
 elsif completion.runtime_outcome='INACTIVE' then
  if preparation.settlement_expected or preparation.previous_state_id is not null
   or completion.reason_code is distinct from 'FUNDING_BELOW_MINIMUM' or completion.input_original->>'tier_activated' is distinct from 'false' then
   raise exception using errcode='55000',message='FUNDING_INACTIVE_CREDIT_ORIGINAL_MISMATCH'; end if;
 elsif completion.runtime_outcome='UNRESOLVED' then
  if preparation.settlement_expected then
   select * into state from app_private.funding_engine_state_receipts where id=earned.next_state_id;
   if completion.accepted_state_id is distinct from state.id or completion.condition_id is distinct from previous.condition_id
    or state.condition_id is distinct from previous.condition_id or state.earned_receipt_id is distinct from earned.id then
    raise exception using errcode='55000',message='FUNDING_UNRESOLVED_CREDIT_OLD_STATE_MISSING'; end if;
  elsif completion.accepted_state_id is not null or completion.condition_id is not null or completion.activation_id is not null then
   raise exception using errcode='55000',message='FUNDING_UNRESOLVED_CREDIT_STATE_FORBIDDEN'; end if;
 end if;
end;
$$;

create or replace function app_private.guard_credit_boundary_completion() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; source public.money_source_movements%rowtype; inputs jsonb;
begin
 perform app_private.assert_credit_boundary_executor();
 select * into preparation from app_private.funding_credit_boundary_preparations where id=new.boundary_id;
 source:=app_private.read_credit_boundary_source(new.boundary_id);
 if preparation.user_id is distinct from new.user_id or new.credit_movement_id is distinct from source.id
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_COMPLETION_ORIGINAL_MISMATCH'; end if;
 if new.runtime_outcome in('ACCEPTED','INACTIVE') then
  if new.input_original->>'input_contract_version'='3' then
   if not preparation.settlement_expected or(select c.inputs->>'input_contract_version' from app_private.funding_engine_state_receipts s
    join app_private.funding_condition_originals c on c.id=s.condition_id where s.id=preparation.previous_state_id) is distinct from '3' then
    raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_OLD_INTERVAL_REQUIRED';end if;
   inputs:=app_private.read_verified_input3_funding_inputs(new.user_id,preparation.current_allocation_original_id,preparation.effective_at);
  else
   inputs:=app_private.read_verified_credit_funding_inputs(new.user_id,preparation.current_allocation_original_id,preparation.effective_at);
  end if;
  if inputs is distinct from new.input_original or(preparation.unresolved_reason_code is not null)
   or(new.runtime_outcome='ACCEPTED' and inputs->>'tier_activated' is distinct from 'true')
   or(new.runtime_outcome='INACTIVE' and inputs->>'tier_activated' is distinct from 'false') then
   raise exception using errcode='55000',message='FUNDING_CREDIT_COMPLETION_INPUT_MISMATCH'; end if;
 elsif new.reason_code is null then raise exception using errcode='55000',message='FUNDING_CREDIT_UNRESOLVED_REASON_REQUIRED';
 end if;
 return new;
end;
$$;

create or replace function app_private.assert_allocation_boundary_complete(p_allocation uuid,p_transition uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; log public.audit_logs%rowtype;
begin
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 select * into log from public.audit_logs where id=original.audit_id;
 if not exists(select 1 from app_private.idempotency_keys i where i.scope='funding.allocation'
   and i.actor_id=original.user_id and i.idempotency_key=log.metadata->>'idempotency_key' and i.status='COMPLETED'
   and i.response_status=200 and i.completed_at>=original.effective_at
   and i.response_payload->>'allocationId'=original.id::text
   and i.response_payload->>'transitionId'=p_transition::text
   and i.response_payload->>'revision'=original.revision::text
   and i.response_payload->>'inputDigest'=original.input_digest) then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_COMMAND_COMPLETION_MISSING'; end if;
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_ALLOCATION_CONFIRMED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.funding_allocation_snapshot(original));
 if(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=p_transition)='3' then
  perform app_private.assert_input3_condition_snapshot(p_transition);
 end if;
end;
$$;

revoke all on function app_private.finish_input3_credit_funding_boundary(uuid) from public,anon,authenticated,service_role;

commit;
