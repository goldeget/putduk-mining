begin;

create function app_private.write_funding_engine_seal(
 p_id uuid,p_kind text,p_user uuid,p_digest text,p_audit uuid,p_event uuid,p_snapshot jsonb
) returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_request uuid:=gen_random_uuid();
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 insert into public.audit_logs(id,action,target_type,target_id,reason,request_id,after_state,metadata)
 values(p_audit,p_kind,'FUNDING_ENGINE_V1',p_id::text,'verified default funded engine original',v_request,p_snapshot,
   jsonb_build_object('input_digest',p_digest,'executor','service_role','engine_contract',1));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,
   payload,correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(p_event,p_kind||'.v1',1,'funding_engine_v1',p_id,p_user,
   jsonb_build_object('user_id',p_user,'audit_id',p_audit,'input_digest',p_digest),gen_random_uuid(),v_request,
   'funding:'||p_id::text||':seal','infinity','FUNDING_ENGINE_CONSUMER_NOT_ENABLED');
end;
$$;

-- No default allocation is inserted. An actual fresh original must already
-- have a confirmed allocation effective at its own credit instant.
create function app_private.activate_default_funding_engine(p_credit uuid,p_allocation uuid)
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
 insert into app_private.funding_engine_activations select v_a.*;
 insert into app_private.funding_engine_state_receipts(user_id,activation_id,cycle_id,revision,cursor_at,
   base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den)
 values(v_user,v_a.id,v_cycle,0,v_effective,0,1,0,1,0,1);
 perform app_private.write_funding_engine_seal(v_a.id,'FUNDING_ACTIVATED',v_user,v_a.input_digest,
   v_a.audit_id,v_a.source_event_id,app_private.funding_activation_snapshot(v_a));
 return v_a.id;
end;
$$;

-- Explicitly disconnected: jobs are unavailable at infinity, and no application
-- or worker calls this function. Root must review connection separately. Tests
-- may owner-release a fixture job, then use the actual canonical claim command.
create function app_private.prepare_default_funding_job(p_activation uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_user uuid; v_state app_private.funding_engine_state_receipts%rowtype;
 v_j app_private.funding_engine_jobs%rowtype; v_payload jsonb; v_existing uuid;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 select user_id into v_user from app_private.funding_engine_activations where id=p_activation;
 if v_user is null then raise exception using errcode='55000',message='FUNDING_ACTIVATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||v_user::text,0));
 select * into v_state from app_private.funding_engine_state where user_id=v_user;
 if v_state.cycle_closed then raise exception using errcode='55000',message='FUNDING_NEXT_CYCLE_UNSUPPORTED'; end if;
 select job_id into v_existing from app_private.funding_engine_jobs where expected_state_id=v_state.id;
 if v_existing is not null then
   select * into v_j from app_private.funding_engine_jobs where job_id=v_existing;
   perform app_private.assert_funding_engine_seal(v_existing,'FUNDING_JOB_PREPARED',v_user,v_j.input_digest,
     v_j.audit_id,v_j.source_event_id,app_private.funding_job_snapshot(v_j));
   return v_existing;
 end if;
 v_j.job_id:=gen_random_uuid(); v_j.user_id:=v_user; v_j.activation_id:=p_activation; v_j.expected_state_id:=v_state.id;
 v_payload:=app_private.funding_job_snapshot(v_j); v_j.input_digest:=app_private.funding_engine_digest(v_payload);
 v_j.audit_id:=gen_random_uuid(); v_j.source_event_id:=gen_random_uuid(); v_j.recorded_at:=clock_timestamp();
 insert into public.system_jobs(id,job_type,idempotency_key,payload,payload_version,available_at,last_error_code)
 values(v_j.job_id,'FUNDING_MINING_TICK_V1','funding:state:'||v_state.id::text,v_payload,1,
   'infinity','FUNDING_ENGINE_RUNTIME_NOT_CONNECTED');
 insert into app_private.funding_engine_jobs select v_j.*;
 perform app_private.write_funding_engine_seal(v_j.job_id,'FUNDING_JOB_PREPARED',v_user,v_j.input_digest,
   v_j.audit_id,v_j.source_event_id,v_payload);
 return v_j.job_id;
end;
$$;

-- Amount/rate/clock/used/carry are never arguments. The job's immutable original,
-- member state and authoritative originals determine every financial effect.
create function app_private.process_default_funding_job(p_job uuid,p_worker text,p_attempt integer)
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

revoke all on function app_private.write_funding_engine_seal(uuid,text,uuid,text,uuid,uuid,jsonb),
 app_private.activate_default_funding_engine(uuid,uuid),app_private.prepare_default_funding_job(uuid),
 app_private.process_default_funding_job(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.write_funding_engine_seal(uuid,text,uuid,text,uuid,uuid,jsonb),
 app_private.activate_default_funding_engine(uuid,uuid),app_private.prepare_default_funding_job(uuid),
 app_private.process_default_funding_job(uuid,text,integer) to service_role;
comment on function app_private.process_default_funding_job(uuid,text,integer) is
 'Disconnected private default first-cycle producer; trusted original IDs and live attempt fence only, no caller reward/clock. No public completion branch or automatic schedule.';
commit;
