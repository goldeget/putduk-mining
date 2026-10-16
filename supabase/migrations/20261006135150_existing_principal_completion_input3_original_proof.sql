begin;

-- Existing INVOKER completion guard: source2 remains exact; source3 additionally
-- requires a full completed archived predecessor. No native finance gate removed.
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
  or coalesce(original.source_inputs->>'input_contract_version','') not in('2','3')
  or original.source_epoch_at is distinct from (select introduced_at from app_private.money_source_epochs where version=1)
  or original.principal_epoch_at is distinct from (select introduced_at from app_private.funding_principal_epochs where version=1)
  or original.engine_epoch_at is distinct from (select introduced_at from app_private.funding_engine_epochs where version=1)
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(original)) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 if original.source_inputs->>'input_contract_version'='3' then
  if condition.cause_principal_boundary_id is null
   or not exists(select 1 from app_private.funding_principal_boundary_completions c
    where c.boundary_id=condition.cause_principal_boundary_id and c.user_id=original.user_id
     and c.runtime_outcome='ACCEPTED' and c.condition_id=condition.id and c.input_original=original.source_inputs)
   or previous_transition.revision is distinct from app_private.principal_snapshot_last_transition(condition.cause_principal_boundary_id) then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_INPUT3_PREDECESSOR_REQUIRED';end if;
  -- Replay the exact completed old boundary, not today's latest condition or
  -- public coverage. Later finance must still prove its own full native source.
  perform app_private.assert_principal_input_snapshot(condition.cause_principal_boundary_id);
 end if;
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

revoke all on function app_private.assert_principal_recovery_intent_completion(uuid)
 from public,anon,authenticated,service_role;

commit;
