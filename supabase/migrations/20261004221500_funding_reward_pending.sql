begin;

-- 저장된 segment의 경과분으로 pending 수치만 계산한다.
-- 호출자가 넘긴 보상 금액은 받지 않는다.
-- 입력은 저장된 principal, segment proration, policy version, cycle 창,
-- 그리고 그 policy에 저장된 기본 speed다.
-- speed는 같은 base 한도를 더 빨리 채울 뿐이며 capacity를 올리지 않는다.
-- 남은 capacity가 0이면 speed만으로 pending을 다시 열지 않는다.
-- retention은 pending에 더하지 않고 UNCONFIRMED로 남긴다.
-- 원장 credit, wallet, reward_carry, settlement, worker, snapshot은 만들지 않는다.
-- campaign boost, product multiplier, override 결합은 저장분이 없으므로 만들지 않는다.

-- 경과 시간에 speed/identity를 정수로 곱한다. 결과는 segment 길이를 넘지 않는다.
create function app_private.funding_reward_pending_fill_microseconds(
  p_elapsed_microseconds bigint,
  p_span_microseconds bigint,
  p_speed_bps bigint,
  p_speed_identity_bps bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_quot numeric;
begin
  if p_elapsed_microseconds is null or p_elapsed_microseconds < 0
    or p_span_microseconds is null or p_span_microseconds <= 0
    or p_elapsed_microseconds > p_span_microseconds
    or p_speed_bps is null or p_speed_bps < 0
    or p_speed_identity_bps is null or p_speed_identity_bps <= 0 then
    raise exception using errcode = '22023', message = 'PRODUCER_INPUT_INVALID';
  end if;
  if p_elapsed_microseconds = 0 or p_speed_bps = 0 then
    return 0;
  end if;
  if p_speed_bps = p_speed_identity_bps then
    return p_elapsed_microseconds;
  end if;
  -- numeric는 이진 부동소수가 아니다. 정수 몫만 남긴다.
  v_quot := div(
    p_elapsed_microseconds::numeric * p_speed_bps::numeric,
    p_speed_identity_bps::numeric);
  if v_quot is null or v_quot <> trunc(v_quot) or v_quot < 0 then
    raise exception using errcode = '22003', message = 'PRODUCER_MICRO_OVERFLOW';
  end if;
  if v_quot >= p_span_microseconds::numeric then
    return p_span_microseconds;
  end if;
  if v_quot > 9223372036854775807::numeric then
    raise exception using errcode = '22003', message = 'PRODUCER_MICRO_OVERFLOW';
  end if;
  return v_quot::bigint;
end;
$$;

-- 저장된 base/retention에 경과 비율만 적용한다. capacity는 base 입력 그대로다.
create function app_private.funding_reward_pending_segment_micro(
  p_base_entitlement_micro bigint,
  p_retention_entitlement_micro bigint,
  p_elapsed_microseconds bigint,
  p_span_microseconds bigint,
  p_speed_bps bigint,
  p_speed_identity_bps bigint
) returns jsonb
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_fill bigint;
  v_accrued bigint;
  v_retention bigint;
begin
  if p_base_entitlement_micro is null
    or p_retention_entitlement_micro is null then
    raise exception using errcode = '22023', message = 'PRODUCER_INPUT_INVALID';
  end if;
  v_fill := app_private.funding_reward_pending_fill_microseconds(
    p_elapsed_microseconds,
    p_span_microseconds,
    p_speed_bps,
    p_speed_identity_bps);
  v_accrued := app_private.funding_capacity_speed_scale_micro(
    p_base_entitlement_micro, v_fill, p_span_microseconds);
  v_retention := app_private.funding_capacity_speed_scale_micro(
    p_retention_entitlement_micro, v_fill, p_span_microseconds);
  return jsonb_build_object(
    'accrued_micro_krw', v_accrued::text,
    'retention_unconfirmed_micro_krw', v_retention::text,
    'segment_capacity_micro_krw', p_base_entitlement_micro::text,
    'fill_microseconds', v_fill::text,
    'speed_multiplier_bps', p_speed_bps::text,
    'speed_identity_bps', p_speed_identity_bps::text,
    'retention_verified_credit', false,
    'ledger_credit_created', false
  );
end;
$$;

-- 남은 capacity가 0이면 양수 경과분도 pending이 되지 않는다. 음수는 회수하지 않는다.
create function app_private.funding_reward_pending_cap_micro(
  p_accrued_micro bigint,
  p_remaining_capacity_micro bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
begin
  if p_accrued_micro is null
    or p_remaining_capacity_micro is null
    or p_remaining_capacity_micro < 0 then
    raise exception using errcode = '22023', message = 'PRODUCER_INPUT_INVALID';
  end if;
  if p_remaining_capacity_micro = 0 or p_accrued_micro <= 0 then
    return 0;
  end if;
  if p_accrued_micro > p_remaining_capacity_micro then
    return p_remaining_capacity_micro;
  end if;
  return p_accrued_micro;
end;
$$;

create function app_private.read_funding_reward_pending(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_principal jsonb;
  v_status text;
  v_as_of timestamptz;
  v_active_count integer;
  v_active_id uuid;
  v_started timestamptz;
  v_end timestamptz;
  v_segment app_private.funding_cycle_segments%rowtype;
  v_policy jsonb;
  v_config jsonb;
  v_identity bigint;
  v_combined_speed bigint;
  v_span bigint;
  v_elapsed bigint;
  v_piece jsonb;
  v_accrued bigint;
  v_retention_piece bigint;
  v_capacity_sum numeric := 0;
  v_accrued_sum numeric := 0;
  v_retention_sum numeric := 0;
  v_capacity_text text;
  v_retention_text text;
  v_remaining bigint := 0;
  v_pending bigint := 0;
  v_segments jsonb := '[]'::jsonb;
  v_speed text;
  v_identity_text text;
  v_speed_consistent boolean := true;
  v_policy_id uuid;
  v_policy_version text;
  v_principal_text text;
  v_state text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'PRODUCER_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'PRODUCER_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  v_principal := app_private.read_funding_principal_foundation(p_user_id);
  v_status := v_principal->>'funding_status';
  if v_status is null or v_status not in (
    'FUNDING_BELOW_MINIMUM',
    'FUNDING_MINIMUM_MET',
    'FUNDING_PRINCIPAL_UNRESOLVED'
  ) then
    raise exception using errcode = '55000', message = 'PRODUCER_FUNDING_STATUS_UNKNOWN';
  end if;

  if v_status is distinct from 'FUNDING_MINIMUM_MET' then
    return jsonb_build_object(
      'schema_version', 1,
      'reader', 'FUNDING_REWARD_PENDING',
      'funding_status', v_status,
      'tier_activated', false,
      'active_cycle_id', null,
      'cycle_started_at', null,
      'cycle_end', null,
      'policy_id', null,
      'policy_version', null,
      'eligible_principal_micro_krw', v_principal->>'eligible_principal_micro_krw',
      'effective_capacity_micro_krw', null,
      'remaining_capacity_micro_krw', '0',
      'used_capacity_micro_krw', '0',
      'speed_multiplier_bps', null,
      'speed_identity_bps', null,
      'pending_micro_krw', '0',
      'retention_unconfirmed_micro_krw', '0',
      'retention_qualification', null,
      'retention_verified_credit', false,
      'accepted_receipt', false,
      'ledger_credit_created', false,
      'reward_carry_stored', false,
      'capacity_state', v_status,
      'segments', '[]'::jsonb
    );
  end if;

  v_as_of := clock_timestamp();
  if not isfinite(v_as_of) then
    raise exception using errcode = '22023', message = 'PRODUCER_INPUT_INVALID';
  end if;
  select count(*)::integer into v_active_count
  from app_private.funding_cycle_windows as opened
  where opened.user_id = p_user_id
    and opened.cycle_started_at <= v_as_of
    and opened.cycle_end > v_as_of;
  if v_active_count > 1 then
    raise exception using errcode = '55000', message = 'PRODUCER_WINDOW_OVERLAP';
  end if;
  if v_active_count = 0 then
    return jsonb_build_object(
      'schema_version', 1,
      'reader', 'FUNDING_REWARD_PENDING',
      'funding_status', v_status,
      'tier_activated', true,
      'active_cycle_id', null,
      'cycle_started_at', null,
      'cycle_end', null,
      'policy_id', null,
      'policy_version', null,
      'eligible_principal_micro_krw', v_principal->>'eligible_principal_micro_krw',
      'effective_capacity_micro_krw', null,
      'remaining_capacity_micro_krw', '0',
      'used_capacity_micro_krw', '0',
      'speed_multiplier_bps', null,
      'speed_identity_bps', null,
      'pending_micro_krw', '0',
      'retention_unconfirmed_micro_krw', '0',
      'retention_qualification', null,
      'retention_verified_credit', false,
      'accepted_receipt', false,
      'ledger_credit_created', false,
      'reward_carry_stored', false,
      'capacity_state', 'NO_ACTIVE_WINDOW',
      'segments', '[]'::jsonb
    );
  end if;

  select opened.id, opened.cycle_started_at, opened.cycle_end
    into strict v_active_id, v_started, v_end
  from app_private.funding_cycle_windows as opened
  where opened.user_id = p_user_id
    and opened.cycle_started_at <= v_as_of
    and opened.cycle_end > v_as_of;

  for v_segment in
    select segment.*
    from app_private.funding_cycle_segments as segment
    where segment.cycle_id = v_active_id
      and segment.user_id = p_user_id
    order by segment.segment_ordinal
  loop
    if v_segment.retention_qualification is distinct from 'UNCONFIRMED' then
      raise exception using errcode = '55000', message = 'PRODUCER_RETENTION_NOT_PAYABLE';
    end if;
    if v_segment.effective_until <= v_segment.effective_at
      or v_segment.effective_at < v_started
      or v_segment.effective_until > v_end then
      raise exception using errcode = '55000', message = 'PRODUCER_SEGMENT_WINDOW_INVALID';
    end if;
    v_policy := public.read_effective_economy_policy(
      app_private.funding_segment_epoch_microseconds(v_segment.effective_at));
    if coalesce(v_policy->>'schemaVersion', '') <> '1'
      or v_policy->>'reader' is distinct from 'EFFECTIVE_ECONOMY_POLICY'
      or v_policy->>'policyReceiptComplete' is distinct from 'true'
      or v_policy->'policy'->>'policyId' is distinct from v_segment.policy_id::text
      or v_policy->'policy'->>'policyVersion' is distinct from v_segment.policy_version
      or v_policy->'policy'->>'configDigest' is distinct from v_segment.policy_config_digest
      or jsonb_typeof(v_policy->'policy'->'configuration') is distinct from 'object' then
      raise exception using errcode = '55000', message = 'PRODUCER_POLICY_MISMATCH';
    end if;
    v_config := v_policy->'policy'->'configuration';
    perform app_private.validate_economy_policy_config(v_config);
    v_identity := app_private.funding_capacity_policy_limit(
      v_config, 'defaultSpeedMultiplierBps', false);
    v_combined_speed := app_private.funding_capacity_policy_limit(
      v_config, 'maximumCombinedSpeedMultiplierBps', false);
    if v_identity > v_combined_speed then
      raise exception using errcode = '22023', message = 'PRODUCER_SPEED_INVALID';
    end if;
    v_span := app_private.funding_segment_span_microseconds(
      v_segment.effective_at, v_segment.effective_until);
    if v_as_of <= v_segment.effective_at then
      v_elapsed := 0;
    elsif v_as_of >= v_segment.effective_until then
      v_elapsed := v_span;
    else
      v_elapsed := app_private.funding_segment_span_microseconds(
        v_segment.effective_at, v_as_of);
    end if;
    v_piece := app_private.funding_reward_pending_segment_micro(
      v_segment.base_entitlement_micro_krw,
      v_segment.retention_entitlement_micro_krw,
      v_elapsed,
      v_span,
      v_identity,
      v_identity);
    if v_piece->>'segment_capacity_micro_krw'
        is distinct from v_segment.base_entitlement_micro_krw::text
      or v_piece->>'speed_multiplier_bps' is distinct from v_identity::text then
      raise exception using errcode = '55000', message = 'PRODUCER_CAPACITY_CHANGED';
    end if;
    v_accrued := (v_piece->>'accrued_micro_krw')::bigint;
    v_retention_piece := (v_piece->>'retention_unconfirmed_micro_krw')::bigint;
    v_capacity_sum := v_capacity_sum + v_segment.base_entitlement_micro_krw;
    v_accrued_sum := v_accrued_sum + v_accrued;
    v_retention_sum := v_retention_sum + v_retention_piece;
    if v_speed is null then
      v_speed := v_identity::text;
      v_identity_text := v_identity::text;
    elsif v_speed is distinct from v_identity::text
      or v_identity_text is distinct from v_identity::text then
      v_speed_consistent := false;
    end if;
    v_policy_id := v_segment.policy_id;
    v_policy_version := v_segment.policy_version;
    v_principal_text := v_segment.principal_micro_krw::text;
    v_segments := v_segments || jsonb_build_array(jsonb_build_object(
      'segment_ordinal', v_segment.segment_ordinal,
      'principal_micro_krw', v_segment.principal_micro_krw::text,
      'policy_id', v_segment.policy_id,
      'policy_version', v_segment.policy_version,
      'effective_at', v_segment.effective_at,
      'effective_until', v_segment.effective_until,
      'elapsed_microseconds', v_elapsed::text,
      'span_microseconds', v_span::text,
      'base_entitlement_micro_krw', v_segment.base_entitlement_micro_krw::text,
      'retention_entitlement_micro_krw', v_segment.retention_entitlement_micro_krw::text,
      'accrued_micro_krw', v_piece->>'accrued_micro_krw',
      'retention_unconfirmed_micro_krw', v_piece->>'retention_unconfirmed_micro_krw',
      'segment_capacity_micro_krw', v_piece->>'segment_capacity_micro_krw',
      'speed_multiplier_bps', v_piece->>'speed_multiplier_bps',
      'speed_identity_bps', v_piece->>'speed_identity_bps'
    ));
  end loop;

  if v_capacity_sum <> trunc(v_capacity_sum)
    or v_accrued_sum <> trunc(v_accrued_sum)
    or v_retention_sum <> trunc(v_retention_sum) then
    raise exception using errcode = '22003', message = 'PRODUCER_MICRO_OVERFLOW';
  end if;
  begin
    v_capacity_text := v_capacity_sum::bigint::text;
    v_retention_text := v_retention_sum::bigint::text;
  exception
    when numeric_value_out_of_range then
      raise exception using errcode = '22003', message = 'PRODUCER_MICRO_OVERFLOW';
  end;
  if v_capacity_sum > 0 then
    v_remaining := v_capacity_sum::bigint;
    v_state := 'ACTIVE';
  else
    v_remaining := 0;
    v_state := case
      when v_segments = '[]'::jsonb then 'NO_SEGMENT'
      else 'CAPACITY_EXHAUSTED'
    end;
  end if;
  v_pending := app_private.funding_reward_pending_cap_micro(
    v_accrued_sum::bigint, v_remaining);
  if not v_speed_consistent then
    v_speed := null;
    v_identity_text := null;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'reader', 'FUNDING_REWARD_PENDING',
    'funding_status', v_status,
    'tier_activated', true,
    'active_cycle_id', v_active_id,
    'cycle_started_at', v_started,
    'cycle_end', v_end,
    'policy_id', v_policy_id,
    'policy_version', v_policy_version,
    'eligible_principal_micro_krw', coalesce(
      v_principal_text, v_principal->>'eligible_principal_micro_krw'),
    'effective_capacity_micro_krw', v_capacity_text,
    'remaining_capacity_micro_krw', v_remaining::text,
    'used_capacity_micro_krw', '0',
    'speed_multiplier_bps', v_speed,
    'speed_identity_bps', v_identity_text,
    'pending_micro_krw', v_pending::text,
    'retention_unconfirmed_micro_krw', v_retention_text,
    'retention_qualification', case
      when v_segments = '[]'::jsonb then null
      else 'UNCONFIRMED'
    end,
    'retention_verified_credit', false,
    'accepted_receipt', false,
    'ledger_credit_created', false,
    'reward_carry_stored', false,
    'capacity_state', v_state,
    'segments', v_segments
  );
end;
$$;

revoke all on function app_private.funding_reward_pending_fill_microseconds(bigint, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_reward_pending_fill_microseconds(bigint, bigint, bigint, bigint)
  to service_role;
revoke all on function app_private.funding_reward_pending_segment_micro(bigint, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_reward_pending_segment_micro(bigint, bigint, bigint, bigint, bigint, bigint)
  to service_role;
revoke all on function app_private.funding_reward_pending_cap_micro(bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_reward_pending_cap_micro(bigint, bigint)
  to service_role;
revoke all on function app_private.read_funding_reward_pending(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_funding_reward_pending(uuid) to service_role;

comment on function app_private.funding_reward_pending_fill_microseconds(bigint, bigint, bigint, bigint) is
  '경과 시간에 저장된 speed를 정수로 적용하고 segment 길이에서 자른다.';
comment on function app_private.funding_reward_pending_segment_micro(bigint, bigint, bigint, bigint, bigint, bigint) is
  '저장된 base와 retention proration의 경과분이다. speed는 capacity 수치를 바꾸지 않는다.';
comment on function app_private.funding_reward_pending_cap_micro(bigint, bigint) is
  '남은 capacity가 없으면 pending은 0이다. 음수 경과분은 보상 회수가 아니다.';
comment on function app_private.read_funding_reward_pending(uuid) is
  '저장된 segment, policy version, cycle 창으로 pending 수치만 읽는다. 보상 금액 인자가 없고 원장에 쓰지 않는다.';

commit;
