begin;

-- Private/disconnected default engine. This migration deliberately installs no
-- public alias, credit hook, catalog/assignment producer, worker registration or
-- complete_system_job branch. Every monetary input is read from sealed originals.
create function app_private.funding_engine_digest(p_value jsonb) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
  select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex');
$$;

create function app_private.assert_funding_engine_seal(
  p_id uuid,p_kind text,p_user uuid,p_digest text,p_audit uuid,p_event uuid,p_state jsonb
) returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a public.audit_logs%rowtype; v_e public.outbox_events%rowtype;
begin
  select * into v_a from public.audit_logs where id=p_audit;
  select * into v_e from public.outbox_events where id=p_event;
  if v_a.id is null or v_e.id is null or v_a.action is distinct from p_kind
    or v_a.target_type is distinct from 'FUNDING_ENGINE_V1'
    or v_a.target_id is distinct from p_id::text or v_a.after_state is distinct from p_state
    or v_a.metadata->>'input_digest' is distinct from p_digest
    or v_e.event_type is distinct from p_kind||'.v1' or v_e.schema_version<>1
    or v_e.aggregate_type is distinct from 'funding_engine_v1' or v_e.aggregate_id<>p_id
    or v_e.actor_user_id is distinct from p_user or v_e.request_id<>v_a.request_id
    or v_e.payload is distinct from jsonb_build_object('user_id',p_user,'audit_id',p_audit,'input_digest',p_digest)
    or v_e.idempotency_key is distinct from 'funding:'||p_id::text||':seal'
  then raise exception using errcode='55000',message='FUNDING_ENGINE_ORIGINAL_SEAL_MISMATCH'; end if;
end;
$$;

create function app_private.funding_allocation_snapshot(p_allocation app_private.funding_allocation_originals)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('user_id',p_allocation.user_id,'revision',p_allocation.revision,
    'catalog_version_id',p_allocation.catalog_version_id,'products',p_allocation.products,
    'effects',p_allocation.effects,'effective_at_microseconds',((extract(epoch from p_allocation.effective_at)*1000000)::bigint)::text);
$$;

create function app_private.assert_funding_allocation_original(
  p_id uuid,p_user uuid,p_effective timestamptz,p_config jsonb,p_slots integer
) returns integer language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a app_private.funding_allocation_originals%rowtype;
  v_catalog public.product_catalog_versions%rowtype; v_item jsonb; v_total integer:=0;
  v_rule public.product_rule_versions%rowtype; v_bps integer; v_snapshot jsonb;
