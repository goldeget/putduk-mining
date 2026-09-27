begin;

-- ---------------------------------------------------------------------------
-- Phone normalization + availability
-- ---------------------------------------------------------------------------

create function public.normalize_signup_phone(p_raw text)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_digits text;
begin
  if p_raw is null then
    return null;
  end if;

  v_digits := regexp_replace(p_raw, '[^0-9+]', '', 'g');

  if left(v_digits, 1) = '+' then
    v_digits := '+' || regexp_replace(substr(v_digits, 2), '[^0-9]', '', 'g');
  else
    v_digits := regexp_replace(v_digits, '[^0-9]', '', 'g');
    if left(v_digits, 2) = '00' then
      v_digits := '+' || substr(v_digits, 3);
    elsif left(v_digits, 1) = '0' then
      -- Korea local mobile → E.164
      v_digits := '+82' || substr(v_digits, 2);
    elsif left(v_digits, 2) = '82' then
      v_digits := '+' || v_digits;
    else
      return null;
    end if;
  end if;

  if v_digits !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;

  return v_digits;
end;
$$;

revoke all on function public.normalize_signup_phone(text)
  from public, anon, authenticated;
grant execute on function public.normalize_signup_phone(text)
  to anon, authenticated, service_role;

create function public.signup_phone_availability(p_raw text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_phone text;
  v_bucket text;
begin
  v_phone := public.normalize_signup_phone(p_raw);
  if v_phone is null then
    return 'UNAVAILABLE';
  end if;

  v_bucket := encode(extensions.digest(v_phone, 'sha256'), 'hex');
  perform app_private.touch_command_rate_limit(
    'SIGNUP_PHONE_AVAILABILITY',
    v_bucket,
    20,
    300,
    600
  );

  if exists (
    select 1 from public.signup_phone_history as history where history.phone_e164 = v_phone
  ) or exists (
    select 1 from public.user_identity_profiles as profile where profile.phone_e164 = v_phone
  ) then
    return 'UNAVAILABLE';
  end if;

  return 'AVAILABLE';
end;
$$;

revoke all on function public.signup_phone_availability(text)
  from public, anon, authenticated;
grant execute on function public.signup_phone_availability(text)
  to anon, authenticated, service_role;

comment on function public.normalize_signup_phone(text) is
  'Normalizes signup phone input to E.164. Not SMS ownership verification.';
comment on function public.signup_phone_availability(text) is
  'Enumeration-resistant signup phone availability. Returns only AVAILABLE or UNAVAILABLE.';

-- ---------------------------------------------------------------------------
-- USDT deposit commands
-- ---------------------------------------------------------------------------

create function public.set_usdt_deposit_instructions(
  p_address text,
  p_network text,
  p_actor uuid,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_address text := btrim(coalesce(p_address, ''));
  v_version integer;
  v_id uuid;
  v_prior uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'DEPOSIT']);

  if v_network not in ('TRC20', 'ERC20', 'BEP20')
    or char_length(v_address) not between 8 and 128
    or char_length(btrim(coalesce(p_reason, ''))) < 10
    or p_actor is null
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_DEPOSIT_INSTRUCTIONS';
  end if;

  if not exists (
    select 1
    from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select instruction.id into v_prior
  from public.usdt_deposit_instructions as instruction
  where instruction.network = v_network
    and instruction.is_active
  for update;

  if v_prior is not null then
    update public.usdt_deposit_instructions
    set is_active = false, deactivated_at = statement_timestamp()
    where id = v_prior;

    insert into public.usdt_deposit_instruction_events (
      instruction_id, event_type, actor_user_id, reason, request_id
    ) values (
      v_prior, 'DEACTIVATED', p_actor, p_reason, p_request_id
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.usdt_deposit_instructions
  where network = v_network;

  insert into public.usdt_deposit_instructions (
    network, deposit_address, is_active, version, set_by, reason, request_id
  ) values (
    v_network, v_address, true, v_version, p_actor, p_reason, p_request_id
  ) returning id into v_id;

  insert into public.usdt_deposit_instruction_events (
    instruction_id, event_type, actor_user_id, reason, request_id
  ) values (
    v_id, 'ACTIVATED', p_actor, p_reason, p_request_id
  );

  insert into public.audit_logs (
    actor_user_id, actor_role, action, target_type, target_id, reason, request_id, after_state
  )
  select
    p_actor,
    role.role,
    'usdt_deposit_instructions.set',
    'usdt_deposit_instructions',
    v_id::text,
    p_reason,
    p_request_id,
    jsonb_build_object('network', v_network, 'version', v_version)
  from public.user_roles as role
  where role.user_id = p_actor
    and role.revoked_at is null
  order by role.role
  limit 1;

  return v_id;
end;
$$;

revoke all on function public.set_usdt_deposit_instructions(text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_usdt_deposit_instructions(text, text, uuid, text, uuid)
  to service_role;

create function public.submit_usdt_manual_deposit(
  p_user_id uuid,
  p_network text,
  p_tx_hash text,
  p_sent_usdt_amount numeric,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_tx text := lower(btrim(coalesce(p_tx_hash, '')));
  v_instruction public.usdt_deposit_instructions%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'DEPOSIT']);

  if p_user_id is null
    or v_network not in ('TRC20', 'ERC20', 'BEP20')
    or char_length(v_tx) not between 8 and 128
    or p_sent_usdt_amount is null
    or p_sent_usdt_amount <= 0
    or scale(p_sent_usdt_amount) > 6
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_MANUAL_DEPOSIT';
  end if;

  select deposit.id into v_existing
  from public.usdt_manual_deposits as deposit
  where deposit.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  select instruction.* into v_instruction
  from public.usdt_deposit_instructions as instruction
  where instruction.network = v_network
    and instruction.is_active
  for share;

  if v_instruction.id is null then
    raise exception using errcode = '55000', message = 'USDT_DEPOSIT_INSTRUCTIONS_UNAVAILABLE';
  end if;

  insert into public.usdt_manual_deposits (
    user_id,
    network,
    tx_hash,
    sent_usdt_amount,
    deposit_address_snapshot,
    network_snapshot,
    status,
    idempotency_key
  ) values (
    p_user_id,
    v_network,
    v_tx,
    p_sent_usdt_amount,
    v_instruction.deposit_address,
    v_instruction.network,
    'SUBMITTED',
    p_idempotency_key
  )
  returning id into v_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'USDT_MANUAL_DEPOSIT_SUBMITTED.v1',
    1,
    'usdt_manual_deposit',
    v_id,
    p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'network', v_network,
      'tx_hash', v_tx,
      'sent_usdt_amount', p_sent_usdt_amount::text
    ),
    gen_random_uuid(),
    gen_random_uuid(),
    p_idempotency_key || ':event'
  );

  return v_id;
