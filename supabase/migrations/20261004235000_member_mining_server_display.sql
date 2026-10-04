begin;

-- 회원 화면은 app_private 조회를 직접 호출하지 못한다.
-- authenticated EXECUTE는 이 함수에만 주고, 아래 여섯 함수에는 주지 않는다.
-- 공식, policy, segment 행, 한도 상한은 반환하지 않는다.
-- 활성 창의 prior와 multiplier 결합 순서는 만들지 않는다.
-- 빈 배수와 저장된 창 길이만 기존 capacity 함수에 넘긴다.
-- 화면의 한도, 속도, pending은 저장된 segment로 이미 계산된 pending 값을 쓴다.
-- retention_unconfirmed_micro_krw는 pending에 더하지 않는다.
-- 원장, wallet, reward_carry, worker, snapshot 표는 만들지 않는다.

create function public.read_own_mining_server_display(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid;
  v_message text;
  v_principal jsonb;
  v_entitlement jsonb;
  v_cycle jsonb;
  v_pending jsonb;
  v_capacity jsonb;
  v_active_id uuid;
  v_days integer;
  v_span bigint;
  v_effective text;
  v_remaining text;
  v_used text;
  v_speed text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception using errcode = '42501', message = 'MINING_DISPLAY_SIGN_IN_REQUIRED';
  end if;
  if p_user_id is null or p_user_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'MINING_DISPLAY_SUBJECT_FORBIDDEN';
  end if;

  begin
    v_principal := app_private.read_funding_principal_foundation(v_actor);
  exception
    when sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      if v_message is distinct from 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND' then
        raise;
      end if;
      return jsonb_build_object(
        'available', false,
        'eligible_principal_micro_krw', null,
        'tier_code', null,
        'tier_activated', false,
        'cycle_started_at', null,
        'cycle_end', null,
        'effective_capacity_micro_krw', null,
        'remaining_capacity_micro_krw', null,
        'used_capacity_micro_krw', null,
        'speed_multiplier_bps', null,
        'pending_micro_krw', null,
        'retention_unconfirmed_micro_krw', null
      );
  end;

  v_entitlement := app_private.read_funding_entitlement_foundation(v_actor);
  v_cycle := app_private.read_funding_cycle_foundation(v_actor);
  perform app_private.read_funding_segment_foundation(v_actor);
  v_pending := app_private.read_funding_reward_pending(v_actor);

  -- 등급이 켜졌는데 창이 없으면 capacity 함수는 창을 만들지 않고 거절한다.
  -- 그 경우는 pending이 이미 0으로 돌려준 값을 표시한다.
  if v_entitlement->>'tier_activated' is distinct from 'true' then
    v_capacity := app_private.read_funding_capacity_speed(
      v_actor,
      0,
      array[]::bigint[],
      array[]::bigint[],
      null, null, null, null, null, null,
      0);
  elsif v_cycle->>'active_cycle_id' is not null then
    if v_cycle->>'active_cycle_id' !~ '^[0-9a-f-]{36}$' then
      raise exception using errcode = '55000', message = 'MINING_DISPLAY_CYCLE_UNAVAILABLE';
    end if;
    v_active_id := (v_cycle->>'active_cycle_id')::uuid;
    select opened.cycle_days into v_days
    from app_private.funding_cycle_windows as opened
    where opened.id = v_active_id
      and opened.user_id = v_actor;
    if v_days is null or v_days <= 0
      or v_days::bigint > 9223372036854775807 / 86400000000 then
      raise exception using errcode = '55000', message = 'MINING_DISPLAY_CYCLE_UNAVAILABLE';
    end if;
    v_span := v_days::bigint * 24::bigint * 60::bigint * 60::bigint * 1000000::bigint;
    v_capacity := app_private.read_funding_capacity_speed(
      v_actor,
      0,
      array[]::bigint[],
      array[]::bigint[],
      null, null, null, null, null, null,
      v_span);
  end if;

  v_effective := v_pending->>'effective_capacity_micro_krw';
  v_remaining := v_pending->>'remaining_capacity_micro_krw';
  v_used := v_pending->>'used_capacity_micro_krw';
  v_speed := v_pending->>'speed_multiplier_bps';
  if v_capacity is not null then
    if v_effective is null then
      v_effective := v_capacity->>'effective_capacity_micro_krw';
    end if;
    if v_remaining is null then
      v_remaining := v_capacity->>'remaining_capacity_micro_krw';
    end if;
    if v_used is null then
      v_used := v_capacity->>'used_capacity_micro_krw';
    end if;
    if v_speed is null then
      v_speed := v_capacity->>'speed_multiplier_bps';
    end if;
  end if;

  return jsonb_build_object(
    'available', true,
    'eligible_principal_micro_krw', v_principal->>'eligible_principal_micro_krw',
    'tier_code', v_entitlement->>'tier_code',
    'tier_activated', coalesce(v_entitlement->>'tier_activated' = 'true', false),
    'cycle_started_at', v_cycle->>'cycle_started_at',
    'cycle_end', v_cycle->>'cycle_end',
    'effective_capacity_micro_krw', v_effective,
    'remaining_capacity_micro_krw', v_remaining,
    'used_capacity_micro_krw', v_used,
    'speed_multiplier_bps', v_speed,
    'pending_micro_krw', v_pending->>'pending_micro_krw',
    'retention_unconfirmed_micro_krw', v_pending->>'retention_unconfirmed_micro_krw'
  );
end;
$$;

-- service_role은 public 스키마 CREATE가 없다.
-- 소유자 변경에만 잠깐 쓰고, 회원 앱에 스키마 생성 권한은 남기지 않는다.
do $$
begin
  if has_schema_privilege('service_role', 'public', 'create') then
    alter function public.read_own_mining_server_display(uuid) owner to service_role;
  else
    grant create on schema public to service_role;
    alter function public.read_own_mining_server_display(uuid) owner to service_role;
    revoke create on schema public from service_role;
  end if;
end;
$$;

revoke all on function public.read_own_mining_server_display(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_own_mining_server_display(uuid) to authenticated;

comment on function public.read_own_mining_server_display(uuid) is
  '로그인한 회원 본인의 채굴 표시값만 반환한다. 다른 회원과 미로그인은 거절한다. pending에 미확정 retention을 더하지 않는다.';

commit;
