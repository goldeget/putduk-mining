begin;

-- 일반 KRW 출금은 검증된 출처가 금액 전체를 덮을 때만 hold까지 간다.
-- 원금 배분은 기존 newest-first 회수를 재사용한다. lot 순서는
-- effective_at DESC, recorded_at DESC, id DESC 이고 부분 배분한다.
-- BONUS와 MINING_REWARD는 원금이 아니다. 수익이 부족하면 원금으로 채우지 않는다.
-- 채굴 수익 CREDIT을 생산하는 경로는 열지 않는다.
-- hold 원장 쓰기는 기존 post_withdrawal_hold만 한다.
-- 특정 reversal의 복합 상계는 기존 거절 그대로 둔다.

create function app_private.verified_mining_reward_remaining_atomic(p_user_id uuid)
returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_credit bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  select coalesce(sum(movement.amount_atomic), 0)::bigint
    into v_credit
  from public.money_source_movements as movement
  where movement.user_id = p_user_id
    and movement.source_bucket = 'MINING_REWARD'
    and movement.movement_kind = 'CREDIT'
    and app_private.money_source_credit_verified(movement);
  if v_credit is null or v_credit < 0 then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  return v_credit;
end;
$$;

create function app_private.verified_principal_remaining_atomic(p_user_id uuid)
returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_micro bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  v_micro := app_private.funding_principal_mining_eligible_micro(
    p_user_id, statement_timestamp());
  if v_micro is null or v_micro < 0 or v_micro % 1000000 <> 0 then
    raise exception using errcode = '22003', message = 'PRINCIPAL_RECOVERY_MICRO_INVALID';
  end if;
  return v_micro / 1000000;
end;
$$;

