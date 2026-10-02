begin;

-- 원화 입금 승인을 균형 분개, 지갑 투영, 감사, 버전 아웃박스와 한 트랜잭션으로 맞춘다.
-- 과거 입금은 다시 적립하지 않는다. 승인액이 요청액과 달라도 기존처럼 허용한다.
-- 출금 네 명령은 금액을 다시 적립하지 않고 작업·결과·행위자·사유만 남긴다.
-- 대사는 불일치를 기록만 하며 잔액을 고치지 않는다.

alter table public.deposit_requests
  add column approved_amount_atomic bigint,
  add column ledger_transaction_id uuid,
  add column wallet_ledger_id uuid;

alter table public.deposit_requests
  add constraint deposit_requests_approved_amount_positive
    check (approved_amount_atomic is null or approved_amount_atomic > 0),
  add constraint deposit_requests_ledger_transaction_fk
    foreign key (ledger_transaction_id)
    references public.ledger_transactions (id)
    on delete restrict,
  add constraint deposit_requests_wallet_ledger_fk
    foreign key (wallet_ledger_id)
    references public.wallet_ledger (id)
    on delete restrict,
  add constraint deposit_requests_approval_linkage_pair
    check (
      (
        ledger_transaction_id is null
        and wallet_ledger_id is null
        and approved_amount_atomic is null
      )
      or (
        ledger_transaction_id is not null
        and wallet_ledger_id is not null
        and approved_amount_atomic is not null
      )
    );

comment on column public.deposit_requests.approved_amount_atomic is
  '승인 시점의 원화 원자 단위. 요청액과 다를 수 있다. 과거 행은 채우지 않는다.';
comment on column public.deposit_requests.ledger_transaction_id is
  '이번 승인이 만든 DEPOSIT 분개. 과거 승인 행은 null로 남는다.';
comment on column public.deposit_requests.wallet_ledger_id is
  '이번 승인이 만든 지갑 투영 대변. 반환 식별자와 같다.';

-- 계좌·주소·KYC·토큰 원문을 감사에 넣지 않는 연결 기록.
-- SECURITY INVOKER. 금액 분개는 만들지 않는다.
create function app_private.record_money_command_link(
  p_operation text,
  p_result_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_role public.app_role;
begin
  if p_operation is null
    or p_operation !~ '^[a-z][a-z0-9_]{2,63}$'
    or p_result_id is null
    or p_actor_id is null
    or char_length(btrim(coalesce(p_reason, ''))) < 4
    or char_length(btrim(coalesce(p_target_type, ''))) < 2
    or p_target_id is null
    or p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
  then
    raise exception using errcode = '22023', message = 'INVALID_COMMAND_LINK';
  end if;

  if p_metadata ?| array[
    'bank_reference',
    'account_number',
    'account_holder',
    'address',
    'encrypted_value',
    'token',
    'step_up_token',
    'tx_hash',
    'deposit_address',
    'kyc_document',
    'destination_snapshot'
  ] then
    raise exception using errcode = '22023', message = 'COMMAND_LINK_SECRET_FORBIDDEN';
  end if;

  select role_record.role
  into v_role
  from public.user_roles as role_record
  where role_record.user_id = p_actor_id
    and role_record.revoked_at is null
  order by role_record.granted_at desc
  limit 1;

  insert into public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    request_id,
    metadata
  ) values (
    p_actor_id,
    v_role,
    p_operation,
    p_target_type,
    p_target_id::text,
    btrim(p_reason),
    gen_random_uuid(),
    p_metadata || jsonb_build_object(
      'operation', p_operation,
      'result_id', p_result_id,
      'actor_user_id', p_actor_id
    )
  );
end;
$$;

