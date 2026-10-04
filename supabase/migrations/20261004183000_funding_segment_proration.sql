begin;

-- 같은 cycle 안의 시간 segment와 남은 기간 차이만 저장한다.
-- W1 lot, W2 portion, W3 창을 다시 만들지 않는다.
-- used/remaining, speed, 소진, producer, settlement, worker, 원장 credit은 없다.
-- 상품마다 금액을 복제하지 않는다. reward_carry도 만들지 않는다.
-- 부분 원금 회수 배분은 바꾸지 않고, 원금 감소로 segment를 나누지 않는다.

create table app_private.funding_cycle_segments (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users (id) on delete restrict,
  cycle_id uuid not null references app_private.funding_cycle_windows (id) on delete restrict,
  segment_ordinal integer not null check (segment_ordinal between 0 and 4000),
  principal_micro_krw bigint not null check (principal_micro_krw > 0),
  tier_code text not null check (tier_code ~ '^[A-Za-z0-9_+-]{1,32}$'),
  policy_id uuid not null references app_private.economy_policy_versions (id) on delete restrict,
  policy_version text not null check (policy_version ~ '^[A-Z][A-Z0-9._-]{2,99}$'),
  policy_config_digest text not null check (policy_config_digest ~ '^[a-f0-9]{64}$'),
  base_cycle_rate_bps bigint not null check (base_cycle_rate_bps >= 0),
  retention_bonus_bps bigint not null check (retention_bonus_bps >= 0),
  effective_at timestamptz not null,
  effective_until timestamptz not null,
  base_entitlement_micro_krw bigint not null,
  retention_entitlement_micro_krw bigint not null,
  retention_qualification text not null default 'UNCONFIRMED'
    check (retention_qualification = 'UNCONFIRMED'),
  entitlement_kind text not null check (entitlement_kind in ('CYCLE_OPENING', 'REMAINDER_DELTA')),
  recorded_at timestamptz not null default statement_timestamp(),
  unique (cycle_id, segment_ordinal),
  unique (cycle_id, effective_at),
  check (isfinite(effective_at) and isfinite(effective_until)),
  check (effective_until > effective_at),
  check (
    (
      entitlement_kind = 'CYCLE_OPENING'
      and segment_ordinal = 0
      and base_entitlement_micro_krw >= 0
      and retention_entitlement_micro_krw >= 0
    )
    or (
      entitlement_kind = 'REMAINDER_DELTA'
      and segment_ordinal > 0
    )
  )
);

create index funding_cycle_segments_owner_cycle
  on app_private.funding_cycle_segments (user_id, cycle_id, effective_at);

alter table app_private.funding_cycle_segments enable row level security;
alter table app_private.funding_cycle_segments force row level security;
revoke all on app_private.funding_cycle_segments
  from public, anon, authenticated, service_role;
grant select, insert on app_private.funding_cycle_segments to service_role;