-- 검증된 원금도 채굴 수익도 없으면 목적지 잠금 전에 거절한다.
create function app_private.assert_general_withdrawal_source_present(p_user_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
begin
  if app_private.verified_mining_reward_remaining_atomic(p_user_id) = 0
    and app_private.verified_principal_remaining_atomic(p_user_id) = 0 then
    raise exception using errcode = '55000',
      message = 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE';
  end if;
end;
$$;

-- 수수료를 안 뒤에 다시 검사한다. 부족하면 신청 행을 만들지 않는다.
create function app_private.assert_general_withdrawal_source_covers(
  p_user_id uuid,
  p_amount_atomic bigint,
  p_fee_atomic bigint
) returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_need bigint;
  v_mining bigint;
  v_principal bigint;
begin
  if p_amount_atomic is null or p_amount_atomic <= 0
    or p_fee_atomic is null or p_fee_atomic < 0 then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  if p_amount_atomic > 9223372036854775807 - p_fee_atomic then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  v_need := p_amount_atomic + p_fee_atomic;
  v_mining := app_private.verified_mining_reward_remaining_atomic(p_user_id);
  if v_mining > 0 and v_mining < v_need then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  if v_mining >= v_need then
    -- 채굴 수익 예약 insert는 생산자가 없다. 원금으로 바꾸지 않는다.
    raise exception using errcode = '55000',
      message = 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE';
  end if;
  if p_fee_atomic <> 0 then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  v_principal := app_private.verified_principal_remaining_atomic(p_user_id);
  if v_principal < v_need then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
end;
$$;

create or replace function app_private.request_withdrawal_with_hold(
  p_user_id uuid,
  p_destination_id uuid,
  p_amount_krw bigint,
  p_expected_destination_type text,
  p_idempotency_key text,
  p_welcome_reward_conversion_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_wallet_account_id uuid;
  v_available bigint;
  v_request_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_cmd_request_id uuid := gen_random_uuid();
  v_hold_tx uuid;
  v_fee bigint;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_user_id is null
    or p_destination_id is null
    or p_amount_krw is null
    or p_amount_krw <= 0
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;

  select request.id into v_request_id
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;
  if v_request_id is not null then
    return v_request_id;
  end if;

  if p_welcome_reward_conversion_id is null then
    perform pg_advisory_xact_lock(
      hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
    perform app_private.assert_general_withdrawal_source_present(p_user_id);
  elsif not exists (
    select 1
    from public.trial_reward_conversions as conversion
    join public.money_source_movements as movement
      on movement.ledger_transaction_id = conversion.ledger_transaction_id
    where conversion.id = p_welcome_reward_conversion_id
      and conversion.user_id = p_user_id
      and conversion.status = 'CONVERTED'
      and conversion.converted_amount_atomic = p_amount_krw
      and conversion.funding_required = false
      and movement.user_id = p_user_id
      and movement.source_bucket = 'BONUS'
      and movement.origin_code = 'WELCOME_REWARD'
      and movement.movement_kind = 'CREDIT'
      and movement.amount_atomic = p_amount_krw
      and movement.wallet_ledger_id = conversion.wallet_ledger_id
      and exists (
        select 1 from public.trial_qualification_snapshots as qualification
        where qualification.conversion_id = conversion.id
          and qualification.decision = 'APPROVED'
          and qualification.kyc_status = 'APPROVED'
          and qualification.rule_version = conversion.rule_version
          and qualification.risk_model_version = conversion.risk_model_version
      )
      and app_private.money_source_credit_verified(movement)
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_NOT_WITHDRAWABLE';
  end if;

  select destination.* into v_destination
  from public.withdrawal_destinations as destination
  where destination.id = p_destination_id
    and destination.user_id = p_user_id
    and destination.destination_type = p_expected_destination_type
    and destination.verification_status = 'VERIFIED'
    and destination.replaced_at is null
    and destination.protection_until <= statement_timestamp()
  for update;

  if v_destination.id is null then
    raise exception using errcode = '55000', message = 'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED';
  end if;

  select policy.* into v_policy
  from public.withdrawal_policies as policy
  where policy.currency = 'KRW'
    and policy.destination_type = p_expected_destination_type
    and policy.is_enabled
    and policy.effective_at <= statement_timestamp()
    and (policy.expires_at is null or policy.expires_at > statement_timestamp())
    and (
      p_welcome_reward_conversion_id is null
      or (policy.allows_welcome_reward and policy.fee_atomic = 0)
    )
  order by policy.version desc
  limit 1;

  if v_policy.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_POLICY_UNAVAILABLE';
  end if;

  if p_amount_krw < v_policy.minimum_amount_atomic then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_BELOW_MINIMUM';
  end if;

  if p_welcome_reward_conversion_id is not null and p_amount_krw > 5000 then
    raise exception using errcode = '22003', message = 'WELCOME_WITHDRAWAL_CAP_EXCEEDED';
  end if;

  v_fee := v_policy.fee_atomic;

  select account.id into v_wallet_account_id
  from public.wallet_accounts as account
  where account.user_id = p_user_id
    and account.currency = 'KRW'
    and account.closed_at is null
  for update;

  if v_wallet_account_id is null then
    raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
  end if;

  v_available := app_private.available_krw_balance(v_wallet_account_id);
  if v_available < (p_amount_krw + v_fee) then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_AVAILABLE_BALANCE';
  end if;

  if p_welcome_reward_conversion_id is null then
    perform app_private.assert_general_withdrawal_source_covers(
      p_user_id, p_amount_krw, v_fee);
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id,
    withdrawal_policy_id,
    withdrawal_destination_id,
    welcome_reward_conversion_id,
    user_id,
    currency,
    amount_atomic,
    fee_atomic,
    destination_type,
    destination_snapshot,
    status,
    idempotency_key
  ) values (
    v_wallet_account_id,
    v_policy.id,
    v_destination.id,
    p_welcome_reward_conversion_id,
    p_user_id,
    'KRW',
    p_amount_krw,
    v_fee,
    p_expected_destination_type,
    jsonb_build_object(
      'destination_id', v_destination.id,
      'display', v_destination.display_hint,
      'verified_at', v_destination.verified_at
    ),
    'REQUESTED',
    p_idempotency_key
  ) returning id into v_request_id;

  v_hold_tx := app_private.post_withdrawal_hold(
    p_user_id,
    v_request_id,
    p_amount_krw + v_fee,
    p_idempotency_key,
    v_cmd_request_id
  );

  update public.withdrawal_requests
  set
    status = 'HELD',
    hold_ledger_transaction_id = v_hold_tx,
    hold_posted_at = statement_timestamp()
  where id = v_request_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1',
    1,
    'withdrawal_request',
    v_request_id,
    p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', p_amount_krw::text,
      'fee_atomic', v_fee::text,
      'currency', 'KRW',
      'destination_type', p_expected_destination_type,
      'hold_ledger_transaction_id', v_hold_tx,
      'welcome_reward', p_welcome_reward_conversion_id is not null
    ),
    v_correlation_id,
    v_cmd_request_id,
    p_idempotency_key || ':event'
  );

  insert into public.transaction_receipts (
    receipt_number, user_id, transaction_type, source_type, source_id,
    amount_atomic, currency, status, requested_at, status_timeline
  ) values (
    'PDK-WD-' || upper(replace(v_request_id::text, '-', '')),
    p_user_id,
    case
      when p_welcome_reward_conversion_id is not null then 'WELCOME_REWARD_WITHDRAWAL'
      else 'WITHDRAWAL'
    end,
    'withdrawal_request',
    v_request_id,
    p_amount_krw,
    'KRW',
    'HELD',
    statement_timestamp(),
    jsonb_build_array(
      jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'HELD', 'at', statement_timestamp())
    )
  )
  on conflict (source_type, source_id) do nothing;

  if p_welcome_reward_conversion_id is null then
    perform app_private.apply_principal_recovery_newest_first(p_user_id, v_hold_tx);
  end if;

  return v_request_id;
end;
$$;

revoke all on function app_private.verified_mining_reward_remaining_atomic(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.verified_mining_reward_remaining_atomic(uuid)
  to service_role;
revoke all on function app_private.verified_principal_remaining_atomic(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.verified_principal_remaining_atomic(uuid)
  to service_role;
revoke all on function app_private.assert_general_withdrawal_source_present(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.assert_general_withdrawal_source_present(uuid)
  to service_role;
revoke all on function app_private.assert_general_withdrawal_source_covers(uuid, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.assert_general_withdrawal_source_covers(uuid, bigint, bigint)
  to service_role;

comment on function app_private.assert_general_withdrawal_source_covers(uuid, bigint, bigint) is
  '일반 출금 hold 전에 검증된 원금이 전액을 덮는지 본다. 수익 부족분을 원금으로 채우지 않는다.';

commit;
