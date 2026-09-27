begin;

-- ---------------------------------------------------------------------------
-- First destination registration must not block eligible first withdrawal.
-- Replacement / change keeps the protection cooldown window.
-- ---------------------------------------------------------------------------

create or replace function public.register_krw_bank_destination(
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
  v_protection_until timestamptz;
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

    v_protection_until :=
      statement_timestamp() + make_interval(hours => p_protection_hours);
  else
    -- First KRW_BANK destination is immediately eligible for withdrawal.
    v_protection_until := statement_timestamp();
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
    v_protection_until
  ) returning id into v_id;

  insert into public.withdrawal_destination_history (
    destination_id, user_id, destination_type, action, display_hint,
    value_fingerprint, metadata, actor_user_id, request_id
  ) values (
    v_id, p_user_id, 'KRW_BANK', 'REGISTERED', p_display_hint, p_value_fingerprint,
    jsonb_build_object(
      'masked', true,
      'first_registration', v_prior is null,
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

create or replace function public.register_usdt_withdrawal_destination(
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
  v_protection_until timestamptz;
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

    v_protection_until :=
      statement_timestamp() + make_interval(hours => p_protection_hours);
  else
    -- First USDT_ADDRESS destination is immediately eligible for withdrawal.
    v_protection_until := statement_timestamp();
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
    v_protection_until
  ) returning id into v_id;

  insert into public.withdrawal_destination_history (
    destination_id, user_id, destination_type, action, display_hint,
    value_fingerprint, metadata, actor_user_id, request_id
  ) values (
    v_id, p_user_id, 'USDT_ADDRESS', 'REGISTERED', p_display_hint, p_value_fingerprint,
    jsonb_build_object(
      'network', v_network,
      'masked', true,
      'first_registration', v_prior is null,
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

-- ---------------------------------------------------------------------------
-- release_withdrawal_hold: operator rejection = REJECTED,
-- user/operator cancellation = CANCELLED. Forbidden after EXTERNAL_SENT.
-- ---------------------------------------------------------------------------

drop function if exists public.release_withdrawal_hold(uuid, uuid, text, text);

create function public.release_withdrawal_hold(
  p_withdrawal_id uuid,
  p_actor uuid,
  p_reason text,
  p_idempotency_key text,
  p_disposition text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_accounts record;
  v_release_tx uuid;
  v_amount bigint;
  v_request_id uuid := gen_random_uuid();
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 4
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
    or v_disposition not in ('REJECTED', 'CANCELLED')
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_RELEASE';
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.release_ledger_transaction_id is not null then
    return v_request.release_ledger_transaction_id;
  end if;

  if v_request.status in ('EXTERNAL_SENT_RECORDED', 'LEDGER_FINALIZED', 'COMPLETED') then
    raise exception using
      errcode = '55000',
      message = 'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND';
  end if;

  if v_request.status not in (
    'REQUESTED', 'HELD', 'ADMIN_PROCESSING', 'REVIEWING', 'APPROVED', 'PROCESSING'
  ) then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_RELEASABLE';
  end if;

  if v_request.hold_ledger_transaction_id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_HOLD_MISSING';
  end if;

  v_amount := v_request.amount_atomic + v_request.fee_atomic;
  select * into v_accounts from app_private.ensure_withdrawal_hold_accounts(v_request.user_id);

  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, reversal_of_transaction_id, request_id, correlation_id,
    description, metadata, created_by
  ) values (
    'REVERSAL',
    'KRW',
    p_idempotency_key || ':release',
    'withdrawal_request',
    v_request.id,
    v_request.user_id,
    v_request.hold_ledger_transaction_id,
    v_request_id,
    gen_random_uuid(),
    'Withdrawal hold release',
    jsonb_build_object(
      'phase', 'RELEASE',
      'reason', p_reason,
      'disposition', v_disposition
    ),
    p_actor
  )
  on conflict (idempotency_key) do nothing
  returning id into v_release_tx;

  if v_release_tx is null then
    select transaction.id into v_release_tx
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':release';
  else
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_release_tx, v_accounts.hold_clearing_id, 0, 'DEBIT', v_amount),
      (v_release_tx, v_accounts.member_liability_id, 1, 'CREDIT', v_amount);
  end if;

  update public.withdrawal_requests
  set
    status = v_disposition::public.withdrawal_status,
    release_ledger_transaction_id = v_release_tx,
    hold_released_at = statement_timestamp(),
    rejection_reason = p_reason,
    reviewed_by = p_actor,
    reviewed_at = statement_timestamp()
  where id = v_request.id
    and release_ledger_transaction_id is null;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_HOLD_RELEASED.v1',
    1,
    'withdrawal_request',
    v_request.id,
    p_actor,
    jsonb_build_object(
      'release_ledger_transaction_id', v_release_tx,
      'reason', p_reason,
      'disposition', v_disposition
    ),
    gen_random_uuid(),
    v_request_id,
    p_idempotency_key || ':event'
  )
  on conflict (idempotency_key) do nothing;

  return v_release_tx;
end;
$$;

revoke all on function public.release_withdrawal_hold(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.release_withdrawal_hold(uuid, uuid, text, text, text)
  to service_role;

comment on function public.release_withdrawal_hold(uuid, uuid, text, text, text) is
  'Releases a held withdrawal before EXTERNAL_SENT_RECORDED. p_disposition must be REJECTED (operator rejection) or CANCELLED (user/operator cancellation). Idempotent on release ledger.';

commit;
