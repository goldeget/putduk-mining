begin;

-- 자격 기초 조회. W1 lot 합과 발행된 economy policy만 읽는다.
-- base entitlement와 retention entitlement를 나누고, retention은 확정 잔액이 아니다.
-- 원장 credit, cycle anchor, segment, proration, 소진 재개, settlement, worker는 만들지 않는다.
-- 상품 배수, slot, campaign cap은 이 결과 밖이다.
-- 부분 원금 회수의 lot 배분은 여기서 정하지 않는다.

-- 10000은 basis point의 100% 단위다. 등급 구간을 복사한 값이 아니다.
create function app_private.funding_entitlement_portion_micro(
  p_principal_micro bigint,
  p_rate_bps bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_unit constant bigint := 10000;
  v_quot bigint;
  v_rem bigint;
  v_main bigint;
  v_rem_product bigint;
  v_extra bigint;
begin
  if p_principal_micro is null or p_principal_micro < 0
    or p_rate_bps is null or p_rate_bps < 0 then
    raise exception using errcode = '22023', message = 'ENTITLEMENT_PORTION_INVALID';
  end if;
  v_quot := p_principal_micro / v_unit;
  v_rem := p_principal_micro % v_unit;
  if p_rate_bps <> 0 and v_quot > 9223372036854775807 / p_rate_bps then
    raise exception using errcode = '22003', message = 'ENTITLEMENT_MICRO_OVERFLOW';
  end if;
  v_main := v_quot * p_rate_bps;
  if v_rem <> 0 and p_rate_bps > 9223372036854775807 / v_rem then
    raise exception using errcode = '22003', message = 'ENTITLEMENT_MICRO_OVERFLOW';
  end if;
  v_rem_product := v_rem * p_rate_bps;
  if v_rem_product % v_unit <> 0 then
    raise exception using errcode = '22023', message = 'ENTITLEMENT_PORTION_NOT_INTEGRAL_MICRO';
  end if;
  v_extra := v_rem_product / v_unit;
  if v_main > 9223372036854775807 - v_extra then
    raise exception using errcode = '22003', message = 'ENTITLEMENT_MICRO_OVERFLOW';
  end if;
  return v_main + v_extra;
end;
$$;

create function app_private.read_funding_entitlement_foundation(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_now timestamptz;
  v_now_microseconds bigint;
  v_principal jsonb;
  v_policy jsonb;
  v_config jsonb;
  v_status text;
  v_eligible_text text;
  v_eligible_micro bigint;
  v_minimum_text text;
  v_micro_text text;
  v_micro_per bigint;
  v_minimum_krw bigint;
  v_minimum_micro bigint;
  v_principal_krw bigint;
  v_rate_text text;
  v_rate_bps bigint;
  v_tier jsonb;
  v_tier_count integer;
  v_retention_text text;
  v_retention_bps bigint;
  v_tier_activated boolean := false;
  v_tier_code text;
  v_base_text text;
  v_retention_bps_text text;
  v_retention_amount_text text;
  v_retention_qualification text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'ENTITLEMENT_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'ENTITLEMENT_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  v_principal := app_private.read_funding_principal_foundation(p_user_id);
  v_status := v_principal->>'funding_status';
  v_eligible_text := v_principal->>'eligible_principal_micro_krw';
  if v_status is null
    or v_status not in (
      'FUNDING_BELOW_MINIMUM',
      'FUNDING_MINIMUM_MET',
      'FUNDING_PRINCIPAL_UNRESOLVED'
    ) then
    raise exception using errcode = '55000', message = 'ENTITLEMENT_FUNDING_STATUS_UNKNOWN';
  end if;

  v_now := clock_timestamp();
  if not isfinite(v_now) then
    raise exception using errcode = '22023', message = 'ENTITLEMENT_INVALID_SERVER_TIME';
  end if;
  v_now_microseconds := (extract(epoch from v_now) * 1000000)::bigint;
  if v_now_microseconds < 0 then
    raise exception using errcode = '22023', message = 'ENTITLEMENT_INVALID_SERVER_TIME';
  end if;
  v_policy := public.read_effective_economy_policy(v_now_microseconds);
  if coalesce(v_policy->>'schemaVersion', '') <> '1'
    or v_policy->>'reader' is distinct from 'EFFECTIVE_ECONOMY_POLICY'
    or v_policy->>'policyReceiptComplete' is distinct from 'true'
    or jsonb_typeof(v_policy->'policy'->'configuration') is distinct from 'object' then
    raise exception using errcode = '55000', message = 'ENTITLEMENT_POLICY_UNVERIFIED';
  end if;
  v_config := v_policy->'policy'->'configuration';
  perform app_private.validate_economy_policy_config(v_config);

  v_micro_text := v_config->>'microKrwPerKrw';
  v_minimum_text := v_config->>'minimumPrincipalKrw';
  v_rate_text := v_config->>'baseCycleRateBps';
  if v_micro_text !~ '^[1-9][0-9]*$'
    or v_minimum_text !~ '^[1-9][0-9]*$'
    or v_rate_text !~ '^(0|[1-9][0-9]*)$' then
    raise exception using errcode = '22023', message = 'ENTITLEMENT_POLICY_INTEGER_INVALID';
  end if;
  v_micro_per := v_micro_text::bigint;
  v_minimum_krw := v_minimum_text::bigint;
  v_rate_bps := v_rate_text::bigint;
  if v_micro_per = 0 or v_minimum_krw > 9223372036854775807 / v_micro_per then
    raise exception using errcode = '22003', message = 'ENTITLEMENT_MICRO_OVERFLOW';
  end if;
  v_minimum_micro := v_minimum_krw * v_micro_per;
  if v_principal->>'minimum_principal_micro_krw' is distinct from v_minimum_micro::text then
    raise exception using errcode = '55000', message = 'ENTITLEMENT_POLICY_MINIMUM_MISMATCH';
  end if;

  if v_status = 'FUNDING_PRINCIPAL_UNRESOLVED' then
    if v_eligible_text is not null then
      raise exception using errcode = '55000', message = 'ENTITLEMENT_UNRESOLVED_PRINCIPAL_PRESENT';
    end if;
  elsif v_status in ('FUNDING_BELOW_MINIMUM', 'FUNDING_MINIMUM_MET') then
    if v_eligible_text is null or v_eligible_text !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = '22023', message = 'ENTITLEMENT_PRINCIPAL_INVALID';
    end if;
    v_eligible_micro := v_eligible_text::bigint;
    if v_eligible_micro % v_micro_per <> 0 then
      raise exception using errcode = '22023', message = 'ENTITLEMENT_PRINCIPAL_NOT_WHOLE_KRW';
    end if;
    v_principal_krw := v_eligible_micro / v_micro_per;
    if v_status = 'FUNDING_BELOW_MINIMUM' and v_principal_krw >= v_minimum_krw then
      raise exception using errcode = '55000', message = 'ENTITLEMENT_MINIMUM_STATUS_MISMATCH';
    end if;
    if v_status = 'FUNDING_MINIMUM_MET' and v_principal_krw < v_minimum_krw then
      raise exception using errcode = '55000', message = 'ENTITLEMENT_MINIMUM_STATUS_MISMATCH';
    end if;
  end if;

  if v_status = 'FUNDING_MINIMUM_MET' then
    select count(*)::integer into v_tier_count
    from jsonb_array_elements(v_config->'tiers') as tier(item)
    where (tier.item->>'minimumPrincipalKrw')::bigint <= v_principal_krw
      and (
        jsonb_typeof(tier.item->'maximumPrincipalKrw') = 'null'
        or (tier.item->>'maximumPrincipalKrw')::bigint >= v_principal_krw
      );
    if v_tier_count is distinct from 1 then
      raise exception using errcode = '55000', message = 'ENTITLEMENT_TIER_UNRESOLVED';
    end if;
    select tier.item into strict v_tier
    from jsonb_array_elements(v_config->'tiers') as tier(item)
    where (tier.item->>'minimumPrincipalKrw')::bigint <= v_principal_krw
      and (
        jsonb_typeof(tier.item->'maximumPrincipalKrw') = 'null'
        or (tier.item->>'maximumPrincipalKrw')::bigint >= v_principal_krw
      );
    v_retention_text := v_tier->>'retentionBonusBps';
    if coalesce(v_tier->>'code', '') = ''
      or v_retention_text !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = '55000', message = 'ENTITLEMENT_TIER_UNRESOLVED';
    end if;
    v_retention_bps := v_retention_text::bigint;
    v_tier_activated := true;
    v_tier_code := v_tier->>'code';
    v_base_text := app_private.funding_entitlement_portion_micro(
      v_eligible_micro, v_rate_bps)::text;
    v_retention_bps_text := v_retention_text;
    v_retention_amount_text := app_private.funding_entitlement_portion_micro(
      v_eligible_micro, v_retention_bps)::text;
    v_retention_qualification := 'UNCONFIRMED';
    v_rate_text := v_config->>'baseCycleRateBps';
  else
    v_rate_text := null;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'reader', 'FUNDING_ENTITLEMENT_FOUNDATION',
    'funding_status', v_status,
    'eligible_principal_micro_krw', v_eligible_text,
    'minimum_principal_micro_krw', v_minimum_micro::text,
    'lot_count', v_principal->>'lot_count',
    'tier_activated', v_tier_activated,
    'tier_code', v_tier_code,
    'base_cycle_rate_bps', case when v_tier_activated then v_rate_text else null end,
    'base_entitlement_micro_krw', v_base_text,
    'retention_bonus_bps', v_retention_bps_text,
    'retention_entitlement_micro_krw', v_retention_amount_text,
    'retention_qualification', v_retention_qualification,
    'retention_verified_credit', false,
    'ledger_credit_created', false,
    'policy_id', v_policy->'policy'->>'policyId',
    'policy_version', v_policy->'policy'->>'policyVersion',
    'policy_config_digest', v_policy->'policy'->>'configDigest'
  );
end;
$$;

revoke all on function app_private.funding_entitlement_portion_micro(bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_entitlement_portion_micro(bigint, bigint)
  to service_role;
revoke all on function app_private.read_funding_entitlement_foundation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_funding_entitlement_foundation(uuid)
  to service_role;

comment on function app_private.funding_entitlement_portion_micro(bigint, bigint) is
  'micro-KRW에 basis point를 정수로 적용한다. 등급표를 소유하지 않고 원장에 쓰지 않는다.';
comment on function app_private.read_funding_entitlement_foundation(uuid) is
  'W1 lot 합과 발행 policy로 등급, base entitlement, 미확정 retention만 조회한다. 확정 잔액이나 원장 credit이 아니다.';

commit;
