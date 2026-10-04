begin;

-- 사용자당 30일 rolling cycle 창만 저장한다.
-- 상품별 복제, segment, proration, used/remaining, settlement, worker, 원장 credit은 없다.
-- 창 길이는 발행 policy의 cycleDays를 24시간 단위로 더한 값이다.
-- 세션 시간대의 달력 일로 밀지 않는다. 부분 원금 회수 배분은 바꾸지 않는다.

create table app_private.funding_cycle_windows (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users (id) on delete restrict,
  cycle_ordinal integer not null check (cycle_ordinal >= 0),
  cycle_days integer not null check (cycle_days between 1 and 3660),
  cycle_started_at timestamptz not null,
  cycle_end timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (user_id, cycle_ordinal),
  unique (user_id, cycle_started_at),
  check (isfinite(cycle_started_at) and isfinite(cycle_end)),
  check (cycle_end = cycle_started_at + cycle_days * interval '24 hours')
);

create index funding_cycle_windows_owner_start
  on app_private.funding_cycle_windows (user_id, cycle_started_at);

alter table app_private.funding_cycle_windows enable row level security;
alter table app_private.funding_cycle_windows force row level security;
revoke all on app_private.funding_cycle_windows
  from public, anon, authenticated, service_role;
grant select, insert on app_private.funding_cycle_windows to service_role;

create function app_private.guard_funding_cycle_window()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_previous_end timestamptz;
  v_previous_days integer;
begin
  if new.cycle_end is distinct from
    new.cycle_started_at + new.cycle_days * interval '24 hours' then
    raise exception using errcode = '22023', message = 'FUNDING_CYCLE_DURATION_INVALID';
  end if;
  if new.cycle_ordinal = 0 then
    if exists (
      select 1
      from app_private.funding_cycle_windows as opened
      where opened.user_id = new.user_id
    ) then
      raise exception using errcode = '55000', message = 'FUNDING_CYCLE_ANCHOR_EXISTS';
    end if;
  else
    select opened.cycle_end, opened.cycle_days
      into v_previous_end, v_previous_days
    from app_private.funding_cycle_windows as opened
    where opened.user_id = new.user_id
      and opened.cycle_ordinal = new.cycle_ordinal - 1;
    if v_previous_end is null
      or new.cycle_started_at is distinct from v_previous_end
      or new.cycle_days is distinct from v_previous_days then
      raise exception using errcode = '55000', message = 'FUNDING_CYCLE_BOUNDARY_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_funding_cycle_window()
  from public, anon, authenticated, service_role;
grant execute on function app_private.guard_funding_cycle_window() to service_role;

create trigger funding_cycle_windows_verify_boundary
before insert on app_private.funding_cycle_windows
for each row execute function app_private.guard_funding_cycle_window();

create trigger funding_cycle_windows_append_only
before update or delete on app_private.funding_cycle_windows
for each row execute function app_private.prevent_row_mutation();

-- 데이터베이스 소유자만 평가 시각을 바꿀 수 있다. service_role의 설정은 무시한다.
-- 회원 요청 시각이 아니며, 운영 기본값은 clock_timestamp()다.
create function app_private.funding_cycle_server_instant()
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_text text;
  v_as_of timestamptz;
begin
  if current_user in ('postgres', 'supabase_admin') then
    v_text := nullif(btrim(coalesce(
      current_setting('putduk.funding_cycle_as_of', true), '')), '');
    if v_text is not null then
      begin
        v_as_of := v_text::timestamptz;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          raise exception using
            errcode = '22023', message = 'FUNDING_CYCLE_INVALID_SERVER_TIME';
      end;
      if v_as_of is null or not isfinite(v_as_of) then
        raise exception using
          errcode = '22023', message = 'FUNDING_CYCLE_INVALID_SERVER_TIME';
      end if;
      return v_as_of;
    end if;
  end if;
  v_as_of := clock_timestamp();
  if not isfinite(v_as_of) then
    raise exception using
      errcode = '22023', message = 'FUNDING_CYCLE_INVALID_SERVER_TIME';
  end if;
  return v_as_of;
end;
$$;

