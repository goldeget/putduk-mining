begin;

-- Bounded actual prospective V2 condition consumer. Preparation remains manual
-- and dormant at infinity; no credit hook, scheduler, global catalog/default
-- assignment, history repair or held-end qualification is introduced.
create function app_private.read_neutral_funding_job_inputs(p_activation uuid,p_state uuid,p_at timestamptz)
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
  or cycle.id is distinct from activation.first_cycle_id or p_at<state.cursor_at or p_at>cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',activation.user_id,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
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

create function app_private.validate_neutral_funding_job_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 original app_private.funding_engine_jobs%rowtype; cycle app_private.funding_cycle_windows%rowtype; inputs jsonb; calculation jsonb;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_earned.user_id::text,0));
 select * into activation from app_private.funding_engine_activations where id=p_earned.activation_id;
 select * into original from app_private.funding_engine_jobs where job_id=p_earned.job_id;
 select * into state from app_private.funding_engine_state_receipts where id=p_earned.previous_state_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_earned.cycle_id;
 perform app_private.assert_funding_job_fence(p_earned.job_id,p_earned.worker_id,p_earned.attempt_number);
 inputs:=app_private.read_neutral_funding_job_inputs(activation.id,state.id,p_earned.settled_to);
 if p_earned.runtime_version<>2 or p_earned.cause_allocation_id is not null
  or activation.user_id is distinct from p_earned.user_id or original.user_id is distinct from p_earned.user_id
  or original.activation_id is distinct from activation.id or original.expected_state_id is distinct from state.id
  or p_earned.condition_id is distinct from state.condition_id or p_earned.cycle_id is distinct from cycle.id
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to>clock_timestamp()
  or p_earned.fence_expires_at is distinct from(select lease_expires_at from public.system_jobs where id=p_earned.job_id) then
  raise exception using errcode='55000',message='FUNDING_EARNED_INPUT_MISMATCH'; end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from p_earned.settled_to-p_earned.settled_from)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,
  p_earned.settled_to=cycle.cycle_end);
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create function app_private.verify_neutral_funding_job_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare successor app_private.funding_engine_state_receipts%rowtype; movement public.money_source_movements%rowtype;
begin
 select * into successor from app_private.funding_engine_state_receipts where id=p_earned.next_state_id;
 if successor.earned_receipt_id is distinct from p_earned.id or successor.user_id is distinct from p_earned.user_id
  or successor.condition_id is distinct from p_earned.condition_id then
  raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
 if not exists(select 1 from public.system_jobs j join public.system_job_attempts a on a.job_id=j.id and a.attempt_number=j.attempts
  where j.id=p_earned.job_id and j.status='SUCCEEDED' and j.attempts=p_earned.attempt_number
   and a.status='SUCCEEDED' and a.worker_id=p_earned.worker_id and j.completed_at=a.completed_at
   and j.completed_at>=p_earned.recorded_at and j.completed_at<p_earned.fence_expires_at and j.completed_at<=clock_timestamp()) then
  raise exception using errcode='55000',message='FUNDING_ACCEPTED_JOB_COMPLETION_MISSING'; end if;
 if p_earned.amount_atomic>0 then
  select m.* into movement from public.money_source_movements m join public.mining_reward_credits c
   on c.ledger_transaction_id=m.ledger_transaction_id where c.id=p_earned.credit_id and c.funding_earned_receipt_id=p_earned.id;
  if movement.user_id is distinct from p_earned.user_id or movement.amount_atomic is distinct from p_earned.amount_atomic
   or movement.source_bucket is distinct from 'MINING_REWARD' or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at is distinct from p_earned.settled_to
   or not exists(select 1 from public.mining_settlements where id=p_earned.settlement_id and funding_earned_receipt_id=p_earned.id)
   or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=p_earned.id) then
   raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
  perform app_private.assert_money_source_credit(movement);
 end if;
 if (p_earned.calculation->>'qualifiedRetentionNum')::numeric>0
  and not exists(select 1 from app_private.funding_retention_qualifications where earned_receipt_id=p_earned.id) then
  raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 perform app_private.assert_funding_engine_seal(p_earned.id,'FUNDING_EARNED_ACCEPTED',p_earned.user_id,p_earned.input_digest,
  p_earned.audit_id,p_earned.source_event_id,app_private.funding_earned_snapshot(p_earned));