exception
  when unique_violation then
    select deposit.id into v_existing
    from public.usdt_manual_deposits as deposit
    where deposit.idempotency_key = p_idempotency_key
       or (deposit.network = v_network and deposit.tx_hash = v_tx);
    if v_existing is not null then
      return v_existing;
    end if;
    raise;
end;
$$;

revoke all on function public.submit_usdt_manual_deposit(uuid, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.submit_usdt_manual_deposit(uuid, text, text, numeric, text)
  to service_role;

create function public.confirm_usdt_manual_deposit(
  p_deposit_id uuid,
  p_credited_krw bigint,
  p_actor uuid,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_deposit public.usdt_manual_deposits%rowtype;
  v_wallet_account_id uuid;
  v_member_ledger_account_id uuid;
  v_cash_ledger_account_id uuid;
  v_ledger_transaction_id uuid;
  v_wallet_ledger_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'DEPOSIT']);

  if p_deposit_id is null
    or p_credited_krw is null
    or p_credited_krw <= 0
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 10
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_DEPOSIT_CONFIRMATION';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select deposit.* into v_deposit
  from public.usdt_manual_deposits as deposit
  where deposit.id = p_deposit_id
  for update;

  if v_deposit.id is null then
    raise exception using errcode = '55000', message = 'USDT_DEPOSIT_NOT_FOUND';
  end if;

  if v_deposit.status = 'CONFIRMED' and v_deposit.ledger_transaction_id is not null then
    return v_deposit.ledger_transaction_id;
  end if;

  if v_deposit.status <> 'SUBMITTED' then
    raise exception using errcode = '55000', message = 'USDT_DEPOSIT_NOT_CONFIRMABLE';
  end if;

  insert into public.ledger_accounts (
    code, currency, account_class, normal_side, is_controlled_asset
  ) values (
    'PUTDUK:OPERATING_CASH:KRW', 'KRW', 'ASSET', 'DEBIT', true
  ) on conflict (code) do nothing;

  insert into public.ledger_accounts (
    code, currency, account_class, normal_side, owner_user_id
  ) values (
    'USER:' || upper(v_deposit.user_id::text) || ':KRW:LIABILITY',
    'KRW', 'LIABILITY', 'CREDIT', v_deposit.user_id
  ) on conflict (code) do nothing;

  select account.id into v_cash_ledger_account_id
  from public.ledger_accounts as account
  where account.code = 'PUTDUK:OPERATING_CASH:KRW';

  select account.id into v_member_ledger_account_id
  from public.ledger_accounts as account
  where account.code = 'USER:' || upper(v_deposit.user_id::text) || ':KRW:LIABILITY';

  select wallet.id into v_wallet_account_id
  from public.wallet_accounts as wallet
  where wallet.user_id = v_deposit.user_id
    and wallet.currency = 'KRW'
    and wallet.closed_at is null
  for update;

  if v_wallet_account_id is null then
    raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
  end if;

  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, metadata, created_by
  ) values (
    'DEPOSIT',
    'KRW',
    p_idempotency_key || ':ledger',
    'usdt_manual_deposit',
    v_deposit.id,
    v_deposit.user_id,
    v_request_id,
    v_correlation_id,
    'Manual USDT deposit confirmed as KRW',
    jsonb_build_object(
      'network_snapshot', v_deposit.network_snapshot,
      'deposit_address_snapshot', v_deposit.deposit_address_snapshot,
      'tx_hash', v_deposit.tx_hash,
      'sent_usdt_amount', v_deposit.sent_usdt_amount::text
    ),
    p_actor
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_transaction_id;

  if v_ledger_transaction_id is null then
    select transaction.id into v_ledger_transaction_id
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':ledger';
  else
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_ledger_transaction_id, v_cash_ledger_account_id, 0, 'DEBIT', p_credited_krw),
      (v_ledger_transaction_id, v_member_ledger_account_id, 1, 'CREDIT', p_credited_krw);

    insert into public.wallet_ledger (
      wallet_account_id, user_id, direction, entry_type, amount_atomic,
      idempotency_key, reference_type, reference_id, reason, created_by
    ) values (
      v_wallet_account_id,
      v_deposit.user_id,
      'CREDIT',
      'DEPOSIT',
      p_credited_krw,
      p_idempotency_key || ':wallet',
      'usdt_manual_deposit',
      v_deposit.id,
      p_reason,
      p_actor
    ) returning id into v_wallet_ledger_id;
  end if;

  update public.usdt_manual_deposits
  set
    status = 'CONFIRMED',
    credited_krw = p_credited_krw,
    ledger_transaction_id = v_ledger_transaction_id,
    wallet_ledger_id = coalesce(v_wallet_ledger_id, wallet_ledger_id),
    confirmed_by = p_actor,
    confirmed_at = statement_timestamp()
  where id = v_deposit.id
    and status = 'SUBMITTED';

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'USDT_MANUAL_DEPOSIT_CONFIRMED.v1',
    1,
    'usdt_manual_deposit',
    v_deposit.id,
    p_actor,
    jsonb_build_object(
      'user_id', v_deposit.user_id,
      'credited_krw', p_credited_krw::text,
      'ledger_transaction_id', v_ledger_transaction_id
    ),
    v_correlation_id,
    v_request_id,
    p_idempotency_key || ':event'
  )
  on conflict (idempotency_key) do nothing;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, request_id, after_state
  ) values (
    p_actor,
    'usdt_manual_deposit.confirm',
    'usdt_manual_deposit',
    v_deposit.id::text,
    p_reason,
    v_request_id,
    jsonb_build_object('credited_krw', p_credited_krw::text, 'ledger_transaction_id', v_ledger_transaction_id)
  );

  return v_ledger_transaction_id;
end;
$$;

revoke all on function public.confirm_usdt_manual_deposit(uuid, bigint, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_usdt_manual_deposit(uuid, bigint, uuid, text, text)
  to service_role;

commit;
