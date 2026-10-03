begin;

-- Safety closure only: VERIFIED EARNED WRITER NOT CONNECTED.
-- Preserve the exact private signature, existing recovery, START qualification,
-- grants, invoker authority, fixed path and all original money effects.
-- No new lock, source movement, money constant, public alias or activation flag.

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

  -- Existing requests recover above. Fresh general withdrawals remain closed
  -- until an authoritative earned producer and source lifecycle are connected.
  -- Dedicated START must carry its own qualified, captured original receipt.
  if p_welcome_reward_conversion_id is null then
    raise exception using errcode = '55000',
      message = 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE';
  end if;
  if not exists (
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

  return v_request_id;
end;
$$;

commit;
