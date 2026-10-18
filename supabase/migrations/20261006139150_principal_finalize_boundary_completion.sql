begin;

--139 OUTSIDE source candidate: immutable native FINALIZE originals only.
create or replace function app_private.assert_principal_admission_before_finance(p_admission uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype; original_hold app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 perform app_private.assert_principal_input_executor(admission.user_id);
 select r.* into request from public.withdrawal_requests r where r.id=admission.withdrawal_id;
 if admission.id is null or request.user_id is distinct from admission.user_id
  or request.currency<>'KRW' or request.fee_atomic<>0 or request.welcome_reward_conversion_id is not null
  or admission.amount_atomic is distinct from request.amount_atomic
  or admission.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(request)
  or admission.effective_at>clock_timestamp()
  or admission.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_withdrawal_clock_snapshot(admission))
  or not exists(select 1 from public.audit_logs a where a.id=admission.audit_id and a.actor_user_id=admission.user_id
    and a.request_id=admission.journal_request_id and a.created_at=admission.effective_at)
  or not exists(select 1 from public.outbox_events e where e.id=admission.source_event_id
    and e.request_id=admission.journal_request_id and e.correlation_id=admission.journal_request_id
    and e.occurred_at=admission.effective_at and e.created_at=admission.effective_at)
  or exists(select 1 from public.ledger_transactions t where t.metadata->>'clock_admission_id'=admission.id::text)
  or(admission.phase='HOLD' and(request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null
    or admission.hold_admission_id is not null))
  or(admission.phase='RELEASE' and(request.status not in('HELD','ADMIN_PROCESSING','REVIEWING','APPROVED','PROCESSING')
    or request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null))
  or(admission.phase='FINALIZE' and(request.status<>'EXTERNAL_SENT_RECORDED' or request.hold_ledger_transaction_id is null
    or request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null
    or not exists(select 1 from public.withdrawal_external_sends e where e.withdrawal_id=request.id and e.method=request.destination_type))) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREFINANCE_ADMISSION_REQUIRED'; end if;
 perform app_private.assert_funding_engine_seal(admission.id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED',admission.user_id,
  admission.input_digest,admission.audit_id,admission.source_event_id,app_private.funding_withdrawal_clock_snapshot(admission));
 if admission.phase in('RELEASE','FINALIZE') then
  select a.* into original_hold from app_private.funding_withdrawal_clock_admissions a where a.id=admission.hold_admission_id;
  if original_hold.phase is distinct from 'HOLD' or original_hold.user_id is distinct from admission.user_id
   or original_hold.withdrawal_id is distinct from admission.withdrawal_id or original_hold.effective_at>admission.effective_at then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RELEASE_PREDECESSOR_REQUIRED'; end if;
  perform app_private.assert_funding_withdrawal_clock_completion(original_hold.id);
 end if;
end;
$$;


create or replace function app_private.begin_principal_runtime_boundary(p_admission uuid) returns uuid
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
  if admission.phase not in('RELEASE','FINALIZE') or sqlerrm not in('FUNDING_PRINCIPAL_HISTORY_BOUNDARY_UNRESOLVED','FUNDING_CREDIT_CYCLE_BOUNDARY_UNSUPPORTED','FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED','FUNDING_PRINCIPAL_OLD_CONDITION_CHANGED','FUNDING_POLICY_ORIGINAL_REQUIRED','FUNDING_DEFAULT_POLICY_REQUIRED') then raise;end if;
  if admission.phase='FINALIZE' then
   -- No old interval is earned or new input accepted beyond a supported cycle.
   -- Genuine already-sent native payout is still completed. Do not consume the
   -- immutable one-successor preparation key of the unchanged previous state.
   -- Native admission/source/deferred guards remain mandatory independently.
   reason_code:=sqlerrm;
   insert into public.audit_logs(actor_user_id,action,target_type,target_id,reason,request_id,after_state,created_at)
   values(admission.user_id,'FUNDING_PRINCIPAL_BOUNDARY_UNAVAILABLE','FUNDING_ENGINE_V1',admission.id::text,
    'native FINALIZE has unsupported derivative old interval',admission.journal_request_id,
    jsonb_build_object('reason_code',reason_code,'clock_admission_id',admission.id,'accepted',false),admission.effective_at);
   return null;
  end if;
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


