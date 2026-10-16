begin;

-- Exact real-original calculation dependency only. No earning is inserted and
-- no state/capacity/clock is advanced. The first ACTIVE callback still needs
-- atomic pre-finance earning and post-finance completion in a later batch.
create function app_private.calculate_first_principal_hold_capacity(p_intent uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_principal_recovery_intent_originals%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; old_interval jsonb; caps numeric[]; next_base numeric[]; next_retention numeric[];
 old_base numeric[]; new_base numeric[]; old_retention numeric[]; new_retention numeric[];
 span bigint; remaining bigint;
begin
 select i.* into original from app_private.funding_principal_recovery_intent_originals i where i.id=p_intent;
 perform app_private.assert_principal_input_executor(original.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 perform app_private.assert_principal_recovery_intent_completion(original.id);
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=original.withdrawal_id and a.phase='HOLD';
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=original.previous_state_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 select w.* into cycle from app_private.funding_cycle_windows w where w.id=state.cycle_id;
 if request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null
  or state.id is distinct from(select s.id from app_private.funding_engine_state s where s.user_id=original.user_id)
  or condition.inputs->>'input_contract_version' is distinct from '2'
  or state.cycle_closed or cycle.user_id is distinct from original.user_id
  or admission.effective_at<state.cursor_at or admission.effective_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_FIRST_PRINCIPAL_HOLD_CAPACITY_UNSUPPORTED'; end if;
 -- Uses the actual130 clock and independently validated completed source,
 -- never a caller time, amount, principal or rule override.
 inputs:=app_private.read_principal_portion_funding_inputs(original.user_id,original.current_allocation_original_id,admission.effective_at);
 if inputs->>'tier_activated' is distinct from 'true'
  or inputs->>'policy_publication_id' is distinct from condition.inputs->>'policy_publication_id'
  or inputs->>'policy_config_digest' is distinct from condition.inputs->>'policy_config_digest'
  or inputs->>'cycle_days' is distinct from condition.inputs->>'cycle_days'
  or inputs->>'base_bps' is distinct from condition.inputs->>'base_bps'
  or(inputs->>'principal_atomic')::numeric+original.amount_atomic is distinct from
   (condition.inputs->>'principal_atomic')::numeric then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_HOLD_CONDITION_UNRESOLVED'; end if;
 caps:=app_private.funding_state_effective_capacities(state.id);
 old_interval:=app_private.calculate_credit_boundary_interval(state.id,admission.effective_at);
 old_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
 new_base:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
 old_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
 new_retention:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000);
 span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
 remaining:=(extract(epoch from cycle.cycle_end-admission.effective_at)*1000000)::bigint;
 -- Approval10-03: unchanged anchor/window, entitlement difference only over
 -- the remaining window. Approval10-06: maintenance ignores BASE allocation
 -- and all speed/capacity modifiers. All ratios multiply before final floor.
 next_base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],new_base[1],new_base[2],remaining,span);
 next_retention:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_retention[1],old_retention[2],new_retention[1],new_retention[2],remaining,span);
 if(old_interval->>'baseUsedNum')::numeric*next_base[2]>next_base[1]*(old_interval->>'baseUsedDen')::numeric
  or(old_interval->>'retentionUsedNum')::numeric*next_retention[2]>next_retention[1]*(old_interval->>'retentionUsedDen')::numeric then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CAPACITY_HISTORY_UNSUPPORTED'; end if;
 return jsonb_build_object('calculation_contract_version',1,'intent_id',original.id,'clock_admission_id',admission.id,
  'user_id',original.user_id,'previous_state_id',state.id,'current_allocation_original_id',original.current_allocation_original_id,
  'cycle_id',cycle.id,'anchor_microseconds',((extract(epoch from cycle.cycle_started_at)*1000000)::bigint)::text,
  'cycle_end_microseconds',((extract(epoch from cycle.cycle_end)*1000000)::bigint)::text,
  'effective_at_microseconds',((extract(epoch from admission.effective_at)*1000000)::bigint)::text,
  'cycle_microseconds',span::text,'remaining_microseconds',remaining::text,'next_input_original',inputs,
  'old_interval_calculation',old_interval,'base_capacity_num',next_base[1]::text,'base_capacity_den',next_base[2]::text,
  'retention_capacity_num',next_retention[1]::text,'retention_capacity_den',next_retention[2]::text,
  'wallet_posted',false,'condition_accepted',false,'qualified_retention_atomic','0');
end;
$$;

alter function app_private.calculate_first_principal_hold_capacity(uuid) owner to postgres;
revoke all on function app_private.calculate_first_principal_hold_capacity(uuid)
 from public,anon,authenticated,service_role;

commit;
