begin;

-- Capacity와 Speed 계산만 한다.
-- 기준은 남은 Eligible Principal의 entitlement 조회와 저장된 cycle 창이다.
-- lifetime deposit으로 다시 합산하지 않는다.
-- base와 retention은 분리한다. retention은 확정 잔액이 아니다.
-- speed는 속도만 바꾼다. capacity가 이미 소진이면 speed만으로 재개하지 않는다.
-- capacity boost나 추가 원금으로 새 effective capacity가 used보다 크면
-- 그 차이만 재개 가능 금액으로 남긴다. cycle 시작과 끝은 바꾸지 않는다.
-- 캠페인 한도는 인자다. 발행 policy가 있으면 조회 함수가 그 row를 읽어 넘긴다.
-- 원장 credit, producer, settlement, 부분 원금 회수 배분은 만들지 않는다.

create function app_private.funding_capacity_speed_scale_micro(
  p_delta_micro bigint,
  p_numerator bigint,
  p_denominator bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_negative boolean;
  v_abs bigint;
  v_quotient numeric;
begin
  if p_delta_micro is null
    or p_numerator is null or p_numerator < 0
    or p_denominator is null or p_denominator <= 0
    or p_numerator > p_denominator then
    raise exception using errcode = '22023', message = 'CAPACITY_SPAN_INVALID';
  end if;
  if p_delta_micro = 0 or p_numerator = 0 then
    return 0;
  end if;
  if p_numerator = p_denominator then
    return p_delta_micro;
  end if;
  -- bigint 최솟값의 부호 반전은 넘친다.
  if p_delta_micro = -9223372036854775808 then
    raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
  end if;
  v_negative := p_delta_micro < 0;
  v_abs := case when v_negative then -p_delta_micro else p_delta_micro end;
  -- numeric는 이진 부동소수가 아니다. 기간 비율의 정수 몫만 남긴다.
  v_quotient := div(v_abs::numeric * p_numerator::numeric, p_denominator::numeric);
  if v_quotient is null or v_quotient <> trunc(v_quotient)
    or v_quotient < 0 or v_quotient > 9223372036854775807::numeric then
    raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
  end if;
  if v_negative then
    return (-v_quotient)::bigint;
  end if;
  return v_quotient::bigint;
end;
$$;

create function app_private.funding_capacity_speed_boost_bps(
  p_boosts_bps bigint[],
  p_single_limit_bps bigint,
  p_combined_limit_bps bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_boost bigint;
  v_sum bigint := 0;
begin
  if p_boosts_bps is null
    or p_single_limit_bps is null or p_combined_limit_bps is null
    or p_single_limit_bps < 0 or p_combined_limit_bps < 0
    or p_single_limit_bps > p_combined_limit_bps then
    raise exception using errcode = '22023', message = 'CAPACITY_POLICY_LIMIT_INVALID';
  end if;
  foreach v_boost in array p_boosts_bps loop
    if v_boost is null or v_boost < 0 or v_boost > p_single_limit_bps then
      raise exception using errcode = '22023', message = 'CAPACITY_CAMPAIGN_LIMIT';
    end if;
    if v_sum > 9223372036854775807 - v_boost then
      raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
    end if;
    v_sum := v_sum + v_boost;
  end loop;
  if v_sum > p_combined_limit_bps then
    raise exception using errcode = '22023', message = 'CAPACITY_CAMPAIGN_LIMIT';
  end if;
  return v_sum;
end;
$$;

-- 속도 배수를 서로 곱하지 않는다. 기준에서 늘어난 값만 더하고, 최종 상한은 인자다.
create function app_private.funding_capacity_speed_multiplier_bps(
  p_multipliers_bps bigint[],
  p_identity_bps bigint,
  p_single_limit_bps bigint,
  p_combined_limit_bps bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_speed bigint;
  v_extra bigint;
  v_extra_sum bigint := 0;
  v_final bigint;
begin
  if p_multipliers_bps is null
    or p_identity_bps is null or p_identity_bps <= 0
    or p_single_limit_bps is null or p_combined_limit_bps is null
    or p_identity_bps > p_single_limit_bps
    or p_single_limit_bps > p_combined_limit_bps then
    raise exception using errcode = '22023', message = 'CAPACITY_POLICY_LIMIT_INVALID';
  end if;
  foreach v_speed in array p_multipliers_bps loop
    if v_speed is null
      or v_speed < p_identity_bps
      or v_speed > p_single_limit_bps then
      raise exception using errcode = '22023', message = 'CAPACITY_SPEED_LIMIT';
    end if;
    v_extra := v_speed - p_identity_bps;
    if v_extra_sum > 9223372036854775807 - v_extra then
      raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
    end if;
    v_extra_sum := v_extra_sum + v_extra;
  end loop;
  if p_identity_bps > 9223372036854775807 - v_extra_sum then
    raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
  end if;
  v_final := p_identity_bps + v_extra_sum;
  if v_final > p_combined_limit_bps then
    raise exception using errcode = '22023', message = 'CAPACITY_SPEED_LIMIT';
  end if;
  return v_final;
end;
$$;

-- boost bps는 base rate와 같은 방식으로 남은 원금에만 더한다. retention에는 더하지 않는다.
create function app_private.funding_capacity_speed_boosted_base(
  p_principal_micro bigint,
  p_base_micro bigint,
  p_boosts_bps bigint[],
  p_single_limit_bps bigint,
  p_combined_limit_bps bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_boost_bps bigint;
  v_boost_micro bigint;
begin
  if p_principal_micro is null or p_principal_micro < 0
    or p_base_micro is null or p_base_micro < 0 then
    raise exception using errcode = '22023', message = 'CAPACITY_AMOUNT_INVALID';
  end if;
  v_boost_bps := app_private.funding_capacity_speed_boost_bps(
    p_boosts_bps, p_single_limit_bps, p_combined_limit_bps);
  if v_boost_bps = 0 then
    return p_base_micro;
  end if;
  v_boost_micro := app_private.funding_entitlement_portion_micro(
    p_principal_micro, v_boost_bps);
  if p_base_micro > 9223372036854775807 - v_boost_micro then
    raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
  end if;
  return p_base_micro + v_boost_micro;
end;
$$;

create function app_private.funding_capacity_speed_compute(
  p_principal_micro bigint,
  p_base_entitlement_micro bigint,
  p_retention_entitlement_micro bigint,
  p_prior_principal_micro bigint,
  p_prior_base_entitlement_micro bigint,
  p_prior_retention_full_micro bigint,
  p_prior_retention_cycle_micro bigint,
  p_prior_effective_capacity_micro bigint,
  p_used_capacity_micro bigint,
  p_capacity_boosts_bps bigint[],
  p_prior_capacity_boosts_bps bigint[],
  p_speed_multipliers_bps bigint[],
  p_remaining_span_microseconds bigint,
  p_cycle_span_microseconds bigint,
  p_single_capacity_limit_bps bigint,
  p_combined_capacity_limit_bps bigint,
  p_speed_identity_bps bigint,
  p_single_speed_limit_bps bigint,
  p_combined_speed_limit_bps bigint
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_initial boolean;
  v_new_full bigint;
  v_old_full bigint;
  v_delta bigint;
  v_effective bigint;
  v_retention_delta bigint;
  v_retention_cycle bigint;
  v_remaining bigint;
  v_speed bigint;
  v_boost_bps bigint;
  v_state text;
  v_reactivated boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'CAPACITY_SERVICE_ROLE_REQUIRED';
  end if;
  if p_used_capacity_micro is null or p_used_capacity_micro < 0
    or p_remaining_span_microseconds is null
    or p_cycle_span_microseconds is null
    or p_cycle_span_microseconds <= 0
    or p_remaining_span_microseconds < 0
    or p_remaining_span_microseconds > p_cycle_span_microseconds
    or p_retention_entitlement_micro is null
    or p_retention_entitlement_micro < 0 then
    raise exception using errcode = '22023', message = 'CAPACITY_AMOUNT_INVALID';
  end if;
  v_initial := p_prior_principal_micro is null
    and p_prior_base_entitlement_micro is null
    and p_prior_retention_full_micro is null
    and p_prior_retention_cycle_micro is null
    and p_prior_effective_capacity_micro is null;
  if v_initial then
    if p_remaining_span_microseconds is distinct from p_cycle_span_microseconds then
      raise exception using errcode = '22023', message = 'CAPACITY_PRIOR_REQUIRED';
    end if;
    if p_prior_capacity_boosts_bps is not null
      and cardinality(p_prior_capacity_boosts_bps) <> 0 then
      raise exception using errcode = '22023', message = 'CAPACITY_PRIOR_MISMATCH';
    end if;
  elsif p_prior_principal_micro is null
    or p_prior_base_entitlement_micro is null
    or p_prior_retention_full_micro is null
    or p_prior_retention_cycle_micro is null
    or p_prior_effective_capacity_micro is null
    or p_prior_capacity_boosts_bps is null
    or p_prior_principal_micro < 0
    or p_prior_base_entitlement_micro < 0
    or p_prior_retention_full_micro < 0
    or p_prior_retention_cycle_micro < 0
    or p_prior_effective_capacity_micro < 0 then
    raise exception using errcode = '22023', message = 'CAPACITY_PRIOR_MISMATCH';
  end if;

  v_speed := app_private.funding_capacity_speed_multiplier_bps(
    p_speed_multipliers_bps,
    p_speed_identity_bps,
    p_single_speed_limit_bps,
    p_combined_speed_limit_bps);
  v_new_full := app_private.funding_capacity_speed_boosted_base(
    p_principal_micro,
    p_base_entitlement_micro,
    p_capacity_boosts_bps,
    p_single_capacity_limit_bps,
    p_combined_capacity_limit_bps);
  v_boost_bps := app_private.funding_capacity_speed_boost_bps(
    p_capacity_boosts_bps,
    p_single_capacity_limit_bps,
    p_combined_capacity_limit_bps);

  if v_initial then
    v_effective := v_new_full;
    v_retention_cycle := p_retention_entitlement_micro;
  else
    v_old_full := app_private.funding_capacity_speed_boosted_base(
      p_prior_principal_micro,
      p_prior_base_entitlement_micro,
      p_prior_capacity_boosts_bps,
      p_single_capacity_limit_bps,
      p_combined_capacity_limit_bps);
    v_delta := app_private.funding_capacity_speed_scale_micro(
      v_new_full - v_old_full,
      p_remaining_span_microseconds,
      p_cycle_span_microseconds);
    if v_delta > 0 and p_prior_effective_capacity_micro
        > 9223372036854775807 - v_delta then
      raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
    end if;
    if v_delta < 0 and p_prior_effective_capacity_micro < -v_delta then
      raise exception using errcode = '22023', message = 'CAPACITY_EFFECTIVE_INVALID';
    end if;
    v_effective := p_prior_effective_capacity_micro + v_delta;
    v_retention_delta := app_private.funding_capacity_speed_scale_micro(
      p_retention_entitlement_micro - p_prior_retention_full_micro,
      p_remaining_span_microseconds,
      p_cycle_span_microseconds);
    if v_retention_delta > 0 and p_prior_retention_cycle_micro
        > 9223372036854775807 - v_retention_delta then
      raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
    end if;
    if v_retention_delta < 0
      and p_prior_retention_cycle_micro < -v_retention_delta then
      raise exception using errcode = '22023', message = 'CAPACITY_EFFECTIVE_INVALID';
    end if;
    v_retention_cycle := p_prior_retention_cycle_micro + v_retention_delta;
  end if;

  if v_effective < 0 or v_retention_cycle < 0 then
    raise exception using errcode = '22023', message = 'CAPACITY_EFFECTIVE_INVALID';
  end if;
  -- speed는 위에서 따로 구했다. effective capacity에는 더하지 않는다.
  if p_used_capacity_micro >= v_effective then
    v_state := 'CAPACITY_EXHAUSTED';
    v_remaining := 0;
    v_reactivated := false;
  else
    v_state := 'ACTIVE';
    v_remaining := v_effective - p_used_capacity_micro;
    v_reactivated := p_prior_effective_capacity_micro is not null
      and p_used_capacity_micro >= p_prior_effective_capacity_micro;
  end if;

  return jsonb_build_object(
    'effective_capacity_micro_krw', v_effective::text,
    'remaining_capacity_micro_krw', v_remaining::text,
    'used_capacity_micro_krw', p_used_capacity_micro::text,
    'retention_cycle_micro_krw', v_retention_cycle::text,
    'retention_verified_credit', false,
    'capacity_state', v_state,
    'reactivated', v_reactivated,
    'speed_multiplier_bps', v_speed::text,
    'capacity_boost_bps', v_boost_bps::text,
    'single_capacity_limit_bps', p_single_capacity_limit_bps::text,
    'combined_capacity_limit_bps', p_combined_capacity_limit_bps::text,
    'speed_identity_bps', p_speed_identity_bps::text,
    'single_speed_limit_bps', p_single_speed_limit_bps::text,
    'combined_speed_limit_bps', p_combined_speed_limit_bps::text,
    'ledger_credit_created', false
  );
end;
$$;

create function app_private.funding_capacity_policy_limit(
  p_config jsonb,
  p_key text,
  p_allow_zero boolean
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_text text;
begin
  if p_config is null or p_key is null or btrim(p_key) = '' then
    raise exception using errcode = '55000', message = 'CAPACITY_POLICY_LIMIT_ABSENT';
  end if;
  v_text := p_config->'campaign'->>p_key;
  if v_text is null
    or (p_allow_zero and v_text !~ '^(0|[1-9][0-9]*)$')
    or (not p_allow_zero and v_text !~ '^[1-9][0-9]*$') then
    raise exception using errcode = '55000', message = 'CAPACITY_POLICY_LIMIT_ABSENT';
  end if;
  return v_text::bigint;
end;
$$;

create function app_private.read_funding_capacity_speed(
  p_user_id uuid,
  p_used_capacity_micro bigint,
  p_capacity_boosts_bps bigint[],
  p_speed_multipliers_bps bigint[],
  p_prior_principal_micro bigint,
  p_prior_base_entitlement_micro bigint,
  p_prior_retention_full_micro bigint,
  p_prior_retention_cycle_micro bigint,
  p_prior_effective_capacity_micro bigint,
  p_prior_capacity_boosts_bps bigint[],
  p_remaining_span_microseconds bigint
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_entitlement jsonb;
  v_cycle jsonb;
  v_now timestamptz;
  v_now_microseconds bigint;
  v_policy jsonb;
  v_config jsonb;
  v_status text;
  v_activated boolean;
  v_principal bigint;
  v_base bigint;
  v_retention bigint;
  v_active_id uuid;
  v_started timestamptz;
  v_end timestamptz;
  v_days integer;
  v_span bigint;
  v_hour_micro constant bigint := 60::bigint * 60 * 1000000;
  v_computed jsonb;
  v_single_capacity bigint;
  v_combined_capacity bigint;
  v_speed_identity bigint;
  v_single_speed bigint;
  v_combined_speed bigint;
  v_prior_boosts bigint[];
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'CAPACITY_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'CAPACITY_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;
  if p_used_capacity_micro is null or p_used_capacity_micro < 0
    or p_capacity_boosts_bps is null
    or p_speed_multipliers_bps is null
    or p_remaining_span_microseconds is null
    or p_remaining_span_microseconds < 0 then
    raise exception using errcode = '22023', message = 'CAPACITY_AMOUNT_INVALID';
  end if;

  v_entitlement := app_private.read_funding_entitlement_foundation(p_user_id);
  v_cycle := app_private.read_funding_cycle_foundation(p_user_id);
  v_status := v_entitlement->>'funding_status';
  if v_status is distinct from v_cycle->>'funding_status' then
    raise exception using errcode = '55000', message = 'CAPACITY_CYCLE_MISMATCH';
  end if;

  v_now := clock_timestamp();
  if not isfinite(v_now) then
    raise exception using errcode = '22023', message = 'CAPACITY_INVALID_SERVER_TIME';
  end if;
  v_now_microseconds := (extract(epoch from v_now) * 1000000)::bigint;
  if v_now_microseconds < 0 then
    raise exception using errcode = '22023', message = 'CAPACITY_INVALID_SERVER_TIME';
  end if;
  v_policy := public.read_effective_economy_policy(v_now_microseconds);
  if coalesce(v_policy->>'schemaVersion', '') <> '1'
    or v_policy->>'reader' is distinct from 'EFFECTIVE_ECONOMY_POLICY'
    or v_policy->>'policyReceiptComplete' is distinct from 'true'
    or jsonb_typeof(v_policy->'policy'->'configuration') is distinct from 'object' then
    raise exception using errcode = '55000', message = 'CAPACITY_POLICY_UNVERIFIED';
  end if;
  if v_entitlement->>'policy_id' is distinct from v_policy->'policy'->>'policyId' then
    raise exception using errcode = '55000', message = 'CAPACITY_POLICY_MISMATCH';
  end if;
  v_config := v_policy->'policy'->'configuration';
  perform app_private.validate_economy_policy_config(v_config);
  -- 한도가 row에 없으면 승인 숫자를 대신 넣지 않는다.
  perform app_private.funding_capacity_policy_limit(
    v_config, 'defaultCapacityBoostBps', true);
  v_single_capacity := app_private.funding_capacity_policy_limit(
    v_config, 'maximumSingleCapacityBoostBps', true);
  v_combined_capacity := app_private.funding_capacity_policy_limit(
    v_config, 'maximumCombinedCapacityBoostBps', true);
  v_speed_identity := app_private.funding_capacity_policy_limit(
    v_config, 'defaultSpeedMultiplierBps', false);
  v_single_speed := app_private.funding_capacity_policy_limit(
    v_config, 'maximumSingleSpeedMultiplierBps', false);
  v_combined_speed := app_private.funding_capacity_policy_limit(
    v_config, 'maximumCombinedSpeedMultiplierBps', false);

  v_activated := v_entitlement->>'tier_activated' = 'true';
  if v_cycle->>'active_cycle_id' is null then
    v_active_id := null;
  elsif v_cycle->>'active_cycle_id' !~ '^[0-9a-f-]{36}$' then
    raise exception using errcode = '55000', message = 'CAPACITY_CYCLE_MISMATCH';
  else
    v_active_id := (v_cycle->>'active_cycle_id')::uuid;
  end if;

  if v_active_id is null then
    if v_activated then
      raise exception using errcode = '55000', message = 'CAPACITY_CYCLE_ABSENT';
    end if;
    if cardinality(p_capacity_boosts_bps) <> 0
      or cardinality(p_speed_multipliers_bps) <> 0
      or p_prior_effective_capacity_micro is not null then
      raise exception using errcode = '22023', message = 'CAPACITY_INACTIVE';
    end if;
    return jsonb_build_object(
      'schema_version', 1,
      'reader', 'FUNDING_CAPACITY_SPEED',
      'funding_status', v_status,
      'tier_activated', false,
      'tier_code', null,
      'eligible_principal_micro_krw', v_entitlement->>'eligible_principal_micro_krw',
      'base_entitlement_micro_krw', null,
      'retention_entitlement_micro_krw', null,
      'retention_cycle_micro_krw', null,
      'retention_qualification', null,
      'retention_verified_credit', false,
      'effective_capacity_micro_krw', null,
      'remaining_capacity_micro_krw', '0',
      'used_capacity_micro_krw', p_used_capacity_micro::text,
      'capacity_state', 'FUNDING_BELOW_MINIMUM',
      'reactivated', false,
      'speed_multiplier_bps', null,
      'capacity_boost_bps', '0',
      'cycle_started_at', null,
      'cycle_end', null,
      'ledger_credit_created', false,
      'policy_id', v_policy->'policy'->>'policyId'
    );
  end if;

  select opened.cycle_days, opened.cycle_started_at, opened.cycle_end
    into v_days, v_started, v_end
  from app_private.funding_cycle_windows as opened
  where opened.id = v_active_id
    and opened.user_id = p_user_id;
  if v_days is null
    or v_started is null
    or v_end is null
    or v_started is distinct from (v_cycle->>'cycle_started_at')::timestamptz
    or v_end is distinct from (v_cycle->>'cycle_end')::timestamptz
    or v_end is distinct from v_started + v_days * interval '24 hours' then
    raise exception using errcode = '55000', message = 'CAPACITY_CYCLE_MISMATCH';
  end if;
  if v_days::bigint > 9223372036854775807 / (24 * v_hour_micro) then
    raise exception using errcode = '22003', message = 'CAPACITY_MICRO_OVERFLOW';
  end if;
  v_span := v_days::bigint * 24 * v_hour_micro;

  if not v_activated then
    if cardinality(p_capacity_boosts_bps) <> 0
      or cardinality(p_speed_multipliers_bps) <> 0 then
      raise exception using errcode = '22023', message = 'CAPACITY_INACTIVE';
    end if;
    return jsonb_build_object(
      'schema_version', 1,
      'reader', 'FUNDING_CAPACITY_SPEED',
      'funding_status', v_status,
      'tier_activated', false,
      'tier_code', null,
      'eligible_principal_micro_krw', v_entitlement->>'eligible_principal_micro_krw',
      'base_entitlement_micro_krw', null,
      'retention_entitlement_micro_krw', null,
      'retention_cycle_micro_krw', null,
      'retention_qualification', null,
      'retention_verified_credit', false,
      'effective_capacity_micro_krw', null,
      'remaining_capacity_micro_krw', '0',
      'used_capacity_micro_krw', p_used_capacity_micro::text,
      'capacity_state', 'FUNDING_BELOW_MINIMUM',
      'reactivated', false,
      'speed_multiplier_bps', null,
      'capacity_boost_bps', '0',
      'cycle_started_at', v_started,
      'cycle_end', v_end,
      'ledger_credit_created', false,
      'policy_id', v_policy->'policy'->>'policyId'
    );
  end if;

  if v_entitlement->>'eligible_principal_micro_krw' !~ '^(0|[1-9][0-9]*)$'
    or v_entitlement->>'base_entitlement_micro_krw' !~ '^(0|[1-9][0-9]*)$'
    or v_entitlement->>'retention_entitlement_micro_krw' !~ '^(0|[1-9][0-9]*)$' then
    raise exception using errcode = '22023', message = 'CAPACITY_AMOUNT_INVALID';
  end if;
  v_principal := (v_entitlement->>'eligible_principal_micro_krw')::bigint;
  v_base := (v_entitlement->>'base_entitlement_micro_krw')::bigint;
  v_retention := (v_entitlement->>'retention_entitlement_micro_krw')::bigint;
  v_prior_boosts := p_prior_capacity_boosts_bps;
  if v_prior_boosts is null
    and p_prior_principal_micro is null then
    v_prior_boosts := array[]::bigint[];
  end if;

  v_computed := app_private.funding_capacity_speed_compute(
    v_principal,
    v_base,
    v_retention,
    p_prior_principal_micro,
    p_prior_base_entitlement_micro,
    p_prior_retention_full_micro,
    p_prior_retention_cycle_micro,
    p_prior_effective_capacity_micro,
    p_used_capacity_micro,
    p_capacity_boosts_bps,
    v_prior_boosts,
    p_speed_multipliers_bps,
    p_remaining_span_microseconds,
    v_span,
    v_single_capacity,
    v_combined_capacity,
    v_speed_identity,
    v_single_speed,
    v_combined_speed);

  return v_computed || jsonb_build_object(
    'schema_version', 1,
    'reader', 'FUNDING_CAPACITY_SPEED',
    'funding_status', v_status,
    'tier_activated', true,
    'tier_code', v_entitlement->>'tier_code',
    'eligible_principal_micro_krw', v_entitlement->>'eligible_principal_micro_krw',
    'base_entitlement_micro_krw', v_entitlement->>'base_entitlement_micro_krw',
    'retention_entitlement_micro_krw', v_entitlement->>'retention_entitlement_micro_krw',
    'retention_qualification', 'UNCONFIRMED',
    'cycle_started_at', v_started,
    'cycle_end', v_end,
    'policy_id', v_policy->'policy'->>'policyId',
    'policy_version', v_policy->'policy'->>'policyVersion'
  );
end;
$$;

revoke all on function app_private.funding_capacity_speed_scale_micro(bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function app_private.funding_capacity_speed_boost_bps(bigint[], bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function app_private.funding_capacity_speed_multiplier_bps(bigint[], bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function app_private.funding_capacity_speed_boosted_base(bigint, bigint, bigint[], bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function app_private.funding_capacity_policy_limit(jsonb, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function app_private.funding_capacity_speed_compute(
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint[], bigint[], bigint[], bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function app_private.read_funding_capacity_speed(
  uuid, bigint, bigint[], bigint[], bigint, bigint, bigint, bigint, bigint, bigint[], bigint)
  from public, anon, authenticated, service_role;

grant execute on function app_private.funding_capacity_speed_scale_micro(bigint, bigint, bigint)
  to service_role;
grant execute on function app_private.funding_capacity_speed_boost_bps(bigint[], bigint, bigint)
  to service_role;
grant execute on function app_private.funding_capacity_speed_multiplier_bps(bigint[], bigint, bigint, bigint)
  to service_role;
grant execute on function app_private.funding_capacity_speed_boosted_base(bigint, bigint, bigint[], bigint, bigint)
  to service_role;
grant execute on function app_private.funding_capacity_policy_limit(jsonb, text, boolean)
  to service_role;
grant execute on function app_private.funding_capacity_speed_compute(
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint[], bigint[], bigint[], bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  to service_role;
grant execute on function app_private.read_funding_capacity_speed(
  uuid, bigint, bigint[], bigint[], bigint, bigint, bigint, bigint, bigint, bigint[], bigint)
  to service_role;

comment on function app_private.funding_capacity_speed_compute(
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint[], bigint[], bigint[], bigint, bigint, bigint, bigint, bigint, bigint, bigint) is
  'Capacity와 Speed를 정수 micro-KRW와 basis point로 계산한다. 한도는 인자이고 원장에 쓰지 않는다.';
comment on function app_private.read_funding_capacity_speed(
  uuid, bigint, bigint[], bigint[], bigint, bigint, bigint, bigint, bigint, bigint[], bigint) is
  'entitlement와 cycle 창을 읽어 Capacity와 Speed만 계산한다. cycle 시작과 끝을 바꾸지 않고 retention을 확정 잔액으로 쓰지 않는다.';

commit;
