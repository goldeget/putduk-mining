begin;

-- Exact130 admitted HOLD clock; existing RELEASE branch/native completion unchanged.
create or replace function app_private.read_principal_prefinance_old_inputs(p_admission uuid,p_state uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 intent app_private.funding_principal_recovery_intent_originals%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 transition app_private.funding_portion_transitions%rowtype; inputs jsonb; allocation_id uuid;
begin
 perform app_private.assert_principal_admission_before_finance(p_admission);
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=p_state;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 if intent.user_id is distinct from admission.user_id or state.user_id is distinct from admission.user_id
  or state.id is distinct from(select s.id from app_private.funding_engine_state s where s.user_id=admission.user_id)
  or state.cycle_closed or condition.user_id is distinct from admission.user_id then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREFINANCE_STATE_STALE'; end if;
 allocation_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 if admission.phase='HOLD' then
  if intent.previous_state_id is distinct from state.id or intent.journal_request_id is distinct from admission.journal_request_id
   or intent.amount_atomic is distinct from admission.amount_atomic or intent.prepared_at>admission.effective_at
   or intent.previous_condition_id is distinct from condition.id
   or intent.current_allocation_original_id is distinct from allocation_id
   or intent.source_inputs is distinct from condition.inputs
   or intent.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(intent)) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_TYPED_PREDECESSOR_MISMATCH'; end if;
  perform app_private.assert_funding_engine_seal(intent.id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED',intent.user_id,
   intent.input_digest,intent.audit_id,intent.source_event_id,app_private.funding_principal_recovery_intent_snapshot(intent));
  if condition.inputs->>'input_contract_version'='3' then
   inputs:=app_private.read_principal_input3_prefinance_current_inputs(admission.user_id,allocation_id,
    admission.effective_at,admission.withdrawal_id,admission.id);
   for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=admission.user_id order by t.revision loop
    perform app_private.verify_principal_history_portion_fact(transition,condition.cause_principal_boundary_id);
   end loop;
  else
   inputs:=app_private.read_principal_boundary_current_inputs(admission.user_id,allocation_id,admission.effective_at,admission.withdrawal_id,admission.id);
   for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=admission.user_id order by t.revision loop
    perform app_private.verify_principal_boundary_prefinance_portion_fact(transition,admission.withdrawal_id,admission.id);
   end loop;
  end if;
 else
  perform app_private.assert_principal_recovery_intent_completion(intent.id);
  if condition.inputs->>'input_contract_version' is distinct from '3'
   or condition.cause_principal_boundary_id is null then
   -- A historical authority-only HOLD must not gain retrospective earning.
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_HISTORY_BOUNDARY_UNRESOLVED'; end if;
  inputs:=app_private.read_principal_portion_funding_inputs(admission.user_id,allocation_id,admission.effective_at);
 end if;
 if inputs is distinct from condition.inputs
  or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_OLD_CONDITION_CHANGED'; end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
  condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 return inputs;
end;
$$;

revoke all on function app_private.read_principal_prefinance_old_inputs(uuid,uuid)
 from public,anon,authenticated,service_role;

commit;