begin
  select * into v_a from app_private.funding_allocation_originals where id=p_id;
  if v_a.id is null then raise exception using errcode='55000',message='FUNDING_ALLOCATION_ORIGINAL_REQUIRED'; end if;
  if v_a.user_id is distinct from p_user or v_a.effective_at>p_effective or v_a.recorded_at>p_effective or v_a.effects<>'{}'
    or (select count(*) from app_private.funding_allocation_originals where user_id=p_user)<>1
    or jsonb_array_length(v_a.products)>p_slots then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_UNSUPPORTED'; end if;
  v_snapshot:=app_private.funding_allocation_snapshot(v_a);
  if v_a.input_digest is distinct from app_private.funding_engine_digest(v_snapshot) then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_DIGEST_MISMATCH'; end if;
  perform app_private.assert_funding_engine_seal(v_a.id,'FUNDING_ALLOCATION_CONFIRMED',p_user,
    v_a.input_digest,v_a.audit_id,v_a.source_event_id,v_snapshot);
  if not exists(select 1 from public.audit_logs where id=v_a.audit_id and actor_user_id=p_user and created_at<=p_effective)
    or not exists(select 1 from public.outbox_events where id=v_a.source_event_id and occurred_at<=p_effective and created_at<=p_effective) then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_MEMBER_PROOF_REQUIRED'; end if;
  select * into v_catalog from public.product_catalog_versions where id=v_a.catalog_version_id;
  if v_catalog.status is distinct from 'PUBLISHED' or v_catalog.approved_by is null
    or v_catalog.approved_at is null or v_catalog.published_at is null
    or not isfinite(v_catalog.approved_at) or not isfinite(v_catalog.published_at)
    or v_catalog.approved_at>v_catalog.published_at or v_catalog.published_at>v_a.effective_at
    or jsonb_array_length(v_catalog.source_references)=0 then
    raise exception using errcode='55000',message='FUNDING_PUBLISHED_CATALOG_REQUIRED'; end if;
  if (select count(distinct item->>'productId') from jsonb_array_elements(v_a.products) item)
    <>jsonb_array_length(v_a.products) then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_DUPLICATE_PRODUCT'; end if;
  for v_item in select value from jsonb_array_elements(v_a.products) loop
    if jsonb_typeof(v_item)<>'object' or (select count(*) from jsonb_object_keys(v_item))<>3
      or not v_item ?& array['productId','ruleVersionId','allocationBps']
      or jsonb_typeof(v_item->'allocationBps') is distinct from 'string'
      or coalesce(v_item->>'allocationBps','') !~ '^[1-9][0-9]{0,4}$' then
      raise exception using errcode='55000',message='FUNDING_ALLOCATION_PAYLOAD_UNSUPPORTED'; end if;
    v_bps:=(v_item->>'allocationBps')::integer;
    if v_bps>(p_config#>>'{allocation,maximumPerProductBps}')::integer then
      raise exception using errcode='55000',message='FUNDING_ALLOCATION_LIMIT_EXCEEDED'; end if;
    select rule.* into v_rule from public.product_rule_versions rule
    join public.mining_products product on product.id=rule.product_id
    where rule.id=(v_item->>'ruleVersionId')::uuid and product.id=(v_item->>'productId')::uuid
      and product.catalog_version_id=v_catalog.id;
    -- No guessed catalog rule grammar: only an explicitly approved empty/neutral
    -- original is supported. Unknown effects remain closed until their adapter.
    if v_rule.id is null or v_rule.approved_by is null or v_rule.rule_payload<>'{}'
      or not isfinite(v_rule.effective_at) or v_rule.effective_at>v_a.effective_at
      or v_rule.retired_at is not null then
      raise exception using errcode='55000',message='FUNDING_NEUTRAL_PRODUCT_RULE_REQUIRED'; end if;
    if (select count(*) from public.product_rule_versions where product_id=v_rule.product_id)<>1
      or not exists(select 1 from public.product_availability availability
        where availability.product_id=v_rule.product_id and availability.status='AVAILABLE'
          and availability.available_from<=v_a.effective_at and availability.available_to is null)
      or (select count(*) from public.product_availability where product_id=v_rule.product_id)<>1 then
      raise exception using errcode='55000',message='FUNDING_PRODUCT_HISTORY_UNSUPPORTED'; end if;
    v_total:=v_total+v_bps;
  end loop;
  if v_total>(p_config#>>'{allocation,maximumTotalBps}')::integer then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_LIMIT_EXCEEDED'; end if;
  return v_total;
end;
$$;

-- Current complete source coverage is mandatory even for otherwise valid
-- principal. Supported case: exactly one actual forward credit/lot/revision,
-- never reserved/restored/corrected; its age is therefore unambiguous.
create function app_private.read_default_funding_inputs(p_credit uuid,p_allocation uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_move public.money_source_movements%rowtype; v_revision public.funding_principal_revisions%rowtype;
  v_policy jsonb; v_config jsonb; v_tier jsonb; v_bps integer; v_epoch timestamptz; v_now timestamptz;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
  select * into v_move from public.money_source_movements where id=p_credit;
  if v_move.id is null or v_move.source_bucket<>'PRINCIPAL' or v_move.movement_kind<>'CREDIT'
    or v_move.origin_code not in ('KRW_DEPOSIT','USDT_KRW_DEPOSIT') then
    raise exception using errcode='55000',message='FUNDING_FRESH_PRINCIPAL_REQUIRED'; end if;
  perform app_private.assert_money_source_credit(v_move);
  select introduced_at into v_epoch from app_private.funding_engine_epochs where version=1;
  v_now:=clock_timestamp();
  if v_move.effective_at<v_epoch or v_move.effective_at>v_now or not isfinite(v_move.effective_at)
    or (select coverage from public.money_source_summaries where user_id=v_move.user_id) is distinct from 'COMPLETE' then
    raise exception using errcode='55000',message='FUNDING_SOURCE_HISTORY_UNSUPPORTED'; end if;
  if (select count(*) from public.funding_principal_lots where user_id=v_move.user_id)<>1
    or (select count(*) from public.funding_principal_revisions where user_id=v_move.user_id)<>1
    or (select count(*) from public.money_source_movements where user_id=v_move.user_id and source_bucket='PRINCIPAL')<>1
    or exists(select 1 from public.funding_principal_recovery_allocations where user_id=v_move.user_id)
    or exists(select 1 from public.funding_principal_recovery_releases where user_id=v_move.user_id)
    or exists(select 1 from app_private.funding_cycle_segments where user_id=v_move.user_id) then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CHANGES_UNSUPPORTED'; end if;
  select * into v_revision from public.funding_principal_revisions where money_source_movement_id=p_credit;
  if v_revision.user_id is distinct from v_move.user_id or v_revision.direction is distinct from 'INCREASE'
    or v_revision.effective_at is distinct from v_move.effective_at
    or v_revision.ledger_transaction_id is distinct from v_move.ledger_transaction_id
    or v_revision.source_event_id is distinct from v_move.source_event_id
    or v_revision.delta_micro_krw is distinct from app_private.funding_principal_micro_krw(v_move.amount_atomic)
    or v_revision.eligible_principal_micro_krw_after is distinct from v_revision.delta_micro_krw
    or app_private.funding_principal_mining_eligible_micro(v_move.user_id,v_now) is distinct from v_revision.delta_micro_krw then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
  v_policy:=public.read_effective_economy_policy((extract(epoch from v_move.effective_at)*1000000)::bigint)->'policy';
  v_config:=v_policy->'configuration';
  if (v_config->>'minimumPrincipalKrw')::bigint>v_move.amount_atomic
    or v_config#>>'{platformFeesKrw,mining}' is distinct from '0'
    or v_config#>>'{productMultiplier,defaultBps}' is distinct from '10000'
    or v_config#>>'{userOverride,defaultMultiplierBps}' is distinct from '10000'
    or v_config#>>'{campaign,defaultSpeedMultiplierBps}' is distinct from '10000'
    or v_config#>>'{campaign,defaultCapacityBoostBps}' is distinct from '0'
    or v_config#>>'{allocation,capacityScope}' is distinct from 'GLOBAL_CYCLE' then
    raise exception using errcode='55000',message='FUNDING_DEFAULT_POLICY_REQUIRED'; end if;
  select tier into v_tier from jsonb_array_elements(v_config->'tiers') tier
  where (tier->>'minimumPrincipalKrw')::bigint<=v_move.amount_atomic
    and (tier->>'maximumPrincipalKrw' is null or (tier->>'maximumPrincipalKrw')::bigint>=v_move.amount_atomic);
  if v_tier is null then raise exception using errcode='55000',message='FUNDING_TIER_UNRESOLVED'; end if;
  v_bps:=app_private.assert_funding_allocation_original(p_allocation,v_move.user_id,v_move.effective_at,v_config,(v_tier->>'slots')::integer);
  -- Bounded first runtime: an original must explicitly confirm full aggregate
  -- allocation. Do not infer maintenance qualification for absent/partial
  -- allocation or invent an assignment merely to open the earning path.
  if v_bps<>10000 then raise exception using errcode='55000',message='FUNDING_FULL_ALLOCATION_REQUIRED'; end if;
  -- Shared component locks match the existing operator publisher's exclusive
  -- boundary. No catch-up across an unconsumed safe-mode or ACCOUNT boundary.
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
  if exists(select 1 from public.safe_mode_controls where component in ('GLOBAL','NEW_MINING','SETTLEMENT')
      and (is_paused or starts_at>=v_move.effective_at))
    or exists(select 1 from public.audit_logs where target_type='SAFE_MODE' and target_id in ('GLOBAL','NEW_MINING','SETTLEMENT')
      and (after_state->>'starts_at')::timestamptz>=v_move.effective_at)
    or exists(select 1 from public.block_rules where user_id=v_move.user_id and scope='ACCOUNT'
      and (ends_at is null or ends_at>v_move.effective_at)) then
    raise exception using errcode='55000',message='FUNDING_ELIGIBILITY_HISTORY_UNSUPPORTED'; end if;
  return jsonb_build_object('user_id',v_move.user_id,'credit_id',v_move.id,'principal_revision_id',v_revision.id,
    'principal_atomic',v_move.amount_atomic::text,'effective_at_microseconds',((extract(epoch from v_move.effective_at)*1000000)::bigint)::text,
    'allocation_id',p_allocation,'allocation_digest',(select input_digest from app_private.funding_allocation_originals where id=p_allocation),
    'allocation_bps',v_bps,'policy_publication_id',v_policy->>'publicationId','policy_config_digest',v_policy->>'configDigest',
    'cycle_days',(v_config->>'cycleDays')::integer,'base_bps',(v_config->>'baseCycleRateBps')::integer,
    'retention_bps',(v_tier->>'retentionBonusBps')::integer);
end;
$$;

create function app_private.funding_activation_snapshot(p_a app_private.funding_engine_activations)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_a.user_id,'credit_id',p_a.trigger_credit_movement_id,
   'principal_revision_id',p_a.trigger_principal_revision_id,'allocation_id',p_a.allocation_original_id,
   'policy_publication_id',p_a.policy_publication_id,'cycle_id',p_a.first_cycle_id,
   'principal_atomic',p_a.principal_atomic::text,'effective_at_microseconds',((extract(epoch from p_a.effective_at)*1000000)::bigint)::text,
   'input_digest',p_a.input_digest);
$$;

create function app_private.guard_funding_activation() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_input jsonb; v_cycle app_private.funding_cycle_windows%rowtype;
begin
  v_input:=app_private.read_default_funding_inputs(new.trigger_credit_movement_id,new.allocation_original_id);
  select * into v_cycle from app_private.funding_cycle_windows where id=new.first_cycle_id;
  if new.user_id::text is distinct from v_input->>'user_id'
    or new.trigger_principal_revision_id::text is distinct from v_input->>'principal_revision_id'
    or new.policy_publication_id::text is distinct from v_input->>'policy_publication_id'
    or new.principal_atomic::text is distinct from v_input->>'principal_atomic'
    or ((extract(epoch from new.effective_at)*1000000)::bigint)::text is distinct from v_input->>'effective_at_microseconds'
    or new.input_digest is distinct from app_private.funding_engine_digest(v_input)
    or v_cycle.user_id is distinct from new.user_id or v_cycle.cycle_ordinal is distinct from 0
    or v_cycle.cycle_started_at is distinct from new.effective_at
    or v_cycle.cycle_days is distinct from (v_input->>'cycle_days')::integer then
    raise exception using errcode='55000',message='FUNDING_ACTIVATION_ORIGINAL_MISMATCH'; end if;
  return new;
end;
$$;
create trigger funding_activation_validate before insert on app_private.funding_engine_activations
for each row execute function app_private.guard_funding_activation();

create function app_private.guard_funding_state_receipt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a app_private.funding_engine_activations%rowtype; v_previous app_private.funding_engine_state_receipts%rowtype;
  v_earned app_private.funding_earned_receipts%rowtype; v_cycle app_private.funding_cycle_windows%rowtype;
begin
  select * into v_a from app_private.funding_engine_activations where id=new.activation_id;
  select * into v_cycle from app_private.funding_cycle_windows where id=new.cycle_id;
  if new.user_id is distinct from v_a.user_id or new.cycle_id is distinct from v_a.first_cycle_id
    or new.cursor_at<v_cycle.cycle_started_at or new.cursor_at>v_cycle.cycle_end
    or new.cycle_closed is distinct from (new.cursor_at=v_cycle.cycle_end)
    or app_private.funding_exact_ratio(new.base_used_num,new.base_used_den) is distinct from array[new.base_used_num,new.base_used_den]
    or app_private.funding_exact_ratio(new.retention_used_num,new.retention_used_den) is distinct from array[new.retention_used_num,new.retention_used_den]
    or app_private.funding_exact_ratio(new.carry_num,new.carry_den) is distinct from array[new.carry_num,new.carry_den] then
    raise exception using errcode='55000',message='FUNDING_STATE_ORIGINAL_MISMATCH'; end if;
  if new.revision=0 then
    if new.cursor_at<>v_a.effective_at or new.base_used_num<>0 or new.base_used_den<>1
      or new.retention_used_num<>0 or new.retention_used_den<>1 or new.carry_num<>0 or new.carry_den<>1 then
      raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
  else
    select * into v_previous from app_private.funding_engine_state_receipts where id=new.previous_state_id;
    select * into v_earned from app_private.funding_earned_receipts where id=new.earned_receipt_id;
    if v_previous.user_id is distinct from new.user_id or v_previous.activation_id is distinct from new.activation_id
      or new.revision is distinct from v_previous.revision+1 or v_previous.cycle_closed
      or v_earned.next_state_id is distinct from new.id or v_earned.previous_state_id is distinct from v_previous.id
      or new.cursor_at is distinct from v_earned.settled_to
      or new.base_used_num::text is distinct from v_earned.calculation->>'baseUsedNum'
      or new.base_used_den::text is distinct from v_earned.calculation->>'baseUsedDen'
      or new.retention_used_num::text is distinct from v_earned.calculation->>'retentionUsedNum'
      or new.retention_used_den::text is distinct from v_earned.calculation->>'retentionUsedDen'
      or new.carry_num::text is distinct from v_earned.calculation->>'carryNum'
      or new.carry_den::text is distinct from v_earned.calculation->>'carryDen' then
      raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
  end if;
  return new;
end;
$$;
create trigger funding_state_validate before insert on app_private.funding_engine_state_receipts
for each row execute function app_private.guard_funding_state_receipt();

create function app_private.funding_job_snapshot(p_j app_private.funding_engine_jobs)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_j.user_id,'activation_id',p_j.activation_id,'expected_state_id',p_j.expected_state_id);
$$;
create function app_private.guard_funding_job() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_job public.system_jobs%rowtype; v_state app_private.funding_engine_state_receipts%rowtype; v_payload jsonb;
begin
 select * into v_job from public.system_jobs where id=new.job_id;
 select * into v_state from app_private.funding_engine_state_receipts where id=new.expected_state_id;
 v_payload:=app_private.funding_job_snapshot(new);
 if v_state.user_id is distinct from new.user_id or v_state.activation_id is distinct from new.activation_id
   or v_state.cycle_closed or v_state.id is distinct from (select id from app_private.funding_engine_state where user_id=new.user_id)
   or v_job.job_type is distinct from 'FUNDING_MINING_TICK_V1' or v_job.payload_version<>1
   or v_job.payload is distinct from v_payload or v_job.idempotency_key is distinct from 'funding:state:'||v_state.id::text
   or new.input_digest is distinct from app_private.funding_engine_digest(v_payload) then
   raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_MISMATCH'; end if;
 return new;
end;
$$;
create trigger funding_job_validate before insert on app_private.funding_engine_jobs
for each row execute function app_private.guard_funding_job();

create function app_private.assert_funding_job_fence(p_job uuid,p_worker text,p_attempt integer)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if not exists(select 1 from public.system_jobs job join public.system_job_attempts attempt
     on attempt.job_id=job.id and attempt.attempt_number=job.attempts
   where job.id=p_job and job.status='RUNNING' and job.lease_owner=p_worker and job.attempts=p_attempt
     and job.lease_expires_at>clock_timestamp() and attempt.worker_id=p_worker and attempt.status='RUNNING') then
   raise exception using errcode='55000',message='FUNDING_JOB_FENCE_NOT_OWNED'; end if;
end;
$$;

create function app_private.funding_earned_snapshot(p_e app_private.funding_earned_receipts)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_e.user_id,'activation_id',p_e.activation_id,'cycle_id',p_e.cycle_id,
  'job_id',p_e.job_id,'attempt_number',p_e.attempt_number,'worker_id',p_e.worker_id,
  'fence_expires_at_microseconds',((extract(epoch from p_e.fence_expires_at)*1000000)::bigint)::text,
  'previous_state_id',p_e.previous_state_id,'next_state_id',p_e.next_state_id,
  'settled_from_microseconds',((extract(epoch from p_e.settled_from)*1000000)::bigint)::text,
  'settled_to_microseconds',((extract(epoch from p_e.settled_to)*1000000)::bigint)::text,'calculation',p_e.calculation,
  'credit_id',p_e.credit_id,'settlement_id',p_e.settlement_id);
