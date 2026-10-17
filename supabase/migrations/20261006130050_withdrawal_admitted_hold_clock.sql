begin;

-- Source candidate only: no public principal command, source fallback, grants,
-- automatic jobs or historical timestamp repair. Existing function ACLs persist.

create or replace function app_private.post_withdrawal_hold(
  p_user_id uuid,
  p_withdrawal_id uuid,
  p_amount_atomic bigint,
  p_idempotency_key text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_accounts record;
  v_tx uuid;
  v_admission record;
  v_request public.withdrawal_requests%rowtype;
  v_wallet uuid;
  v_existing public.ledger_transactions%rowtype;
  v_at timestamptz;
  v_metadata jsonb;
begin
  if current_user = 'service_role' then
    if p_user_id is null or p_withdrawal_id is null or p_request_id is null
      or p_amount_atomic is null or p_amount_atomic <= 0
      or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_HOLD';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL', 0));
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL', 0));
    select r.* into v_request from public.withdrawal_requests r
      where r.id = p_withdrawal_id and r.user_id = p_user_id for update;
    if v_request.id is null or v_request.currency <> 'KRW'
      or v_request.amount_atomic + v_request.fee_atomic is distinct from p_amount_atomic
      or v_request.idempotency_key is distinct from p_idempotency_key then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_HOLD_ORIGINAL_MISMATCH';
    end if;
    select a.id into v_wallet from public.wallet_accounts a
      where a.id = v_request.wallet_account_id and a.user_id = p_user_id
        and a.currency = 'KRW' and a.closed_at is null for update;
    if v_wallet is null then
      raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
    end if;
    select t.* into v_existing from public.ledger_transactions t
      where t.idempotency_key = p_idempotency_key || ':hold';
    if v_existing.id is not null then
      if v_existing.reference_type is distinct from 'withdrawal_request'
        or v_existing.reference_id is distinct from p_withdrawal_id
        or v_existing.member_user_id is distinct from p_user_id
        or v_existing.category <> 'WITHDRAWAL' or v_existing.currency <> 'KRW'
        or v_existing.metadata->>'phase' is distinct from 'HOLD'
        or v_existing.metadata->>'amount_atomic' is distinct from p_amount_atomic::text then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
      end if;
      return v_existing.id;
    end if;
    if v_request.status <> 'REQUESTED' or v_request.hold_ledger_transaction_id is not null then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_HOLD_ORIGINAL_MISMATCH';
    end if;
    perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);
  elsif current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_HOLD_SERVICE_ROLE_REQUIRED';
  end if;
  select * into v_accounts from app_private.ensure_withdrawal_hold_accounts(p_user_id);

  -- All potentially waiting admissions precede this sole new financial clock.
  -- Postgres-only historical fixtures retain the historical statement clock;
  -- they do not receive or imply the newly connected producer contract.
  v_metadata := jsonb_build_object('phase', 'HOLD', 'amount_atomic', p_amount_atomic::text);
  if current_user = 'service_role' and exists(select 1 from app_private.funding_engine_activations a
    where a.user_id=p_user_id and a.runtime_version=2) then
    select a.* into v_admission from app_private.capture_funding_withdrawal_clock_admission(
      p_withdrawal_id,'HOLD',p_request_id) a;
    v_at := v_admission.effective_at;
    v_metadata := v_metadata || jsonb_build_object('portion_clock_contract', 'HOLD_CANCEL_V1',
      'clock_admission_id',v_admission.admission_id,
      'admitted_at_microseconds', ((extract(epoch from v_at) * 1000000)::bigint)::text);
  else
    v_at := case when current_user = 'service_role' then clock_timestamp() else statement_timestamp() end;
  end if;
  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, metadata, posted_at, created_at
  ) values (
    'WITHDRAWAL',
    'KRW',
    p_idempotency_key || ':hold',
    'withdrawal_request',
    p_withdrawal_id,
    p_user_id,
    p_request_id,
    gen_random_uuid(),
    'Withdrawal hold reservation',
    v_metadata, v_at, v_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx;

  if v_tx is null then
    select t.* into v_existing from public.ledger_transactions t
      where t.idempotency_key = p_idempotency_key || ':hold';
    if current_user = 'service_role' and (
      v_existing.reference_type is distinct from 'withdrawal_request'
      or v_existing.reference_id is distinct from p_withdrawal_id
      or v_existing.member_user_id is distinct from p_user_id
      or v_existing.category <> 'WITHDRAWAL' or v_existing.currency <> 'KRW'
      or v_existing.metadata->>'phase' is distinct from 'HOLD'
      or v_existing.metadata->>'amount_atomic' is distinct from p_amount_atomic::text) then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;

  insert into public.ledger_entries (
    transaction_id, account_id, sequence, side, amount_atomic
  ) values
    (v_tx, v_accounts.member_liability_id, 0, 'DEBIT', p_amount_atomic),
    (v_tx, v_accounts.hold_clearing_id, 1, 'CREDIT', p_amount_atomic);

  return v_tx;
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
  v_hold_at timestamptz;
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

  -- Every source takes the member boundary before destination/wallet rows.
  -- A qualified START reservation still changes no principal clock.
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
  select r.id into v_request_id from public.withdrawal_requests r
    where r.user_id = p_user_id and r.idempotency_key = p_idempotency_key;
  if v_request_id is not null then return v_request_id; end if;
  if p_welcome_reward_conversion_id is null then
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

  select t.posted_at into v_hold_at from public.ledger_transactions t where t.id = v_hold_tx;

  update public.withdrawal_requests
  set
    status = 'HELD',
    hold_ledger_transaction_id = v_hold_tx,
    hold_posted_at = v_hold_at
  where id = v_request_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, occurred_at, created_at
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
    p_idempotency_key || ':event', v_hold_at, v_hold_at
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
      jsonb_build_object('status', 'HELD', 'at', v_hold_at)
    )
  )
  on conflict (source_type, source_id) do nothing;

  if p_welcome_reward_conversion_id is null then
    perform app_private.reserve_verified_mining_reward_newest_first(
      p_user_id, v_hold_tx);
  end if;

  return v_request_id;
end;
$$;

commit;