create or replace function app_private.finish_principal_runtime_boundary(p_admission uuid) returns void
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
  where m.user_id=preparation.user_id and m.ledger_transaction_id=(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end)
   and m.origin_code=(case when admission.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' when admission.phase='RELEASE' then 'PRINCIPAL_RECOVERY_RELEASE' else 'PRINCIPAL_RECOVERY_FINALIZE' end);
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


create or replace function app_private.assert_principal_boundary_complete(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 completion app_private.funding_principal_boundary_completions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 predecessor app_private.funding_engine_state_receipts%rowtype;successor app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;earned app_private.funding_earned_receipts%rowtype;
 movement public.money_source_movements%rowtype;caps numeric[];expected_caps numeric[];
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_boundary;
 select c.* into completion from app_private.funding_principal_boundary_completions c where c.boundary_id=p_boundary;
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=preparation.clock_admission_id;
 select s.* into predecessor from app_private.funding_engine_state_receipts s where s.id=preparation.previous_state_id;
 select s.* into successor from app_private.funding_engine_state_receipts s where s.id=completion.accepted_state_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=completion.condition_id;
 select e.* into earned from app_private.funding_earned_receipts e where e.cause_principal_boundary_id=preparation.id;
 select m.* into movement from public.money_source_movements m where m.id=completion.source_movement_id;
 perform app_private.assert_principal_history_executor(preparation.user_id);
 if preparation.id is null or completion.id is null or completion.user_id is distinct from preparation.user_id
  or admission.user_id is distinct from preparation.user_id or admission.phase is distinct from preparation.phase
  or admission.effective_at is distinct from preparation.effective_at or completion.effective_at is distinct from admission.effective_at
  or completion.recorded_at is distinct from admission.effective_at or preparation.recorded_at is distinct from admission.effective_at
  or predecessor.user_id is distinct from preparation.user_id or predecessor.cycle_id is distinct from preparation.cycle_id
  or successor.user_id is distinct from preparation.user_id or successor.activation_id is distinct from predecessor.activation_id
  or movement.user_id is distinct from preparation.user_id or movement.effective_at is distinct from admission.effective_at
  or movement.amount_atomic is distinct from admission.amount_atomic
  or movement.ledger_transaction_id is distinct from(select(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end) from public.withdrawal_requests r where r.id=admission.withdrawal_id)
  or preparation.old_input_original is distinct from(select c.inputs from app_private.funding_condition_originals c where c.id=predecessor.condition_id)
  or preparation.intent_id is distinct from(select i.id from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id)
  or movement.origin_code is distinct from(case when preparation.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' when preparation.phase='RELEASE' then 'PRINCIPAL_RECOVERY_RELEASE' else 'PRINCIPAL_RECOVERY_FINALIZE' end)
  or preparation.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_preparation_snapshot(preparation))
  or completion.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_completion_snapshot(completion)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_BOUNDARY_COMPLETION_MISSING';end if;
 perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 perform app_private.assert_principal_recovery_movement(movement);
 perform app_private.assert_funding_engine_seal(preparation.id,'FUNDING_PRINCIPAL_BOUNDARY_PREPARED',preparation.user_id,
  preparation.input_digest,preparation.audit_id,preparation.source_event_id,app_private.funding_principal_preparation_snapshot(preparation));
 perform app_private.assert_funding_engine_seal(completion.id,'FUNDING_PRINCIPAL_BOUNDARY_COMPLETED',completion.user_id,
  completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_principal_completion_snapshot(completion));
 if preparation.settlement_expected then
  perform app_private.verify_principal_boundary_earned(earned);
  if earned.next_state_id is distinct from successor.id or successor.previous_state_id is distinct from predecessor.id
   or successor.revision is distinct from predecessor.revision+1 or successor.earned_receipt_id is distinct from earned.id
   or successor.cycle_id is distinct from predecessor.cycle_id or successor.cursor_at is distinct from admission.effective_at
   or successor.cycle_closed or successor.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
   or successor.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
   or successor.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
   or successor.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
   or successor.carry_num::text is distinct from earned.calculation->>'carryNum'
   or successor.carry_den::text is distinct from earned.calculation->>'carryDen' then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_STATE_COMPLETION_MISMATCH';end if;
  caps:=app_private.funding_state_effective_capacities(successor.id);
  if completion.runtime_outcome='ACCEPTED' then
   perform app_private.assert_principal_input_snapshot(preparation.id);
   expected_caps:=app_private.principal_boundary_expected_capacities(preparation.id,completion.input_original);
   if condition.user_id is distinct from preparation.user_id or condition.cause_principal_boundary_id is distinct from preparation.id
    or condition.previous_condition_id is distinct from predecessor.condition_id or condition.revision is distinct from
     (select c.revision+1 from app_private.funding_condition_originals c where c.id=predecessor.condition_id)
    or condition.current_allocation_original_id is distinct from preparation.current_allocation_original_id
    or condition.effective_at is distinct from admission.effective_at or condition.recorded_at is distinct from admission.effective_at
    or condition.inputs is distinct from completion.input_original or successor.condition_id is distinct from condition.id
    or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition))
    or caps is distinct from expected_caps then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CONDITION_CAPACITY_MISMATCH';end if;
   perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
    condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
  else
   if condition.id is not null or successor.condition_id is distinct from predecessor.condition_id
    or caps is distinct from app_private.funding_state_effective_capacities(predecessor.id) then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_FALSE_UNKNOWN_ACCEPTANCE';end if;
  end if;
 else
  if earned.id is not null or completion.runtime_outcome<>'UNRESOLVED' or completion.reason_code is distinct from preparation.unresolved_reason_code
   or successor.id is distinct from predecessor.id or condition.id is not null then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_HISTORY_FALSE_ADVANCEMENT';end if;
 end if;
end;
$$;


commit;
