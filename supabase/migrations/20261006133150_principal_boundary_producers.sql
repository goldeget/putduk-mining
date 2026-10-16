begin;

-- Private constructor reached only INSIDE the closed130 owner executor after
-- its fresh admission seal and before native finance. No service EXECUTE.
create function app_private.begin_principal_runtime_boundary(p_admission uuid) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 intent app_private.funding_principal_recovery_intent_originals%rowtype;
 preparation app_private.funding_principal_boundary_preparations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 earned app_private.funding_earned_receipts%rowtype;
 inputs jsonb; calculation jsonb; reason_code text;
begin
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
 if intent.id is null then return null; end if; -- generic MINING/START unchanged
 if auth.role() is distinct from 'service_role' then
  if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' then
   raise exception using errcode='42501',message='FUNDING_PRINCIPAL_CALLBACK_CONTEXT_REQUIRED';end if;
  -- This audit is an exception, not an accepted input/cause/state. No JWT is
  -- fabricated to turn the preserved SQL-only financial caller into an engine.
  insert into public.audit_logs(actor_user_id,action,target_type,target_id,reason,request_id,after_state,created_at)
   values(admission.user_id,'FUNDING_PRINCIPAL_BOUNDARY_UNAVAILABLE','FUNDING_ENGINE_V1',admission.id::text,
    'SQL-only financial caller has no trusted engine JWT',admission.journal_request_id,
    jsonb_build_object('reason_code','FUNDING_PRINCIPAL_ENGINE_CONTEXT_UNRESOLVED','clock_admission_id',admission.id,'accepted',false),admission.effective_at);
  return null;
 end if;
 perform app_private.assert_principal_input_executor(admission.user_id);
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.clock_admission_id=admission.id;
 if preparation.id is not null then
  perform app_private.assert_principal_boundary_complete(preparation.id);return preparation.id;end if;
 perform app_private.assert_principal_admission_before_finance(admission.id);
 select s.* into state from app_private.funding_engine_state s where s.user_id=admission.user_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 if state.id is null then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CURRENT_STATE_REQUIRED'; end if;
 begin
  inputs:=app_private.read_principal_prefinance_old_inputs(admission.id,state.id);
  calculation:=app_private.calculate_credit_boundary_interval(state.id,admission.effective_at);
 exception when sqlstate '55000' then
  -- Only historical authority-only or ended-cycle CANCEL may proceed without
  -- economic acceptance. It must not acquire retrospective gross earning.
  if admission.phase<>'RELEASE' or sqlerrm not in('FUNDING_PRINCIPAL_HISTORY_BOUNDARY_UNRESOLVED','FUNDING_CREDIT_CYCLE_BOUNDARY_UNSUPPORTED','FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED','FUNDING_PRINCIPAL_OLD_CONDITION_CHANGED','FUNDING_POLICY_ORIGINAL_REQUIRED','FUNDING_DEFAULT_POLICY_REQUIRED') then raise;end if;
  reason_code:=sqlerrm;inputs:=condition.inputs;calculation:='{}'::jsonb;
 end;
 preparation.id:=gen_random_uuid();preparation.user_id:=admission.user_id;preparation.intent_id:=intent.id;
 preparation.clock_admission_id:=admission.id;preparation.phase:=admission.phase;
 preparation.previous_state_id:=state.id;preparation.cycle_id:=state.cycle_id;
 preparation.current_allocation_original_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 preparation.settlement_expected:=reason_code is null;preparation.unresolved_reason_code:=reason_code;
 preparation.effective_at:=admission.effective_at;preparation.recorded_at:=admission.effective_at;
 preparation.old_input_original:=inputs;preparation.old_interval_calculation:=calculation;
 preparation.audit_id:=gen_random_uuid();preparation.source_event_id:=gen_random_uuid();
 preparation.input_digest:=app_private.funding_engine_digest(app_private.funding_principal_preparation_snapshot(preparation));
 insert into app_private.funding_principal_boundary_preparations select preparation.*;
 perform app_private.write_principal_boundary_seal(preparation.id,'FUNDING_PRINCIPAL_BOUNDARY_PREPARED',preparation.user_id,
  preparation.input_digest,preparation.audit_id,preparation.source_event_id,app_private.funding_principal_preparation_snapshot(preparation),admission.id);
 if preparation.settlement_expected then
  earned.id:=gen_random_uuid();earned.user_id:=state.user_id;earned.activation_id:=state.activation_id;earned.cycle_id:=state.cycle_id;
  earned.previous_state_id:=state.id;earned.next_state_id:=gen_random_uuid();earned.condition_id:=state.condition_id;
  earned.runtime_version:=2;earned.cause_principal_boundary_id:=preparation.id;
  earned.settled_from:=state.cursor_at;earned.settled_to:=admission.effective_at;earned.recorded_at:=admission.effective_at;
  earned.calculation:=calculation;earned.amount_atomic:=(calculation->>'amountAtomic')::bigint;
  if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid();earned.settlement_id:=gen_random_uuid();end if;
  earned.audit_id:=gen_random_uuid();earned.source_event_id:=gen_random_uuid();
  earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
  insert into app_private.funding_earned_receipts select earned.*;
  perform app_private.post_principal_boundary_earned(earned.id);
  perform app_private.write_principal_boundary_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,
   earned.input_digest,earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned),admission.id);
 end if;
 return preparation.id;
