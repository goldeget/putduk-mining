begin;

-- Only verified neutral first-cycle input_contract2 gains GLOBAL attribution.
-- Existing signatures/ACLs/fences and unknown-history fallbacks remain closed.

create or replace function app_private.read_verified_credit_funding_inputs(p_user uuid,p_allocation uuid,p_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare movement public.money_source_movements%rowtype; principal public.funding_principal_revisions%rowtype;
 policy app_private.economy_policy_published%rowtype; receipt app_private.economy_policy_receipts%rowtype;
 policy_revision integer:=0; previous uuid; tier jsonb; allocation_bps integer:=0;
 cumulative_micro numeric:=0; first_credit_at timestamptz; manifest jsonb:='[]'::jsonb;
 source record; source_count bigint; credits bigint; role_name text;
begin
 role_name:=current_setting('role',true);
 if p_user is null or (
   (role_name='service_role' and auth.role()='service_role')
   or(role_name='authenticated' and auth.role()='authenticated' and auth.uid()=p_user)) is not true then
  raise exception using errcode='42501',message='FUNDING_INPUT_SUBJECT_FORBIDDEN'; end if;
 if p_at is null or not isfinite(p_at) or p_at>clock_timestamp()
   or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 if(select coverage from public.money_source_summaries where user_id=p_user) is distinct from 'COMPLETE'
  or exists(select 1 from public.funding_principal_recovery_allocations where user_id=p_user)
  or exists(select 1 from public.funding_principal_recovery_releases where user_id=p_user)
  or exists(select 1 from app_private.funding_cycle_segments where user_id=p_user)
  or exists(select 1 from public.money_source_movements where user_id=p_user and source_bucket='PRINCIPAL'
    and(movement_kind<>'CREDIT' or origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT'))) then
  raise exception using errcode='55000',message='FUNDING_SOURCE_BOUNDARY_ADAPTER_REQUIRED'; end if;
 select count(*) into credits from public.money_source_movements where user_id=p_user and source_bucket='PRINCIPAL';
 if credits=0 or credits<>(select count(*) from public.funding_principal_lots where user_id=p_user)
  or credits<>(select count(*) from public.funding_principal_revisions where user_id=p_user) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
 -- Positive INCREASE snapshots establish their immutable logical order by net
 -- after balance, not guessed wall-clock/UUID tie order. Every exact delta must
 -- connect to the next receipt; neither a stale gross chain nor hidden hold is
 -- repaired here. No monetary original is inserted by this reader.
 for source in select m.id as movement_id,l.id as lot_id,r.id as principal_revision_id
   from public.funding_principal_revisions r
   join public.funding_principal_lots l on l.id=r.lot_id
   join public.money_source_movements m on m.id=r.money_source_movement_id
   where r.user_id=p_user order by r.eligible_principal_micro_krw_after loop
  select * into movement from public.money_source_movements where id=source.movement_id;
  select * into principal from public.funding_principal_revisions where id=source.principal_revision_id;
  if movement.user_id is distinct from p_user or movement.effective_at>p_at
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or principal.direction is distinct from 'INCREASE' or principal.user_id is distinct from p_user
   or principal.effective_at is distinct from movement.effective_at
   or principal.ledger_transaction_id is distinct from movement.ledger_transaction_id
   or principal.source_event_id is distinct from movement.source_event_id
   or principal.delta_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or principal.eligible_principal_micro_krw_after::numeric is distinct from cumulative_micro+principal.delta_micro_krw
   or not exists(select 1 from public.funding_principal_lots l where l.id=source.lot_id and l.user_id=p_user
    and l.money_source_movement_id=movement.id and l.ledger_transaction_id=movement.ledger_transaction_id
    and l.source_event_id=movement.source_event_id and l.effective_at=movement.effective_at
    and l.amount_atomic=movement.amount_atomic and l.amount_micro_krw=principal.delta_micro_krw) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
  perform app_private.assert_money_source_credit(movement);
  cumulative_micro:=cumulative_micro+principal.delta_micro_krw;
  first_credit_at:=least(first_credit_at,movement.effective_at);
  manifest:=manifest||jsonb_build_array(jsonb_build_object('credit_id',movement.id,'lot_id',source.lot_id,
   'principal_revision_id',principal.id,'amount_atomic',movement.amount_atomic::text,
   'effective_at_microseconds',((extract(epoch from movement.effective_at)*1000000)::bigint)::text));
 end loop;
 select count(*) into source_count from jsonb_array_elements(manifest);
 if source_count<>credits or cumulative_micro is distinct from app_private.funding_principal_mining_eligible_micro(p_user,clock_timestamp())
   or cumulative_micro>9223372036854775807 then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
 -- Only this local calculation record uses the derived aggregate for tier and
 -- policy checks. Its real credit was independently verified before aggregation.
 movement.amount_atomic:=div(cumulative_micro,1000000)::bigint;
 -- Validate the real policy publication chain directly in the trusted member
 -- definer context, without impersonating the service-only policy RPC role.
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
 select * into policy from app_private.economy_policy_published where effective_from<=p_at
  and(effective_until is null or effective_until>p_at);
 if policy.policy_id is null then raise exception using errcode='55000',message='FUNDING_POLICY_ORIGINAL_REQUIRED'; end if;
 perform app_private.validate_economy_policy_config(policy.config);
 for receipt in select * from app_private.economy_policy_receipts where policy_id=policy.policy_id order by revision loop
  policy_revision:=policy_revision+1;
  if receipt.revision is distinct from policy_revision or policy_revision>4 or receipt.previous_revision_id is distinct from previous
   or receipt.state is distinct from (array['DRAFT','PREVIEWED','APPROVED','PUBLISHED'])[policy_revision] then
   raise exception using errcode='55000',message='FUNDING_POLICY_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_economy_policy_receipt(receipt.id); previous:=receipt.id;
 end loop;
 if policy_revision<>4 or previous is distinct from policy.revision_id
  or policy.config#>>'{platformFeesKrw,mining}' is distinct from '0'
  or policy.config#>>'{productMultiplier,defaultBps}' is distinct from '10000'
  or policy.config#>>'{userOverride,defaultMultiplierBps}' is distinct from '10000'
  or policy.config#>>'{campaign,defaultSpeedMultiplierBps}' is distinct from '10000'
  or policy.config#>>'{campaign,defaultCapacityBoostBps}' is distinct from '0'
  or policy.config#>>'{allocation,capacityScope}' is distinct from 'GLOBAL_CYCLE' then
  raise exception using errcode='55000',message='FUNDING_DEFAULT_POLICY_REQUIRED'; end if;
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::bigint<=movement.amount_atomic
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::bigint>=movement.amount_atomic);
 if tier is null and movement.amount_atomic>=(policy.config->>'minimumPrincipalKrw')::bigint then
  raise exception using errcode='55000',message='FUNDING_TIER_UNRESOLVED'; end if;
 if p_allocation is not null then
  allocation_bps:=app_private.assert_prospective_allocation(p_allocation,p_user,policy.config,coalesce((tier->>'slots')::integer,0));
  if (select effective_at from app_private.funding_allocation_originals where id=p_allocation)>p_at then
   raise exception using errcode='55000',message='FUNDING_ALLOCATION_FUTURE_INPUT'; end if;
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 if exists(select 1 from public.safe_mode_controls where component in('NEW_MINING','SETTLEMENT')
   and(is_paused or starts_at>=first_credit_at))
  or exists(select 1 from public.audit_logs where target_type='SAFE_MODE' and target_id in('NEW_MINING','SETTLEMENT')
   and(after_state->>'starts_at')::timestamptz>=first_credit_at)
  or exists(select 1 from public.block_rules where user_id=p_user and scope='ACCOUNT'
   and(ends_at is null or ends_at>first_credit_at)) then
  raise exception using errcode='55000',message='FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED'; end if;
 -- GLOBAL history requires exact immutable command originals, never a guessed state.
 perform app_private.funding_global_eligible_interval(first_credit_at,p_at);
 return jsonb_build_object('input_contract_version',2,'user_id',p_user,'credit_originals',manifest,
  'principal_original_digest',app_private.funding_engine_digest(manifest),
  'principal_atomic',movement.amount_atomic::text,'first_credit_at_microseconds',((extract(epoch from first_credit_at)*1000000)::bigint)::text,
  'allocation_id',p_allocation,'allocation_digest',(select input_digest from app_private.funding_allocation_originals where id=p_allocation),
  'allocation_bps',allocation_bps,'policy_publication_id',policy.publication_id,'policy_config_digest',policy.config_digest,
  'policy_effective_from_microseconds',((extract(epoch from policy.effective_from)*1000000)::bigint)::text,
  'cycle_days',(policy.config->>'cycleDays')::integer,'base_bps',(policy.config->>'baseCycleRateBps')::integer,
  'retention_bps',coalesce((tier->>'retentionBonusBps')::integer,0),'tier_code',tier->>'code',
  'slots',coalesce((tier->>'slots')::integer,0),'tier_activated',tier is not null);
end;
$$;

create or replace function app_private.calculate_credit_boundary_interval(p_state uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare state app_private.funding_engine_state_receipts%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 condition app_private.funding_condition_originals%rowtype; caps numeric[]; speed numeric[]; timeline jsonb; calculation jsonb;
begin
 select * into state from app_private.funding_engine_state_receipts where id=p_state;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if state.id is null or state.cycle_closed or p_at<state.cursor_at or p_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_CREDIT_CYCLE_BOUNDARY_UNSUPPORTED'; end if;
 caps:=app_private.funding_state_effective_capacities(p_state);
 speed:=app_private.funding_exact_ratio((condition.inputs->>'allocation_bps')::numeric,10000);
 timeline:=app_private.funding_global_eligible_interval(state.cursor_at,p_at);
 calculation:=app_private.funding_exact_forward_interval((condition.inputs->>'principal_atomic')::bigint,
 (condition.inputs->>'base_bps')::integer,(condition.inputs->>'retention_bps')::integer,
 (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
 (timeline->>'eligible_microseconds')::bigint,speed[1],speed[2],caps[1],caps[2],caps[3],caps[4],
 state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,0,1);
 -- Preserve historical snapshots before the first effective GLOBAL original.
 if jsonb_array_length(timeline->'control_original_ids')>0 then
  calculation:=calculation||jsonb_build_object('globalControlContractVersion',1,
   'globalEligibleMicroseconds',timeline->>'eligible_microseconds',
   'globalControlOriginalIds',timeline->'control_original_ids');
 end if;
 return calculation;
end;
$$;

create or replace function app_private.begin_funding_credit_boundary(p_original uuid,p_origin text) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 activation app_private.funding_engine_activations%rowtype; earned app_private.funding_earned_receipts%rowtype;
 wallet_id uuid; calculation jsonb; message text; locked_owner uuid;
begin
 perform app_private.assert_credit_boundary_executor();
 if p_origin='KRW_DEPOSIT' then select user_id into preparation.user_id from public.deposit_requests where id=p_original;
 elsif p_origin='USDT_KRW_DEPOSIT' then select user_id into preparation.user_id from public.usdt_manual_deposits where id=p_original;
 else raise exception using errcode='22023',message='FUNDING_CREDIT_ORIGIN_INVALID'; end if;
 if preparation.user_id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_COMMAND_ORIGINAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 perform app_private.assert_funding_global_credit_allowed();
 if p_origin='KRW_DEPOSIT' then select user_id into locked_owner from public.deposit_requests where id=p_original for update;
 else select user_id into locked_owner from public.usdt_manual_deposits where id=p_original for update; end if;
 if locked_owner is distinct from preparation.user_id then raise exception using errcode='40001',message='FUNDING_CREDIT_COMMAND_OWNER_CHANGED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||preparation.user_id::text,0));
 select id into wallet_id from public.wallet_accounts where user_id=preparation.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 select * into state from app_private.funding_engine_state where user_id=preparation.user_id;
 select * into activation from app_private.funding_engine_activations where user_id=preparation.user_id;
 preparation.id:=gen_random_uuid(); preparation.origin_code:=p_origin; preparation.command_original_id:=p_original;
 preparation.previous_state_id:=state.id; preparation.settlement_expected:=false;
 select coalesce(current_allocation_original_id,allocation_original_id) into preparation.current_allocation_original_id
 from app_private.funding_condition_originals where id=state.condition_id;
 preparation.effective_at:=clock_timestamp(); preparation.recorded_at:=preparation.effective_at;
 if activation.id is not null then
  if activation.runtime_version<>2 or state.id is null then preparation.unresolved_reason_code:='FUNDING_EXISTING_RUNTIME_UNSUPPORTED';
  else
   begin
    -- SETTLEMENT stops old mining execution, not the principal credit command.
    -- Its refusal becomes an audited engine exception; finance still commits.
    perform app_private.assert_funding_global_execution_allowed();
    perform app_private.assert_credit_condition_inputs(state.condition_id,preparation.effective_at);
    calculation:=app_private.calculate_credit_boundary_interval(state.id,preparation.effective_at);
    preparation.settlement_expected:=true;
   exception when sqlstate '55000' or sqlstate '42501' then
    get stacked diagnostics message=message_text;
    preparation.unresolved_reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
   end;
  end if;
 end if;
 preparation.audit_id:=gen_random_uuid(); preparation.source_event_id:=gen_random_uuid();
 preparation.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_preparation_snapshot(preparation));
 insert into app_private.funding_credit_boundary_preparations select preparation.*;
 perform app_private.write_credit_boundary_seal(preparation.id,'FUNDING_CREDIT_BOUNDARY_PREPARED',preparation.user_id,
 preparation.input_digest,preparation.audit_id,preparation.source_event_id,app_private.funding_credit_preparation_snapshot(preparation),preparation.effective_at);
 if preparation.settlement_expected then
  earned.id:=gen_random_uuid(); earned.user_id:=preparation.user_id; earned.activation_id:=activation.id; earned.cycle_id:=state.cycle_id;
  earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.settled_from:=state.cursor_at;
  earned.settled_to:=preparation.effective_at; earned.calculation:=calculation; earned.amount_atomic:=(calculation->>'amountAtomic')::bigint;
  earned.runtime_version:=2; earned.condition_id:=state.condition_id; earned.cause_credit_boundary_id:=preparation.id;
  if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
  earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
  earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
  insert into app_private.funding_earned_receipts select earned.*;
  perform app_private.post_credit_boundary_earned(earned.id);
  perform app_private.write_credit_boundary_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,earned.input_digest,
  earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned),preparation.effective_at);
 end if;
 return preparation.id;
end;
$$;

create or replace function app_private.apply_forward_allocation_boundary(p_allocation uuid) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 earned app_private.funding_earned_receipts%rowtype; wallet_id uuid; inputs jsonb; calculation jsonb; caps numeric[]; transition uuid;
begin
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 perform app_private.assert_funding_member_writer(original.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 select id into transition from app_private.funding_condition_originals where allocation_original_id=p_allocation;
 if transition is not null then perform app_private.assert_allocation_boundary_complete(p_allocation,transition); return transition; end if;
 perform app_private.assert_funding_global_execution_allowed();
 select id into wallet_id from public.wallet_accounts where user_id=original.user_id and currency='KRW' and closed_at is null for update;
 select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 select * into state from app_private.funding_engine_state where user_id=original.user_id;
 if wallet_id is null or activation.runtime_version<>2 or state.id is null
  or exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
   on b.id=c.boundary_id where c.user_id=original.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 perform app_private.assert_credit_condition_inputs(condition.id,original.effective_at);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,original.effective_at);
 caps:=app_private.funding_state_effective_capacities(state.id);
 inputs:=app_private.read_verified_credit_funding_inputs(original.user_id,p_allocation,original.effective_at);
 condition.id:=gen_random_uuid(); condition.revision:=condition.revision+1; condition.previous_condition_id:=state.condition_id;
 condition.allocation_original_id:=p_allocation; condition.cause_credit_boundary_id:=null; condition.current_allocation_original_id:=p_allocation;
 condition.effective_at:=original.effective_at; condition.inputs:=inputs; condition.recorded_at:=clock_timestamp();
 condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid();
 condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
 insert into app_private.funding_condition_originals select condition.*;
 perform app_private.write_prospective_funding_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
 condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 earned.id:=gen_random_uuid(); earned.user_id:=original.user_id; earned.activation_id:=activation.id; earned.cycle_id:=state.cycle_id;
 earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.condition_id:=state.condition_id;
 earned.settled_from:=state.cursor_at; earned.settled_to:=original.effective_at; earned.calculation:=calculation;
 earned.amount_atomic:=(calculation->>'amountAtomic')::bigint; earned.runtime_version:=2; earned.cause_allocation_id:=p_allocation;
 if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
 earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
 earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select earned.*;
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(earned.next_state_id,original.user_id,caps[1],caps[2],caps[3],caps[4]);
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
 earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,original.user_id,activation.id,state.cycle_id,state.revision+1,state.id,earned.id,original.effective_at,
 (calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric,(calculation->>'retentionUsedNum')::numeric,
 (calculation->>'retentionUsedDen')::numeric,(calculation->>'carryNum')::numeric,(calculation->>'carryDen')::numeric,condition.id);
 perform app_private.post_prospective_funding_earned(earned.id);
 perform app_private.write_prospective_funding_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,
 earned.input_digest,earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned));
 return condition.id;
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
 if v_input->>'input_contract_version'='2' then
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
 if v_input->>'input_contract_version'='2' then
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

