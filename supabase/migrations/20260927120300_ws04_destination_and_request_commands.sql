begin;

-- ---------------------------------------------------------------------------
-- Ledger hold helpers
-- ---------------------------------------------------------------------------

create function app_private.ensure_withdrawal_hold_accounts(p_user_id uuid)
returns table (
  member_liability_id uuid,
  hold_clearing_id uuid,
  payout_cash_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  insert into public.ledger_accounts (
    code, currency, account_class, normal_side, is_controlled_asset
  ) values
    ('PUTDUK:WITHDRAWAL_HOLD:KRW', 'KRW', 'CLEARING', 'CREDIT', false),
    ('PUTDUK:OPERATING_CASH:KRW', 'KRW', 'ASSET', 'DEBIT', true)
  on conflict (code) do nothing;

  insert into public.ledger_accounts (
    code, currency, account_class, normal_side, owner_user_id
  ) values (
    'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY',
    'KRW', 'LIABILITY', 'CREDIT', p_user_id
  ) on conflict (code) do nothing;

  return query
  select
    (select id from public.ledger_accounts where code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'),
    (select id from public.ledger_accounts where code = 'PUTDUK:WITHDRAWAL_HOLD:KRW'),
    (select id from public.ledger_accounts where code = 'PUTDUK:OPERATING_CASH:KRW');
end;
$$;

revoke all on function app_private.ensure_withdrawal_hold_accounts(uuid)
  from public, anon, authenticated;

create function app_private.post_withdrawal_hold(
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
begin
  select * into v_accounts from app_private.ensure_withdrawal_hold_accounts(p_user_id);

  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, metadata
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
    jsonb_build_object('phase', 'HOLD', 'amount_atomic', p_amount_atomic::text)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx;

  if v_tx is null then
    select transaction.id into v_tx
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':hold';
    return v_tx;
  end if;

  insert into public.ledger_entries (
    transaction_id, account_id, sequence, side, amount_atomic
  ) values
    (v_tx, v_accounts.member_liability_id, 0, 'DEBIT', p_amount_atomic),
    (v_tx, v_accounts.hold_clearing_id, 1, 'CREDIT', p_amount_atomic);

  return v_tx;
end;
$$;

revoke all on function app_private.post_withdrawal_hold(uuid, uuid, bigint, text, uuid)
  from public, anon, authenticated;

create function app_private.available_krw_balance(p_wallet_account_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce((
    select sum(
      case when ledger.direction = 'CREDIT' then ledger.amount_atomic else -ledger.amount_atomic end
    )::bigint
    from public.wallet_ledger as ledger
    where ledger.wallet_account_id = p_wallet_account_id
  ), 0) - coalesce((
    select sum(request.amount_atomic + request.fee_atomic)::bigint
    from public.withdrawal_requests as request
    where request.wallet_account_id = p_wallet_account_id
      and request.status in (
        'REQUESTED', 'HELD', 'ADMIN_PROCESSING', 'EXTERNAL_SENT_RECORDED',
        'REVIEWING', 'APPROVED', 'PROCESSING'
      )
  ), 0);
$$;

revoke all on function app_private.available_krw_balance(uuid)
  from public, anon, authenticated;

create function app_private.consume_admin_step_up_token(
  p_user_id uuid,
  p_token text,
  p_command_family text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_hash text;
  v_grant public.admin_step_up_grants%rowtype;
begin
  if char_length(btrim(coalesce(p_token, ''))) < 16 then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select grant_row.* into v_grant
  from public.admin_step_up_grants as grant_row
  where grant_row.token_hash = v_hash
    and grant_row.user_id = p_user_id
    and grant_row.command_family = p_command_family
  for update;

  if v_grant.id is null
    or v_grant.consumed_at is not null
    or v_grant.expires_at <= statement_timestamp()
  then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  if not exists (
    select 1 from public.admin_sessions as session
    where session.id = v_grant.admin_session_id
      and session.revoked_at is null
      and session.idle_expires_at > statement_timestamp()
      and session.absolute_expires_at > statement_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_SESSION_EXPIRED';
  end if;

  update public.admin_step_up_grants
  set consumed_at = statement_timestamp(), consume_request_id = p_request_id
  where id = v_grant.id
    and consumed_at is null;

  if not found then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  return v_grant.id;
end;
$$;

revoke all on function app_private.consume_admin_step_up_token(uuid, text, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Destination registration
-- ---------------------------------------------------------------------------

create function public.register_krw_bank_destination(
  p_user_id uuid,
  p_encrypted_value bytea,
  p_value_fingerprint text,
  p_display_hint text,
  p_step_up_token text,
  p_request_id uuid,
  p_protection_hours integer default 24
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_id uuid;
  v_prior uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_user_id is null
    or p_encrypted_value is null
    or octet_length(p_encrypted_value) < 16
    or char_length(btrim(coalesce(p_value_fingerprint, ''))) < 8
    or char_length(btrim(coalesce(p_display_hint, ''))) < 2
    or p_request_id is null
    or coalesce(p_protection_hours, 0) not between 1 and 168
  then
    raise exception using errcode = '22023', message = 'INVALID_KRW_BANK_DESTINATION';
  end if;

  perform app_private.touch_command_rate_limit(
    'REGISTER_KRW_BANK_DESTINATION',
    p_user_id::text,
    5,
    3600,
    3600
  );

  if char_length(btrim(coalesce(p_step_up_token, ''))) < 8 then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  select destination.id into v_prior
  from public.withdrawal_destinations as destination
  where destination.user_id = p_user_id
    and destination.destination_type = 'KRW_BANK'
    and destination.replaced_at is null
  for update;

  if v_prior is not null then
    update public.withdrawal_destinations
    set replaced_at = statement_timestamp()
    where id = v_prior;

    insert into public.withdrawal_destination_history (
      destination_id, user_id, destination_type, action, display_hint,
      value_fingerprint, actor_user_id, request_id
    )
    select
      destination.id, destination.user_id, destination.destination_type, 'REPLACED',
      destination.display_hint, destination.value_fingerprint, p_user_id, p_request_id
    from public.withdrawal_destinations as destination
    where destination.id = v_prior;
  end if;

  insert into public.withdrawal_destinations (
    user_id, destination_type, encrypted_value, value_fingerprint,
    display_hint, verification_status, verified_at, protection_until
  ) values (
    p_user_id,
    'KRW_BANK',
    p_encrypted_value,
    p_value_fingerprint,
    p_display_hint,
    'VERIFIED',
    statement_timestamp(),
    statement_timestamp() + make_interval(hours => p_protection_hours)
  ) returning id into v_id;

  insert into public.withdrawal_destination_history (
    destination_id, user_id, destination_type, action, display_hint,
    value_fingerprint, metadata, actor_user_id, request_id
  ) values (
    v_id, p_user_id, 'KRW_BANK', 'REGISTERED', p_display_hint, p_value_fingerprint,
    jsonb_build_object(
      'masked', true,
      'step_up_token_hash', encode(extensions.digest(p_step_up_token, 'sha256'), 'hex')
    ),
    p_user_id,
    p_request_id
  );

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_user_id,
    'WITHDRAWAL_DESTINATION_REGISTERED',
    null,
    'NONE',
    jsonb_build_object('destination_type', 'KRW_BANK', 'destination_id', v_id),
    p_request_id
  );

  return v_id;
end;
$$;

revoke all on function public.register_krw_bank_destination(
  uuid, bytea, text, text, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.register_krw_bank_destination(
  uuid, bytea, text, text, text, uuid, integer
) to service_role;

create function public.register_usdt_withdrawal_destination(
  p_user_id uuid,
  p_network text,
  p_address text,
  p_encrypted_value bytea,
  p_value_fingerprint text,
  p_display_hint text,
  p_step_up_token text,
  p_request_id uuid,
  p_protection_hours integer default 24
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_address text := btrim(coalesce(p_address, ''));
  v_id uuid;
  v_prior uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_user_id is null
    or v_network not in ('TRC20', 'ERC20', 'BEP20')
    or char_length(v_address) not between 8 and 128
    or (v_network = 'TRC20' and v_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
    or (v_network in ('ERC20', 'BEP20') and v_address !~ '^0x[0-9a-fA-F]{40}$')
    or p_encrypted_value is null
    or octet_length(p_encrypted_value) < 16
    or char_length(btrim(coalesce(p_value_fingerprint, ''))) < 8
    or char_length(btrim(coalesce(p_display_hint, ''))) < 2
    or p_request_id is null
    or coalesce(p_protection_hours, 0) not between 1 and 168
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_WITHDRAWAL_DESTINATION';
  end if;

  perform app_private.touch_command_rate_limit(
    'REGISTER_USDT_WITHDRAWAL_DESTINATION',
    p_user_id::text,
    5,
    3600,
    3600
  );

  if char_length(btrim(coalesce(p_step_up_token, ''))) < 8 then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  select destination.id into v_prior
  from public.withdrawal_destinations as destination
  where destination.user_id = p_user_id
    and destination.destination_type = 'USDT_ADDRESS'
    and destination.replaced_at is null
  for update;

  if v_prior is not null then
    update public.withdrawal_destinations
    set replaced_at = statement_timestamp()
    where id = v_prior;

    insert into public.withdrawal_destination_history (
      destination_id, user_id, destination_type, action, display_hint,
      value_fingerprint, actor_user_id, request_id, metadata
    )
    select
      destination.id, destination.user_id, destination.destination_type, 'REPLACED',
      destination.display_hint, destination.value_fingerprint, p_user_id, p_request_id,
      jsonb_build_object('network', v_network)
    from public.withdrawal_destinations as destination
    where destination.id = v_prior;
  end if;

  insert into public.withdrawal_destinations (
    user_id, destination_type, encrypted_value, value_fingerprint,
    display_hint, verification_status, verified_at, protection_until
  ) values (
    p_user_id,
    'USDT_ADDRESS',
    p_encrypted_value,
    p_value_fingerprint,
    p_display_hint,
    'VERIFIED',
    statement_timestamp(),
    statement_timestamp() + make_interval(hours => p_protection_hours)
  ) returning id into v_id;

  insert into public.withdrawal_destination_history (
    destination_id, user_id, destination_type, action, display_hint,
    value_fingerprint, metadata, actor_user_id, request_id
  ) values (
    v_id, p_user_id, 'USDT_ADDRESS', 'REGISTERED', p_display_hint, p_value_fingerprint,
    jsonb_build_object(
      'network', v_network,
      'masked', true,
      'step_up_token_hash', encode(extensions.digest(p_step_up_token, 'sha256'), 'hex')
    ),
    p_user_id,
    p_request_id
  );

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_user_id,
    'WITHDRAWAL_DESTINATION_REGISTERED',
    null,
    'NONE',
    jsonb_build_object(
      'destination_type', 'USDT_ADDRESS',
      'network', v_network,
      'destination_id', v_id
    ),
    p_request_id
  );

  return v_id;
end;
$$;

revoke all on function public.register_usdt_withdrawal_destination(
  uuid, text, text, bytea, text, text, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.register_usdt_withdrawal_destination(
  uuid, text, text, bytea, text, text, text, uuid, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- Shared withdrawal request + hold
-- ---------------------------------------------------------------------------

create function app_private.request_withdrawal_with_hold(
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

revoke all on function app_private.request_withdrawal_with_hold(
  uuid, uuid, bigint, text, text, uuid
) from public, anon, authenticated;

create function public.request_krw_withdrawal(
  p_user_id uuid,
  p_destination_id uuid,
  p_amount_krw bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  return app_private.request_withdrawal_with_hold(
    p_user_id, p_destination_id, p_amount_krw, 'KRW_BANK', p_idempotency_key, null
  );
end;
$$;

revoke all on function public.request_krw_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.request_krw_withdrawal(uuid, uuid, bigint, text)
  to service_role;

create function public.request_usdt_withdrawal(
  p_user_id uuid,
  p_destination_id uuid,
  p_amount_krw bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  return app_private.request_withdrawal_with_hold(
    p_user_id, p_destination_id, p_amount_krw, 'USDT_ADDRESS', p_idempotency_key, null
  );
end;
$$;

revoke all on function public.request_usdt_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.request_usdt_withdrawal(uuid, uuid, bigint, text)
  to service_role;

commit;