-- 첫 창의 길이만 발행 policy에서 읽는다. 이후 창은 저장된 cycle_days를 복사한다.
create function app_private.funding_cycle_policy_days()
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_now timestamptz;
  v_now_microseconds bigint;
  v_policy jsonb;
  v_config jsonb;
  v_days_text text;
  v_days bigint;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'FUNDING_CYCLE_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'FUNDING_CYCLE_FRESH_SNAPSHOT_REQUIRED';
  end if;
  v_now := clock_timestamp();
  if not isfinite(v_now) then
    raise exception using errcode = '22023', message = 'FUNDING_CYCLE_INVALID_SERVER_TIME';
  end if;
  v_now_microseconds := (extract(epoch from v_now) * 1000000)::bigint;
  if v_now_microseconds < 0 then
    raise exception using errcode = '22023', message = 'FUNDING_CYCLE_INVALID_SERVER_TIME';
  end if;
  v_policy := public.read_effective_economy_policy(v_now_microseconds);
  if coalesce(v_policy->>'schemaVersion', '') <> '1'
    or v_policy->>'reader' is distinct from 'EFFECTIVE_ECONOMY_POLICY'
    or v_policy->>'policyReceiptComplete' is distinct from 'true'
    or jsonb_typeof(v_policy->'policy'->'configuration') is distinct from 'object' then
    raise exception using errcode = '55000', message = 'FUNDING_CYCLE_POLICY_UNVERIFIED';
  end if;
  v_config := v_policy->'policy'->'configuration';
  perform app_private.validate_economy_policy_config(v_config);
  v_days_text := v_config->>'cycleDays';
  if v_days_text !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'FUNDING_CYCLE_DURATION_INVALID';
  end if;
  v_days := v_days_text::bigint;
  -- 3660은 창 길이의 오버플로 가드다. 상품 주기나 등급 숫자가 아니다.
  if v_days > 3660 then
    raise exception using errcode = '22023', message = 'FUNDING_CYCLE_DURATION_INVALID';
  end if;
  return v_days::integer;
end;
$$;

