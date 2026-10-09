begin;

create function app_private.verify_principal_boundary_earned(p_earned app_private.funding_earned_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 predecessor app_private.funding_engine_state_receipts%rowtype;movement public.money_source_movements%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;posting_key text;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_earned.cause_principal_boundary_id;
 select s.* into predecessor from app_private.funding_engine_state_receipts s where s.id=preparation.previous_state_id;
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=preparation.clock_admission_id;
 perform app_private.assert_principal_history_executor(preparation.user_id);
 if preparation.id is null or not preparation.settlement_expected
  or p_earned.user_id is distinct from preparation.user_id or p_earned.runtime_version<>2
  or p_earned.previous_state_id is distinct from predecessor.id or p_earned.activation_id is distinct from predecessor.activation_id
  or p_earned.cycle_id is distinct from predecessor.cycle_id or p_earned.condition_id is distinct from predecessor.condition_id
  or p_earned.job_id is not null or p_earned.cause_allocation_id is not null or p_earned.cause_credit_boundary_id is not null
  or p_earned.recorded_at is distinct from preparation.effective_at
  or p_earned.settled_from is distinct from predecessor.cursor_at or p_earned.settled_to is distinct from admission.effective_at
  or p_earned.calculation is distinct from preparation.old_interval_calculation
  or p_earned.calculation is distinct from app_private.calculate_credit_boundary_interval(predecessor.id,admission.effective_at)
  or p_earned.amount_atomic::text is distinct from p_earned.calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_EARNED_ORIGINAL_MISMATCH';end if;
 posting_key:='funding:principal:'||admission.withdrawal_id::text||':'||admission.phase;
 if p_earned.amount_atomic>0 then
  select m.* into movement from public.money_source_movements m join public.mining_reward_credits c
   on c.ledger_transaction_id=m.ledger_transaction_id where c.id=p_earned.credit_id and c.funding_earned_receipt_id=p_earned.id;
  if movement.user_id is distinct from p_earned.user_id or movement.amount_atomic is distinct from p_earned.amount_atomic
   or movement.source_bucket is distinct from 'MINING_REWARD' or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at is distinct from p_earned.settled_to
   or not exists(select 1 from public.mining_settlements s where s.id=p_earned.settlement_id
    and s.funding_earned_receipt_id=p_earned.id and s.idempotency_key=posting_key||':settlement')
   or(select count(*) from public.mining_settlement_segments s where s.funding_earned_receipt_id=p_earned.id)<>1 then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_EARNED_POST_INCOMPLETE';end if;
  perform app_private.assert_money_source_credit(movement);
 end if;
 perform app_private.assert_funding_engine_seal(p_earned.id,'FUNDING_EARNED_ACCEPTED',p_earned.user_id,p_earned.input_digest,
  p_earned.audit_id,p_earned.source_event_id,app_private.funding_earned_snapshot(p_earned));
end;
$$;

create function app_private.assert_principal_boundary_complete(p_boundary uuid) returns void
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
  or movement.ledger_transaction_id is distinct from(select(case when admission.phase='HOLD' then r.hold_ledger_transaction_id else r.release_ledger_transaction_id end) from public.withdrawal_requests r where r.id=admission.withdrawal_id)
  or preparation.old_input_original is distinct from(select c.inputs from app_private.funding_condition_originals c where c.id=predecessor.condition_id)
  or preparation.intent_id is distinct from(select i.id from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id)
  or movement.origin_code is distinct from(case when preparation.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' else 'PRINCIPAL_RECOVERY_RELEASE' end)
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

create function app_private.verify_principal_boundary_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if tg_table_schema is distinct from 'app_private' or tg_table_name not in('funding_principal_boundary_preparations','funding_principal_boundary_completions')
  or tg_op is distinct from 'INSERT' or tg_when is distinct from 'AFTER' or tg_level is distinct from 'ROW' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_COMMIT_CONTEXT_INVALID';end if;
 -- Closed fresh producers require the actual service context at commit as well.
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role'
  or(auth.uid() is not null and auth.uid() is distinct from new.user_id) then
  raise exception using errcode='42501',message='FUNDING_PRINCIPAL_COMMIT_SUBJECT_FORBIDDEN';end if;
 if tg_table_name='funding_principal_boundary_preparations' then perform app_private.assert_principal_boundary_complete(new.id);
 else perform app_private.assert_principal_boundary_complete(new.boundary_id);end if;
 return null;
end;
$$;
create constraint trigger principal_boundary_preparation_complete after insert on app_private.funding_principal_boundary_preparations
 deferrable initially deferred for each row execute function app_private.verify_principal_boundary_commit();
create constraint trigger principal_boundary_completion_complete after insert on app_private.funding_principal_boundary_completions
 deferrable initially deferred for each row execute function app_private.verify_principal_boundary_commit();

create function app_private.guard_principal_boundary_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if tg_table_schema<>'public' or tg_table_name not in('audit_logs','outbox_events') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_LINK_CONTEXT_INVALID';end if;
 if tg_table_name='audit_logs' then
  if(exists(select 1 from app_private.funding_principal_boundary_preparations b where b.audit_id=old.id)
   or exists(select 1 from app_private.funding_principal_boundary_completions c where c.audit_id=old.id))
   and(tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_IMMUTABLE';end if;
 else
  if(exists(select 1 from app_private.funding_principal_boundary_preparations b where b.source_event_id=old.id)
   or exists(select 1 from app_private.funding_principal_boundary_completions c where c.source_event_id=old.id))
   and(tg_op='DELETE' or row(new.event_type,new.schema_version,new.aggregate_type,new.aggregate_id,new.actor_user_id,
     new.payload,new.request_id,new.correlation_id,new.idempotency_key,new.occurred_at,new.created_at)
    is distinct from row(old.event_type,old.schema_version,old.aggregate_type,old.aggregate_id,old.actor_user_id,
     old.payload,old.request_id,old.correlation_id,old.idempotency_key,old.occurred_at,old.created_at)) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_IMMUTABLE';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;
$$;
create trigger principal_boundary_audit_immutable before update or delete on public.audit_logs
 for each row execute function app_private.guard_principal_boundary_links();
create trigger principal_boundary_event_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_principal_boundary_links();

alter function app_private.verify_principal_boundary_commit() owner to postgres;
revoke all on function app_private.verify_principal_boundary_earned(app_private.funding_earned_receipts),
 app_private.assert_principal_boundary_complete(uuid),app_private.verify_principal_boundary_commit(),
 app_private.guard_principal_boundary_links() from public,anon,authenticated,service_role;

commit;
