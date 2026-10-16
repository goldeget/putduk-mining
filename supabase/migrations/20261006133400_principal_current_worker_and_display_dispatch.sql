begin;

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
  or cycle.id is distinct from activation.first_cycle_id or p_at<state.cursor_at or p_at>cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',activation.user_id,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 if condition.inputs->>'input_contract_version'='3' then
  -- No held-at-cycle-end qualification rule or rollover is inferred.
  if p_at>=cycle.cycle_end then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CYCLE_END_QUALIFICATION_UNAPPROVED';end if;
  if condition.cause_principal_boundary_id is null or exists(select 1 from app_private.funding_principal_boundary_completions c
   join app_private.funding_principal_boundary_preparations b on b.id=c.boundary_id
   where c.user_id=activation.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_UNRESOLVED';end if;
  perform app_private.assert_principal_boundary_complete(condition.cause_principal_boundary_id);
  inputs:=app_private.read_principal_portion_funding_inputs(activation.user_id,condition.current_allocation_original_id,p_at);
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


create or replace function app_private.read_forward_neutral_job_inputs(p_activation uuid,p_state uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype; inputs jsonb; item jsonb;
begin
 select * into activation from app_private.funding_engine_activations where id=p_activation;
 select * into state from app_private.funding_engine_state where user_id=activation.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if condition.inputs->>'input_contract_version'='3' then
  return app_private.read_neutral_funding_job_inputs(p_activation,p_state,p_at);end if;
 if activation.runtime_version<>2 or state.id is distinct from p_state or state.activation_id is distinct from activation.id
  or p_at is null or not isfinite(p_at) or p_at<state.cursor_at or p_at>=cycle.cycle_end or state.cycle_closed then
  raise exception using errcode='55000',message='FUNDING_FORWARD_CYCLE_QUALIFICATION_ADAPTER_REQUIRED'; end if;
 if exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
 on b.id=c.boundary_id where c.user_id=activation.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 if exists(select 1 from app_private.funding_principal_boundary_completions c join app_private.funding_principal_boundary_preparations b
  on b.id=c.boundary_id where c.user_id=activation.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_UNRESOLVED';end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
 activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 inputs:=app_private.assert_credit_condition_inputs(condition.id,p_at);
 if(select count(*) from app_private.funding_portion_clock_state where user_id=activation.user_id)
  <>jsonb_array_length(inputs->'credit_originals') then
  raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 for item in select value from jsonb_array_elements(inputs->'credit_originals') loop
  if not exists(select 1 from app_private.funding_portion_clock_state c
   join app_private.funding_principal_portions p on p.id=c.portion_id join public.funding_principal_lots l on l.id=p.lot_id
   where c.user_id=activation.user_id and p.lot_id=(item->>'lot_id')::uuid and p.parent_portion_id is null
    and c.status='AVAILABLE' and p.amount_micro_krw=l.amount_micro_krw and c.accumulated_eligible_microseconds=0
    and c.resumed_at=l.effective_at) then
   raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 end loop;
 return inputs;
end;
$$;


create or replace function app_private.validate_neutral_funding_job_earned(p_earned app_private.funding_earned_receipts)
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
 if inputs->>'input_contract_version' in('2','3') then
  calculation:=app_private.calculate_credit_boundary_interval(state.id,p_earned.settled_to);
 else
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from p_earned.settled_to-p_earned.settled_from)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,
  p_earned.settled_to=cycle.cycle_end);
 end if;
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;


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
 if v_input->>'input_contract_version' in('2','3') then
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


create or replace function app_private.read_funding_runtime_server_display(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; policy app_private.economy_policy_published%rowtype;
 instant timestamptz; inputs jsonb; calculation jsonb; tier jsonb; pending numeric[]; maintenance numeric[];
 used numeric[]; capacity numeric[]; remaining numeric[]; committed numeric;
 speed numeric[]; runtime_status text; stop_reason text; base_capacity numeric[];
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role'
  or p_user is null or(auth.uid() is not null and auth.uid() is distinct from p_user) then
  raise exception using errcode='42501',message='MINING_DISPLAY_SUBJECT_FORBIDDEN'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 select * into activation from app_private.funding_engine_activations where user_id=p_user;
 select * into state from app_private.funding_engine_state where user_id=p_user;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 instant:=clock_timestamp();
 if activation.runtime_version is distinct from 2 or state.activation_id is distinct from activation.id
  or state.user_id is distinct from p_user or condition.user_id is distinct from p_user
  or condition.activation_id is distinct from activation.id or cycle.id is distinct from activation.first_cycle_id
  or state.cycle_closed or instant>=cycle.cycle_end or instant<state.cursor_at then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_DISPLAY_BOUNDARY_UNSUPPORTED'; end if;
 if exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
  on b.id=c.boundary_id where c.user_id=p_user and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 if exists(select 1 from app_private.funding_principal_boundary_completions c join app_private.funding_principal_boundary_preparations b
  on b.id=c.boundary_id where c.user_id=p_user and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_UNRESOLVED';end if;
 if condition.inputs->>'input_contract_version' in('2','3') then
  return app_private.read_forward_funding_runtime_display(p_user,instant); end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',p_user,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',p_user,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,instant);
 if inputs is distinct from condition.inputs
  or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition))
  or not exists(select 1 from app_private.funding_portion_clock_state c
    join app_private.funding_principal_portions p on p.id=c.portion_id
    join public.funding_principal_lots l on l.id=p.lot_id
    where c.user_id=p_user and c.status='AVAILABLE' and p.parent_portion_id is null
     and p.amount_micro_krw=l.amount_micro_krw and l.money_source_movement_id=activation.trigger_credit_movement_id)
  or(select count(*) from app_private.funding_portion_clock_state where user_id=p_user)<>1 then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_DISPLAY_ORIGINAL_MISMATCH'; end if;
 if condition.allocation_original_id is not null then
  perform app_private.assert_allocation_boundary_complete(condition.allocation_original_id,condition.id);
 end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from instant-state.cursor_at)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 pending:=app_private.funding_exact_sum(array[state.carry_num,state.carry_den],
  array[(calculation->>'baseNum')::numeric,(calculation->>'baseDen')::numeric]);
 maintenance:=array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric];
 used:=app_private.funding_exact_sum(array[(calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric],maintenance);
 capacity:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*
  ((inputs->>'base_bps')::numeric+(inputs->>'retention_bps')::numeric),10000);
 remaining:=app_private.funding_exact_ratio(greatest(0,capacity[1]*used[2]-used[1]*capacity[2]),capacity[2]*used[2]);
 select * into policy from app_private.economy_policy_published where publication_id=activation.policy_publication_id;
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::bigint<=(inputs->>'principal_atomic')::bigint
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::bigint>=(inputs->>'principal_atomic')::bigint);
 speed:=app_private.funding_exact_ratio((inputs->>'allocation_bps')::numeric,10000);
 base_capacity:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
 if (inputs->>'allocation_bps')::integer=0 then
  runtime_status:='STOPPED'; stop_reason:='NO_ACTIVE_ALLOCATION';
 elsif (calculation->>'baseUsedNum')::numeric*base_capacity[2]>=base_capacity[1]*(calculation->>'baseUsedDen')::numeric then
  runtime_status:='STOPPED'; stop_reason:='CAPACITY_USED';
 else runtime_status:='ACTIVE'; end if;
 select coalesce(sum(amount_atomic),0) into committed from app_private.funding_earned_receipts where activation_id=activation.id;
 return jsonb_build_object('available',true,'eligible_principal_micro_krw',
  ((inputs->>'principal_atomic')::numeric*1000000)::text,'tier_code',tier->>'code','tier_activated',true,
  'cycle_started_at',to_char(cycle.cycle_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cycle_end',to_char(cycle.cycle_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'effective_capacity_micro_krw',div(capacity[1]*1000000,capacity[2])::text,
  'remaining_capacity_micro_krw',div(remaining[1]*1000000,remaining[2])::text,
  'used_capacity_micro_krw',div(used[1]*1000000,used[2])::text,'speed_multiplier_bps','10000',
  'pending_micro_krw',div(pending[1]*1000000,pending[2])::text,
  'retention_unconfirmed_micro_krw',div(maintenance[1]*1000000,maintenance[2])::text,
  'funded_runtime',jsonb_build_object('schema_version',2,'runtime_version',2,'state_revision',state.revision::text,
   'condition_revision',condition.revision::text,
   'accepted_cursor_at',to_char(state.cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'evaluated_at',to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'allocation_bps',inputs->>'allocation_bps','status',runtime_status,'stop_reason',stop_reason,
   'speed',jsonb_build_object('product_multiplier_bps','10000','user_multiplier_bps','10000',
    'common_multiplier',jsonb_build_object('numerator','1','denominator','1'),
    'effective_global_multiplier',jsonb_build_object('numerator',speed[1]::text,'denominator',speed[2]::text)),
   'committed_reward_total_atomic',committed::text,
   'reward_carry',jsonb_build_object('numerator',state.carry_num::text,'denominator',state.carry_den::text,'unit','KRW'),
   'conditional_maintenance',jsonb_build_object('numerator',maintenance[1]::text,'denominator',maintenance[2]::text,
    'unit','KRW','qualification','UNCONFIRMED')));
end;
$$;


commit;