revoke all on function app_private.record_money_command_link(text, uuid, uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function app_private.record_money_command_link(text, uuid, uuid, text, text, uuid, jsonb)
  to service_role;

create or replace function public.approve_deposit_request(
  p_deposit_request_id uuid,
  p_operator_id uuid,
  p_received_amount_atomic bigint,
  p_ledger_idempotency_key text,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_after public.deposit_requests%rowtype;
  v_before public.deposit_requests%rowtype;
  v_cash_account_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_created_journal boolean := false;
  v_existing_hash text;
  v_existing_payload jsonb;
  v_existing_reference uuid;
  v_existing_status text;
  v_idempotency_id uuid;
  v_journal_id uuid;
  v_journal_key text;
  v_ledger_amount bigint;
  v_ledger_id uuid;
  v_liability_account_id uuid;
  v_operator_role public.app_role;
  v_request_hash text;
  v_wallet_id uuid;
begin
  if p_received_amount_atomic is null or p_received_amount_atomic <= 0 then
    raise exception using errcode = '22023', message = 'AMOUNT_MUST_BE_POSITIVE';
  end if;
  if char_length(btrim(coalesce(p_ledger_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if btrim(coalesce(p_reason, '')) = '' or p_request_id is null or p_operator_id is null then
    raise exception using errcode = '22023', message = 'AUDIT_REASON_REQUIRED';
  end if;

  v_operator_role := app_private.require_operator_role(
    p_operator_id,
    array['SUPER_ADMIN', 'ADMIN']::public.app_role[]
  );

  select request.*
  into v_before
  from public.deposit_requests as request
  where request.id = p_deposit_request_id
  for update;

  if v_before.id is null then
    raise exception using errcode = '22023', message = 'DEPOSIT_REQUEST_NOT_FOUND';
  end if;
  if v_before.currency <> 'KRW'::public.currency_code then
    raise exception using errcode = '22023', message = 'DEPOSIT_CURRENCY_NOT_APPROVABLE';
  end if;
  if v_before.status not in ('REQUESTED', 'AWAITING_TRANSFER', 'REVIEWING', 'APPROVED') then
    raise exception using errcode = '55000', message = 'DEPOSIT_REQUEST_NOT_APPROVABLE';
  end if;

  v_request_hash := encode(
    extensions.digest(
      convert_to(
        v_before.id::text
          || '|'
          || p_received_amount_atomic::text
          || '|'
          || v_before.currency::text
          || '|'
          || btrim(p_reason),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_journal_key := p_ledger_idempotency_key || ':ledger';

  insert into app_private.idempotency_keys (
    scope,
    actor_id,
    idempotency_key,
    request_hash,
    status,
    locked_until
  ) values (
    'deposit.approve',
    p_operator_id,
    p_ledger_idempotency_key,
    v_request_hash,
    'PROCESSING',
    statement_timestamp() + interval '5 minutes'
  )
  on conflict (scope, actor_id, idempotency_key) do nothing
  returning id into v_idempotency_id;

  if v_idempotency_id is null then
    select key_record.status, key_record.request_hash, key_record.response_payload
    into v_existing_status, v_existing_hash, v_existing_payload
    from app_private.idempotency_keys as key_record
    where key_record.scope = 'deposit.approve'
      and key_record.actor_id = p_operator_id
      and key_record.idempotency_key = p_ledger_idempotency_key
    for update;

    if v_existing_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    if v_existing_status = 'COMPLETED'
      and nullif(v_existing_payload->>'wallet_ledger_id', '') is not null
    then
      return (v_existing_payload->>'wallet_ledger_id')::uuid;
    end if;
    raise exception using errcode = '40001', message = 'DEPOSIT_APPROVAL_IN_PROGRESS';
  end if;

  if v_before.status = 'APPROVED' then
    -- 과거 행의 approved_amount_atomic은 채우지 않는다.
    -- 금액이 다르면 COMPLETED로 남기기 전에 예외를 내 트랜잭션을 롤백한다.
    select ledger.id, ledger.amount_atomic
    into v_ledger_id, v_ledger_amount
    from public.wallet_ledger as ledger
    where ledger.reference_type = 'deposit_request'
      and ledger.reference_id = v_before.id
      and ledger.entry_type = 'DEPOSIT'
      and ledger.direction = 'CREDIT'
    order by ledger.created_at
    limit 1;

    if v_ledger_id is null then
      raise exception using errcode = '55000', message = 'DEPOSIT_APPROVAL_LEDGER_MISSING';
    end if;
    if v_ledger_amount is distinct from p_received_amount_atomic
      or (
        v_before.approved_amount_atomic is not null
        and v_before.approved_amount_atomic is distinct from p_received_amount_atomic
      )
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;

    update app_private.idempotency_keys
    set
      status = 'COMPLETED',
      response_status = 200,
      response_payload = jsonb_build_object(
        'wallet_ledger_id', v_ledger_id,
        'ledger_transaction_id', v_before.ledger_transaction_id
      ),
      completed_at = statement_timestamp(),
      locked_until = null
    where id = v_idempotency_id;

    return v_ledger_id;
  end if;

  perform app_private.assert_not_safe_mode(array['GLOBAL', 'DEPOSIT']);

  insert into public.ledger_accounts (
    code, currency, account_class, normal_side, is_controlled_asset
  ) values (
    'PUTDUK:OPERATING_CASH:KRW', 'KRW', 'ASSET', 'DEBIT', true
  )
  on conflict (code) do nothing;

  insert into public.ledger_accounts (
    code, currency, account_class, normal_side, owner_user_id
  ) values (
    'USER:' || upper(v_before.user_id::text) || ':KRW:LIABILITY',
    'KRW', 'LIABILITY', 'CREDIT', v_before.user_id
  )
  on conflict (code) do nothing;

  select account.id
  into v_cash_account_id
  from public.ledger_accounts as account
  where account.code = 'PUTDUK:OPERATING_CASH:KRW';

  select account.id
  into v_liability_account_id
  from public.ledger_accounts as account
  where account.code = 'USER:' || upper(v_before.user_id::text) || ':KRW:LIABILITY';

  insert into public.wallet_accounts (user_id, currency)
  values (v_before.user_id, 'KRW'::public.currency_code)
  on conflict (user_id, currency) do nothing;

  select account.id
  into v_wallet_id
  from public.wallet_accounts as account
  where account.user_id = v_before.user_id
    and account.currency = 'KRW'::public.currency_code
    and account.closed_at is null
  for update;

  if v_wallet_id is null or v_cash_account_id is null or v_liability_account_id is null then
    raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
  end if;

  insert into public.ledger_transactions (
    category,
    currency,
    idempotency_key,
    reference_type,
    reference_id,
    member_user_id,
    request_id,
    correlation_id,
    description,
    metadata,
    created_by
  ) values (
    'DEPOSIT',
    'KRW',
    v_journal_key,
    'deposit_request',
    v_before.id,
    v_before.user_id,
    p_request_id,
    v_correlation_id,
    'KRW deposit approved',
    jsonb_build_object(
      'operation', 'approve_deposit_request',
      'approved_amount_atomic', p_received_amount_atomic::text,
      'requested_amount_atomic', v_before.amount_atomic::text
    ),
    p_operator_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_journal_id;

  if v_journal_id is null then
    select transaction.id, transaction.reference_id
    into v_journal_id, v_existing_reference
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = v_journal_key;

    if v_existing_reference is distinct from v_before.id then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_journal_id, v_cash_account_id, 0, 'DEBIT', p_received_amount_atomic::numeric(38, 0)),
      (v_journal_id, v_liability_account_id, 1, 'CREDIT', p_received_amount_atomic::numeric(38, 0));
    v_created_journal := true;
  end if;

  insert into public.wallet_ledger (
    wallet_account_id,
    user_id,
    direction,
    entry_type,
    amount_atomic,
    idempotency_key,
    reference_type,
    reference_id,
    reason,
    created_by
  ) values (
    v_wallet_id,
    v_before.user_id,
    'CREDIT',
    'DEPOSIT',
    p_received_amount_atomic,
    p_ledger_idempotency_key,
    'deposit_request',
    v_before.id,
    p_reason,
    p_operator_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select ledger.id, ledger.reference_id
    into v_ledger_id, v_existing_reference
    from public.wallet_ledger as ledger
    where ledger.idempotency_key = p_ledger_idempotency_key;

    if v_existing_reference is distinct from v_before.id
      or v_ledger_id is null
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  end if;

  if not v_created_journal then
    if not exists (
      select 1
      from public.ledger_entries as entry
      where entry.transaction_id = v_journal_id
    ) then
      raise exception using errcode = '55000', message = 'DEPOSIT_JOURNAL_INCOMPLETE';
    end if;
  end if;

  update public.deposit_requests
  set
    status = 'APPROVED',
    reviewed_by = p_operator_id,
    reviewed_at = statement_timestamp(),
    rejection_reason = null,
    approved_amount_atomic = p_received_amount_atomic,
    ledger_transaction_id = v_journal_id,
    wallet_ledger_id = v_ledger_id
  where id = v_before.id
    and status in ('REQUESTED', 'AWAITING_TRANSFER', 'REVIEWING')
  returning * into v_after;

  if v_after.id is null then
    raise exception using errcode = '40001', message = 'DEPOSIT_APPROVAL_IN_PROGRESS';
  end if;

  insert into public.outbox_events (
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    payload,
    correlation_id,
    request_id,
    idempotency_key
  ) values (
    'DEPOSIT_CONFIRMED.v1',
    1,
    'deposit_request',
    v_before.id,
    p_operator_id,
    jsonb_build_object(
      'user_id', v_before.user_id,
      'currency', 'KRW',
      'approved_amount_atomic', p_received_amount_atomic::text,
      'requested_amount_atomic', v_before.amount_atomic::text,
      'ledger_transaction_id', v_journal_id,
      'wallet_ledger_id', v_ledger_id
    ),
    v_correlation_id,
    p_request_id,
    p_ledger_idempotency_key || ':deposit-event'
  )
  on conflict (idempotency_key) do nothing;

  insert into public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    request_id,
    before_state,
    after_state,
    metadata
  ) values (
    p_operator_id,
    v_operator_role,
    'deposit.approve',
    'deposit_request',
    v_before.id::text,
    p_reason,
    p_request_id,
    to_jsonb(v_before),
    to_jsonb(v_after),
    jsonb_build_object(
      'operation', 'approve_deposit_request',
      'result_id', v_ledger_id,
      'actor_user_id', p_operator_id,
      'wallet_ledger_id', v_ledger_id,
      'ledger_transaction_id', v_journal_id,
      'approved_amount_atomic', p_received_amount_atomic::text,
      'currency', 'KRW'
    )
  );

  update app_private.idempotency_keys
  set
    status = 'COMPLETED',
    response_status = 200,
    response_payload = jsonb_build_object(
      'wallet_ledger_id', v_ledger_id,
      'ledger_transaction_id', v_journal_id,
      'approved_amount_atomic', p_received_amount_atomic::text
    ),
    completed_at = statement_timestamp(),
    locked_until = null
  where id = v_idempotency_id;

  return v_ledger_id;
end;
$$;

comment on function public.approve_deposit_request(uuid, uuid, bigint, text, text, uuid) is
  '원화 입금 승인. 승인액으로 DEPOSIT 분개와 지갑 대변, 감사, DEPOSIT_CONFIRMED.v1을 한 트랜잭션에 기록한다. 요청액과 다른 양수 승인액은 그대로 둔다.';

-- 아래 네 함수의 분개 차변·대변과 금액은 그대로 두고, 성공 경로에 연결 기록만 더한다.

create or replace function public.record_krw_external_send(
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

  perform app_private.record_money_command_link(
    'record_krw_external_send',
    v_send_id,
    p_actor,
    'record_krw_external_send',
    'withdrawal_external_send',
    v_send_id,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'destination_id', v_request.withdrawal_destination_id,
      'currency', 'KRW',
      'amount_atomic', p_actual_krw_amount::text,
      'withdrawal_amount_atomic', v_request.amount_atomic::text,
      'withdrawal_fee_atomic', v_request.fee_atomic::text,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_send_id;
end;
$$;

create or replace function public.record_usdt_external_send(
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

  perform app_private.record_money_command_link(
    'record_usdt_external_send',
    v_send_id,
    p_actor,
    'record_usdt_external_send',
    'withdrawal_external_send',
    v_send_id,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'destination_id', v_request.withdrawal_destination_id,
      'withdrawal_currency', 'KRW',
      'withdrawal_amount_atomic', v_request.amount_atomic::text,
      'withdrawal_fee_atomic', v_request.fee_atomic::text,
      'external_currency', 'USDT',
      'external_amount', p_actual_usdt_amount::text,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_send_id;
end;
$$;

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
    select transaction.id into v_release_tx
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':release';
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
    select transaction.id into v_finalize_tx
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':finalize';
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
    on conflict (idempotency_key) do nothing;
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

create or replace function public.run_financial_reconciliation(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_checked_count bigint;
  v_mismatch_count bigint;
  v_run_id uuid;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'RECONCILIATION_REQUEST_ID_REQUIRED';
  end if;

  insert into public.reconciliation_runs (request_id, scope)
  values (p_request_id, 'FINANCIAL_CORE')
  returning id into v_run_id;

  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'UNBALANCED_JOURNAL',
    'ledger_transaction',
    transaction.id::text,
    jsonb_build_object('minimum_entries', 2, 'debit_equals_credit', true, 'currency_count', 1),
    jsonb_build_object(
      'entry_count', count(entry.id),
      'debit_atomic', coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0)::text,
      'credit_atomic', coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0)::text,
      'currency_count', count(distinct account.currency)
    )
  from public.ledger_transactions as transaction
  left join public.ledger_entries as entry on entry.transaction_id = transaction.id
  left join public.ledger_accounts as account on account.id = entry.account_id
  group by transaction.id
  having count(entry.id) < 2
    or coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0)
      <> coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0)
    or count(distinct account.currency) <> 1;

  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'WELCOME_REWARD_PROJECTION_MISMATCH',
    'trial_reward_conversion',
    conversion.id::text,
    jsonb_build_object(
      'amount_atomic', conversion.converted_amount_atomic::text,
      'wallet_projection_count', 1,
      'outbox_count', 1
    ),
    jsonb_build_object(
      'wallet_amount_atomic', coalesce(wallet.amount_atomic, 0)::text,
      'wallet_projection_count', case when wallet.id is null then 0 else 1 end,
      'outbox_count', event_summary.event_count,
      'debit_atomic', journal.debit_atomic::text,
      'credit_atomic', journal.credit_atomic::text
    )
  from public.trial_reward_conversions as conversion
  left join public.wallet_ledger as wallet on wallet.id = conversion.wallet_ledger_id
  left join lateral (
    select
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0) as debit_atomic,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0) as credit_atomic
    from public.ledger_entries as entry
    where entry.transaction_id = conversion.ledger_transaction_id
  ) as journal on true
  left join lateral (
    select count(*)::integer as event_count
    from public.outbox_events as event
    where event.aggregate_id = conversion.id
      and event.event_type = 'TRIAL_REWARD_CONVERTED.v1'
  ) as event_summary on true
  where conversion.status = 'CONVERTED'
    and (
      wallet.id is null
      or coalesce(wallet.amount_atomic, 0) <> conversion.converted_amount_atomic
      or event_summary.event_count <> 1
      or journal.debit_atomic <> conversion.converted_amount_atomic
      or journal.credit_atomic <> conversion.converted_amount_atomic
    );

  -- 승인된 원화 입금과 DEPOSIT 분개·투영·아웃박스를 비교만 한다.
  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'APPROVED_DEPOSIT_JOURNAL_MISMATCH',
    'deposit_request',
    request.id::text,
    jsonb_build_object(
      'currency', 'KRW',
      'approved_amount_atomic', expected.amount_atomic::text,
      'journal_count', 1,
      'projection_count', 1,
      'outbox_count', 1
    ),
    jsonb_build_object(
      'journal_count', journal_summary.journal_count,
      'debit_atomic', coalesce(journal_summary.debit_atomic, 0)::text,
      'credit_atomic', coalesce(journal_summary.credit_atomic, 0)::text,
      'projection_count', projection_summary.projection_count,
      'projection_atomic', coalesce(projection_summary.amount_atomic, 0)::text,
      'outbox_count', event_summary.event_count
    )
  from public.deposit_requests as request
  cross join lateral (
    select coalesce(
      request.approved_amount_atomic,
      (
        select ledger.amount_atomic
        from public.wallet_ledger as ledger
        where ledger.reference_type = 'deposit_request'
          and ledger.reference_id = request.id
          and ledger.entry_type = 'DEPOSIT'
          and ledger.direction = 'CREDIT'
        order by ledger.created_at
        limit 1
      ),
      request.amount_atomic
    )::numeric(38, 0) as amount_atomic
  ) as expected
  left join lateral (
    select
      count(distinct transaction.id)::integer as journal_count,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0) as debit_atomic,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0) as credit_atomic
    from public.ledger_transactions as transaction
    left join public.ledger_entries as entry on entry.transaction_id = transaction.id
    left join public.ledger_accounts as account on account.id = entry.account_id
    where transaction.reference_type = 'deposit_request'
      and transaction.reference_id = request.id
      and transaction.category = 'DEPOSIT'
      and transaction.currency = 'KRW'::public.currency_code
  ) as journal_summary on true
  left join lateral (
    select
      count(*)::integer as projection_count,
      coalesce(sum(ledger.amount_atomic), 0)::numeric(38, 0) as amount_atomic
    from public.wallet_ledger as ledger
    where ledger.reference_type = 'deposit_request'
      and ledger.reference_id = request.id
      and ledger.entry_type = 'DEPOSIT'
      and ledger.direction = 'CREDIT'
  ) as projection_summary on true
  left join lateral (
    select count(*)::integer as event_count
    from public.outbox_events as event
    where event.aggregate_id = request.id
      and event.event_type = 'DEPOSIT_CONFIRMED.v1'
  ) as event_summary on true
  where request.status = 'APPROVED'
    and request.currency = 'KRW'::public.currency_code
    and (
      journal_summary.journal_count <> 1
      or journal_summary.debit_atomic <> expected.amount_atomic
      or journal_summary.credit_atomic <> expected.amount_atomic
      or projection_summary.projection_count <> 1
      or projection_summary.amount_atomic <> expected.amount_atomic
      or event_summary.event_count <> 1
    );

  -- hold 중 부채 순액과 지갑 총잔액을 같다고 보지 않는다.
  -- 지갑 총잔액 = 부채 순액 + 분개된 미해제 hold.
  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'KRW_WALLET_LIABILITY_HOLD_PARITY',
    'wallet_account',
    wallet.id::text,
    jsonb_build_object(
      'wallet_total_atomic', totals.wallet_net::text,
      'formula', 'liability_net + posted_open_hold'
    ),
    jsonb_build_object(
      'liability_net_atomic', totals.liability_net::text,
      'posted_open_hold_atomic', totals.open_hold::text,
      'ui_total_atomic', totals.wallet_net::text
    )
  from public.wallet_accounts as wallet
  cross join lateral (
    select
      coalesce((
        select sum(
          case
            when entry.direction = 'CREDIT' then entry.amount_atomic
            else -entry.amount_atomic
          end
        )
        from public.wallet_ledger as entry
        where entry.wallet_account_id = wallet.id
      ), 0)::numeric(38, 0) as wallet_net,
      coalesce((
        select sum(
          case
            when entry.side = 'CREDIT' then entry.amount_atomic
            else -entry.amount_atomic
          end
        )
        from public.ledger_entries as entry
        join public.ledger_accounts as liability on liability.id = entry.account_id
        where liability.owner_user_id = wallet.user_id
          and liability.currency = 'KRW'::public.currency_code
          and liability.account_class = 'LIABILITY'
          and liability.closed_at is null
      ), 0)::numeric(38, 0) as liability_net,
      coalesce((
        select sum(request.amount_atomic + request.fee_atomic)
        from public.withdrawal_requests as request
        where request.user_id = wallet.user_id
          and request.currency = 'KRW'::public.currency_code
          and request.wallet_account_id = wallet.id
          and request.hold_ledger_transaction_id is not null
          and request.release_ledger_transaction_id is null
          and request.finalize_ledger_transaction_id is null
          and request.status in (
            'REQUESTED',
            'HELD',
            'ADMIN_PROCESSING',
            'EXTERNAL_SENT_RECORDED',
            'REVIEWING',
            'APPROVED',
            'PROCESSING'
          )
      ), 0)::numeric(38, 0) as open_hold
  ) as totals
  where wallet.currency = 'KRW'::public.currency_code
    and wallet.closed_at is null
    and totals.wallet_net <> totals.liability_net + totals.open_hold;

  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'EXTERNAL_SEND_LINK_MISMATCH',
    'withdrawal_request',
    request.id::text,
    jsonb_build_object(
      'currency', 'KRW',
      'destination_id', request.withdrawal_destination_id,
      'method', request.destination_type,
      'finalize_amount_atomic', (request.amount_atomic + request.fee_atomic)::text
    ),
    jsonb_build_object(
      'send_id', send.id,
      'send_method', send.method,
      'actual_krw_amount', send.actual_krw_amount,
      'actual_usdt_amount', send.actual_usdt_amount::text,
      'finalize_currency', finalize_journal.currency,
      'finalize_debit_atomic', coalesce(finalize_journal.debit_atomic, 0)::text
    )
  from public.withdrawal_requests as request
  left join public.withdrawal_external_sends as send
    on send.withdrawal_id = request.id
  left join lateral (
    select
      transaction.currency,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0) as debit_atomic,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0) as credit_atomic
    from public.ledger_transactions as transaction
    left join public.ledger_entries as entry on entry.transaction_id = transaction.id
    where transaction.id = request.finalize_ledger_transaction_id
    group by transaction.currency
  ) as finalize_journal on true
  where request.status in ('COMPLETED', 'LEDGER_FINALIZED')
    and request.currency = 'KRW'::public.currency_code
    and (
      send.id is null
      or send.method is distinct from request.destination_type
      or request.withdrawal_destination_id is null
      or request.finalize_ledger_transaction_id is null
      or finalize_journal.currency is distinct from 'KRW'::public.currency_code
      or finalize_journal.debit_atomic <> (request.amount_atomic + request.fee_atomic)::numeric(38, 0)
      or finalize_journal.credit_atomic <> (request.amount_atomic + request.fee_atomic)::numeric(38, 0)
      or (
        request.destination_type = 'KRW_BANK'
        and send.actual_krw_amount is null
      )
      or (
        request.destination_type = 'USDT_ADDRESS'
        and send.actual_usdt_amount is null
      )
    );

  select
    (select count(*) from public.ledger_transactions)
      + (select count(*) from public.trial_reward_conversions)
      + (
        select count(*)
        from public.deposit_requests
        where status = 'APPROVED'
          and currency = 'KRW'::public.currency_code
      )
      + (
        select count(*)
        from public.wallet_accounts
        where currency = 'KRW'::public.currency_code
          and closed_at is null
      ),
    (select count(*) from public.reconciliation_mismatches where run_id = v_run_id)
  into v_checked_count, v_mismatch_count;

  update public.reconciliation_runs
  set
    status = 'SUCCEEDED',
    checked_count = v_checked_count,
    mismatch_count = v_mismatch_count,
    totals = jsonb_build_object(
      'ledger_transactions', (select count(*) from public.ledger_transactions),
      'welcome_conversions', (select count(*) from public.trial_reward_conversions),
      'approved_krw_deposits', (
        select count(*)
        from public.deposit_requests
        where status = 'APPROVED'
          and currency = 'KRW'::public.currency_code
      )
    ),
    completed_at = statement_timestamp()
  where id = v_run_id;

  return v_run_id;
end;
$$;

comment on function public.run_financial_reconciliation(uuid) is
  'Read-only financial checker that records journal, deposit, hold-aware wallet parity, external-send linkage and welcome-reward projection mismatches. It never auto-repairs money.';

do $privilege$
begin
  if exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = 'app_private.record_money_command_link(text,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
      and (
        procedure.prosecdef
        or has_function_privilege('public', procedure.oid, 'EXECUTE')
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ) then
    raise exception using errcode = '42501', message = 'PUBLIC_EXECUTE_FORBIDDEN';
  end if;

  if exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = 'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)'::regprocedure
      and (
        procedure.prosecdef
        or has_function_privilege('public', procedure.oid, 'EXECUTE')
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      )
  ) then
    raise exception using errcode = '42501', message = 'APPROVE_DEPOSIT_PRIVILEGE_REGRESSION';
  end if;
end
$privilege$;

commit;
