begin;
-- Existing balanced earned writer extension. It posts no additional money and
-- never infers a start from activation alone. First positive accepted earnings
-- confirm the actual activation start; settlement owns its actual business end.
create table app_private.funded_mining_mission_epoch(
 version integer primary key check(version=1),introduced_at timestamptz not null);
insert into app_private.funded_mining_mission_epoch values(1,statement_timestamp());
alter table app_private.funded_mining_mission_epoch enable row level security;
alter table app_private.funded_mining_mission_epoch force row level security;
revoke all on app_private.funded_mining_mission_epoch from public,anon,authenticated,service_role;
create trigger funded_mining_mission_epoch_immutable before update or delete on app_private.funded_mining_mission_epoch
for each row execute function app_private.prevent_row_mutation();

create table app_private.funded_mining_mission_originals(
 id uuid primary key default gen_random_uuid(),
 source_type text not null check(source_type in('MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1')),
 user_id uuid not null references auth.users(id),
 activation_id uuid not null references app_private.funding_engine_activations(id),
 earned_receipt_id uuid not null references app_private.funding_earned_receipts(id),
 settlement_id uuid not null references public.mining_settlements(id),
 effective_at timestamptz not null,observed_at timestamptz not null,
 snapshot jsonb not null,digest text not null,
 outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 unique(source_type,earned_receipt_id));
create unique index funded_mining_first_start_once on app_private.funded_mining_mission_originals(activation_id)
where source_type='MINING_STARTED.v1';
alter table app_private.funded_mining_mission_originals enable row level security;
alter table app_private.funded_mining_mission_originals force row level security;
revoke all on app_private.funded_mining_mission_originals from public,anon,authenticated,service_role;
create trigger funded_mining_mission_original_immutable before update or delete on app_private.funded_mining_mission_originals
for each row execute function app_private.prevent_row_mutation();

create function app_private.funded_mining_mission_snapshot(p_type text,p_earned app_private.funding_earned_receipts)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare a app_private.funding_engine_activations%rowtype;c public.mining_reward_credits%rowtype;
begin
 select * into a from app_private.funding_engine_activations where id=p_earned.activation_id;
 select * into c from public.mining_reward_credits where id=p_earned.credit_id;
 return jsonb_build_object('version',1,'source_type',p_type,'user_id',p_earned.user_id,
  'activation_id',a.id,'activation_digest',a.input_digest,'earned_receipt_id',p_earned.id,'earned_digest',p_earned.input_digest,
  'settlement_id',p_earned.settlement_id,'credit_id',c.id,'ledger_transaction_id',c.ledger_transaction_id,
  'wallet_ledger_id',c.wallet_ledger_id,'amount_atomic',p_earned.amount_atomic::text,
  'effective_at',case when p_type='MINING_STARTED.v1' then a.effective_at else p_earned.settled_to end,
  'observed_at',p_earned.recorded_at,'basis','ACTUAL_POSITIVE_BALANCED_EARNED');
end;$$;

