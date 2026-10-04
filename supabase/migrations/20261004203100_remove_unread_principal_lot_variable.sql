begin;

-- v_lot_micro는 lot.amount_micro_krw 합계만 받는다.
-- 그 합계는 회수 예약을 빼지 않아 반환값과 최소 원금 비교에 쓰지 않는다.
-- 채굴 인정 원금은 funding_principal_mining_eligible_micro만 읽는다.
-- 선언만 남은 변수는 schema lint warning이므로 제거한다.

create or replace function app_private.read_funding_principal_foundation(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_coverage text;
  v_eligible_text text;
  v_minimum_text text;
  v_minimum_krw bigint;
  v_minimum_micro bigint;
  v_lot_atomic bigint;
  v_lot_count integer;
  v_epoch timestamptz;
  v_status text;
  v_net bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;
  select summary.coverage, summary.eligible_principal_atomic
  into v_coverage, v_eligible_text
  from public.money_source_summaries as summary
  where summary.user_id = p_user_id;
  if v_coverage is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  select policy.config->>'minimumPrincipalKrw' into v_minimum_text
  from app_private.economy_policy_published as policy
  where policy.effective_from <= statement_timestamp()
    and (policy.effective_until is null or policy.effective_until > statement_timestamp())
  order by policy.effective_from desc
  limit 1;
  if v_minimum_text is null or v_minimum_text !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '55000', message = 'FUNDING_MINIMUM_POLICY_UNAVAILABLE';
  end if;
  v_minimum_krw := v_minimum_text::bigint;
  v_minimum_micro := app_private.funding_principal_micro_krw(v_minimum_krw);

  select introduced_at into v_epoch
  from app_private.funding_principal_epochs
  where version = 1;
  select coalesce(sum(lot.amount_atomic), 0), count(*)::integer
  into v_lot_atomic, v_lot_count
  from public.funding_principal_lots as lot
  where lot.user_id = p_user_id;

  if v_coverage is distinct from 'COMPLETE' then
    return jsonb_build_object(
      'eligible_principal_micro_krw', null,
      'minimum_principal_micro_krw', v_minimum_micro::text,
      'funding_status', 'FUNDING_PRINCIPAL_UNRESOLVED',
      'lot_count', v_lot_count
    );
  end if;

  if exists (
    select 1
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.recorded_at >= v_epoch
      and movement.amount_atomic <= 9223372036854
      and not exists (
        select 1 from public.funding_principal_lots as lot
        where lot.money_source_movement_id = movement.id
          and lot.amount_atomic = movement.amount_atomic
          and lot.effective_at = movement.effective_at
          and lot.origin_code = movement.origin_code
      )
  ) then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_LOT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.amount_atomic > 9223372036854
  ) then
    return jsonb_build_object(
      'eligible_principal_micro_krw', null,
      'minimum_principal_micro_krw', v_minimum_micro::text,
      'funding_status', 'FUNDING_PRINCIPAL_UNRESOLVED',
      'lot_count', v_lot_count
    );
  end if;

  if exists (
    select 1
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.recorded_at < v_epoch
  ) or v_eligible_text is null
    or v_eligible_text::bigint is distinct from v_lot_atomic
  then
    return jsonb_build_object(
      'eligible_principal_micro_krw', null,
      'minimum_principal_micro_krw', v_minimum_micro::text,
      'funding_status', 'FUNDING_PRINCIPAL_UNRESOLVED',
      'lot_count', v_lot_count
    );
  end if;

  v_net := app_private.funding_principal_mining_eligible_micro(
    p_user_id, statement_timestamp());
  if v_net < v_minimum_micro then
    v_status := 'FUNDING_BELOW_MINIMUM';
  else
    v_status := 'FUNDING_MINIMUM_MET';
  end if;
  return jsonb_build_object(
    'eligible_principal_micro_krw', v_net::text,
    'minimum_principal_micro_krw', v_minimum_micro::text,
    'funding_status', v_status,
    'lot_count', v_lot_count
  );
end;
$$;

revoke all on function app_private.read_funding_principal_foundation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_funding_principal_foundation(uuid)
  to service_role;

commit;