$$;
create function app_private.guard_funding_earned_receipt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a app_private.funding_engine_activations%rowtype; v_state app_private.funding_engine_state_receipts%rowtype;
 v_j app_private.funding_engine_jobs%rowtype; v_cycle app_private.funding_cycle_windows%rowtype;
 v_input jsonb; v_calculation jsonb; v_until timestamptz;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 select * into v_a from app_private.funding_engine_activations where id=new.activation_id;
 select * into v_j from app_private.funding_engine_jobs where job_id=new.job_id;
 select * into v_state from app_private.funding_engine_state_receipts where id=new.previous_state_id;
 select * into v_cycle from app_private.funding_cycle_windows where id=new.cycle_id;
 perform app_private.assert_funding_job_fence(new.job_id,new.worker_id,new.attempt_number);
 v_input:=app_private.read_default_funding_inputs(v_a.trigger_credit_movement_id,v_a.allocation_original_id);
 select effective_until into v_until from app_private.economy_policy_published where publication_id=v_a.policy_publication_id;
 if v_a.user_id is distinct from new.user_id or v_j.user_id is distinct from new.user_id
   or v_j.activation_id is distinct from new.activation_id or v_j.expected_state_id is distinct from new.previous_state_id
   or v_state.id is distinct from (select id from app_private.funding_engine_state where user_id=new.user_id)
   or v_state.activation_id is distinct from v_a.id or v_state.cycle_closed
   or new.fence_expires_at is distinct from (select lease_expires_at from public.system_jobs where id=new.job_id)
   or new.cycle_id is distinct from v_a.first_cycle_id or new.settled_from is distinct from v_state.cursor_at
   or new.settled_to>clock_timestamp() or new.settled_to>v_cycle.cycle_end
   or (v_until is not null and new.settled_to>v_until)
   or v_a.input_digest is distinct from app_private.funding_engine_digest(v_input) then
   raise exception using errcode='55000',message='FUNDING_EARNED_INPUT_MISMATCH'; end if;
 v_calculation:=app_private.funding_exact_default_interval(v_a.principal_atomic,
   (v_input->>'base_bps')::integer,(v_input->>'retention_bps')::integer,(v_input->>'allocation_bps')::integer,
   (extract(epoch from v_cycle.cycle_end-v_cycle.cycle_started_at)*1000000)::bigint,
   (extract(epoch from new.settled_to-new.settled_from)*1000000)::bigint,
   v_state.base_used_num,v_state.base_used_den,v_state.retention_used_num,v_state.retention_used_den,
   v_state.carry_num,v_state.carry_den,new.settled_to=v_cycle.cycle_end);
 if new.calculation is distinct from v_calculation or new.amount_atomic::text is distinct from v_calculation->>'amountAtomic'
   or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(new)) then
   raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
 return new;
