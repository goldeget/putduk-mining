begin;

-- Canonical125 member writer calls this private seam in the same transaction.
-- No amount, elapsed time, policy/rate, source owner or clock is an argument.
create function app_private.write_prospective_funding_seal(
 p_id uuid,p_kind text,p_user uuid,p_digest text,p_audit uuid,p_event uuid,p_snapshot jsonb
) returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare request_id uuid:=gen_random_uuid(); instant timestamptz:=clock_timestamp();
begin
 perform app_private.assert_funding_member_writer(p_user);
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(p_audit,p_user,p_kind,'FUNDING_ENGINE_V1',p_id::text,'sealed prospective funding condition',request_id,p_snapshot,
  jsonb_build_object('input_digest',p_digest,'executor','authenticated_canonical_writer','engine_contract',2),instant);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,available_at,last_error_code,occurred_at,created_at)
 values(p_event,p_kind||'.v1',1,'funding_engine_v1',p_id,p_user,
  jsonb_build_object('user_id',p_user,'audit_id',p_audit,'input_digest',p_digest),request_id,request_id,
  'funding:'||p_id::text||':seal','infinity','FUNDING_AUTOMATIC_RUNTIME_NOT_ENABLED',instant,instant);
end;
$$;

create function app_private.create_prospective_funding_condition(p_activation uuid,p_allocation uuid,p_previous uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
begin
 select * into activation from app_private.funding_engine_activations where id=p_activation;
 perform app_private.assert_funding_member_writer(activation.user_id);
 condition.id:=gen_random_uuid(); condition.user_id:=activation.user_id; condition.activation_id:=activation.id;
 condition.previous_condition_id:=p_previous; condition.allocation_original_id:=p_allocation;
 if p_allocation is null then
  condition.revision:=0; condition.effective_at:=activation.effective_at;
 else
  select revision,effective_at into condition.revision,condition.effective_at
   from app_private.funding_allocation_originals where id=p_allocation and user_id=activation.user_id;
 end if;
 condition.inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,p_allocation,condition.effective_at);
 condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
 condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid(); condition.recorded_at:=clock_timestamp();
 insert into app_private.funding_condition_originals select condition.*;
 perform app_private.write_prospective_funding_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
  condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 return condition.id;
end;
$$;

