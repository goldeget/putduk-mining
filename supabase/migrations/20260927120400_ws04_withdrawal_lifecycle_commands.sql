begin;

-- ---------------------------------------------------------------------------
-- External send + release + finalize
-- ---------------------------------------------------------------------------

create function public.record_krw_external_send(
  p_withdrawal_id uuid,
  p_bank_reference text,
  p_actual_krw_amount bigint,
  p_actor uuid,
  p_sent_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_existing uuid;
  v_send_id uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or char_length(btrim(coalesce(p_bank_reference, ''))) < 4
    or p_actual_krw_amount is null
    or p_actual_krw_amount <= 0
    or p_actor is null
    or p_sent_at is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_KRW_EXTERNAL_SEND';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select send.id into v_existing
  from public.withdrawal_external_sends as send
  where send.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.destination_type <> 'KRW_BANK' then
    raise exception using errcode = '22023', message = 'WITHDRAWAL_METHOD_MISMATCH';
  end if;

  if exists (
    select 1 from public.withdrawal_external_sends as send
    where send.withdrawal_id = p_withdrawal_id
  ) then
    select send.id into v_existing
    from public.withdrawal_external_sends as send
    where send.withdrawal_id = p_withdrawal_id;
    return v_existing;
  end if;

  if v_request.status not in ('HELD', 'ADMIN_PROCESSING', 'REQUESTED') then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_SENDABLE';
  end if;

  if v_request.status = 'HELD' or v_request.status = 'REQUESTED' then
    update public.withdrawal_requests
    set status = 'ADMIN_PROCESSING', processing_started_at = statement_timestamp()
    where id = p_withdrawal_id;
  end if;

  insert into public.withdrawal_external_sends (
    withdrawal_id, method, bank_reference, actual_krw_amount,
    operator_user_id, sent_at, idempotency_key
  ) values (
    p_withdrawal_id, 'KRW_BANK', btrim(p_bank_reference), p_actual_krw_amount,
    p_actor, p_sent_at, p_idempotency_key
  ) returning id into v_send_id;

  update public.withdrawal_requests
  set status = 'EXTERNAL_SENT_RECORDED'
  where id = p_withdrawal_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_EXTERNAL_SENT.v1',
    1,
    'withdrawal_request',
    p_withdrawal_id,
    p_actor,
    jsonb_build_object(
      'method', 'KRW_BANK',
      'bank_reference', btrim(p_bank_reference),
      'actual_krw_amount', p_actual_krw_amount::text
    ),
    gen_random_uuid(),
    gen_random_uuid(),
    p_idempotency_key || ':event'
  );

  return v_send_id;
end;
$$;