end;
$$;
create trigger funding_earned_validate before insert on app_private.funding_earned_receipts
for each row execute function app_private.guard_funding_earned_receipt();

-- Explicit canonical reporting branch: no fabricated legacy world/session.
alter table public.mining_reward_credits add column funding_earned_receipt_id uuid unique
 references app_private.funding_earned_receipts(id);
alter table public.mining_settlements alter column mining_session_id drop not null;
alter table public.mining_settlements add column funding_earned_receipt_id uuid unique references app_private.funding_earned_receipts(id),
 add constraint mining_settlement_authority_branch check((mining_session_id is not null)<>(funding_earned_receipt_id is not null));
alter table public.mining_settlement_segments alter column rule_version_id drop not null;
alter table public.mining_settlement_segments add column funding_earned_receipt_id uuid unique references app_private.funding_earned_receipts(id),
 add constraint mining_segment_authority_branch check((rule_version_id is not null)<>(funding_earned_receipt_id is not null));
alter table app_private.funding_earned_receipts add constraint funding_earned_credit_fk foreign key(credit_id)
 references public.mining_reward_credits(id) deferrable initially deferred,
 add constraint funding_earned_settlement_fk foreign key(settlement_id)
 references public.mining_settlements(id) deferrable initially deferred;

create function app_private.guard_funded_canonical_insert() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_e app_private.funding_earned_receipts%rowtype; v_settlement public.mining_settlements%rowtype;
begin
 if new.funding_earned_receipt_id is null then
   if current_user='service_role' then raise exception using errcode='42501',message='FUNDING_EARNED_ORIGINAL_REQUIRED'; end if;
   return new; -- Preserve immutable owner-only legacy fixtures/history.
 end if;
 select * into v_e from app_private.funding_earned_receipts where id=new.funding_earned_receipt_id;
 if v_e.id is null or new.user_id is distinct from v_e.user_id or new.amount_atomic is distinct from v_e.amount_atomic or v_e.amount_atomic<=0 then
   raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 if tg_table_name='mining_reward_credits' then
   if new.id is distinct from v_e.credit_id or new.effective_at is distinct from v_e.settled_to then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 elsif tg_table_name='mining_settlements' then
   if new.id is distinct from v_e.settlement_id or new.settled_from is distinct from v_e.settled_from
     or new.settled_to is distinct from v_e.settled_to or new.currency<>'KRW' or new.segment_count<>1
     or new.idempotency_key is distinct from 'funding:job:'||v_e.job_id::text||':settlement' then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 else
   select * into v_settlement from public.mining_settlements where id=new.mining_settlement_id;
   if v_settlement.funding_earned_receipt_id is distinct from v_e.id or new.sequence<>0
     or new.settled_from is distinct from v_e.settled_from or new.settled_to is distinct from v_e.settled_to
     or new.equipment_efficiency_bps<>10000 or new.world_multiplier_bps<>10000
     or new.event_multiplier_bps<>10000 or new.status_multiplier_bps<>10000 then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 end if;
 return new;