create function app_private.assert_funded_mining_mission_original(p_id uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare o app_private.funded_mining_mission_originals%rowtype;e app_private.funding_earned_receipts%rowtype;
 s public.mining_settlements%rowtype;b public.outbox_events%rowtype;c public.mining_reward_credits%rowtype;
begin
 select * into o from app_private.funded_mining_mission_originals where id=p_id;
 select * into e from app_private.funding_earned_receipts where id=o.earned_receipt_id;
 select * into s from public.mining_settlements where id=e.settlement_id;
 select * into c from public.mining_reward_credits where id=e.credit_id;
 select * into b from public.outbox_events where id=o.outbox_id;
 if o.id is null or e.id is null or e.job_id is null or e.amount_atomic<=0
  or e.recorded_at<(select introduced_at from app_private.funded_mining_mission_epoch where version=1)
  or row(o.user_id,o.activation_id,o.settlement_id,o.observed_at)is distinct from row(e.user_id,e.activation_id,e.settlement_id,e.recorded_at)
  or s.id is null or s.funding_earned_receipt_id is distinct from e.id or s.user_id is distinct from e.user_id or s.amount_atomic is distinct from e.amount_atomic
  or c.id is null or c.funding_earned_receipt_id is distinct from e.id or c.user_id is distinct from e.user_id or c.amount_atomic is distinct from e.amount_atomic
  or o.snapshot is distinct from app_private.funded_mining_mission_snapshot(o.source_type,e)
  or o.digest is distinct from app_private.funding_engine_digest(o.snapshot)
  or o.effective_at is distinct from (o.snapshot->>'effective_at')::timestamptz or o.observed_at>clock_timestamp()
  or b.id is null or b.event_type is distinct from o.source_type or b.schema_version<>1
  or b.aggregate_type is distinct from 'funded_mining_mission' or b.aggregate_id is distinct from o.id
  or b.actor_user_id is distinct from o.user_id or b.occurred_at is distinct from o.effective_at or b.created_at is distinct from o.observed_at
  or b.request_id is distinct from (select request_id from public.ledger_transactions where id=c.ledger_transaction_id)
  or b.payload is distinct from jsonb_build_object('user_id',o.user_id,'original_id',o.id,'earned_receipt_id',e.id,'settlement_id',s.id,'digest',o.digest)
  then raise exception using errcode='55000',message='MINING_MISSION_ORIGINAL_INVALID';end if;
 -- Verifies accepted worker fence/attempt, exact earned calculation, state,
 -- original balanced journal, wallet, source movement and interval seals.
 perform app_private.verify_neutral_funding_job_earned(e);
end;$$;
create function app_private.verify_funded_mining_mission_commit()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if current_setting('role',true)is distinct from 'service_role' or auth.role()is distinct from 'service_role' then
  raise exception using errcode='42501',message='MINING_MISSION_SERVICE_REQUIRED';end if;
 perform app_private.assert_funded_mining_mission_original(new.id);return null;
end;$$;
create constraint trigger funded_mining_mission_complete after insert on app_private.funded_mining_mission_originals
deferrable initially deferred for each row execute function app_private.verify_funded_mining_mission_commit();

create function app_private.emit_funded_mining_missions(p_earned uuid)returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare e app_private.funding_earned_receipts%rowtype;o app_private.funded_mining_mission_originals%rowtype;
 c public.mining_reward_credits%rowtype;j public.ledger_transactions%rowtype;kind text;
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'service_role' or auth.role()is distinct from 'service_role' then
  raise exception using errcode='42501',message='MINING_MISSION_SERVICE_REQUIRED';end if;
 select * into e from app_private.funding_earned_receipts where id=p_earned;
 if e.id is null or e.job_id is null then raise exception using errcode='55000',message='MINING_ACCEPTED_EARNED_REQUIRED';end if;
 if e.amount_atomic=0 then return;end if;
 if e.recorded_at<(select introduced_at from app_private.funded_mining_mission_epoch where version=1)then return;end if;
 if e.amount_atomic<0 then
  raise exception using errcode='55000',message='MINING_MISSION_NEW_WRITER_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-mining-missions:'||e.activation_id::text,0));
 perform app_private.verify_neutral_funding_job_earned(e);
 select * into c from public.mining_reward_credits where id=e.credit_id;
 select * into j from public.ledger_transactions where id=c.ledger_transaction_id;
 foreach kind in array array['MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1']loop
  select * into o from app_private.funded_mining_mission_originals where
   source_type=kind and(case when kind='MINING_STARTED.v1' then activation_id=e.activation_id else earned_receipt_id=e.id end);
  if o.id is not null then perform app_private.assert_funded_mining_mission_original(o.id);continue;end if;
  o.id:=gen_random_uuid();o.source_type:=kind;o.user_id:=e.user_id;o.activation_id:=e.activation_id;o.earned_receipt_id:=e.id;
  o.settlement_id:=e.settlement_id;o.observed_at:=e.recorded_at;o.snapshot:=app_private.funded_mining_mission_snapshot(kind,e);
  o.effective_at:=(o.snapshot->>'effective_at')::timestamptz;o.digest:=app_private.funding_engine_digest(o.snapshot);o.outbox_id:=gen_random_uuid();
  insert into app_private.funded_mining_mission_originals select o.*;
  insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
   correlation_id,request_id,idempotency_key,occurred_at,created_at)
  values(o.outbox_id,kind,1,'funded_mining_mission',o.id,o.user_id,
   jsonb_build_object('user_id',o.user_id,'original_id',o.id,'earned_receipt_id',e.id,'settlement_id',e.settlement_id,'digest',o.digest),
   j.correlation_id,j.request_id,'funded-mission:'||kind||':'||case when kind='MINING_STARTED.v1' then e.activation_id::text else e.id::text end,
   o.effective_at,o.observed_at);
  perform app_private.assert_funded_mining_mission_original(o.id);
 end loop;
