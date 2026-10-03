begin;

-- 기존 public 명령과 v1 이벤트를 유지한다. 재시도는 실영수증을 확인하며
-- 과거 불일치를 다시 적립하거나 자동 복구하지 않는다.
create or replace function public.confirm_usdt_manual_deposit(
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
  v_journal public.ledger_transactions%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_operator_role public.app_role;
  v_hash text;
  v_key_id uuid;
  v_wallet_account_id uuid;
  v_member_account_id uuid;
  v_cash_account_id uuid;
  v_journal_id uuid;
  v_wallet_ledger_id uuid;
  v_entry_count bigint;
  v_valid_entry_count bigint;
  v_correlation_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
begin
  if p_deposit_id is null
    or p_credited_krw is null or p_credited_krw <= 0
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 10
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_DEPOSIT_CONFIRMATION';
  end if;

  v_operator_role := app_private.require_operator_role(
    p_actor, array['SUPER_ADMIN', 'ADMIN']::public.app_role[]
  );
  select deposit.* into v_deposit
  from public.usdt_manual_deposits as deposit
  where deposit.id = p_deposit_id
  for update;
  if v_deposit.id is null then
    raise exception using errcode = '55000', message = 'USDT_DEPOSIT_NOT_FOUND';
  end if;
  if v_deposit.status not in ('SUBMITTED', 'CONFIRMED') then
    raise exception using errcode = '55000', message = 'USDT_DEPOSIT_NOT_CONFIRMABLE';
  end if;
  if v_deposit.status = 'SUBMITTED' and (
    v_deposit.credited_krw is not null or v_deposit.ledger_transaction_id is not null
    or v_deposit.wallet_ledger_id is not null or v_deposit.confirmed_by is not null
    or v_deposit.confirmed_at is not null
  ) then
    raise exception using errcode = '55000', message = 'USDT_CONFIRMATION_RECEIPT_MISMATCH';
  end if;

  v_hash := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'deposit_id', v_deposit.id,
      'credited_krw', p_credited_krw::text,
      'reason', btrim(p_reason)
    )::text, 'UTF8'
  ), 'sha256'), 'hex');
  insert into app_private.idempotency_keys (
    scope, actor_id, idempotency_key, request_hash, status, locked_until
  ) values (
    -- 명령 키는 운영자가 달라도 전역으로 같은 요청만 가리킨다.
    'usdt_manual_deposit.confirm', null, p_idempotency_key, v_hash,
    'PROCESSING', statement_timestamp() + interval '5 minutes'
  ) on conflict (scope, actor_id, idempotency_key) do nothing
  returning id into v_key_id;

  if v_key_id is null then
    select key_record.* into v_key
    from app_private.idempotency_keys as key_record
    where key_record.scope = 'usdt_manual_deposit.confirm'
      and key_record.actor_id is null
      and key_record.idempotency_key = p_idempotency_key
    for update;
    if v_key.request_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    if v_key.status <> 'COMPLETED' then
      raise exception using errcode = '40001', message = 'USDT_CONFIRMATION_IN_PROGRESS';
    end if;
    v_key_id := v_key.id;
    if v_deposit.status <> 'CONFIRMED'
      or v_key.response_payload->>'ledger_transaction_id'
        is distinct from v_deposit.ledger_transaction_id::text
      or v_key.response_payload->>'credited_krw' is distinct from p_credited_krw::text
    then
      raise exception using errcode = '55000', message = 'USDT_CONFIRMATION_RECEIPT_MISMATCH';
    end if;
  end if;

  if v_deposit.status = 'CONFIRMED' then
    if v_deposit.credited_krw is distinct from p_credited_krw then
      raise exception using errcode = '22023', message = 'USDT_CONFIRMED_AMOUNT_MISMATCH';
    end if;
    if v_deposit.ledger_transaction_id is null or v_deposit.wallet_ledger_id is null
      or v_deposit.confirmed_by is null or v_deposit.confirmed_at is null
    then
      raise exception using errcode = '55000', message = 'USDT_CONFIRMATION_RECEIPT_MISMATCH';
    end if;
    select journal.* into v_journal
    from public.ledger_transactions as journal
    where journal.id = v_deposit.ledger_transaction_id;
    if exists (
      select 1 from public.ledger_transactions as keyed
      where keyed.idempotency_key = p_idempotency_key || ':ledger'
        and keyed.id is distinct from v_journal.id
    ) or exists (
      select 1 from public.wallet_ledger as keyed
      where keyed.idempotency_key = p_idempotency_key || ':wallet'
        and keyed.id is distinct from v_deposit.wallet_ledger_id
    ) or exists (
      select 1 from public.outbox_events as keyed
      where keyed.idempotency_key = p_idempotency_key || ':event'
        and (keyed.aggregate_type <> 'usdt_manual_deposit'
          or keyed.aggregate_id <> v_deposit.id
          or keyed.event_type <> 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1')
    ) then
      raise exception using errcode = '22023', message = 'USDT_CONFIRMATION_KEY_COLLISION';
    end if;
    -- 이 migration 이전의 정상 영수증도 기존 키의 원래 사유와 일치해야 한다.
    if v_journal.idempotency_key = p_idempotency_key || ':ledger'
      and (select btrim(projection.reason) from public.wallet_ledger as projection
        where projection.id = v_deposit.wallet_ledger_id) is distinct from btrim(p_reason)
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    if v_journal.id is null or v_journal.category <> 'DEPOSIT'
      or v_journal.currency <> 'KRW'
      or v_journal.reference_type <> 'usdt_manual_deposit'
      or v_journal.reference_id is distinct from v_deposit.id
      or v_journal.member_user_id is distinct from v_deposit.user_id
      or v_journal.created_by is distinct from v_deposit.confirmed_by
      or not exists (
        select 1 from public.wallet_ledger as projection
        join public.wallet_accounts as wallet on wallet.id = projection.wallet_account_id
        where projection.id = v_deposit.wallet_ledger_id
          and projection.user_id = v_deposit.user_id
          and wallet.user_id = v_deposit.user_id and wallet.currency = 'KRW'
          and projection.reference_type = 'usdt_manual_deposit'
          and projection.reference_id = v_deposit.id
          and projection.entry_type = 'DEPOSIT' and projection.direction = 'CREDIT'
          and projection.amount_atomic = p_credited_krw
          and projection.created_by = v_deposit.confirmed_by
      )
    then
      raise exception using errcode = '55000', message = 'USDT_CONFIRMATION_RECEIPT_MISMATCH';
    end if;

    select count(*), count(*) filter (where
      entry.amount_atomic = p_credited_krw and account.currency = 'KRW'
      and (
        (entry.sequence = 0 and entry.side = 'DEBIT'
          and account.code = 'PUTDUK:OPERATING_CASH:KRW'
          and account.account_class = 'ASSET' and account.normal_side = 'DEBIT'
          and account.is_controlled_asset and account.owner_user_id is null)
        or (entry.sequence = 1 and entry.side = 'CREDIT'
          and account.code = 'USER:' || upper(v_deposit.user_id::text) || ':KRW:LIABILITY'
          and account.account_class = 'LIABILITY' and account.normal_side = 'CREDIT'
          and not account.is_controlled_asset and account.owner_user_id = v_deposit.user_id)
      )
    ) into v_entry_count, v_valid_entry_count
    from public.ledger_entries as entry
    join public.ledger_accounts as account on account.id = entry.account_id
    where entry.transaction_id = v_journal.id;
    if v_entry_count <> 2 or v_valid_entry_count <> 2
      or (select count(*) from public.ledger_transactions as receipt
        where receipt.reference_type = 'usdt_manual_deposit'
          and receipt.reference_id = v_deposit.id) <> 1
      or (select count(*) from public.wallet_ledger as receipt
        where receipt.reference_type = 'usdt_manual_deposit'
          and receipt.reference_id = v_deposit.id) <> 1
      or (select count(*) from public.audit_logs as receipt
        where receipt.action = 'usdt_manual_deposit.confirm'
          and receipt.target_type = 'usdt_manual_deposit'
          and receipt.target_id = v_deposit.id::text) <> 1
      or (select count(*) from public.outbox_events as receipt
        where receipt.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'
          and receipt.aggregate_type = 'usdt_manual_deposit'
          and receipt.aggregate_id = v_deposit.id) <> 1
      or (select count(*) from public.audit_logs as audit
        where audit.action = 'usdt_manual_deposit.confirm'
          and audit.target_type = 'usdt_manual_deposit'
          and audit.target_id = v_deposit.id::text
          and audit.actor_user_id = v_deposit.confirmed_by
          and audit.request_id = v_journal.request_id
          and audit.after_state->>'ledger_transaction_id' = v_journal.id::text
          and audit.after_state->>'credited_krw' = p_credited_krw::text
      ) <> 1
      or (select count(*) from public.outbox_events as event
        where event.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'
          and event.schema_version = 1 and event.aggregate_type = 'usdt_manual_deposit'
          and event.aggregate_id = v_deposit.id
          and event.actor_user_id = v_deposit.confirmed_by
          and event.request_id = v_journal.request_id
          and event.correlation_id = v_journal.correlation_id
          and event.payload->>'user_id' = v_deposit.user_id::text
          and event.payload->>'ledger_transaction_id' = v_journal.id::text
          and event.payload->>'credited_krw' = p_credited_krw::text
      ) <> 1
    then
      raise exception using errcode = '55000', message = 'USDT_CONFIRMATION_RECEIPT_MISMATCH';
    end if;
    v_journal_id := v_journal.id;
  else
    -- 안전 모드는 새 적립을 막는다. 검증된 과거 영수증 조회는 허용한다.
    perform app_private.assert_not_safe_mode(array['GLOBAL', 'DEPOSIT']);
    insert into public.ledger_accounts (
      code, currency, account_class, normal_side, is_controlled_asset
    ) values ('PUTDUK:OPERATING_CASH:KRW', 'KRW', 'ASSET', 'DEBIT', true)
    on conflict (code) do nothing;
    insert into public.ledger_accounts (
      code, currency, account_class, normal_side, owner_user_id
    ) values (
      'USER:' || upper(v_deposit.user_id::text) || ':KRW:LIABILITY',
      'KRW', 'LIABILITY', 'CREDIT', v_deposit.user_id
    ) on conflict (code) do nothing;
    select account.id into v_cash_account_id from public.ledger_accounts as account
    where account.code = 'PUTDUK:OPERATING_CASH:KRW'
      and account.currency = 'KRW' and account.account_class = 'ASSET'
      and account.normal_side = 'DEBIT' and account.is_controlled_asset
      and account.owner_user_id is null and account.closed_at is null;
    select account.id into v_member_account_id from public.ledger_accounts as account
    where account.code = 'USER:' || upper(v_deposit.user_id::text) || ':KRW:LIABILITY'
      and account.currency = 'KRW' and account.account_class = 'LIABILITY'
      and account.normal_side = 'CREDIT' and not account.is_controlled_asset
      and account.owner_user_id = v_deposit.user_id and account.closed_at is null;
    if v_cash_account_id is null or v_member_account_id is null then
      raise exception using errcode = '55000', message = 'USDT_LEDGER_ACCOUNT_MISMATCH';
    end if;
    select wallet.id into v_wallet_account_id from public.wallet_accounts as wallet
    where wallet.user_id = v_deposit.user_id and wallet.currency = 'KRW'
      and wallet.closed_at is null
    for update;
    if v_wallet_account_id is null then
      raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
    end if;

    insert into public.ledger_transactions (
      category, currency, idempotency_key, reference_type, reference_id,
      member_user_id, request_id, correlation_id, description, metadata, created_by
    ) values (
      'DEPOSIT', 'KRW', p_idempotency_key || ':ledger', 'usdt_manual_deposit',
      v_deposit.id, v_deposit.user_id, v_request_id, v_correlation_id,
      'Manual USDT deposit confirmed as KRW',
      jsonb_build_object('network_snapshot', v_deposit.network_snapshot,
        'credited_krw', p_credited_krw::text, 'request_hash', v_hash), p_actor
    ) on conflict (idempotency_key) do nothing returning id into v_journal_id;
    if v_journal_id is null then
      raise exception using errcode = '22023', message = 'USDT_CONFIRMATION_KEY_COLLISION';
    end if;
    insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
    values
      (v_journal_id, v_cash_account_id, 0, 'DEBIT', p_credited_krw),
      (v_journal_id, v_member_account_id, 1, 'CREDIT', p_credited_krw);
    insert into public.wallet_ledger (
      wallet_account_id, user_id, direction, entry_type, amount_atomic,
      idempotency_key, reference_type, reference_id, reason, created_by
    ) values (
      v_wallet_account_id, v_deposit.user_id, 'CREDIT', 'DEPOSIT', p_credited_krw,
      p_idempotency_key || ':wallet', 'usdt_manual_deposit', v_deposit.id,
      btrim(p_reason), p_actor
    ) returning id into v_wallet_ledger_id;
    update public.usdt_manual_deposits
    set status = 'CONFIRMED', credited_krw = p_credited_krw,
      ledger_transaction_id = v_journal_id, wallet_ledger_id = v_wallet_ledger_id,
      confirmed_by = p_actor, confirmed_at = statement_timestamp()
    where id = v_deposit.id;
    insert into public.outbox_events (
      event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
      payload, correlation_id, request_id, idempotency_key
    ) values (
      'USDT_MANUAL_DEPOSIT_CONFIRMED.v1', 1, 'usdt_manual_deposit', v_deposit.id, p_actor,
      jsonb_build_object('user_id', v_deposit.user_id, 'credited_krw', p_credited_krw::text,
        'ledger_transaction_id', v_journal_id),
      v_correlation_id, v_request_id, p_idempotency_key || ':event'
    );
    insert into public.audit_logs (
      actor_user_id, actor_role, action, target_type, target_id, reason, request_id, after_state
    ) values (
      p_actor, v_operator_role, 'usdt_manual_deposit.confirm', 'usdt_manual_deposit',
      v_deposit.id::text, btrim(p_reason), v_request_id,
      jsonb_build_object('credited_krw', p_credited_krw::text, 'ledger_transaction_id', v_journal_id)
    );
  end if;

  update app_private.idempotency_keys
  set status = 'COMPLETED', response_status = 200,
    response_payload = jsonb_build_object('ledger_transaction_id', v_journal_id,
      'credited_krw', p_credited_krw::text),
    completed_at = statement_timestamp(), locked_until = null
  where id = v_key_id and status = 'PROCESSING';
  return v_journal_id;
end;
$$;

revoke all on function public.confirm_usdt_manual_deposit(uuid, bigint, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_usdt_manual_deposit(uuid, bigint, uuid, text, text)
  to service_role;

commit;