end;
$$;
create trigger mining_credit_funded_original before insert on public.mining_reward_credits
for each row execute function app_private.guard_funded_canonical_insert();
create trigger mining_settlement_funded_original before insert on public.mining_settlements
for each row execute function app_private.guard_funded_canonical_insert();
create trigger mining_segment_funded_original before insert on public.mining_settlement_segments
for each row execute function app_private.guard_funded_canonical_insert();

create function app_private.verify_funding_engine_fact_complete() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_snapshot jsonb; v_kind text; v_user uuid; v_id uuid; v_digest text; v_audit uuid; v_event uuid;
 v_e app_private.funding_earned_receipts%rowtype; v_move public.money_source_movements%rowtype;
begin
 if tg_table_name='funding_engine_activations' then
   v_id:=new.id;
   v_snapshot:=app_private.funding_activation_snapshot(new); v_kind:='FUNDING_ACTIVATED';
   if not exists(select 1 from app_private.funding_engine_state_receipts where activation_id=new.id and revision=0) then
     raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
 elsif tg_table_name='funding_engine_jobs' then
   v_id:=new.job_id;
   v_snapshot:=app_private.funding_job_snapshot(new); v_kind:='FUNDING_JOB_PREPARED';
 else
   v_id:=new.id;
   v_e:=new; v_snapshot:=app_private.funding_earned_snapshot(v_e); v_kind:='FUNDING_EARNED_ACCEPTED';
   if not exists(select 1 from public.system_jobs job join public.system_job_attempts attempt
       on attempt.job_id=job.id and attempt.attempt_number=job.attempts
     where job.id=v_e.job_id and job.status='SUCCEEDED' and job.attempts=v_e.attempt_number
       and attempt.worker_id=v_e.worker_id and attempt.status='SUCCEEDED'
       and job.completed_at=attempt.completed_at and job.completed_at>=v_e.recorded_at
       and job.completed_at<v_e.fence_expires_at and job.completed_at<=clock_timestamp()) then
     raise exception using errcode='55000',message='FUNDING_ACCEPTED_JOB_COMPLETION_MISSING'; end if;
   if not exists(select 1 from app_private.funding_engine_state_receipts where id=v_e.next_state_id
       and earned_receipt_id=v_e.id and user_id=v_e.user_id) then
     raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
   if v_e.amount_atomic>0 then
     select movement.* into v_move from public.money_source_movements movement
     join public.mining_reward_credits credit on credit.ledger_transaction_id=movement.ledger_transaction_id
     where credit.id=v_e.credit_id and credit.funding_earned_receipt_id=v_e.id;
     if v_move.user_id is distinct from v_e.user_id or v_move.amount_atomic is distinct from v_e.amount_atomic
       or v_move.source_bucket is distinct from 'MINING_REWARD' or v_move.movement_kind is distinct from 'CREDIT'
       or v_move.effective_at is distinct from v_e.settled_to
       or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=v_e.id) then
       raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
     perform app_private.assert_money_source_credit(v_move);
   end if;
   if (v_e.calculation->>'qualifiedRetentionNum')::numeric>0
     and not exists(select 1 from app_private.funding_retention_qualifications where earned_receipt_id=v_e.id) then
     raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 end if;
 v_user:=new.user_id; v_digest:=new.input_digest; v_audit:=new.audit_id; v_event:=new.source_event_id;
 perform app_private.assert_funding_engine_seal(v_id,v_kind,v_user,v_digest,v_audit,v_event,v_snapshot);
 return null;