end;$$;
create function app_private.guard_funded_mining_mission_outbox()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app_private.funded_mining_mission_originals where outbox_id=old.id)
  and(tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
  is distinct from to_jsonb(old)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'])then
  raise exception using errcode='55000',message='MINING_MISSION_OUTBOX_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end;$$;
create trigger funded_mining_mission_outbox_immutable before update or delete on public.outbox_events
for each row execute function app_private.guard_funded_mining_mission_outbox();
revoke all on function app_private.funded_mining_mission_snapshot(text,app_private.funding_earned_receipts),
 app_private.assert_funded_mining_mission_original(uuid),app_private.verify_funded_mining_mission_commit(),
 app_private.emit_funded_mining_missions(uuid),app_private.guard_funded_mining_mission_outbox()from public,anon,authenticated,service_role;
grant execute on function app_private.emit_funded_mining_missions(uuid)to service_role;
-- Existing sole monetary writer: one same-transaction original extension.
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
   perform app_private.emit_funded_mining_missions(v_e.id);
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
 if v_input->>'input_contract_version' in('2','3') or v_target=v_cycle.cycle_end then
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
 if (v_calc->>'qualifiedRetentionNum')::numeric>0 or v_calc ? 'retentionComponentOriginal' then
   insert into app_private.funding_retention_qualifications(user_id,cycle_id,earned_receipt_id,qualified_num,qualified_den,
     principal_input_digest,qualified_at,component_original)
   values(v_e.user_id,v_cycle.id,v_e.id,(v_calc->>'qualifiedRetentionNum')::numeric,
     (v_calc->>'qualifiedRetentionDen')::numeric,v_a.input_digest,v_cycle.cycle_end,v_calc->'retentionComponentOriginal');
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
 if v_target=v_cycle.cycle_end then perform app_private.open_next_funding_cycle(v_e.id);end if;
 perform app_private.emit_funded_mining_missions(v_e.id);
 return v_e.id;
end;
$$;

create or replace function app_private.read_nonmoney_mission_original(p_source uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;
 w public.withdrawal_requests%rowtype;a app_private.funding_withdrawal_clock_admissions%rowtype;
 t public.ledger_transactions%rowtype;owner_id uuid;effective_at timestamptz;original jsonb;mission app_private.funded_mining_mission_originals%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_source;
 if e.id is null or e.schema_version<>1 then raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if e.event_type in('DEPOSIT_CONFIRMED.v1','TRIAL_REWARD_CONVERTED.v1') then
  if (select count(*) from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT')<>1 then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_CREDIT_ORIGINAL_REQUIRED';end if;
  select * into m from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT';
  if (e.event_type='DEPOSIT_CONFIRMED.v1' and(e.aggregate_type<>'deposit_request' or m.origin_code<>'KRW_DEPOSIT'))
   or(e.event_type='TRIAL_REWARD_CONVERTED.v1' and(e.aggregate_type<>'trial_reward_conversion' or m.origin_code<>'WELCOME_REWARD')) then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_KIND_MISMATCH';end if;
  -- This exact existing validator verifies terminal domain row, member, amounts,
  -- balanced journal, wallet, request/correlation, canonical idempotency and audit.
  perform app_private.assert_money_source_credit_complete(m);
  select * into t from public.ledger_transactions where id=m.ledger_transaction_id;
  owner_id:=m.user_id;effective_at:=m.effective_at;
  if effective_at is distinct from t.posted_at then raise exception using errcode='55000',message='NONMONEY_BUSINESS_CLOCK_MISMATCH';end if;
  original:=jsonb_build_object('credit_movement_id',m.id,'ledger_transaction_id',t.id,'wallet_ledger_id',m.wallet_ledger_id,
   'domain_id',e.aggregate_id,'domain_kind',e.aggregate_type,'member_id',owner_id,'effective_at',effective_at,
   'credit_movement',to_jsonb(m),'ledger_original',to_jsonb(t));
 elsif e.event_type='WITHDRAWAL_COMPLETED.v1' then
  if e.aggregate_type<>'withdrawal_request' then raise exception using errcode='55000',message='NONMONEY_SOURCE_KIND_MISMATCH';end if;
  select * into w from public.withdrawal_requests where id=e.aggregate_id;
  if w.id is null or w.status<>'COMPLETED' or w.finalize_ledger_transaction_id is null or w.ledger_finalized_at is null
   or e.payload->>'finalize_ledger_transaction_id' is distinct from w.finalize_ledger_transaction_id::text then
   raise exception using errcode='55000',message='NONMONEY_WITHDRAWAL_TERMINAL_REQUIRED';end if;
  if (select count(*) from app_private.funding_withdrawal_clock_admissions where withdrawal_id=w.id and phase='FINALIZE')<>1 then
   raise exception using errcode='55000',message='NONMONEY_WITHDRAWAL_CLOCK_ORIGINAL_REQUIRED';end if;
  select * into a from app_private.funding_withdrawal_clock_admissions where withdrawal_id=w.id and phase='FINALIZE';
  -- Includes real external-send receipt, balanced journal and hold provenance,
  -- immutable admission/seal, actual completed transaction receipt and outbox.
  perform app_private.assert_funding_withdrawal_clock_completion(a.id);
  select * into t from public.ledger_transactions where id=w.finalize_ledger_transaction_id;
  owner_id:=a.user_id;effective_at:=a.effective_at;
  if owner_id is distinct from w.user_id or e.occurred_at is distinct from effective_at or e.created_at is distinct from effective_at
   or t.posted_at is distinct from effective_at or e.request_id is distinct from t.request_id then
   raise exception using errcode='55000',message='NONMONEY_BUSINESS_CLOCK_MISMATCH';end if;
  original:=jsonb_build_object('domain_id',w.id,'domain_kind','withdrawal_request','member_id',owner_id,
   'effective_at',effective_at,'clock_admission_id',a.id,'clock_admission_digest',a.input_digest,
   'ledger_transaction_id',t.id,'clock_original',app_private.funding_withdrawal_clock_snapshot(a),'ledger_original',to_jsonb(t));
  elsif e.event_type in('MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1')then
   select * into mission from app_private.funded_mining_mission_originals where outbox_id=e.id;
   if mission.id is null then raise exception using errcode='55000',message='NONMONEY_MINING_ORIGINAL_REQUIRED';end if;
   perform app_private.assert_funded_mining_mission_original(mission.id);
   owner_id:=mission.user_id;effective_at:=mission.effective_at;
   original:=mission.snapshot||jsonb_build_object('mission_original_id',mission.id,'mission_original_digest',mission.digest);
  elsif e.event_type in('TRIAL_COMPLETED.v1','REFERRAL_REWARD_PAID.v1')then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_WRITER_NOT_CONNECTED';
 else raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if owner_id is null or effective_at is null or effective_at>clock_timestamp() then
  raise exception using errcode='55000',message='NONMONEY_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=original||jsonb_build_object('source_event_id',e.id,'source_type',e.event_type,'schema_version',e.schema_version,
  'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',owner_id,'effective_at',effective_at,'source_event_id',e.id,'source_type',e.event_type,
  'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;

create or replace function app_private.approve_local_nonmoney_policy(
 p_event uuid,p_revision uuid,p_rule uuid,p_version integer,p_source_type text,p_reward_kind text,p_reward_code text,p_title_ko text,
 p_actor uuid,p_admin_session uuid,p_auth_session text,p_verified_aal text,p_step_up_token text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare role public.app_role;r app_private.liveops_content_receipts%rowtype;prev app_private.liveops_content_receipts%rowtype;
 event public.events%rowtype;policy app_private.nonmoney_event_policies%rowtype;idem app_private.idempotency_keys%rowtype;
 idem_id uuid;request_id uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();grant_id uuid;
 snapshot jsonb;request_hash text;at timestamptz;result jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 if not exists(select 1 from app_private.nonmoney_executor_configuration where singleton and local_qa_enabled
  and project_identity='putduk-mining-local-recovery-20261009-fi') then raise exception using errcode='42501',message='NONMONEY_LOCAL_QA_DISABLED';end if;
 role:=app_private.liveops_operator_context(p_actor,p_admin_session,p_auth_session,p_verified_aal);
 if p_event is null or p_revision is null or p_rule is null or p_version is null or p_version<1 or p_idempotency_key is null
  or p_source_type not in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1') or p_source_type is null
  or p_reward_kind not in('BADGE','PROFILE_TITLE') or p_reward_kind is null or p_reward_code is null or p_reward_code!~'^[A-Z][A-Z0-9_]{1,47}$'
  or char_length(btrim(coalesce(p_title_ko,''))) not between 1 and 80 or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500
  or char_length(coalesce(p_step_up_token,'')) not between 16 and 512 then raise exception using errcode='22023',message='INVALID_NONMONEY_POLICY';end if;
 -- Missing trial/referral canonical producers stay closed until an actual sole-writer bridge is reviewed.
 perform pg_advisory_xact_lock(hashtextextended('putduk-nonmoney-policy:'||p_event::text||':'||p_rule::text,0));
 select * into r from app_private.liveops_content_receipts where id=p_revision and content_id=p_event and kind='EVENT';
 select * into prev from app_private.liveops_content_receipts where id=r.previous_revision_id;
 select * into event from public.events where id=p_event for share;
 if r.id is null or r.state<>'PUBLISHED' or prev.state<>'APPROVED' or prev.digest is distinct from r.digest
  or event.id is null or event.status not in('SCHEDULED','LIVE') or event.ends_at<=clock_timestamp()
  or not exists(select 1 from public.event_member_content where event_id=p_event and revision_id=p_revision)
  or exists(select 1 from app_private.liveops_content_receipts where content_id=p_event and revision>r.revision) then
  raise exception using errcode='42501',message='NONMONEY_CURRENT_APPROVAL_REQUIRED';end if;
 perform app_private.assert_liveops_receipt(r.id);perform app_private.assert_liveops_receipt(prev.id);
 request_hash:=app_private.funding_engine_digest(jsonb_build_object('event',p_event,'revision',p_revision,'rule',p_rule,'version',p_version,
  'source_type',p_source_type,'reward_kind',p_reward_kind,'reward_code',p_reward_code,'title_ko',btrim(p_title_ko),'actor',p_actor,
  'admin_session',p_admin_session,'auth_session',p_auth_session,'reason',btrim(p_reason),'proof_hash',encode(extensions.digest(p_step_up_token,'sha256'),'hex')));
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status)
 values('nonmoney.local-policy',p_actor,p_idempotency_key::text,request_hash,'PROCESSING') on conflict(scope,actor_id,idempotency_key) do nothing returning id into idem_id;
 if idem_id is null then
  select * into idem from app_private.idempotency_keys where scope='nonmoney.local-policy' and actor_id=p_actor and idempotency_key=p_idempotency_key::text for update;
  if idem.request_hash is distinct from request_hash then raise exception using errcode='22023',message='IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
  if idem.status<>'COMPLETED' then raise exception using errcode='40001',message='NONMONEY_POLICY_IN_PROGRESS';end if;
  perform app_private.assert_nonmoney_policy((idem.response_payload->>'policyId')::uuid);
  return idem.response_payload;
 end if;
 if p_version<>(select coalesce(max(version),0)+1 from app_private.nonmoney_event_policies where event_id=p_event and rule_id=p_rule) then
  raise exception using errcode='40001',message='NONMONEY_POLICY_VERSION_MISMATCH';end if;
 at:=clock_timestamp();grant_id:=app_private.consume_admin_step_up_token(p_actor,p_step_up_token,'LIVEOPS_CONTENT',request_id,p_admin_session);
 policy.id:=gen_random_uuid();snapshot:=jsonb_build_object('policy_id',policy.id,'event_id',p_event,'content_revision_id',p_revision,
  'rule_id',p_rule,'version',p_version,'scope','LOCAL_QA','source_type',p_source_type,'reward_kind',p_reward_kind,'reward_code',p_reward_code,
  'title_ko',btrim(p_title_ko),'starts_at',event.starts_at,'ends_at',event.ends_at,'approved_by',p_actor,'approved_at',at,
  'admin_session_id',p_admin_session,'auth_session_id',p_auth_session,'step_up_grant_id',grant_id,'request_id',request_id,'request_hash',request_hash);
 insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(aid,p_actor,role,'NONMONEY_LOCAL_POLICY_APPROVED','nonmoney_event_policy',policy.id::text,btrim(p_reason),request_id,snapshot,
  jsonb_build_object('admin_session_id',p_admin_session,'step_up_grant_id',grant_id,'request_hash',request_hash),at);
 insert into app_private.nonmoney_event_policies(id,event_id,content_revision_id,rule_id,version,scope,source_type,reward_kind,reward_code,title_ko,
  starts_at,ends_at,approved_by,approval_audit_id,snapshot,digest,created_at)
 values(policy.id,p_event,p_revision,p_rule,p_version,'LOCAL_QA',p_source_type,p_reward_kind,p_reward_code,btrim(p_title_ko),event.starts_at,event.ends_at,
  p_actor,aid,snapshot,app_private.funding_engine_digest(snapshot),at) returning * into policy;
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,occurred_at,created_at)
 values(eid,'NONMONEY_POLICY_APPROVED.v1',1,'nonmoney_event_policy',policy.id,p_actor,
  jsonb_build_object('policy_id',policy.id,'audit_id',aid,'scope','LOCAL_QA','digest',policy.digest),request_id,request_id,
  'nonmoney-local-policy:'||p_actor::text||':'||p_idempotency_key::text,at,at);
 result:=jsonb_build_object('policyId',policy.id,'eventId',p_event,'revisionId',p_revision,'ruleId',p_rule,'version',p_version,'scope','LOCAL_QA',
  'digest',policy.digest,'auditId',aid,'outboxId',eid,'confirmed',true);
 perform app_private.liveops_operator_context(p_actor,p_admin_session,p_auth_session,p_verified_aal);
 update app_private.idempotency_keys set status='COMPLETED',response_status=200,response_payload=result,completed_at=clock_timestamp(),locked_until=null where id=idem_id;
 perform app_private.assert_nonmoney_policy(policy.id);
 return result;
end;$$;

create or replace function public.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_audit public.audit_logs%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_delivery public.event_consumer_deliveries%rowtype;
begin
  select event.* into v_event from public.outbox_events as event
  where event.id = p_event_id for update;
  if v_event.id is null or v_event.status <> 'PROCESSING'
    or v_event.lease_owner is distinct from p_worker_id
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at < clock_timestamp() then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;

  if v_event.event_type = 'SAFE_MODE_CHANGED.v1' then
    select audit.* into v_audit from public.audit_logs as audit
    where audit.id::text = v_event.payload->>'audit_id';
    select logical_key.* into v_key from app_private.idempotency_keys as logical_key
    where logical_key.scope = 'safe_mode.control' and logical_key.actor_id is null
      and logical_key.idempotency_key = v_audit.metadata->>'idempotency_key';
    if v_event.schema_version <> 1 or v_event.aggregate_type <> 'safe_mode_control'
      or v_event.payload - array['audit_id', 'component', 'is_paused', 'review_at', 'request_hash'] <> '{}'::jsonb
      or v_audit.id is null or v_key.id is null
      or v_audit.target_type is distinct from 'SAFE_MODE'
      or v_audit.action not in ('SAFE_MODE_ENABLED', 'SAFE_MODE_DISABLED')
      or v_audit.metadata->'command_version' is distinct from '1'::jsonb
      or v_audit.actor_user_id is distinct from v_event.actor_user_id
      or v_audit.request_id is distinct from v_event.request_id
      or v_event.correlation_id is distinct from v_audit.request_id
      or v_audit.after_state->>'id' is distinct from v_event.aggregate_id::text
      or v_audit.after_state->>'component' is distinct from v_audit.target_id
      or v_event.payload->>'component' is distinct from v_audit.target_id
      or v_event.payload->'is_paused' is distinct from v_audit.after_state->'is_paused'
      or v_event.payload->'is_paused' is distinct from to_jsonb(v_audit.action = 'SAFE_MODE_ENABLED')
      or v_event.payload->'review_at' is distinct from v_audit.after_state->'review_at'
      or v_event.payload->>'request_hash' is distinct from v_audit.metadata->>'request_hash'
      or v_event.idempotency_key is distinct from 'safe-mode:' || v_key.idempotency_key
      or v_key.status <> 'COMPLETED' or v_key.completed_at is null
      or v_key.response_status is distinct from 200
      or v_key.request_hash is distinct from v_event.payload->>'request_hash'
      or v_key.response_payload->>'audit_id' is distinct from v_audit.id::text
      or v_key.response_payload->>'control_id' is distinct from v_event.aggregate_id::text
      or not exists (select 1 from public.safe_mode_controls as control
        where control.id = v_event.aggregate_id and control.component = v_audit.target_id)
      or (select count(*) from public.outbox_events as original
        where original.event_type = 'SAFE_MODE_CHANGED.v1'
          and original.payload->>'audit_id' = v_audit.id::text) <> 1 then
      raise exception using errcode = '55000', message = 'SAFE_MODE_EVENT_RECEIPT_MISMATCH';
    end if;
    insert into public.event_consumer_deliveries (
      event_id, consumer_name, status, attempt_count, processed_at
    ) values (
      v_event.id, 'operator_safe_mode_audit.v1', 'SUCCEEDED', 1, statement_timestamp()
    ) on conflict (event_id, consumer_name) do nothing;
    select delivery.* into v_delivery from public.event_consumer_deliveries as delivery
    where delivery.event_id = v_event.id and delivery.consumer_name = 'operator_safe_mode_audit.v1';
    if v_delivery.status is distinct from 'SUCCEEDED' or v_delivery.processed_at is null
      or v_delivery.attempt_count <> 1 or v_delivery.lease_owner is not null
      or v_delivery.lease_expires_at is not null or v_delivery.last_error_code is not null then
      raise exception using errcode = '55000', message = 'SAFE_MODE_DELIVERY_RECEIPT_MISMATCH';
    end if;
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  elsif v_event.event_type in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1') then
    perform app_private.consume_nonmoney_source(v_event.id,p_worker_id);
   else raise exception using errcode='55000',message='OUTBOX_HANDLER_UNSUPPORTED';
   end if;

  update public.outbox_events set status = 'PROCESSED',
    processed_at = statement_timestamp(), lease_owner = null,
    lease_expires_at = null, last_error_code = null where id = v_event.id
    and status = 'PROCESSING' and lease_owner = p_worker_id
    and lease_expires_at >= clock_timestamp();
  if not found then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;

commit;