end;
$$;

create or replace function app_private.validate_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; successor app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; calculation jsonb;
begin
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

create or replace function app_private.validate_prospective_state(p_state app_private.funding_engine_state_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;
begin
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

create or replace function app_private.guard_funding_runtime_job_scope() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare state app_private.funding_engine_state_receipts%rowtype; cycle app_private.funding_cycle_windows%rowtype;
begin
 if(select runtime_version from app_private.funding_engine_activations where id=new.activation_id)=2 then
  select * into state from app_private.funding_engine_state_receipts where id=new.expected_state_id;
  select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
  perform app_private.read_neutral_funding_job_inputs(new.activation_id,state.id,least(clock_timestamp(),cycle.cycle_end));
 end if;
 return new;
end;
$$;

create function app_private.process_neutral_funding_condition_job(p_job uuid,p_worker text,p_attempt integer)
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
 v_calc:=app_private.funding_exact_condition_interval(v_a.principal_atomic,
   (v_input->>'base_bps')::integer,(v_input->>'retention_bps')::integer,(v_input->>'allocation_bps')::integer,
   (extract(epoch from v_cycle.cycle_end-v_cycle.cycle_started_at)*1000000)::bigint,
   (extract(epoch from v_target-v_state.cursor_at)*1000000)::bigint,
   v_state.base_used_num,v_state.base_used_den,v_state.retention_used_num,v_state.retention_used_den,
   v_state.carry_num,v_state.carry_den,v_target=v_cycle.cycle_end);
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
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
   earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,cycle_closed,condition_id)
 values(v_e.next_state_id,v_e.user_id,v_a.id,v_cycle.id,v_state.revision+1,v_state.id,v_e.id,v_target,
   (v_calc->>'baseUsedNum')::numeric,(v_calc->>'baseUsedDen')::numeric,
   (v_calc->>'retentionUsedNum')::numeric,(v_calc->>'retentionUsedDen')::numeric,
   (v_calc->>'carryNum')::numeric,(v_calc->>'carryDen')::numeric,v_target=v_cycle.cycle_end,v_state.condition_id);
 if (v_calc->>'qualifiedRetentionNum')::numeric>0 then
   insert into app_private.funding_retention_qualifications(user_id,cycle_id,earned_receipt_id,qualified_num,qualified_den,
     principal_input_digest,qualified_at)
   values(v_e.user_id,v_cycle.id,v_e.id,(v_calc->>'qualifiedRetentionNum')::numeric,
     (v_calc->>'qualifiedRetentionDen')::numeric,v_a.input_digest,v_cycle.cycle_end);
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
 return v_e.id;
end;
$$;

create or replace function app_private.process_default_funding_job(p_job uuid,p_worker text,p_attempt integer)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_j app_private.funding_engine_jobs%rowtype; v_job public.system_jobs%rowtype;
 v_a app_private.funding_engine_activations%rowtype; v_state app_private.funding_engine_state_receipts%rowtype;
 v_cycle app_private.funding_cycle_windows%rowtype; v_e app_private.funding_earned_receipts%rowtype;
 v_input jsonb; v_calc jsonb; v_wallet uuid; v_until timestamptz; v_now timestamptz; v_target timestamptz;
 v_key text; v_journal uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_credit_event uuid:=gen_random_uuid();
 v_request uuid:=gen_random_uuid(); v_correlation uuid:=gen_random_uuid(); v_count integer;
