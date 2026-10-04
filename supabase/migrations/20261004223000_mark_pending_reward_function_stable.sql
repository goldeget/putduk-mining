begin;

-- jsonb_build_object는 STABLE이다. 반환 식이 STABLE이므로
-- 이 함수를 IMMUTABLE로 표시하면 schema lint가 경고로 실패한다.
-- 계산 식은 바꾸지 않는다. pending은 저장된 segment, capacity, policy에서만 나오고
-- 호출자 금액은 없으며 retention은 pending에 더하지 않고 원장 credit은 없다.

create or replace function app_private.funding_reward_pending_segment_micro(
  p_base_entitlement_micro bigint,
  p_retention_entitlement_micro bigint,
  p_elapsed_microseconds bigint,
  p_span_microseconds bigint,
  p_speed_bps bigint,
  p_speed_identity_bps bigint
) returns jsonb
language plpgsql
stable
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

commit;