end;
$$;

create function app_private.principal_boundary_expected_capacities(p_boundary uuid,p_next_inputs jsonb) returns numeric[]
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; caps numeric[]; base numeric[]; maintenance numeric[];
 old_base numeric[]; new_base numeric[]; old_maintenance numeric[]; new_maintenance numeric[];
 span bigint; remaining bigint;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_boundary;
 perform app_private.assert_principal_history_executor(preparation.user_id);
 select w.* into cycle from app_private.funding_cycle_windows w where w.id=preparation.cycle_id;
 if not preparation.settlement_expected or p_next_inputs->>'input_contract_version' is distinct from '3'
  or p_next_inputs->>'tier_activated' is distinct from 'true'
  or p_next_inputs->>'user_id' is distinct from preparation.user_id::text
  or p_next_inputs->>'policy_publication_id' is distinct from preparation.old_input_original->>'policy_publication_id'
  or p_next_inputs->>'policy_config_digest' is distinct from preparation.old_input_original->>'policy_config_digest'
  or p_next_inputs->>'cycle_days' is distinct from preparation.old_input_original->>'cycle_days'
  or p_next_inputs->>'base_bps' is distinct from preparation.old_input_original->>'base_bps'
  or preparation.effective_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_NEXT_CONDITION_UNRESOLVED'; end if;
 caps:=app_private.funding_state_effective_capacities(preparation.previous_state_id);
 span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
 remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
 old_base:=app_private.funding_exact_ratio((preparation.old_input_original->>'principal_atomic')::numeric*(preparation.old_input_original->>'base_bps')::numeric,10000);
 new_base:=app_private.funding_exact_ratio((p_next_inputs->>'principal_atomic')::numeric*(p_next_inputs->>'base_bps')::numeric,10000);
 old_maintenance:=app_private.funding_exact_ratio((preparation.old_input_original->>'principal_atomic')::numeric*(preparation.old_input_original->>'retention_bps')::numeric,10000);
 new_maintenance:=app_private.funding_exact_ratio((p_next_inputs->>'principal_atomic')::numeric*(p_next_inputs->>'retention_bps')::numeric,10000);
 base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],new_base[1],new_base[2],remaining,span);
 maintenance:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_maintenance[1],old_maintenance[2],new_maintenance[1],new_maintenance[2],remaining,span);
 if(preparation.old_interval_calculation->>'baseUsedNum')::numeric*base[2]>base[1]*(preparation.old_interval_calculation->>'baseUsedDen')::numeric
  or(preparation.old_interval_calculation->>'retentionUsedNum')::numeric*maintenance[2]>maintenance[1]*(preparation.old_interval_calculation->>'retentionUsedDen')::numeric then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CAPACITY_HISTORY_UNSUPPORTED'; end if;
 return array[base[1],base[2],maintenance[1],maintenance[2]];
end;
$$;