begin
 if(select runtime_version from app_private.funding_engine_activations where id=(
  select activation_id from app_private.funding_engine_jobs where job_id=p_job))=2 then
  return app_private.process_neutral_funding_condition_job(p_job,p_worker,p_attempt);
 end if;
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
 v_input:=app_private.read_default_funding_inputs(v_a.trigger_credit_movement_id,v_a.allocation_original_id);
 if v_a.input_digest is distinct from app_private.funding_engine_digest(v_input) then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 select * into v_cycle from app_private.funding_cycle_windows where id=v_state.cycle_id;
 select effective_until into v_until from app_private.economy_policy_published where publication_id=v_a.policy_publication_id;
 v_now:=clock_timestamp(); v_target:=least(v_now,v_cycle.cycle_end,coalesce(v_until,'infinity'::timestamptz));
 if v_target<=v_state.cursor_at then raise exception using errcode='55000',message='FUNDING_BOUNDARY_ADAPTER_REQUIRED'; end if;
 v_calc:=app_private.funding_exact_default_interval(v_a.principal_atomic,
   (v_input->>'base_bps')::integer,(v_input->>'retention_bps')::integer,(v_input->>'allocation_bps')::integer,
   (extract(epoch from v_cycle.cycle_end-v_cycle.cycle_started_at)*1000000)::bigint,
   (extract(epoch from v_target-v_state.cursor_at)*1000000)::bigint,
   v_state.base_used_num,v_state.base_used_den,v_state.retention_used_num,v_state.retention_used_den,
   v_state.carry_num,v_state.carry_den,v_target=v_cycle.cycle_end);
 v_e.id:=gen_random_uuid(); v_e.user_id:=v_j.user_id; v_e.activation_id:=v_a.id; v_e.cycle_id:=v_cycle.id;
 v_e.job_id:=p_job; v_e.attempt_number:=p_attempt; v_e.worker_id:=p_worker;
 v_e.fence_expires_at:=v_job.lease_expires_at;
 v_e.previous_state_id:=v_state.id; v_e.next_state_id:=gen_random_uuid();
 v_e.settled_from:=v_state.cursor_at; v_e.settled_to:=v_target; v_e.calculation:=v_calc;
 v_e.amount_atomic:=(v_calc->>'amountAtomic')::bigint;
 if v_e.amount_atomic>0 then v_e.credit_id:=gen_random_uuid(); v_e.settlement_id:=gen_random_uuid(); end if;
 v_e.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(v_e));
 v_e.audit_id:=gen_random_uuid(); v_e.source_event_id:=gen_random_uuid(); v_e.recorded_at:=clock_timestamp();
 v_e.runtime_version:=1; -- Existing composite-row producer must explicitly retain its V1 branch.
 insert into app_private.funding_earned_receipts select v_e.*;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
   earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,cycle_closed)
 values(v_e.next_state_id,v_e.user_id,v_a.id,v_cycle.id,v_state.revision+1,v_state.id,v_e.id,v_target,
   (v_calc->>'baseUsedNum')::numeric,(v_calc->>'baseUsedDen')::numeric,
   (v_calc->>'retentionUsedNum')::numeric,(v_calc->>'retentionUsedDen')::numeric,
   (v_calc->>'carryNum')::numeric,(v_calc->>'carryDen')::numeric,v_target=v_cycle.cycle_end);
 if (v_calc->>'qualifiedRetentionNum')::numeric>0 then
   insert into app_private.funding_retention_qualifications(user_id,cycle_id,earned_receipt_id,qualified_num,qualified_den,
     principal_input_digest,qualified_at)
   values(v_e.user_id,v_cycle.id,v_e.id,(v_calc->>'qualifiedRetentionNum')::numeric,
     (v_calc->>'qualifiedRetentionDen')::numeric,v_a.input_digest,v_cycle.cycle_end);
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
 return v_e.id;
end;
$$;

revoke all on function app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamptz),
 app_private.validate_neutral_funding_job_earned(app_private.funding_earned_receipts),
 app_private.verify_neutral_funding_job_earned(app_private.funding_earned_receipts),
 app_private.process_neutral_funding_condition_job(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamptz),
 app_private.validate_neutral_funding_job_earned(app_private.funding_earned_receipts),
 app_private.verify_neutral_funding_job_earned(app_private.funding_earned_receipts),
 app_private.process_neutral_funding_condition_job(uuid,text,integer) to service_role;
comment on function app_private.process_neutral_funding_condition_job(uuid,text,integer) is
 'Dormant bounded first-cycle V2 neutral condition consumer: no caller amount/clock; actual never-held principal/allocation originals, canonical current-attempt fence, exact carry and atomic fee-zero posting. Scheduling remains disconnected.';
alter function app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamptz) owner to postgres;

commit;