end;
$$;
create constraint trigger funding_activation_complete after insert on app_private.funding_engine_activations
 deferrable initially deferred for each row execute function app_private.verify_funding_engine_fact_complete();
create constraint trigger funding_job_complete after insert on app_private.funding_engine_jobs
 deferrable initially deferred for each row execute function app_private.verify_funding_engine_fact_complete();
create constraint trigger funding_earned_complete after insert on app_private.funding_earned_receipts
 deferrable initially deferred for each row execute function app_private.verify_funding_engine_fact_complete();

create function app_private.guard_funding_retention_qualification() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_e app_private.funding_earned_receipts%rowtype; v_a app_private.funding_engine_activations%rowtype;
 v_cycle app_private.funding_cycle_windows%rowtype;
begin
 select * into v_e from app_private.funding_earned_receipts where id=new.earned_receipt_id;
 select * into v_a from app_private.funding_engine_activations where id=v_e.activation_id;
 select * into v_cycle from app_private.funding_cycle_windows where id=v_e.cycle_id;
 if new.user_id is distinct from v_e.user_id or new.cycle_id is distinct from v_e.cycle_id
   or new.qualified_at is distinct from v_cycle.cycle_end or v_e.settled_to is distinct from v_cycle.cycle_end
   or new.qualified_num::text is distinct from v_e.calculation->>'qualifiedRetentionNum'
   or new.qualified_den::text is distinct from v_e.calculation->>'qualifiedRetentionDen'
   or new.principal_input_digest is distinct from v_a.input_digest then
   raise exception using errcode='55000',message='FUNDING_RETENTION_ORIGINAL_MISMATCH'; end if;
 return new;