revoke all on function public.record_krw_external_send(
  uuid, text, bigint, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_krw_external_send(
  uuid, text, bigint, uuid, timestamptz, text
) to service_role;

create function public.record_usdt_external_send(
  p_withdrawal_id uuid,
  p_network text,
  p_tx_hash text,
  p_actual_usdt_amount numeric,
  p_conversion_evidence jsonb,
  p_actor uuid,
  p_sent_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_tx text := lower(btrim(coalesce(p_tx_hash, '')));
  v_existing uuid;
  v_send_id uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or v_network not in ('TRC20', 'ERC20', 'BEP20')
    or char_length(v_tx) not between 8 and 128
    or p_actual_usdt_amount is null
    or p_actual_usdt_amount <= 0
    or scale(p_actual_usdt_amount) > 6
    or (p_conversion_evidence is not null and jsonb_typeof(p_conversion_evidence) <> 'object')
    or p_actor is null
    or p_sent_at is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_EXTERNAL_SEND';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select send.id into v_existing
  from public.withdrawal_external_sends as send
  where send.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.destination_type <> 'USDT_ADDRESS' then
    raise exception using errcode = '22023', message = 'WITHDRAWAL_METHOD_MISMATCH';
  end if;

  if exists (
    select 1 from public.withdrawal_external_sends as send
    where send.withdrawal_id = p_withdrawal_id
  ) then
    select send.id into v_existing
    from public.withdrawal_external_sends as send
    where send.withdrawal_id = p_withdrawal_id;
    return v_existing;
  end if;

  if v_request.status not in ('HELD', 'ADMIN_PROCESSING', 'REQUESTED') then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_SENDABLE';
  end if;

  if v_request.status in ('HELD', 'REQUESTED') then
    update public.withdrawal_requests
    set status = 'ADMIN_PROCESSING', processing_started_at = statement_timestamp()
    where id = p_withdrawal_id;
  end if;

  insert into public.withdrawal_external_sends (
    withdrawal_id, method, network, tx_hash, actual_usdt_amount,
    conversion_evidence, operator_user_id, sent_at, idempotency_key
  ) values (
    p_withdrawal_id, 'USDT_ADDRESS', v_network, v_tx, p_actual_usdt_amount,
    p_conversion_evidence, p_actor, p_sent_at, p_idempotency_key
  ) returning id into v_send_id;

  update public.withdrawal_requests
  set status = 'EXTERNAL_SENT_RECORDED'
  where id = p_withdrawal_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_EXTERNAL_SENT.v1',
    1,
    'withdrawal_request',
    p_withdrawal_id,
    p_actor,
    jsonb_build_object(
      'method', 'USDT_ADDRESS',
      'network', v_network,
      'tx_hash', v_tx,
      'actual_usdt_amount', p_actual_usdt_amount::text,
      'conversion_evidence_present', p_conversion_evidence is not null
    ),
    gen_random_uuid(),
    gen_random_uuid(),
    p_idempotency_key || ':event'
  );

  return v_send_id;
end;
$$;

revoke all on function public.record_usdt_external_send(
  uuid, text, text, numeric, jsonb, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_usdt_external_send(
  uuid, text, text, numeric, jsonb, uuid, timestamptz, text
) to service_role;

create function public.release_withdrawal_hold(
  p_withdrawal_id uuid,
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
  v_request public.withdrawal_requests%rowtype;
  v_accounts record;
  v_release_tx uuid;
  v_amount bigint;
  v_request_id uuid := gen_random_uuid();
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 4
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
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
    raise exception using errcode = '55000', message = 'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND';
  end if;

  if v_request.status not in ('REQUESTED', 'HELD', 'ADMIN_PROCESSING', 'REVIEWING', 'APPROVED', 'PROCESSING') then
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
    jsonb_build_object('phase', 'RELEASE', 'reason', p_reason),
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
    status = 'CANCELLED',
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
    jsonb_build_object('release_ledger_transaction_id', v_release_tx, 'reason', p_reason),
    gen_random_uuid(),
    v_request_id,
    p_idempotency_key || ':event'
  )
  on conflict (idempotency_key) do nothing;

  return v_release_tx;
end;
$$;

revoke all on function public.release_withdrawal_hold(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.release_withdrawal_hold(uuid, uuid, text, text)
  to service_role;

create function public.finalize_withdrawal_ledger(
  p_withdrawal_id uuid,
  p_actor uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_accounts record;
  v_finalize_tx uuid;
  v_amount bigint;
  v_wallet_account_id uuid;
  v_request_id uuid := gen_random_uuid();
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_FINALIZE';
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.finalize_ledger_transaction_id is not null then
    return v_request.finalize_ledger_transaction_id;
  end if;

  if v_request.status in ('LEDGER_FINALIZED', 'COMPLETED') then
    return v_request.finalize_ledger_transaction_id;
  end if;

  if not exists (
    select 1 from public.withdrawal_external_sends as send
    where send.withdrawal_id = p_withdrawal_id
  ) then
    raise exception using errcode = '55000', message = 'EXTERNAL_SEND_REQUIRED';
  end if;

  if v_request.status <> 'EXTERNAL_SENT_RECORDED' then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FINALIZABLE';
  end if;

  if v_request.hold_ledger_transaction_id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_HOLD_MISSING';
  end if;

  v_amount := v_request.amount_atomic + v_request.fee_atomic;
  select * into v_accounts from app_private.ensure_withdrawal_hold_accounts(v_request.user_id);

  select account.id into v_wallet_account_id
  from public.wallet_accounts as account
  where account.user_id = v_request.user_id
    and account.currency = 'KRW'
    and account.closed_at is null
  for update;

  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, metadata, created_by
  ) values (
    'WITHDRAWAL',
    'KRW',
    p_idempotency_key || ':finalize',
    'withdrawal_request',
    v_request.id,
    v_request.user_id,
    v_request_id,
    gen_random_uuid(),
    'Withdrawal ledger finalize after external send',
    jsonb_build_object('phase', 'FINALIZE'),
    p_actor
  )
  on conflict (idempotency_key) do nothing
  returning id into v_finalize_tx;

  if v_finalize_tx is null then
    select transaction.id into v_finalize_tx
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':finalize';
  else
    -- Clear hold clearing into operating cash (external payout settled).
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_finalize_tx, v_accounts.hold_clearing_id, 0, 'DEBIT', v_amount),
      (v_finalize_tx, v_accounts.payout_cash_id, 1, 'CREDIT', v_amount);

    insert into public.wallet_ledger (
      wallet_account_id, user_id, direction, entry_type, amount_atomic,
      idempotency_key, reference_type, reference_id, reason, created_by
    ) values (
      v_wallet_account_id,
      v_request.user_id,
      'DEBIT',
      'WITHDRAWAL',
      v_amount,
      p_idempotency_key || ':wallet',
      'withdrawal_request',
      v_request.id,
      'Withdrawal finalized after external send',
      p_actor
    )
    on conflict (idempotency_key) do nothing;
  end if;

  update public.withdrawal_requests
  set
    status = 'COMPLETED',
    finalize_ledger_transaction_id = v_finalize_tx,
    ledger_finalized_at = statement_timestamp(),
    reviewed_by = coalesce(reviewed_by, p_actor),
    reviewed_at = coalesce(reviewed_at, statement_timestamp())
  where id = v_request.id
    and finalize_ledger_transaction_id is null;

  update public.transaction_receipts
  set
    status = 'COMPLETED',
    completed_at = statement_timestamp(),
    ledger_transaction_id = v_finalize_tx,
    status_timeline = status_timeline || jsonb_build_array(
      jsonb_build_object('status', 'EXTERNAL_SENT_RECORDED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'LEDGER_FINALIZED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'COMPLETED', 'at', statement_timestamp())
    )
  where source_type = 'withdrawal_request'
    and source_id = v_request.id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_COMPLETED.v1',
    1,
    'withdrawal_request',
    v_request.id,
    p_actor,
    jsonb_build_object(
      'finalize_ledger_transaction_id', v_finalize_tx,
      'amount_atomic', v_request.amount_atomic::text
    ),
    gen_random_uuid(),
    v_request_id,
    p_idempotency_key || ':event'
  )
  on conflict (idempotency_key) do nothing;

  return v_finalize_tx;
end;
$$;

revoke all on function public.finalize_withdrawal_ledger(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_withdrawal_ledger(uuid, uuid, text)
  to service_role;

-- Welcome withdrawal: allow KRW_BANK and USDT_ADDRESS via hold path
create or replace function public.create_welcome_reward_withdrawal_request(
  p_user_id uuid,
  p_conversion_id uuid,
  p_withdrawal_policy_id uuid,
  p_destination_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_conversion public.trial_reward_conversions%rowtype;
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_existing uuid;
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_CONTEXT';
  end if;

  select request.id into v_existing
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  select conversion.* into v_conversion
  from public.trial_reward_conversions as conversion
  where conversion.id = p_conversion_id
    and conversion.user_id = p_user_id
    and conversion.status = 'CONVERTED'
  for update;

  if v_conversion.id is null then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_NOT_WITHDRAWABLE';
  end if;

  if v_conversion.converted_amount_atomic is null
    or v_conversion.converted_amount_atomic <= 0
    or v_conversion.converted_amount_atomic > 5000
  then
    raise exception using errcode = '22003', message = 'WELCOME_WITHDRAWAL_CAP_EXCEEDED';
  end if;

  if exists (
    select 1 from public.withdrawal_requests as request
    where request.welcome_reward_conversion_id = p_conversion_id
  ) then
    raise exception using errcode = '23505', message = 'WELCOME_REWARD_WITHDRAWAL_EXISTS';
  end if;

  select destination.* into v_destination
  from public.withdrawal_destinations as destination
  where destination.id = p_destination_id
    and destination.user_id = p_user_id
    and destination.destination_type in ('KRW_BANK', 'USDT_ADDRESS')
    and destination.verification_status = 'VERIFIED'
    and destination.replaced_at is null
    and destination.protection_until <= statement_timestamp();

  if v_destination.id is null then
    raise exception using errcode = '55000', message = 'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED';
  end if;

  select policy.* into v_policy
  from public.withdrawal_policies as policy
  where policy.id = p_withdrawal_policy_id
    and policy.currency = 'KRW'
    and policy.destination_type = v_destination.destination_type
    and policy.is_enabled
    and policy.allows_welcome_reward
    and policy.fee_atomic = 0
    and policy.effective_at <= statement_timestamp()
    and (policy.expires_at is null or policy.expires_at > statement_timestamp());

  if v_policy.id is null then
    raise exception using errcode = '55000', message = 'WELCOME_WITHDRAWAL_POLICY_UNAVAILABLE';
  end if;

  return app_private.request_withdrawal_with_hold(
    p_user_id,
    p_destination_id,
    v_conversion.converted_amount_atomic,
    v_destination.destination_type,
    p_idempotency_key,
    p_conversion_id
  );
end;
$$;

commit;