create function app_private.finish_principal_runtime_boundary(p_admission uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 completion app_private.funding_principal_boundary_completions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 earned app_private.funding_earned_receipts%rowtype;movement public.money_source_movements%rowtype;
 inputs jsonb; caps numeric[]; next_condition uuid; reason_code text;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_PRINCIPAL_COMPLETION_SERVICE_REQUIRED';end if;
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.clock_admission_id=p_admission;
 if preparation.id is null then return;end if; -- generic/history with no cause
 if auth.role() is distinct from 'service_role' and exists(select 1 from app_private.funding_principal_boundary_completions c where c.boundary_id=preparation.id) then
  perform app_private.assert_funding_withdrawal_clock_completion(p_admission);return;end if;
 if exists(select 1 from app_private.funding_principal_boundary_completions c where c.boundary_id=preparation.id) then
  perform app_private.assert_principal_history_executor(preparation.user_id);
  perform app_private.assert_principal_boundary_complete(preparation.id);return;end if;
 perform app_private.assert_principal_input_executor(preparation.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 select m.* into movement from public.money_source_movements m join public.withdrawal_requests r on r.id=admission.withdrawal_id
  where m.user_id=preparation.user_id and m.ledger_transaction_id=(case when admission.phase='HOLD' then r.hold_ledger_transaction_id else r.release_ledger_transaction_id end)
   and m.origin_code=(case when admission.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' else 'PRINCIPAL_RECOVERY_RELEASE' end);
 if movement.id is null then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_NATIVE_SOURCE_REQUIRED';end if;
 select s.* into previous from app_private.funding_engine_state s where s.user_id=preparation.user_id;
 if previous.id is distinct from preparation.previous_state_id then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_COMPLETION_STATE_STALE';end if;
 select e.* into earned from app_private.funding_earned_receipts e where e.cause_principal_boundary_id=preparation.id;
 reason_code:=preparation.unresolved_reason_code;
 if preparation.settlement_expected then
  if earned.id is null then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_OLD_EARNING_REQUIRED';end if;
  caps:=app_private.funding_state_effective_capacities(previous.id);
  begin
   inputs:=app_private.read_principal_portion_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,admission.effective_at);
   caps:=app_private.principal_boundary_expected_capacities(preparation.id,inputs);
  exception when sqlstate '55000' then
   reason_code:=sqlerrm;
   if reason_code !~ '^[A-Z][A-Z0-9_]{2,95}$' then raise;end if;
   caps:=app_private.funding_state_effective_capacities(previous.id);
  end;
  next_condition:=previous.condition_id;
  if reason_code is null then
   select c.* into condition from app_private.funding_condition_originals c where c.id=previous.condition_id;
   condition.id:=gen_random_uuid();condition.previous_condition_id:=previous.condition_id;condition.revision:=condition.revision+1;
   condition.allocation_original_id:=null;condition.cause_credit_boundary_id:=null;condition.cause_principal_boundary_id:=preparation.id;
   condition.current_allocation_original_id:=preparation.current_allocation_original_id;
   condition.effective_at:=admission.effective_at;condition.recorded_at:=admission.effective_at;condition.inputs:=inputs;
   condition.audit_id:=gen_random_uuid();condition.source_event_id:=gen_random_uuid();
   condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
   insert into app_private.funding_condition_originals select condition.*;
   perform app_private.write_principal_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
    condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),admission.id);
   next_condition:=condition.id;
  end if;
  insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den,recorded_at)
   values(earned.next_state_id,preparation.user_id,caps[1],caps[2],caps[3],caps[4],admission.effective_at);
  insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,earned_receipt_id,
   cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id,recorded_at)
  values(earned.next_state_id,previous.user_id,previous.activation_id,previous.cycle_id,previous.revision+1,previous.id,earned.id,
   admission.effective_at,(earned.calculation->>'baseUsedNum')::numeric,(earned.calculation->>'baseUsedDen')::numeric,
   (earned.calculation->>'retentionUsedNum')::numeric,(earned.calculation->>'retentionUsedDen')::numeric,
   (earned.calculation->>'carryNum')::numeric,(earned.calculation->>'carryDen')::numeric,next_condition,admission.effective_at);
  completion.accepted_state_id:=earned.next_state_id;
 else completion.accepted_state_id:=previous.id;
 end if;
 completion.id:=gen_random_uuid();completion.boundary_id:=preparation.id;completion.user_id:=preparation.user_id;
 completion.source_movement_id:=movement.id;completion.condition_id:=condition.id;
 completion.runtime_outcome:=(case when reason_code is null then 'ACCEPTED' else 'UNRESOLVED' end);
 completion.reason_code:=reason_code;completion.input_original:=coalesce(inputs,jsonb_build_object('input_contract_version',3,
  'user_id',preparation.user_id,'runtime_input_unresolved',true));
 completion.effective_at:=admission.effective_at;completion.recorded_at:=admission.effective_at;
 completion.audit_id:=gen_random_uuid();completion.source_event_id:=gen_random_uuid();
 completion.input_digest:=app_private.funding_engine_digest(app_private.funding_principal_completion_snapshot(completion));
 insert into app_private.funding_principal_boundary_completions select completion.*;
 perform app_private.write_principal_boundary_seal(completion.id,'FUNDING_PRINCIPAL_BOUNDARY_COMPLETED',completion.user_id,
  completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_principal_completion_snapshot(completion),admission.id);
end;
$$;

alter function app_private.finish_principal_runtime_boundary(uuid) owner to postgres;
revoke all on function app_private.begin_principal_runtime_boundary(uuid),
 app_private.principal_boundary_expected_capacities(uuid,jsonb),app_private.finish_principal_runtime_boundary(uuid)
 from public,anon,authenticated,service_role;
grant execute on function app_private.finish_principal_runtime_boundary(uuid) to service_role;

commit;