end;
$$;
create trigger funding_retention_validate before insert on app_private.funding_retention_qualifications
for each row execute function app_private.guard_funding_retention_qualification();

-- Immutable originals retain their identity/payload while ordinary worker
-- status, lease, availability and attempt columns remain operational metadata.
create function app_private.guard_funding_engine_operational_original() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_bound boolean; v_mutable text[];
begin
 if tg_table_name='system_jobs' then
   v_bound:=exists(select 1 from app_private.funding_engine_jobs where job_id=old.id);
   if tg_op='UPDATE' and old.status='SUCCEEDED'
     and exists(select 1 from app_private.funding_earned_receipts where job_id=old.id)
     and (new.status is distinct from old.status or new.attempts is distinct from old.attempts
       or new.completed_at is distinct from old.completed_at or new.started_at is distinct from old.started_at) then
     raise exception using errcode='55000',message='FUNDING_ACCEPTED_COMPLETION_IMMUTABLE'; end if;
   v_mutable:=array['status','attempts','available_at','started_at','completed_at','last_error_code',
     'updated_at','lease_owner','lease_expires_at','dead_lettered_at'];
 else
   v_bound:=exists(select 1 from app_private.funding_allocation_originals where source_event_id=old.id)
     or exists(select 1 from app_private.funding_engine_activations where source_event_id=old.id)
     or exists(select 1 from app_private.funding_engine_jobs where source_event_id=old.id)
     or exists(select 1 from app_private.funding_earned_receipts where source_event_id=old.id)
     or exists(select 1 from public.mining_reward_credits where source_event_id=old.id and funding_earned_receipt_id is not null);
   v_mutable:=array['status','available_at','attempt_count','lease_owner','lease_expires_at',
     'processed_at','last_error_code','updated_at'];
 end if;
 if v_bound and (tg_op='DELETE' or to_jsonb(new)-v_mutable is distinct from to_jsonb(old)-v_mutable) then
   raise exception using errcode='55000',message='FUNDING_OPERATIONAL_ORIGINAL_IMMUTABLE'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_job_original_immutable before update or delete on public.system_jobs
