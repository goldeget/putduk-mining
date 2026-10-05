begin;

-- 출금 해제·확정이 다른 출금의 멱등 키를 성공으로 처리하지 않게 한다.
-- 조건은 원화 입금 승인의 IDEMPOTENCY_KEY_REUSED와 같다.
-- 전표가 없거나 reference가 이 출금이 아니면 상태를 바꾸지 않는다.
-- 일반 출금 생성과 적립 생산자 계약은 열지 않는다.

create or replace function public.release_withdrawal_hold(
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
  v_existing_reference uuid;
  v_amount bigint;
  v_request_id uuid := gen_random_uuid();
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
  v_created_journal boolean := false;
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
    select transaction.id, transaction.reference_id
    into v_release_tx, v_existing_reference
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':release';

    if v_existing_reference is distinct from v_request.id
      or v_release_tx is null
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_release_tx, v_accounts.hold_clearing_id, 0, 'DEBIT', v_amount),
      (v_release_tx, v_accounts.member_liability_id, 1, 'CREDIT', v_amount);
    v_created_journal := true;
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

  if v_created_journal then
    perform app_private.record_money_command_link(
      'release_withdrawal_hold',
      v_release_tx,
      p_actor,
      p_reason,
      'withdrawal_request',
      v_request.id,
      jsonb_build_object(
        'disposition', v_disposition,
        'destination_id', v_request.withdrawal_destination_id,
        'currency', 'KRW',
        'amount_atomic', v_amount::text,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  return v_release_tx;
end;
$$;

create or replace function public.finalize_withdrawal_ledger(
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
  v_wallet_ledger_id uuid;
  v_existing_reference uuid;
  v_amount bigint;
  v_wallet_account_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_created_journal boolean := false;
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
    select transaction.id, transaction.reference_id
    into v_finalize_tx, v_existing_reference
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':finalize';

    if v_existing_reference is distinct from v_request.id
      or v_finalize_tx is null
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
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
    on conflict (idempotency_key) do nothing
    returning id into v_wallet_ledger_id;

    if v_wallet_ledger_id is null then
      select ledger.id, ledger.reference_id
      into v_wallet_ledger_id, v_existing_reference
      from public.wallet_ledger as ledger
      where ledger.idempotency_key = p_idempotency_key || ':wallet';

      if v_existing_reference is distinct from v_request.id
        or v_wallet_ledger_id is null
      then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
      end if;
    end if;

    v_created_journal := true;
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

  if v_created_journal then
    perform app_private.record_money_command_link(
      'finalize_withdrawal_ledger',
      v_finalize_tx,
      p_actor,
      'finalize_withdrawal_ledger',
      'withdrawal_request',
      v_request.id,
      jsonb_build_object(
        'destination_id', v_request.withdrawal_destination_id,
        'currency', 'KRW',
        'amount_atomic', v_amount::text,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  return v_finalize_tx;
end;
$$;

commit;