create or replace function app_private.read_forward_funding_runtime_display(p_user uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; condition app_private.funding_condition_originals%rowtype;
 inputs jsonb; calculation jsonb; capacities numeric[]; capacity numeric[]; used numeric[]; remaining numeric[];
 maintenance numeric[]; pending numeric[]; speed numeric[]; committed numeric; runtime_status text; stop_reason text; global_control jsonb;
begin
 select * into activation from app_private.funding_engine_activations where user_id=p_user;
 select * into state from app_private.funding_engine_state where user_id=p_user;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 inputs:=app_private.read_forward_neutral_job_inputs(activation.id,state.id,p_at);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,p_at);
 capacities:=app_private.funding_state_effective_capacities(state.id);
 capacity:=app_private.funding_exact_sum(array[capacities[1],capacities[2]],array[capacities[3],capacities[4]]);
 used:=app_private.funding_exact_sum(array[(calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric],
 array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric]);
 remaining:=app_private.funding_exact_ratio(greatest(0,capacity[1]*used[2]-used[1]*capacity[2]),capacity[2]*used[2]);
 maintenance:=array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric];
 pending:=app_private.funding_exact_sum(array[state.carry_num,state.carry_den],array[(calculation->>'baseNum')::numeric,(calculation->>'baseDen')::numeric]);
 speed:=app_private.funding_exact_ratio((inputs->>'allocation_bps')::numeric,10000);
 global_control:=app_private.funding_global_eligible_interval(p_at,p_at);
 if global_control->>'paused_at_end'='true' then runtime_status:='STOPPED'; stop_reason:='SAFE_MODE';
 elsif (inputs->>'allocation_bps')::integer=0 then runtime_status:='STOPPED'; stop_reason:='NO_ACTIVE_ALLOCATION';
 elsif (calculation->>'baseUsedNum')::numeric*capacities[2]>=capacities[1]*(calculation->>'baseUsedDen')::numeric then
  runtime_status:='STOPPED'; stop_reason:='CAPACITY_USED';
 else runtime_status:='ACTIVE'; end if;
 select coalesce(sum(amount_atomic),0) into committed from app_private.funding_earned_receipts where activation_id=activation.id;
 return jsonb_build_object('available',true,'eligible_principal_micro_krw',((inputs->>'principal_atomic')::numeric*1000000)::text,
 'tier_code',inputs->>'tier_code','tier_activated',true,
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
 'evaluated_at',to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'allocation_bps',inputs->>'allocation_bps','status',runtime_status,'stop_reason',stop_reason,
 'speed',jsonb_build_object('product_multiplier_bps','10000','user_multiplier_bps','10000',
 'common_multiplier',jsonb_build_object('numerator','1','denominator','1'),
 'effective_global_multiplier',jsonb_build_object('numerator',speed[1]::text,'denominator',speed[2]::text)),
 'committed_reward_total_atomic',committed::text,
 'reward_carry',jsonb_build_object('numerator',state.carry_num::text,'denominator',state.carry_den::text,'unit','KRW'),
 'conditional_maintenance',jsonb_build_object('numerator',maintenance[1]::text,'denominator',maintenance[2]::text,'unit','KRW','qualification','UNCONFIRMED')));
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
 if condition.inputs->>'input_contract_version'='2' then
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