for each row execute function app_private.guard_funding_engine_operational_original();
create trigger funding_outbox_original_immutable before update or delete on public.outbox_events
for each row execute function app_private.guard_funding_engine_operational_original();
create function app_private.guard_funding_accepted_attempt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if old.status='SUCCEEDED' and exists(select 1 from app_private.funding_earned_receipts
   where job_id=old.job_id and attempt_number=old.attempt_number)
   and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_COMPLETION_IMMUTABLE'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_accepted_attempt_immutable before update or delete on public.system_job_attempts
for each row execute function app_private.guard_funding_accepted_attempt();

-- Invoker read/append privileges only. Legacy monetary writer stays revoked.
grant select on public.product_catalog_versions,public.mining_products,public.product_rule_versions,public.product_availability,
 public.mining_settlements,public.mining_settlement_segments to service_role;
grant insert on public.mining_reward_credits,public.mining_settlements,public.mining_settlement_segments to service_role;
do $private_functions$
declare v_function record;
begin
 for v_function in select oid::regprocedure identity from pg_proc
   where pronamespace='app_private'::regnamespace and proname in (
    'funding_engine_digest','assert_funding_engine_seal','funding_allocation_snapshot','assert_funding_allocation_original',
    'read_default_funding_inputs','funding_activation_snapshot','guard_funding_activation','guard_funding_state_receipt',
    'funding_job_snapshot','guard_funding_job','assert_funding_job_fence','funding_earned_snapshot',
    'guard_funding_earned_receipt','guard_funded_canonical_insert','verify_funding_engine_fact_complete','guard_funding_retention_qualification',
    'guard_funding_engine_operational_original','guard_funding_accepted_attempt') loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.identity);
   execute format('grant execute on function %s to service_role',v_function.identity);
 end loop;
end;
$private_functions$;
commit;