create function app_private.activate_zero_funding_allocation(p_credit uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare owner_id uuid; input jsonb; activation app_private.funding_engine_activations%rowtype;
 cycle_id uuid:=gen_random_uuid(); condition_id uuid; instant timestamptz; days integer;
begin
 select user_id,effective_at into owner_id,instant from public.money_source_movements where id=p_credit;
 perform app_private.assert_funding_member_writer(owner_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||owner_id::text,0));
 select * into activation from app_private.funding_engine_activations where user_id=owner_id;
 if activation.id is not null then
  if activation.runtime_version<>2 or activation.trigger_credit_movement_id is distinct from p_credit then
   raise exception using errcode='55000',message='FUNDING_EXISTING_RUNTIME_UNSUPPORTED'; end if;
  perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',owner_id,activation.input_digest,
   activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
  return activation.id;
 end if;
 if exists(select 1 from app_private.funding_cycle_windows where user_id=owner_id) then
  raise exception using errcode='55000',message='FUNDING_EXISTING_ANCHOR_UNSUPPORTED'; end if;
 input:=app_private.read_prospective_funding_inputs(p_credit,null,instant);
 days:=(input->>'cycle_days')::integer;
 insert into app_private.funding_cycle_windows(id,user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end)
 values(cycle_id,owner_id,0,days,instant,instant+days*interval '24 hours');
 activation.id:=gen_random_uuid(); activation.user_id:=owner_id; activation.trigger_credit_movement_id:=p_credit;
 activation.trigger_principal_revision_id:=(input->>'principal_revision_id')::uuid;
 activation.policy_publication_id:=(input->>'policy_publication_id')::uuid;
 activation.first_cycle_id:=cycle_id; activation.principal_atomic:=(input->>'principal_atomic')::bigint;
 activation.effective_at:=instant; activation.input_digest:=app_private.funding_engine_digest(input);
 activation.audit_id:=gen_random_uuid(); activation.source_event_id:=gen_random_uuid(); activation.recorded_at:=clock_timestamp();
 activation.runtime_version:=2; activation.input_original:=input;
 insert into app_private.funding_engine_activations select activation.*;
 condition_id:=app_private.create_prospective_funding_condition(activation.id,null,null);
 insert into app_private.funding_engine_state_receipts(user_id,activation_id,cycle_id,revision,cursor_at,
  base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(owner_id,activation.id,cycle_id,0,instant,0,1,0,1,0,1,condition_id);
 perform app_private.write_prospective_funding_seal(activation.id,'FUNDING_ACTIVATED',owner_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 return activation.id;
end;
$$;

create function app_private.post_prospective_funding_earned(p_earned uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare earned app_private.funding_earned_receipts%rowtype; wallet_id uuid; posting_key text;
 journal uuid:=gen_random_uuid(); projection uuid:=gen_random_uuid(); source_event uuid:=gen_random_uuid();
 request_id uuid:=gen_random_uuid(); correlation_id uuid:=gen_random_uuid();
begin
 select * into earned from app_private.funding_earned_receipts where id=p_earned;
 perform app_private.assert_funding_member_writer(earned.user_id);
 if earned.runtime_version<>2 or earned.cause_allocation_id is null then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_EARNED_ORIGINAL_REQUIRED'; end if;
 if earned.amount_atomic=0 then return; end if;
 select id into wallet_id from public.wallet_accounts where user_id=earned.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 posting_key:='funding:allocation:'||earned.cause_allocation_id::text;
 insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,
  member_user_id,request_id,correlation_id,description,posted_at,metadata)
 values(journal,'MINING_REWARD','KRW',posting_key||':ledger','mining_reward_credit',earned.credit_id,
  earned.user_id,request_id,correlation_id,'verified prospective funded mining reward',earned.settled_to,
  jsonb_build_object('funding_earned_receipt_id',earned.id,'fee_atomic','0'));
 insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic) values
  (journal,(select id from public.ledger_accounts where code='PUTDUK:MINING_REWARD_EXPENSE:KRW'),0,'DEBIT',earned.amount_atomic),
  (journal,(select id from public.ledger_accounts where code='USER:'||upper(earned.user_id::text)||':KRW:LIABILITY'),1,'CREDIT',earned.amount_atomic);
 insert into public.wallet_ledger(id,wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
 values(projection,wallet_id,earned.user_id,'CREDIT','MINING_REWARD',earned.amount_atomic,posting_key||':wallet','mining_reward_credit',earned.credit_id);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(source_event,'MINING_REWARD_CREDITED.v1',1,'mining_reward_credit',earned.credit_id,earned.user_id,
  jsonb_build_object('user_id',earned.user_id,'amount_atomic',earned.amount_atomic,'currency','KRW',
   'ledger_transaction_id',journal,'wallet_ledger_id',projection),correlation_id,request_id,posting_key||':event',
  'infinity','FUNDING_AUTOMATIC_RUNTIME_NOT_ENABLED');
 insert into public.mining_reward_credits(id,user_id,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at,funding_earned_receipt_id)
 values(earned.credit_id,earned.user_id,earned.amount_atomic,journal,projection,source_event,earned.settled_to,earned.id);
 insert into public.money_source_movements(user_id,source_bucket,movement_kind,origin_code,amount_atomic,
  ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at)
 values(earned.user_id,'MINING_REWARD','CREDIT','MINING_REWARD',earned.amount_atomic,journal,projection,source_event,earned.settled_to);
 insert into public.mining_settlements(id,user_id,settled_from,settled_to,amount_atomic,currency,segment_count,idempotency_key,funding_earned_receipt_id)
 values(earned.settlement_id,earned.user_id,earned.settled_from,earned.settled_to,earned.amount_atomic,'KRW',1,posting_key||':settlement',earned.id);
 insert into public.mining_settlement_segments(mining_settlement_id,user_id,sequence,settled_from,settled_to,
  amount_atomic,equipment_efficiency_bps,world_multiplier_bps,event_multiplier_bps,status_multiplier_bps,funding_earned_receipt_id)
 values(earned.settlement_id,earned.user_id,0,earned.settled_from,earned.settled_to,earned.amount_atomic,10000,10000,10000,10000,earned.id);
end;
$$;

create function app_private.apply_funding_allocation_boundary(p_allocation uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; earned app_private.funding_earned_receipts%rowtype;
 transition uuid; credit uuid; calculation jsonb; inputs jsonb; wallet_id uuid;
begin
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

-- Postgres-owned canonical member definer is the sole foreground caller. Neither
-- a member, anon nor the service worker can invoke this seam directly.
revoke all on function app_private.write_prospective_funding_seal(uuid,text,uuid,text,uuid,uuid,jsonb),
 app_private.create_prospective_funding_condition(uuid,uuid,uuid),app_private.activate_zero_funding_allocation(uuid),
 app_private.post_prospective_funding_earned(uuid),app_private.apply_funding_allocation_boundary(uuid)
 from public,anon,authenticated,service_role;
comment on function app_private.apply_funding_allocation_boundary(uuid) is
 'Private exact prospective foreground allocation acceptance; actual canonical member seals + completed receipt + balanced source posting. Fresh single-lot neutral first-cycle only; scheduler/hold/control/cycle adapters remain closed.';
-- Compatibility-only explicit branch initialization after additive columns.
create or replace function app_private.activate_default_funding_engine(p_credit uuid,p_allocation uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_user uuid; v_wallet uuid; v_input jsonb; v_a app_private.funding_engine_activations%rowtype;
 v_cycle uuid:=gen_random_uuid(); v_effective timestamptz; v_days integer;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 select user_id into v_user from public.money_source_movements where id=p_credit;
 if v_user is null then raise exception using errcode='55000',message='FUNDING_FRESH_PRINCIPAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||v_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||v_user::text,0));
 select id into v_wallet from public.wallet_accounts where user_id=v_user and currency='KRW' and closed_at is null for update;
 if v_wallet is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 select * into v_a from app_private.funding_engine_activations where user_id=v_user;
 if v_a.id is not null then
   if v_a.trigger_credit_movement_id is distinct from p_credit or v_a.allocation_original_id is distinct from p_allocation then
     raise exception using errcode='22023',message='FUNDING_ACTIVATION_CONFLICT'; end if;
   perform app_private.assert_funding_engine_seal(v_a.id,'FUNDING_ACTIVATED',v_a.user_id,v_a.input_digest,
     v_a.audit_id,v_a.source_event_id,app_private.funding_activation_snapshot(v_a));
   return v_a.id;
 end if;
 v_input:=app_private.read_default_funding_inputs(p_credit,p_allocation);
 if exists(select 1 from app_private.funding_cycle_windows where user_id=v_user) then
   raise exception using errcode='55000',message='FUNDING_EXISTING_ANCHOR_UNSUPPORTED'; end if;
 select effective_at into v_effective from public.money_source_movements where id=p_credit;
 v_days:=(v_input->>'cycle_days')::integer;
 insert into app_private.funding_cycle_windows(id,user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end)
 values(v_cycle,v_user,0,v_days,v_effective,v_effective+v_days*interval '24 hours');
 v_a.id:=gen_random_uuid(); v_a.user_id:=v_user; v_a.trigger_credit_movement_id:=p_credit;
 v_a.trigger_principal_revision_id:=(v_input->>'principal_revision_id')::uuid;
 v_a.allocation_original_id:=p_allocation; v_a.policy_publication_id:=(v_input->>'policy_publication_id')::uuid;
 v_a.first_cycle_id:=v_cycle; v_a.principal_atomic:=(v_input->>'principal_atomic')::bigint;
 v_a.effective_at:=v_effective; v_a.input_digest:=app_private.funding_engine_digest(v_input);
 v_a.audit_id:=gen_random_uuid(); v_a.source_event_id:=gen_random_uuid(); v_a.recorded_at:=clock_timestamp();
 v_a.runtime_version:=1; -- Existing composite-row producer must explicitly retain its V1 branch.
 insert into app_private.funding_engine_activations select v_a.*;
 insert into app_private.funding_engine_state_receipts(user_id,activation_id,cycle_id,revision,cursor_at,
   base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den)
 values(v_user,v_a.id,v_cycle,0,v_effective,0,1,0,1,0,1);
 perform app_private.write_funding_engine_seal(v_a.id,'FUNDING_ACTIVATED',v_user,v_a.input_digest,
   v_a.audit_id,v_a.source_event_id,app_private.funding_activation_snapshot(v_a));
 return v_a.id;
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
commit;