-- timestamptz 차이를 정수 microsecond로 바꾼다. float epoch는 쓰지 않는다.
create function app_private.funding_segment_span_microseconds(
  p_start timestamptz,
  p_end timestamptz
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_span numeric;
begin
  if p_start is null or p_end is null
    or not isfinite(p_start) or not isfinite(p_end)
    or p_end <= p_start then
    raise exception using errcode = '22023', message = 'SEGMENT_TIME_INVALID';
  end if;
  v_span := extract(epoch from (p_end - p_start)) * 1000000;
  if v_span is null or v_span <> trunc(v_span)
    or v_span <= 0 or v_span > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'SEGMENT_TIME_INVALID';
  end if;
  return v_span::bigint;
end;
$$;

-- 기존 policy reader가 요구하는 epoch microsecond다. 기간 비율 계산이 아니다.
create function app_private.funding_segment_epoch_microseconds(p_at timestamptz)
returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_span numeric;
begin
  if p_at is null or not isfinite(p_at) then
    raise exception using errcode = '22023', message = 'SEGMENT_TIME_INVALID';
  end if;
  v_span := extract(epoch from (p_at - timestamptz '1970-01-01 00:00:00+00')) * 1000000;
  if v_span is null or v_span <> trunc(v_span)
    or v_span < 0 or v_span > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'SEGMENT_TIME_INVALID';
  end if;
  return v_span::bigint;
end;
$$;

-- amount * numerator / denominator. 나머지는 1 micro-KRW 미만이라 저장하지 않는다.
create function app_private.funding_segment_scale_micro(
  p_amount_micro bigint,
  p_numerator bigint,
  p_denominator bigint
) returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_quotient numeric;
begin
  if p_amount_micro is null or p_amount_micro < 0
    or p_numerator is null or p_numerator < 0
    or p_denominator is null or p_denominator <= 0
    or p_numerator > p_denominator then
    raise exception using errcode = '22023', message = 'SEGMENT_SCALE_INVALID';
  end if;
  v_quotient := div(p_amount_micro::numeric * p_numerator::numeric, p_denominator::numeric);
  if v_quotient is null or v_quotient <> trunc(v_quotient)
    or v_quotient < 0 or v_quotient > 9223372036854775807 then
    raise exception using errcode = '22003', message = 'SEGMENT_MICRO_OVERFLOW';
  end if;
  return v_quotient::bigint;
end;
$$;

create function app_private.funding_segment_principal_micro(
  p_user_id uuid,
  p_at timestamptz
) returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_sum numeric;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SEGMENT_SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null or p_at is null or not isfinite(p_at) then
    raise exception using errcode = '22023', message = 'SEGMENT_PRINCIPAL_INVALID';
  end if;
  select coalesce(sum(lot.amount_micro_krw), 0)
    into v_sum
  from public.funding_principal_lots as lot
  where lot.user_id = p_user_id
    and lot.effective_at <= p_at;
  if v_sum is null or v_sum <> trunc(v_sum)
    or v_sum < 0 or v_sum > 9223372036854775807 then
    raise exception using errcode = '22003', message = 'SEGMENT_MICRO_OVERFLOW';
  end if;
  return v_sum::bigint;
end;
$$;

-- 그 시각의 발행 policy와 그 시각까지 모인 원금으로 조건과 30일 전체 자격을 읽는다.
create function app_private.funding_segment_condition(
  p_principal_micro bigint,
  p_effective_at timestamptz
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_policy jsonb;
  v_config jsonb;
  v_micro_text text;
  v_minimum_text text;
  v_rate_text text;
  v_micro_per bigint;
  v_minimum_krw bigint;
  v_rate_bps bigint;
  v_principal_krw bigint;
  v_tier jsonb;
  v_tier_count integer;
  v_retention_text text;
  v_retention_bps bigint;
  v_tier_code text;
  v_policy_id uuid;
  v_policy_version text;
  v_digest text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SEGMENT_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'SEGMENT_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_principal_micro is null or p_principal_micro <= 0
    or p_effective_at is null or not isfinite(p_effective_at) then
    raise exception using errcode = '22023', message = 'SEGMENT_PRINCIPAL_INVALID';
  end if;

  v_policy := public.read_effective_economy_policy(
    app_private.funding_segment_epoch_microseconds(p_effective_at));
  if coalesce(v_policy->>'schemaVersion', '') <> '1'
    or v_policy->>'reader' is distinct from 'EFFECTIVE_ECONOMY_POLICY'
    or v_policy->>'policyReceiptComplete' is distinct from 'true'
    or jsonb_typeof(v_policy->'policy'->'configuration') is distinct from 'object' then
    raise exception using errcode = '55000', message = 'SEGMENT_POLICY_UNVERIFIED';
  end if;
  v_config := v_policy->'policy'->'configuration';
  perform app_private.validate_economy_policy_config(v_config);

  v_micro_text := v_config->>'microKrwPerKrw';
  v_minimum_text := v_config->>'minimumPrincipalKrw';
  v_rate_text := v_config->>'baseCycleRateBps';
  v_policy_version := v_policy->'policy'->>'policyVersion';
  v_digest := v_policy->'policy'->>'configDigest';
  if v_micro_text !~ '^[1-9][0-9]*$'
    or v_minimum_text !~ '^[1-9][0-9]*$'
    or v_rate_text !~ '^(0|[1-9][0-9]*)$'
    or v_policy_version !~ '^[A-Z][A-Z0-9._-]{2,99}$'
    or v_digest !~ '^[a-f0-9]{64}$'
    or (v_policy->'policy'->>'policyId') !~ '^[0-9a-f-]{36}$' then
    raise exception using errcode = '55000', message = 'SEGMENT_POLICY_UNVERIFIED';
  end if;
  v_policy_id := (v_policy->'policy'->>'policyId')::uuid;
  v_micro_per := v_micro_text::bigint;
  v_minimum_krw := v_minimum_text::bigint;
  v_rate_bps := v_rate_text::bigint;
  if v_micro_per = 0 or p_principal_micro % v_micro_per <> 0
    or v_minimum_krw > 9223372036854775807 / v_micro_per then
    raise exception using errcode = '22023', message = 'SEGMENT_PRINCIPAL_INVALID';
  end if;
  v_principal_krw := p_principal_micro / v_micro_per;
  if v_principal_krw < v_minimum_krw then
    raise exception using errcode = '55000', message = 'SEGMENT_TIER_UNRESOLVED';
  end if;

  select count(*)::integer into v_tier_count
  from jsonb_array_elements(v_config->'tiers') as tier(item)
  where (tier.item->>'minimumPrincipalKrw') ~ '^(0|[1-9][0-9]*)$'
    and (tier.item->>'minimumPrincipalKrw')::bigint <= v_principal_krw
    and (
      jsonb_typeof(tier.item->'maximumPrincipalKrw') = 'null'
      or (
        (tier.item->>'maximumPrincipalKrw') ~ '^(0|[1-9][0-9]*)$'
        and (tier.item->>'maximumPrincipalKrw')::bigint >= v_principal_krw
      )
    );
  if v_tier_count is distinct from 1 then
    raise exception using errcode = '55000', message = 'SEGMENT_TIER_UNRESOLVED';
  end if;
  select tier.item into strict v_tier
  from jsonb_array_elements(v_config->'tiers') as tier(item)
  where (tier.item->>'minimumPrincipalKrw')::bigint <= v_principal_krw
    and (
      jsonb_typeof(tier.item->'maximumPrincipalKrw') = 'null'
      or (tier.item->>'maximumPrincipalKrw')::bigint >= v_principal_krw
    );
  v_tier_code := v_tier->>'code';
  v_retention_text := v_tier->>'retentionBonusBps';
  if v_tier_code is null or v_tier_code !~ '^[A-Za-z0-9_+-]{1,32}$'
    or v_retention_text !~ '^(0|[1-9][0-9]*)$' then
    raise exception using errcode = '55000', message = 'SEGMENT_TIER_UNRESOLVED';
  end if;
  v_retention_bps := v_retention_text::bigint;

  return jsonb_build_object(
    'principal_micro_krw', p_principal_micro::text,
    'tier_code', v_tier_code,
    'policy_id', v_policy_id,
    'policy_version', v_policy_version,
    'policy_config_digest', v_digest,
    'base_cycle_rate_bps', v_rate_bps::text,
    'retention_bonus_bps', v_retention_bps::text,
    'full_base_entitlement_micro_krw', app_private.funding_entitlement_portion_micro(
      p_principal_micro, v_rate_bps)::text,
    'full_retention_entitlement_micro_krw', app_private.funding_entitlement_portion_micro(
      p_principal_micro, v_retention_bps)::text
  );
end;
$$;

-- 첫 행은 cycle 전체 자격이다. 이후 행은 남은 기간의 새 조건과 기존 조건 차이다.
create function app_private.funding_segment_plan(
  p_user_id uuid,
  p_cycle_started_at timestamptz,
  p_cycle_end timestamptz,
  p_effective_at timestamptz,
  p_previous_id uuid
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_principal bigint;
  v_condition jsonb;
  v_previous app_private.funding_cycle_segments%rowtype;
  v_cycle_micro bigint;
  v_remaining_micro bigint;
  v_new_base bigint;
  v_new_retention bigint;
  v_old_base bigint;
  v_old_retention bigint;
  v_base bigint;
  v_retention bigint;
  v_kind text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SEGMENT_SERVICE_ROLE_REQUIRED';
  end if;
  if p_cycle_started_at is null or p_cycle_end is null or p_effective_at is null
    or p_effective_at < p_cycle_started_at or p_effective_at >= p_cycle_end then
    raise exception using errcode = '22023', message = 'SEGMENT_INTERVAL_INVALID';
  end if;
  v_principal := app_private.funding_segment_principal_micro(p_user_id, p_effective_at);
  if v_principal <= 0 then
    raise exception using errcode = '55000', message = 'SEGMENT_ANCHOR_UNRESOLVED';
  end if;
  v_condition := app_private.funding_segment_condition(v_principal, p_effective_at);
  v_cycle_micro := app_private.funding_segment_span_microseconds(
    p_cycle_started_at, p_cycle_end);
  v_remaining_micro := app_private.funding_segment_span_microseconds(
    p_effective_at, p_cycle_end);
  v_new_base := (v_condition->>'full_base_entitlement_micro_krw')::bigint;
  v_new_retention := (v_condition->>'full_retention_entitlement_micro_krw')::bigint;

  if p_previous_id is null then
    if p_effective_at is distinct from p_cycle_started_at then
      raise exception using errcode = '22023', message = 'SEGMENT_INTERVAL_INVALID';
    end if;
    v_base := app_private.funding_segment_scale_micro(
      v_new_base, v_cycle_micro, v_cycle_micro);
    v_retention := app_private.funding_segment_scale_micro(
      v_new_retention, v_cycle_micro, v_cycle_micro);
    v_kind := 'CYCLE_OPENING';
  else
    select segment.* into v_previous
    from app_private.funding_cycle_segments as segment
    where segment.id = p_previous_id;
    if v_previous.id is null or v_previous.user_id is distinct from p_user_id
      or v_previous.effective_until is distinct from p_cycle_end
      or v_previous.effective_at >= p_effective_at then
      raise exception using errcode = '55000', message = 'SEGMENT_PREVIOUS_MISSING';
    end if;
    if v_principal < v_previous.principal_micro_krw then
      raise exception using errcode = '55000', message = 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED';
    end if;
    if v_principal = v_previous.principal_micro_krw
      and v_condition->>'tier_code' is not distinct from v_previous.tier_code
      and (v_condition->>'policy_id')::uuid is not distinct from v_previous.policy_id
      and v_condition->>'policy_version' is not distinct from v_previous.policy_version
      and v_condition->>'policy_config_digest' is not distinct from v_previous.policy_config_digest
      and (v_condition->>'base_cycle_rate_bps')::bigint is not distinct from v_previous.base_cycle_rate_bps
      and (v_condition->>'retention_bonus_bps')::bigint is not distinct from v_previous.retention_bonus_bps then
      return jsonb_build_object('changed', false);
    end if;
    v_old_base := app_private.funding_entitlement_portion_micro(
      v_previous.principal_micro_krw, v_previous.base_cycle_rate_bps);
    v_old_retention := app_private.funding_entitlement_portion_micro(
      v_previous.principal_micro_krw, v_previous.retention_bonus_bps);
    v_base := app_private.funding_segment_scale_micro(v_new_base, v_remaining_micro, v_cycle_micro)
      - app_private.funding_segment_scale_micro(v_old_base, v_remaining_micro, v_cycle_micro);
    v_retention := app_private.funding_segment_scale_micro(
        v_new_retention, v_remaining_micro, v_cycle_micro)
      - app_private.funding_segment_scale_micro(
        v_old_retention, v_remaining_micro, v_cycle_micro);
    v_kind := 'REMAINDER_DELTA';
  end if;

  return jsonb_build_object(
    'changed', true,
    'principal_micro_krw', v_condition->>'principal_micro_krw',
    'tier_code', v_condition->>'tier_code',
    'policy_id', v_condition->>'policy_id',
    'policy_version', v_condition->>'policy_version',
    'policy_config_digest', v_condition->>'policy_config_digest',
    'base_cycle_rate_bps', v_condition->>'base_cycle_rate_bps',
    'retention_bonus_bps', v_condition->>'retention_bonus_bps',
    'base_entitlement_micro_krw', v_base::text,
    'retention_entitlement_micro_krw', v_retention::text,
    'retention_qualification', 'UNCONFIRMED',
    'entitlement_kind', v_kind
  );
end;
$$;

create function app_private.funding_segment_assert_matches(
  p_segment_id uuid,
  p_plan jsonb
) returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_row app_private.funding_cycle_segments%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SEGMENT_SERVICE_ROLE_REQUIRED';
  end if;
  select segment.* into v_row
  from app_private.funding_cycle_segments as segment
  where segment.id = p_segment_id;
  if v_row.id is null
    or coalesce((p_plan->>'changed')::boolean, false) is distinct from true
    or v_row.principal_micro_krw::text is distinct from p_plan->>'principal_micro_krw'
    or v_row.tier_code is distinct from p_plan->>'tier_code'
    or v_row.policy_id::text is distinct from p_plan->>'policy_id'
    or v_row.policy_version is distinct from p_plan->>'policy_version'
    or v_row.policy_config_digest is distinct from p_plan->>'policy_config_digest'
    or v_row.base_cycle_rate_bps::text is distinct from p_plan->>'base_cycle_rate_bps'
    or v_row.retention_bonus_bps::text is distinct from p_plan->>'retention_bonus_bps'
    or v_row.base_entitlement_micro_krw::text is distinct from p_plan->>'base_entitlement_micro_krw'
    or v_row.retention_entitlement_micro_krw::text is distinct from p_plan->>'retention_entitlement_micro_krw'
    or v_row.retention_qualification is distinct from p_plan->>'retention_qualification'
    or v_row.entitlement_kind is distinct from p_plan->>'entitlement_kind' then
    raise exception using errcode = '55000', message = 'SEGMENT_FROZEN_MISMATCH';
  end if;
end;
$$;

create function app_private.guard_funding_cycle_segment()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_cycle app_private.funding_cycle_windows%rowtype;
  v_previous_at timestamptz;
begin
  select opened.* into v_cycle
  from app_private.funding_cycle_windows as opened
  where opened.id = new.cycle_id;
  if v_cycle.id is null or v_cycle.user_id is distinct from new.user_id
    or new.effective_until is distinct from v_cycle.cycle_end
    or new.effective_at < v_cycle.cycle_started_at
    or new.effective_at >= v_cycle.cycle_end then
    raise exception using errcode = '55000', message = 'SEGMENT_INTERVAL_INVALID';
  end if;
  if new.segment_ordinal = 0 then
    if new.entitlement_kind is distinct from 'CYCLE_OPENING'
      or new.effective_at is distinct from v_cycle.cycle_started_at
      or exists (
        select 1 from app_private.funding_cycle_segments as segment
        where segment.cycle_id = new.cycle_id
      ) then
      raise exception using errcode = '55000', message = 'SEGMENT_OPENING_INVALID';
    end if;
  else
    select segment.effective_at into v_previous_at
    from app_private.funding_cycle_segments as segment
    where segment.cycle_id = new.cycle_id
      and segment.segment_ordinal = new.segment_ordinal - 1;
    if new.entitlement_kind is distinct from 'REMAINDER_DELTA'
      or v_previous_at is null
      or new.effective_at <= v_previous_at then
      raise exception using errcode = '55000', message = 'SEGMENT_BOUNDARY_ORDER';
    end if;
  end if;
  return new;
end;
$$;

create trigger funding_cycle_segments_verify_boundary
before insert on app_private.funding_cycle_segments
for each row execute function app_private.guard_funding_cycle_segment();

create trigger funding_cycle_segments_append_only
before update or delete on app_private.funding_cycle_segments
for each row execute function app_private.prevent_row_mutation();

create function app_private.ensure_funding_cycle_segments(p_user_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_state jsonb;
  v_status text;
  v_now timestamptz;
  v_cycle app_private.funding_cycle_windows%rowtype;
  v_opening app_private.funding_cycle_segments%rowtype;
  v_existing app_private.funding_cycle_segments%rowtype;
  v_previous app_private.funding_cycle_segments%rowtype;
  v_latest app_private.funding_cycle_segments%rowtype;
  v_boundary record;
  v_at timestamptz;
  v_plan jsonb;
  v_changed boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SEGMENT_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'SEGMENT_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-segment:' || p_user_id::text, 0));

  v_state := app_private.read_funding_principal_foundation(p_user_id);
  v_status := v_state->>'funding_status';
  if v_status is null or v_status not in (
    'FUNDING_BELOW_MINIMUM',
    'FUNDING_MINIMUM_MET',
    'FUNDING_PRINCIPAL_UNRESOLVED'
  ) then
    raise exception using errcode = '55000', message = 'SEGMENT_FUNDING_STATUS_UNKNOWN';
  end if;

  perform app_private.ensure_funding_cycle_windows(p_user_id);
  if v_status is distinct from 'FUNDING_MINIMUM_MET' then
    return;
  end if;

  -- policy reader와 같은 실제 시계다. 회원 요청 시각으로 경계를 만들지 않는다.
  v_now := clock_timestamp();
  if not isfinite(v_now) then
    raise exception using errcode = '22023', message = 'SEGMENT_TIME_INVALID';
  end if;

  for v_cycle in
    select opened.*
    from app_private.funding_cycle_windows as opened
    where opened.user_id = p_user_id
      and opened.cycle_started_at <= v_now
    order by opened.cycle_ordinal
  loop
    v_opening := null;
    select segment.* into v_opening
    from app_private.funding_cycle_segments as segment
    where segment.cycle_id = v_cycle.id
      and segment.segment_ordinal = 0;
    v_plan := app_private.funding_segment_plan(
      p_user_id, v_cycle.cycle_started_at, v_cycle.cycle_end,
      v_cycle.cycle_started_at, null);
    if v_opening.id is null then
      if exists (
        select 1 from app_private.funding_cycle_segments as segment
        where segment.cycle_id = v_cycle.id
      ) then
        raise exception using errcode = '55000', message = 'SEGMENT_OPENING_MISSING';
      end if;
      insert into app_private.funding_cycle_segments (
        user_id, cycle_id, segment_ordinal, principal_micro_krw, tier_code,
        policy_id, policy_version, policy_config_digest,
        base_cycle_rate_bps, retention_bonus_bps,
        effective_at, effective_until,
        base_entitlement_micro_krw, retention_entitlement_micro_krw,
        retention_qualification, entitlement_kind
      ) values (
        p_user_id, v_cycle.id, 0,
        (v_plan->>'principal_micro_krw')::bigint,
        v_plan->>'tier_code',
        (v_plan->>'policy_id')::uuid,
        v_plan->>'policy_version',
        v_plan->>'policy_config_digest',
        (v_plan->>'base_cycle_rate_bps')::bigint,
        (v_plan->>'retention_bonus_bps')::bigint,
        v_cycle.cycle_started_at, v_cycle.cycle_end,
        (v_plan->>'base_entitlement_micro_krw')::bigint,
        (v_plan->>'retention_entitlement_micro_krw')::bigint,
        v_plan->>'retention_qualification',
        v_plan->>'entitlement_kind'
      );
    else
      if v_opening.effective_at is distinct from v_cycle.cycle_started_at
        or v_opening.effective_until is distinct from v_cycle.cycle_end then
        raise exception using errcode = '55000', message = 'SEGMENT_FROZEN_MISMATCH';
      end if;
      perform app_private.funding_segment_assert_matches(v_opening.id, v_plan);
    end if;

    for v_boundary in
      select boundary.effective_at
      from (
        select lot.effective_at
        from public.funding_principal_lots as lot
        where lot.user_id = p_user_id
          and lot.effective_at > v_cycle.cycle_started_at
          and lot.effective_at < v_cycle.cycle_end
          and lot.effective_at <= v_now
        union
        select published.effective_from
        from app_private.economy_policy_published as published
        where published.effective_from > v_cycle.cycle_started_at
          and published.effective_from < v_cycle.cycle_end
          and published.effective_from <= v_now
      ) as boundary(effective_at)
      order by boundary.effective_at
    loop
      v_at := v_boundary.effective_at;
      v_previous := null;
      v_latest := null;
      v_existing := null;
      select segment.* into v_previous
      from app_private.funding_cycle_segments as segment
      where segment.cycle_id = v_cycle.id
        and segment.effective_at < v_at
      order by segment.segment_ordinal desc
      limit 1;
      select segment.* into v_latest
      from app_private.funding_cycle_segments as segment
      where segment.cycle_id = v_cycle.id
      order by segment.segment_ordinal desc
      limit 1;
      if v_previous.id is null or v_latest.id is null then
        raise exception using errcode = '55000', message = 'SEGMENT_OPENING_MISSING';
      end if;
      select segment.* into v_existing
      from app_private.funding_cycle_segments as segment
      where segment.cycle_id = v_cycle.id
        and segment.effective_at = v_at;
      v_plan := app_private.funding_segment_plan(
        p_user_id, v_cycle.cycle_started_at, v_cycle.cycle_end, v_at, v_previous.id);
      v_changed := coalesce((v_plan->>'changed')::boolean, false);
      if v_existing.id is not null then
        if not v_changed
          or v_existing.effective_until is distinct from v_cycle.cycle_end then
          raise exception using errcode = '55000', message = 'SEGMENT_FROZEN_MISMATCH';
        end if;
        perform app_private.funding_segment_assert_matches(v_existing.id, v_plan);
        continue;
      end if;
      if not v_changed then
        continue;
      end if;
      if v_at <= v_latest.effective_at then
        raise exception using errcode = '55000', message = 'SEGMENT_LATE_BOUNDARY';
      end if;
      if v_latest.segment_ordinal >= 4000 then
        raise exception using errcode = '22003', message = 'SEGMENT_HORIZON_EXCEEDED';
      end if;
      insert into app_private.funding_cycle_segments (
        user_id, cycle_id, segment_ordinal, principal_micro_krw, tier_code,
        policy_id, policy_version, policy_config_digest,
        base_cycle_rate_bps, retention_bonus_bps,
        effective_at, effective_until,
        base_entitlement_micro_krw, retention_entitlement_micro_krw,
        retention_qualification, entitlement_kind
      ) values (
        p_user_id, v_cycle.id, v_latest.segment_ordinal + 1,
        (v_plan->>'principal_micro_krw')::bigint,
        v_plan->>'tier_code',
        (v_plan->>'policy_id')::uuid,
        v_plan->>'policy_version',
        v_plan->>'policy_config_digest',
        (v_plan->>'base_cycle_rate_bps')::bigint,
        (v_plan->>'retention_bonus_bps')::bigint,
        v_at, v_cycle.cycle_end,
        (v_plan->>'base_entitlement_micro_krw')::bigint,
        (v_plan->>'retention_entitlement_micro_krw')::bigint,
        v_plan->>'retention_qualification',
        v_plan->>'entitlement_kind'
      );
    end loop;
  end loop;
end;
$$;

create function app_private.read_funding_segment_foundation(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_state jsonb;
  v_status text;
  v_now timestamptz;
  v_active_count integer;
  v_active_id uuid;
  v_started timestamptz;
  v_end timestamptz;
  v_count integer := 0;
  v_base_sum numeric := 0;
  v_retention_sum numeric := 0;
  v_base_text text;
  v_retention_text text;
  v_segments jsonb := '[]'::jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SEGMENT_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'SEGMENT_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  v_state := app_private.read_funding_principal_foundation(p_user_id);
  v_status := v_state->>'funding_status';
  if v_status is null or v_status not in (
    'FUNDING_BELOW_MINIMUM',
    'FUNDING_MINIMUM_MET',
    'FUNDING_PRINCIPAL_UNRESOLVED'
  ) then
    raise exception using errcode = '55000', message = 'SEGMENT_FUNDING_STATUS_UNKNOWN';
  end if;

  v_now := clock_timestamp();
  select count(*)::integer into v_active_count
  from app_private.funding_cycle_windows as opened
  where opened.user_id = p_user_id
    and opened.cycle_started_at <= v_now
    and opened.cycle_end > v_now;
  if v_active_count > 1 then
    raise exception using errcode = '55000', message = 'SEGMENT_WINDOW_OVERLAP';
  end if;
  if v_active_count = 1 then
    select opened.id, opened.cycle_started_at, opened.cycle_end
      into strict v_active_id, v_started, v_end
    from app_private.funding_cycle_windows as opened
    where opened.user_id = p_user_id
      and opened.cycle_started_at <= v_now
      and opened.cycle_end > v_now;
    select count(*)::integer,
      coalesce(sum(segment.base_entitlement_micro_krw), 0),
      coalesce(sum(segment.retention_entitlement_micro_krw), 0)
      into v_count, v_base_sum, v_retention_sum
    from app_private.funding_cycle_segments as segment
    where segment.cycle_id = v_active_id;
    select coalesce(jsonb_agg(item.segment order by item.ordinal), '[]'::jsonb)
      into v_segments
    from (
      select segment.segment_ordinal as ordinal,
        jsonb_build_object(
          'segment_ordinal', segment.segment_ordinal,
          'principal_micro_krw', segment.principal_micro_krw::text,
          'tier_code', segment.tier_code,
          'policy_id', segment.policy_id,
          'policy_version', segment.policy_version,
          'policy_config_digest', segment.policy_config_digest,
          'base_cycle_rate_bps', segment.base_cycle_rate_bps::text,
          'retention_bonus_bps', segment.retention_bonus_bps::text,
          'effective_at', segment.effective_at,
          'effective_until', segment.effective_until,
          'base_entitlement_micro_krw', segment.base_entitlement_micro_krw::text,
          'retention_entitlement_micro_krw', segment.retention_entitlement_micro_krw::text,
          'retention_qualification', segment.retention_qualification,
          'entitlement_kind', segment.entitlement_kind
        ) as segment
      from app_private.funding_cycle_segments as segment
      where segment.cycle_id = v_active_id
    ) as item;
  end if;
  if v_base_sum <> trunc(v_base_sum) or v_retention_sum <> trunc(v_retention_sum) then
    raise exception using errcode = '22003', message = 'SEGMENT_MICRO_OVERFLOW';
  end if;
  begin
    v_base_text := v_base_sum::bigint::text;
    v_retention_text := v_retention_sum::bigint::text;
  exception
    when numeric_value_out_of_range then
      raise exception using errcode = '22003', message = 'SEGMENT_MICRO_OVERFLOW';
  end;

  return jsonb_build_object(
    'schema_version', 1,
    'reader', 'FUNDING_SEGMENT_FOUNDATION',
    'funding_status', v_status,
    'active_cycle_id', v_active_id,
    'cycle_started_at', v_started,
    'cycle_end', v_end,
    'segment_count', v_count,
    'cycle_base_entitlement_micro_krw', v_base_text,
    'cycle_retention_entitlement_micro_krw', v_retention_text,
    'segments', v_segments,
    'retention_verified_credit', false,
    'ledger_credit_created', false
  );
end;
$$;

revoke all on function app_private.funding_segment_span_microseconds(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_span_microseconds(timestamptz, timestamptz)
  to service_role;
revoke all on function app_private.funding_segment_epoch_microseconds(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_epoch_microseconds(timestamptz)
  to service_role;
revoke all on function app_private.funding_segment_scale_micro(bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_scale_micro(bigint, bigint, bigint)
  to service_role;
revoke all on function app_private.funding_segment_principal_micro(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_principal_micro(uuid, timestamptz)
  to service_role;
revoke all on function app_private.funding_segment_condition(bigint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_condition(bigint, timestamptz)
  to service_role;
revoke all on function app_private.funding_segment_plan(uuid, timestamptz, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_plan(uuid, timestamptz, timestamptz, timestamptz, uuid)
  to service_role;
revoke all on function app_private.funding_segment_assert_matches(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_segment_assert_matches(uuid, jsonb)
  to service_role;
revoke all on function app_private.guard_funding_cycle_segment()
  from public, anon, authenticated, service_role;
grant execute on function app_private.guard_funding_cycle_segment() to service_role;
revoke all on function app_private.ensure_funding_cycle_segments(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.ensure_funding_cycle_segments(uuid) to service_role;
revoke all on function app_private.read_funding_segment_foundation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_funding_segment_foundation(uuid) to service_role;

comment on table app_private.funding_cycle_segments is
  '사용자 cycle 하나의 시간 segment. principal, tier, rule version, effective_at, effective_until을 고정한다. 이후 입금은 이전 행을 바꾸지 않는다.';
comment on function app_private.funding_segment_scale_micro(bigint, bigint, bigint) is
  '남은 기간 비율을 bigint로 곱하고 나눈다. 1 micro-KRW 미만은 reward_carry로 저장하지 않는다.';
comment on function app_private.ensure_funding_cycle_segments(uuid) is
  'cycle 시작 segment를 고정하고, 이후 변경은 남은 기간 차이만 새 행으로 연다. 창 시각과 원장 credit은 바꾸지 않는다.';
comment on function app_private.read_funding_segment_foundation(uuid) is
  '저장된 segment만 읽는다. base와 미확정 retention을 나누며 원장 credit을 만들지 않는다.';

commit;