create function app_private.ensure_funding_cycle_windows(p_user_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_principal jsonb;
  v_status text;
  v_minimum_text text;
  v_minimum_micro bigint;
  v_running bigint := 0;
  v_anchor timestamptz;
  v_cycle_days integer;
  v_as_of timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_ordinal integer := 0;
  v_existing_start timestamptz;
  v_existing_end timestamptz;
  v_lot record;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'FUNDING_CYCLE_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'FUNDING_CYCLE_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  -- 같은 회원의 창 추가만 직렬화한다. 원장 잠금 순서를 바꾸지 않는다.
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:' || p_user_id::text, 0));

  v_principal := app_private.read_funding_principal_foundation(p_user_id);
  v_status := v_principal->>'funding_status';
  if v_status is null or v_status not in (
    'FUNDING_BELOW_MINIMUM',
    'FUNDING_MINIMUM_MET',
    'FUNDING_PRINCIPAL_UNRESOLVED'
  ) then
    raise exception using errcode = '55000', message = 'FUNDING_CYCLE_FUNDING_STATUS_UNKNOWN';
  end if;

  select opened.cycle_started_at, opened.cycle_days
    into v_anchor, v_cycle_days
  from app_private.funding_cycle_windows as opened
  where opened.user_id = p_user_id
    and opened.cycle_ordinal = 0;

  if v_anchor is null then
    if v_status is distinct from 'FUNDING_MINIMUM_MET' then
      return;
    end if;
    v_cycle_days := app_private.funding_cycle_policy_days();
    v_minimum_text := v_principal->>'minimum_principal_micro_krw';
    if v_minimum_text is null or v_minimum_text !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'FUNDING_CYCLE_MINIMUM_INVALID';
    end if;
    v_minimum_micro := v_minimum_text::bigint;
    for v_lot in
      select lot.effective_at, lot.amount_micro_krw
      from public.funding_principal_lots as lot
      where lot.user_id = p_user_id
      order by lot.effective_at, lot.id
    loop
      if v_lot.amount_micro_krw is null or v_lot.amount_micro_krw <= 0
        or v_lot.effective_at is null or not isfinite(v_lot.effective_at) then
        raise exception using errcode = '55000', message = 'FUNDING_CYCLE_ANCHOR_UNRESOLVED';
      end if;
      if v_running > 9223372036854775807 - v_lot.amount_micro_krw then
        raise exception using errcode = '22003', message = 'FUNDING_CYCLE_MICRO_OVERFLOW';
      end if;
      v_running := v_running + v_lot.amount_micro_krw;
      if v_running >= v_minimum_micro then
        v_anchor := v_lot.effective_at;
        exit;
      end if;
    end loop;
    if v_anchor is null then
      raise exception using errcode = '55000', message = 'FUNDING_CYCLE_ANCHOR_UNRESOLVED';
    end if;
  elsif v_status is distinct from 'FUNDING_MINIMUM_MET' then
    -- 이미 열린 창은 지우거나 길이를 바꾸지 않는다. 원금이 최소 미만이면 다음 창도 열지 않는다.
    return;
  end if;

  v_as_of := app_private.funding_cycle_server_instant();
  if v_as_of < v_anchor then
    return;
  end if;

  v_start := v_anchor;
  while v_start <= v_as_of loop
    if v_ordinal > 4000 then
      raise exception using errcode = '22003', message = 'FUNDING_CYCLE_HORIZON_EXCEEDED';
    end if;
    v_end := v_start + v_cycle_days * interval '24 hours';
    if v_end is null or not isfinite(v_end) or v_end <= v_start then
      raise exception using errcode = '22023', message = 'FUNDING_CYCLE_DURATION_INVALID';
    end if;
    v_existing_start := null;
    v_existing_end := null;
    select opened.cycle_started_at, opened.cycle_end
      into v_existing_start, v_existing_end
    from app_private.funding_cycle_windows as opened
    where opened.user_id = p_user_id
      and opened.cycle_ordinal = v_ordinal;
    if v_existing_start is null then
      insert into app_private.funding_cycle_windows (
        user_id, cycle_ordinal, cycle_days, cycle_started_at, cycle_end
      ) values (
        p_user_id, v_ordinal, v_cycle_days, v_start, v_end
      );
    elsif v_existing_start is distinct from v_start
      or v_existing_end is distinct from v_end then
      raise exception using errcode = '55000', message = 'FUNDING_CYCLE_BOUNDARY_MISMATCH';
    end if;
    v_start := v_end;
    v_ordinal := v_ordinal + 1;
  end loop;
end;
$$;

create function app_private.read_funding_cycle_foundation(p_user_id uuid)
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
  v_count integer;
  v_active_count integer;
  v_active_id uuid;
  v_started timestamptz;
  v_end timestamptz;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'FUNDING_CYCLE_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'FUNDING_CYCLE_FRESH_SNAPSHOT_REQUIRED';
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
    raise exception using errcode = '55000', message = 'FUNDING_CYCLE_FUNDING_STATUS_UNKNOWN';
  end if;

  v_as_of := app_private.funding_cycle_server_instant();
  select count(*)::integer into v_count
  from app_private.funding_cycle_windows as opened
  where opened.user_id = p_user_id;
  select count(*)::integer into v_active_count
  from app_private.funding_cycle_windows as opened
  where opened.user_id = p_user_id
    and opened.cycle_started_at <= v_as_of
    and opened.cycle_end > v_as_of;
  if v_active_count > 1 then
    raise exception using errcode = '55000', message = 'FUNDING_CYCLE_WINDOW_OVERLAP';
  end if;
  if v_active_count = 1 then
    select opened.id, opened.cycle_started_at, opened.cycle_end
      into strict v_active_id, v_started, v_end
    from app_private.funding_cycle_windows as opened
    where opened.user_id = p_user_id
      and opened.cycle_started_at <= v_as_of
      and opened.cycle_end > v_as_of;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'reader', 'FUNDING_CYCLE_FOUNDATION',
    'funding_status', v_status,
    'cycle_count', v_count,
    'active_cycle_id', v_active_id,
    'cycle_started_at', v_started,
    'cycle_end', v_end,
    'ledger_credit_created', false
  );
end;
$$;

revoke all on function app_private.funding_cycle_server_instant()
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_cycle_server_instant() to service_role;
revoke all on function app_private.funding_cycle_policy_days()
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_cycle_policy_days() to service_role;
revoke all on function app_private.ensure_funding_cycle_windows(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.ensure_funding_cycle_windows(uuid) to service_role;
revoke all on function app_private.read_funding_cycle_foundation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_funding_cycle_foundation(uuid) to service_role;

comment on table app_private.funding_cycle_windows is
  '사용자별 30일 창. 시작과 끝만 보관하고 이전 행은 지우지 않는다. 금액, segment, settlement는 없다.';
comment on function app_private.ensure_funding_cycle_windows(uuid) is
  '최소 원금을 처음 넘긴 lot의 effective_at에 창을 고정한다. 추가 입금과 등급 변경으로 시작과 끝을 옮기지 않으며 원장 credit을 만들지 않는다.';
comment on function app_private.read_funding_cycle_foundation(uuid) is
  '저장된 창만 읽는다. 행을 추가하지 않고 retention을 확정 잔액으로 바꾸지 않는다.';

commit;
