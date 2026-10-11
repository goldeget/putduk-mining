begin;

-- BEGIN TEST-ONLY HISTORICAL HOLD FIXTURE
-- Test-only original receipt fixture. Never installed by a migration.
-- pg_temp plus postgres-only execution isolates it from service/public callers.
-- Call inside the owning test transaction; rollback/session end removes it.
-- It represents a source-less historical hold, NOT VERIFIED MINING_REWARD.
create function pg_temp.seed_historical_held_withdrawal(
  p_owner uuid, p_destination uuid, p_amount bigint, p_key text
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $historical_fixture$
declare
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_wallet uuid;
  v_request uuid;
  v_command_request uuid := gen_random_uuid();
  v_journal uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'HISTORICAL_FIXTURE_OWNER_ONLY';
  end if;
  if p_amount is null or p_amount <= 0 or char_length(p_key) not between 8 and 200 then
    raise exception 'INVALID_HISTORICAL_FIXTURE';
  end if;
  if exists (select 1 from public.withdrawal_requests
    where user_id = p_owner and idempotency_key = p_key) then
    raise exception 'HISTORICAL_FIXTURE_ALREADY_EXISTS';
  end if;
  select * into v_destination from public.withdrawal_destinations
  where id = p_destination and user_id = p_owner and verification_status = 'VERIFIED';
  select * into v_policy from public.withdrawal_policies
  where currency = 'KRW' and destination_type = v_destination.destination_type
    and is_enabled and effective_at <= statement_timestamp()
    and (expires_at is null or expires_at > statement_timestamp())
  order by version desc limit 1;
  select id into v_wallet from public.wallet_accounts
  where user_id = p_owner and currency = 'KRW' and closed_at is null;
  if v_destination.id is null or v_policy.id is null or v_wallet is null
    or app_private.available_krw_balance(v_wallet) < p_amount + v_policy.fee_atomic then
    raise exception 'HISTORICAL_FIXTURE_RECEIPT_UNAVAILABLE';
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, withdrawal_destination_id,
    user_id, currency, amount_atomic, fee_atomic, destination_type,
    destination_snapshot, status, idempotency_key
  ) values (
    v_wallet, v_policy.id, v_destination.id, p_owner, 'KRW', p_amount,
    v_policy.fee_atomic, v_destination.destination_type,
    jsonb_build_object('destination_id', v_destination.id,
      'display', v_destination.display_hint, 'verified_at', v_destination.verified_at),
    'REQUESTED', p_key
  ) returning id into v_request;
  v_journal := app_private.post_withdrawal_hold(
    p_owner, v_request, p_amount + v_policy.fee_atomic, p_key, v_command_request
  );
  update public.withdrawal_requests set status = 'HELD',
    hold_ledger_transaction_id = v_journal, hold_posted_at = statement_timestamp()
  where id = v_request;
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1', 1, 'withdrawal_request', v_request, p_owner,
    jsonb_build_object('user_id', p_owner, 'amount_atomic', p_amount::text,
      'fee_atomic', v_policy.fee_atomic::text, 'currency', 'KRW',
      'destination_type', v_destination.destination_type,
      'hold_ledger_transaction_id', v_journal, 'welcome_reward', false),
    gen_random_uuid(), v_command_request, p_key || ':event'
  );
  insert into public.transaction_receipts (
    receipt_number, user_id, transaction_type, source_type, source_id,
    amount_atomic, currency, status, requested_at, status_timeline
  ) values (
    'PDK-WD-' || upper(replace(v_request::text, '-', '')), p_owner, 'WITHDRAWAL',
    'withdrawal_request', v_request, p_amount, 'KRW', 'HELD', statement_timestamp(),
    jsonb_build_array(
      jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'HELD', 'at', statement_timestamp()))
  );
  return v_request;
end;
$historical_fixture$;
revoke all on function pg_temp.seed_historical_held_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
-- END TEST-ONLY HISTORICAL HOLD FIXTURE

-- BEGIN TEST-ONLY VERIFIED MINING REWARD FIXTURE
-- Owner-only sealed mining CREDIT fixture for local rollback/concurrency tests.
-- This is not a producer command or legacy settlement activation.
-- The actual tested withdrawal commands must create their own reservations.
create function pg_temp.plant_verified_mining_reward(
  p_user_id uuid,
  p_movement_id uuid,
  p_amount bigint,
  p_effective_at timestamptz,
  p_recorded_at timestamptz,
  p_key text
) returns void
language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_credit uuid := gen_random_uuid();
  v_journal uuid := gen_random_uuid();
  v_wallet uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_wallet_account uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'VERIFIED_MINING_FIXTURE_OWNER_ONLY';
  end if;
  select account.id into v_wallet_account
  from public.wallet_accounts as account
  where account.user_id = p_user_id and account.currency = 'KRW' and account.closed_at is null;
  insert into public.ledger_transactions(
    id, category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, posted_at
  ) values (
    v_journal, 'MINING_REWARD', 'KRW', p_key || ':ledger', 'mining_reward_credit', v_credit,
    p_user_id, v_request, v_correlation, 'verified mining reward credit', p_effective_at
  );
  insert into public.ledger_entries(transaction_id, account_id, sequence, side, amount_atomic)
  values
    (v_journal, (select id from public.ledger_accounts where code = 'PUTDUK:MINING_REWARD_EXPENSE:KRW'),
      0, 'DEBIT', p_amount),
    (v_journal, (select id from public.ledger_accounts
      where code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'),
      1, 'CREDIT', p_amount);
  insert into public.wallet_ledger(
    id, wallet_account_id, user_id, direction, entry_type, amount_atomic,
    idempotency_key, reference_type, reference_id
  ) values (
    v_wallet, v_wallet_account, p_user_id, 'CREDIT', 'MINING_REWARD', p_amount,
    p_key || ':wallet', 'mining_reward_credit', v_credit
  );
  insert into public.outbox_events(
    id, event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    v_event, 'MINING_REWARD_CREDITED.v1', 1, 'mining_reward_credit', v_credit, p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', p_amount,
      'currency', 'KRW',
      'ledger_transaction_id', v_journal,
      'wallet_ledger_id', v_wallet
    ),
    v_correlation, v_request, p_key || ':event'
  );
  insert into public.mining_reward_credits(
    id, user_id, amount_atomic, ledger_transaction_id, wallet_ledger_id,
    source_event_id, effective_at
  ) values (
    v_credit, p_user_id, p_amount, v_journal, v_wallet, v_event, p_effective_at
  );
  insert into public.money_source_movements(
    id, user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at, recorded_at
  ) values (
    p_movement_id, p_user_id, 'MINING_REWARD', 'CREDIT', 'MINING_REWARD', p_amount,
    v_journal, v_wallet, v_event, p_effective_at, p_recorded_at
  );
end;
$$;

revoke all on function pg_temp.plant_verified_mining_reward(uuid,uuid,bigint,timestamptz,timestamptz,text)
  from public, anon, authenticated, service_role;
-- END TEST-ONLY VERIFIED MINING REWARD FIXTURE


create extension if not exists pgtap with schema extensions;

select no_plan();

create temporary table krw_ctx (
  admin_id uuid not null,
  admin_two_id uuid not null,
  non_admin_id uuid not null,
  baseline_id uuid not null,
  partial_id uuid not null,
  happy_id uuid not null,
  usdt_send_id uuid not null,
  trial_id uuid not null,
  usdt_deposit_id uuid not null,
  partial_deposit_id uuid,
  partial_ledger_id uuid,
  happy_deposit_id uuid,
  happy_ledger_id uuid,
  happy_wallet_id uuid,
  hold_id uuid,
  release_hold_id uuid,
  krw_destination_id uuid,
  usdt_destination_id uuid,
  krw_send_id uuid,
  finalize_id uuid,
  release_id uuid,
  usdt_withdrawal_id uuid,
  usdt_external_send_id uuid,
  trial_conversion_id uuid,
  manual_usdt_ledger_id uuid
);

insert into krw_ctx (
  admin_id,
  admin_two_id,
  non_admin_id,
  baseline_id,
  partial_id,
  happy_id,
  usdt_send_id,
  trial_id,
  usdt_deposit_id
) values (
  '0d100000-0000-4000-8000-0000000000a1',
  '0d100000-0000-4000-8000-0000000000a2',
  '0d100000-0000-4000-8000-0000000000a3',
  '0d100000-0000-4000-8000-0000000000b1',
  '0d100000-0000-4000-8000-0000000000c1',
  '0d100000-0000-4000-8000-0000000000d1',
  '0d100000-0000-4000-8000-0000000000e1',
  '0d100000-0000-4000-8000-0000000000f1',
  '0d100000-0000-4000-8000-0000000000f2'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
)
select
  person.id,
  'authenticated',
  'authenticated',
  person.email,
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
from (
  select admin_id as id, 'krw-journal-admin@putduk.test' as email from krw_ctx
  union all select admin_two_id, 'krw-journal-admin-two@putduk.test' from krw_ctx
  union all select non_admin_id, 'krw-journal-member@putduk.test' from krw_ctx
  union all select baseline_id, 'krw-journal-baseline@putduk.test' from krw_ctx
  union all select partial_id, 'krw-journal-partial@putduk.test' from krw_ctx
  union all select happy_id, 'krw-journal-happy@putduk.test' from krw_ctx
  union all select usdt_send_id, 'krw-journal-usdt-send@putduk.test' from krw_ctx
  union all select trial_id, 'krw-journal-trial@putduk.test' from krw_ctx
  union all select usdt_deposit_id, 'krw-journal-usdt-deposit@putduk.test' from krw_ctx
) as person;

insert into public.user_roles (user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from krw_ctx
union all
select admin_two_id, 'ADMIN'::public.app_role, admin_two_id from krw_ctx;

select public.bootstrap_user((select baseline_id from krw_ctx));
select public.bootstrap_user((select partial_id from krw_ctx));
select public.bootstrap_user((select happy_id from krw_ctx));
select public.bootstrap_user((select usdt_send_id from krw_ctx));
select public.bootstrap_user((select trial_id from krw_ctx));
select public.bootstrap_user((select usdt_deposit_id from krw_ctx));

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)'::regprocedure
  ),
  'approve_deposit_request remains security invoker'
);
select ok(
  not has_function_privilege(
    'public',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'app_private.record_money_command_link(text,uuid,uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'new and replaced money functions are not executable by public'
);

-- 1. 과거형 합성 데이터로 분개 없는 승인 불일치를 드러낸다. 대사는 잔액을 고치지 않는다.
insert into public.deposit_requests (
  id,
  user_id,
  currency,
  amount_atomic,
  status,
  idempotency_key,
  reviewed_by,
  reviewed_at
)
select
  '0d100000-0000-4000-8000-0000000000b2',
  baseline_id,
  'KRW',
  7000,
  'APPROVED',
  'krw-journal-baseline-deposit',
  admin_id,
  statement_timestamp()
from krw_ctx;

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
)
select
  account.id,
  context.baseline_id,
  'CREDIT',
  'DEPOSIT',
  7000,
  'krw-journal-baseline-wallet',
  'deposit_request',
  '0d100000-0000-4000-8000-0000000000b2',
  'synthetic projection without journal',
  context.admin_id
from krw_ctx as context
join public.wallet_accounts as account
  on account.user_id = context.baseline_id
 and account.currency = 'KRW';

select throws_ok(
  $$
    select public.approve_deposit_request(
      '0d100000-0000-4000-8000-0000000000b2',
      admin_id,
      7001,
      'krw-journal-baseline-other-amount',
      'legacy approval amount must match',
      '0d100000-0000-4000-8000-00000000b103'
    )
    from krw_ctx
  $$,
  '22023',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'approved deposit with a null stored amount rejects a different replay amount'
);

select public.run_financial_reconciliation('0d100000-0000-4000-8000-00000000b101');

select ok(
  exists (
    select 1
    from public.reconciliation_mismatches as mismatch
    where mismatch.mismatch_type = 'APPROVED_DEPOSIT_JOURNAL_MISMATCH'
      and mismatch.subject_id = '0d100000-0000-4000-8000-0000000000b2'
  ),
  'baseline approved deposit without a journal is reported'
);
select ok(
  exists (
    select 1
    from public.reconciliation_mismatches as mismatch
    join public.wallet_accounts as account
      on account.id::text = mismatch.subject_id
    where mismatch.mismatch_type = 'KRW_WALLET_LIABILITY_HOLD_PARITY'
      and account.user_id = (select baseline_id from krw_ctx)
  ),
  'baseline wallet credit without liability is reported'
);
select is(
  (
    select count(*)::integer
    from public.ledger_transactions as transaction
    where transaction.member_user_id = (select baseline_id from krw_ctx)
  ),
  0,
  'reconciliation does not backfill a journal for the baseline deposit'
);
select is(
  (
    select coalesce(sum(
      case when ledger.direction = 'CREDIT' then ledger.amount_atomic else -ledger.amount_atomic end
    ), 0)::bigint
    from public.wallet_ledger as ledger
    where ledger.user_id = (select baseline_id from krw_ctx)
  ),
  7000::bigint,
  'reconciliation does not repair the baseline wallet projection'
);

select public.run_financial_reconciliation('0d100000-0000-4000-8000-00000000b102');

select is(
  (
    select coalesce(sum(
      case when ledger.direction = 'CREDIT' then ledger.amount_atomic else -ledger.amount_atomic end
    ), 0)::bigint
    from public.wallet_ledger as ledger
    where ledger.user_id = (select baseline_id from krw_ctx)
  ),
  7000::bigint,
  'a second reconciliation still does not repair the baseline balance'
);

-- 2. 정상 승인은 균형 분개, 투영, 감사, 아웃박스를 함께 만든다.
update krw_ctx
set partial_deposit_id = public.create_deposit_request(
  partial_id,
  'KRW',
  10000,
  'krw-journal-partial-request'
);

update krw_ctx
set partial_ledger_id = public.approve_deposit_request(
  partial_deposit_id,
  admin_id,
  4000,
  'krw-journal-partial-ledger',
  'partial amount remains the approval amount',
  '0d100000-0000-4000-8000-00000000c201'
);

select is(
  (
    select amount_atomic
    from public.deposit_requests
    where id = (select partial_deposit_id from krw_ctx)
  ),
  10000::bigint,
  'requested amount stays unchanged when the approved amount differs'
);
select is(
  (
    select approved_amount_atomic
    from public.deposit_requests
    where id = (select partial_deposit_id from krw_ctx)
  ),
  4000::bigint,
  'stored approval amount is the received amount'
);
select ok(
  (
    select
      sum(entry.amount_atomic) filter (where entry.side = 'DEBIT')
        = 4000::numeric
      and sum(entry.amount_atomic) filter (where entry.side = 'CREDIT')
        = 4000::numeric
      and bool_and(account.currency = 'KRW')
      and bool_or(account.account_class = 'ASSET' and entry.side = 'DEBIT')
      and bool_or(account.account_class = 'LIABILITY' and entry.side = 'CREDIT')
    from public.deposit_requests as request
    join public.ledger_entries as entry
      on entry.transaction_id = request.ledger_transaction_id
    join public.ledger_accounts as account on account.id = entry.account_id
    where request.id = (select partial_deposit_id from krw_ctx)
  ),
  'partial approval posts a balanced KRW cash debit and liability credit'
);

update krw_ctx
set happy_deposit_id = public.create_deposit_request(
  happy_id,
  'KRW',
  100000,
  'krw-journal-happy-request'
);

update krw_ctx
set happy_ledger_id = public.approve_deposit_request(
  happy_deposit_id,
  admin_id,
  100000,
  'krw-journal-happy-ledger',
  'verified matching bank transfer',
  '0d100000-0000-4000-8000-00000000d201'
);

update krw_ctx
set happy_wallet_id = account.id
from public.wallet_accounts as account
where account.user_id = krw_ctx.happy_id
  and account.currency = 'KRW';

select is(
  (
    select count(*)::integer
    from public.ledger_transactions as transaction
    where transaction.reference_type = 'deposit_request'
      and transaction.reference_id = (select happy_deposit_id from krw_ctx)
      and transaction.category = 'DEPOSIT'
      and transaction.currency = 'KRW'
  ),
  1,
  'approval writes one KRW DEPOSIT journal'
);
select is(
  (
    select count(*)::integer
    from public.wallet_ledger as ledger
    where ledger.id = (select happy_ledger_id from krw_ctx)
      and ledger.direction = 'CREDIT'
      and ledger.entry_type = 'DEPOSIT'
      and ledger.amount_atomic = 100000
  ),
  1,
  'approval return id is the wallet projection credit'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events as event
    where event.aggregate_id = (select happy_deposit_id from krw_ctx)
      and event.event_type = 'DEPOSIT_CONFIRMED.v1'
      and event.schema_version = 1
  ),
  1,
  'approval writes one versioned deposit event'
);
select ok(
  exists (
    select 1
    from public.audit_logs as audit
    where audit.action = 'deposit.approve'
      and audit.target_id = (select happy_deposit_id::text from krw_ctx)
      and audit.actor_user_id = (select admin_id from krw_ctx)
      and audit.metadata->>'ledger_transaction_id' is not null
      and audit.metadata->>'currency' = 'KRW'
  ),
  'approval audit links actor, result and currency'
);

-- 3. 같은 키 재실행, 다른 키, 두 관리자.
select is(
  public.approve_deposit_request(
    (select happy_deposit_id from krw_ctx),
    (select admin_id from krw_ctx),
    100000,
    'krw-journal-happy-ledger',
    'verified matching bank transfer',
    '0d100000-0000-4000-8000-00000000d201'
  ),
  (select happy_ledger_id from krw_ctx),
  'same key and payload returns the original projection'
);
select is(
  public.approve_deposit_request(
    (select happy_deposit_id from krw_ctx),
    (select admin_two_id from krw_ctx),
    100000,
    'krw-journal-happy-other-key',
    'verified matching bank transfer',
    '0d100000-0000-4000-8000-00000000d202'
  ),
  (select happy_ledger_id from krw_ctx),
  'a second admin with another key does not post again'
);
select is(
  (
    select count(*)::integer
    from public.ledger_transactions as transaction
    where transaction.reference_id = (select happy_deposit_id from krw_ctx)
      and transaction.category = 'DEPOSIT'
  ),
  1,
  'two admins leave one deposit journal'
);

-- 같은 입금의 두 세션 동시 승인은 supabase/tests-concurrent/krw_deposit_concurrent_approval.sql 이 검사한다.

-- 4. 다른 payload, 금액·통화·상태, 권한. step-up 토큰은 고정 시그니처에 없다.
select throws_ok(
  $$
    select public.approve_deposit_request(
      happy_deposit_id,
      admin_id,
      100001,
      'krw-journal-happy-ledger',
      'verified matching bank transfer',
      '0d100000-0000-4000-8000-00000000d203'
    )
    from krw_ctx
  $$,
  '22023',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'same key with a different amount is rejected'
);
select throws_ok(
  $$
    select public.approve_deposit_request(
      happy_deposit_id,
      admin_two_id,
      1,
      'krw-journal-happy-mismatch',
      'different approval amount',
      '0d100000-0000-4000-8000-00000000d204'
    )
    from krw_ctx
  $$,
  '22023',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'a second admin cannot replace the approved amount'
);
select throws_ok(
  $$
    select public.approve_deposit_request(
      happy_deposit_id,
      admin_id,
      0,
      'krw-journal-zero-amount',
      'zero amount',
      '0d100000-0000-4000-8000-00000000d205'
    )
    from krw_ctx
  $$,
  '22023',
  'AMOUNT_MUST_BE_POSITIVE',
  'non-positive approval amount is rejected'
);

select throws_ok(
  $$
    select public.approve_deposit_request(
      public.create_deposit_request(partial_id, 'USDT', 1000, 'krw-journal-usdt-currency'),
      admin_id,
      1000,
      'krw-journal-usdt-currency-ledger',
      'usdt currency is not a krw deposit',
      '0d100000-0000-4000-8000-00000000c301'
    )
    from krw_ctx
  $$,
  '22023',
  'DEPOSIT_CURRENCY_NOT_APPROVABLE',
  'non-KRW deposit requests are not approved into a user USDT balance'
);
select is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = (select partial_id from krw_ctx)
      and currency = 'USDT'
  ),
  0,
  'rejected currency approval creates no USDT wallet'
);

select public.create_deposit_request(
  (select happy_id from krw_ctx),
  'KRW',
  3000,
  'krw-journal-status-cancel'
);

update public.deposit_requests
set status = 'CANCELLED'
where idempotency_key = 'krw-journal-status-cancel';

select throws_ok(
  $$
    select public.approve_deposit_request(
      request.id,
      (select admin_id from krw_ctx),
      3000,
      'krw-journal-status-cancel-replay',
      'cancelled status replay',
      '0d100000-0000-4000-8000-00000000d302'
    )
    from public.deposit_requests as request
    where request.idempotency_key = 'krw-journal-status-cancel'
  $$,
  '55000',
  'DEPOSIT_REQUEST_NOT_APPROVABLE',
  'cancelled status rejects approval'
);

select throws_ok(
  $$
    select public.approve_deposit_request(
      request.id,
      (select non_admin_id from krw_ctx),
      request.amount_atomic,
      'krw-journal-role-ledger',
      'missing operator role',
      '0d100000-0000-4000-8000-00000000d303'
    )
    from public.deposit_requests as request
    where request.idempotency_key = 'krw-journal-happy-request'
  $$,
  '42501',
  'OPERATOR_ROLE_REQUIRED',
  'a member without an operator role cannot approve'
);
select throws_ok(
  $$
    select public.consume_admin_step_up(
      '0d100000-0000-4000-8000-0000000000a1',
      'short-token',
      'DEPOSIT_APPROVE',
      '0d100000-0000-4000-8000-00000000d304',
      null
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'deposit approval step-up rejects a short token without a session'
);
-- The frozen six-argument service RPC never accepts a step-up token.
-- Exercise its actual caller boundary instead of declaring that test skipped.
-- A signed browser role cannot call the native approval writer directly;
-- real operator AAL2/step-up remains the server command adapter's duty.
set local role authenticated;
select throws_ok(
  $$select public.approve_deposit_request(
    '0d100000-0000-4000-8000-0000000000b1'::uuid,
    '0d100000-0000-4000-8000-0000000000a1'::uuid,
    1::bigint,
    'krw-journal-direct-member-denied',
    'direct browser approval must be rejected',
    '0d100000-0000-4000-8000-00000000d305'::uuid
  )$$,
  '42501',
  'permission denied for function approve_deposit_request',
  'a browser role cannot bypass the operator command and call native approval'
);
reset role;

-- 5. safe mode는 새 승인을 거절하고, 완료된 같은 키 재실행은 분개를 늘리지 않는다.
insert into public.safe_mode_controls (
  component,
  is_paused,
  reason,
  changed_by,
  request_id
)
select
  'DEPOSIT',
  true,
  'krw deposit journal safe mode',
  admin_id,
  '0d100000-0000-4000-8000-00000000d401'
from krw_ctx
on conflict (component) do update
set
  is_paused = true,
  reason = excluded.reason,
  changed_by = excluded.changed_by,
  request_id = excluded.request_id;

select throws_ok(
  $$
    select public.approve_deposit_request(
      public.create_deposit_request(happy_id, 'KRW', 2500, 'krw-journal-safe-request'),
      admin_id,
      2500,
      'krw-journal-safe-ledger',
      'safe mode must reject',
      '0d100000-0000-4000-8000-00000000d402'
    )
    from krw_ctx
  $$,
  '55000',
  'SAFE_MODE_ACTIVE',
  'deposit safe mode rejects a new approval'
);
select is(
  public.approve_deposit_request(
    (select happy_deposit_id from krw_ctx),
    (select admin_id from krw_ctx),
    100000,
    'krw-journal-happy-ledger',
    'verified matching bank transfer',
    '0d100000-0000-4000-8000-00000000d403'
  ),
  (select happy_ledger_id from krw_ctx),
  'completed approval replay succeeds during deposit safe mode'
);
select is(
  (
    select count(*)::integer
    from public.ledger_entries as entry
    join public.ledger_transactions as transaction on transaction.id = entry.transaction_id
    where transaction.reference_id = (select happy_deposit_id from krw_ctx)
      and transaction.category = 'DEPOSIT'
  ),
  2,
  'safe mode replay does not add deposit journal lines'
);

update public.safe_mode_controls
set is_paused = false
where component = 'DEPOSIT';

-- 6. 아웃박스 직전에 실패하면 분개·투영·승인·감사가 남지 않는다.
create function public.krw_deposit_journal_test_fail_outbox()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.event_type = 'DEPOSIT_CONFIRMED.v1' then
    raise exception using errcode = 'P0001', message = 'FORCED_MID_APPROVAL_FAILURE';
  end if;
  return new;
end;
$$;

revoke all on function public.krw_deposit_journal_test_fail_outbox()
  from public, anon, authenticated;

create trigger krw_deposit_journal_test_fail_outbox
before insert on public.outbox_events
for each row execute function public.krw_deposit_journal_test_fail_outbox();

select public.create_deposit_request(
  (select happy_id from krw_ctx),
  'KRW',
  1800,
  'krw-journal-mid-request'
);

select throws_ok(
  $$
    select public.approve_deposit_request(
      request.id,
      (select admin_id from krw_ctx),
      1800,
      'krw-journal-mid-ledger',
      'mid failure must roll back',
      '0d100000-0000-4000-8000-00000000d501'
    )
    from public.deposit_requests as request
    where request.idempotency_key = 'krw-journal-mid-request'
  $$,
  'P0001',
  'FORCED_MID_APPROVAL_FAILURE',
  'a forced outbox failure aborts approval'
);

drop trigger krw_deposit_journal_test_fail_outbox on public.outbox_events;
drop function public.krw_deposit_journal_test_fail_outbox();

select is(
  (
    select status::text
    from public.deposit_requests
    where idempotency_key = 'krw-journal-mid-request'
  ),
  'AWAITING_TRANSFER',
  'failed approval leaves the request unapproved'
);
select is(
  (
    select count(*)::integer
    from public.ledger_transactions as transaction
    join public.deposit_requests as request on request.id = transaction.reference_id
    where request.idempotency_key = 'krw-journal-mid-request'
  ),
  0,
  'failed approval leaves no journal'
);
select is(
  (
    select count(*)::integer
    from public.wallet_ledger as ledger
    where ledger.idempotency_key = 'krw-journal-mid-ledger'
  ),
  0,
  'failed approval leaves no wallet projection'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events as event
    join public.deposit_requests as request on request.id = event.aggregate_id
    where request.idempotency_key = 'krw-journal-mid-request'
      and event.event_type = 'DEPOSIT_CONFIRMED.v1'
  ),
  0,
  'failed approval leaves no deposit event'
);
select is(
  (
    select count(*)::integer
    from public.audit_logs as audit
    where audit.metadata->>'operation' = 'approve_deposit_request'
      and audit.reason = 'mid failure must roll back'
  ),
  0,
  'failed approval leaves no audit'
);

-- 7. 입금 분개 증명 뒤 검증된 채굴 수익으로 hold, 외부 송금 기록, 확정, 대사.
-- The ordinary withdrawal owns a real mining CREDIT; approved deposit principal
-- remains intact and must not silently fund the hold or its release.
select pg_temp.plant_verified_mining_reward(
  happy_id, '0d100000-0000-4000-8000-00000000d550', 30000,
  statement_timestamp(), statement_timestamp(), 'krw-journal-happy-mining-credit'
) from krw_ctx;
insert into public.withdrawal_policies (
  currency,
  destination_type,
  version,
  is_enabled,
  minimum_amount_atomic,
  fee_atomic,
  destination_config,
  effective_at,
  approved_by,
  allows_welcome_reward
)
select
  'KRW',
  'KRW_BANK',
  92300,
  true,
  1,
  0,
  '{"country":"KR"}'::jsonb,
  statement_timestamp() - interval '3 hours',
  admin_id,
  true
from krw_ctx;

insert into public.withdrawal_policies (
  currency,
  destination_type,
  version,
  is_enabled,
  minimum_amount_atomic,
  fee_atomic,
  destination_config,
  effective_at,
  approved_by,
  allows_welcome_reward
)
select
  'KRW',
  'USDT_ADDRESS',
  92301,
  true,
  1,
  0,
  '{"allowed_networks":["TRC20"]}'::jsonb,
  statement_timestamp() - interval '3 hours',
  admin_id,
  false
from krw_ctx;

insert into public.withdrawal_destinations (
  user_id,
  destination_type,
  encrypted_value,
  value_fingerprint,
  display_hint,
  verification_status,
  verified_at,
  protection_until
)
select
  happy_id,
  'KRW_BANK',
  convert_to('KRW-ACCOUNT-SHOULD-NOT-BE-IN-AUDIT', 'UTF8'),
  'krw-journal-bank-fp',
  '***-**-1001',
  'VERIFIED',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day'
from krw_ctx;

update krw_ctx
set krw_destination_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = krw_ctx.happy_id
  and destination.destination_type = 'KRW_BANK';

select throws_ok(
  $$select public.request_krw_withdrawal(
    '0d100000-0000-4000-8000-00000000ffff',
    '0d100000-0000-4000-8000-00000000fffe',
    1000,
    'krw-journal-no-source')$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'a member without verified source credit cannot hold');
grant select, update on krw_ctx to service_role;
set local role service_role;
update krw_ctx
set hold_id = public.request_krw_withdrawal(
  happy_id,
  krw_destination_id,
  20000,
  'krw-journal-hold-0001'
);
reset role;

select ok(
  (
    select status = 'HELD' and hold_ledger_transaction_id is not null
      and (select sum(reservation.amount_atomic)
        from public.mining_reward_withdrawal_reservations as reservation
        join public.money_source_movements as movement on movement.id = reservation.credit_movement_id
        where reservation.hold_ledger_transaction_id = request.hold_ledger_transaction_id
          and movement.source_bucket = 'MINING_REWARD'
          and app_private.money_source_credit_verified(movement)) = 20000
    from public.withdrawal_requests as request
    where id = (select hold_id from krw_ctx)
  ),
  'withdrawal reserves verified mining reward and posts its hold before external send'
);

select public.run_financial_reconciliation('0d100000-0000-4000-8000-00000000d601');

select ok(
  (
    select liability.net <> wallet_total.net
      and liability.net + 20000 = wallet_total.net
    from (
      select coalesce(sum(
        case when entry.side = 'CREDIT' then entry.amount_atomic else -entry.amount_atomic end
      ), 0) as net
      from public.ledger_entries as entry
      join public.ledger_accounts as account on account.id = entry.account_id
      where account.owner_user_id = (select happy_id from krw_ctx)
        and account.account_class = 'LIABILITY'
        and account.currency = 'KRW'
    ) as liability
    cross join (
      select coalesce(sum(
        case when ledger.direction = 'CREDIT' then ledger.amount_atomic else -ledger.amount_atomic end
      ), 0) as net
      from public.wallet_ledger as ledger
      where ledger.wallet_account_id = (select happy_wallet_id from krw_ctx)
    ) as wallet_total
  ),
  'held withdrawal makes liability net differ from the wallet total'
);
select ok(
  not exists (
    select 1
    from public.reconciliation_mismatches as mismatch
    where mismatch.mismatch_type = 'KRW_WALLET_LIABILITY_HOLD_PARITY'
      and mismatch.subject_id = (select happy_wallet_id::text from krw_ctx)
      and mismatch.run_id = (
        select run.id
        from public.reconciliation_runs as run
        where run.request_id = '0d100000-0000-4000-8000-00000000d601'
      )
  ),
  'hold is not a false mismatch against wallet total'
);
select is(
  (
    select count(*)::integer
    from public.reconciliation_mismatches
    where mismatch_type = 'LIABILITY_EQUALS_UI_TOTAL'
  ),
  0,
  'reconciliation has no liability-equals-ui-total check'
);

update krw_ctx
set krw_send_id = public.record_krw_external_send(
  hold_id,
  'KRWREF1001',
  20000,
  admin_id,
  statement_timestamp(),
  'krw-journal-krw-send-0001'
);

select is(
  public.record_krw_external_send(
    (select hold_id from krw_ctx),
    'KRWREF1001',
    20000,
    (select admin_id from krw_ctx),
    (select sent_at from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
    'krw-journal-krw-send-0001'
  ),
  (select krw_send_id from krw_ctx),
  'completed KRW external send replay returns the original send'
);

-- Before-patch regressions: canonical command identity includes the transfer facts.
select throws_ok($q$select public.record_krw_external_send(
  gen_random_uuid(), 'KRWREF1001', 20000,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
  'krw-journal-krw-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'KRW key cannot report success for a different withdrawal');
select throws_ok($q$select public.record_krw_external_send(
  (select hold_id from krw_ctx), 'KRWREF1001', 19999,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
  'krw-journal-krw-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'KRW key cannot accept a changed actual amount');
select throws_ok($q$select public.record_krw_external_send(
  (select hold_id from krw_ctx), 'KRWREF_CHANGED', 20000,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
  'krw-journal-krw-send-0002')$q$, '22023', 'EXTERNAL_SEND_PAYLOAD_MISMATCH',
  'new KRW key cannot change the already recorded transfer');
select throws_ok($q$select public.record_krw_external_send(
  (select hold_id from krw_ctx), 'KRWREF1001', 20000,
  (select admin_id from krw_ctx),
  (select sent_at + interval '1 second' from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
  'krw-journal-krw-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'KRW key preserves the originally supplied actual sent time');
select is(public.record_krw_external_send(
  (select hold_id from krw_ctx), '  KRWREF1001  ', 20000,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
  'krw-journal-krw-send-0002'), (select krw_send_id from krw_ctx),
  'same normalized KRW transfer under a fresh key cannot send again');
select throws_ok($q$select public.record_krw_external_send(
  gen_random_uuid(), 'KRWREF1001', 20000,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select krw_send_id from krw_ctx)),
  'krw-journal-krw-send-0002')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'a successful fresh KRW retry key remains bound to its original withdrawal');
select is((select count(*)::integer from public.withdrawal_external_sends
  where withdrawal_id = (select hold_id from krw_ctx)), 1,
  'KRW rejection and retry leave exactly one external transfer');

select ok(
  exists (
    select 1
    from public.audit_logs as audit
    where audit.action = 'record_krw_external_send'
      and audit.actor_user_id = (select admin_id from krw_ctx)
      and audit.metadata->>'result_id' = (select krw_send_id::text from krw_ctx)
      and audit.metadata->>'currency' = 'KRW'
      and audit.metadata->>'amount_atomic' = '20000'
      and audit.metadata->>'destination_id' = (select krw_destination_id::text from krw_ctx)
      and audit.metadata::text not like '%KRWREF1001%'
      and audit.metadata::text not like '%KRW-ACCOUNT-SHOULD-NOT-BE-IN-AUDIT%'
      and coalesce(audit.before_state::text, '') not like '%KRW-ACCOUNT-SHOULD-NOT-BE-IN-AUDIT%'
      and coalesce(audit.after_state::text, '') not like '%KRW-ACCOUNT-SHOULD-NOT-BE-IN-AUDIT%'
  ),
  'KRW external send audit links amount, currency and destination without account text'
);

update krw_ctx
set finalize_id = public.finalize_withdrawal_ledger(
  hold_id,
  admin_id,
  'krw-journal-finalize-0001'
);

select is(
  public.finalize_withdrawal_ledger(
    (select hold_id from krw_ctx),
    (select admin_id from krw_ctx),
    'krw-journal-finalize-0001'
  ),
  (select finalize_id from krw_ctx),
  'finalize replay returns the original withdrawal journal'
);
select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where idempotency_key = 'krw-journal-finalize-0001:finalize'
  ),
  1,
  'finalize replay does not post a second withdrawal journal'
);
select is(
  (
    select count(*)::integer
    from public.wallet_ledger
    where reference_id = (select hold_id from krw_ctx)
      and entry_type = 'WITHDRAWAL'
      and direction = 'DEBIT'
  ),
  1,
  'finalize debits the wallet projection once'
);

select public.run_financial_reconciliation('0d100000-0000-4000-8000-00000000d701');

select ok(
  not exists (
    select 1
    from public.reconciliation_mismatches as mismatch
    where mismatch.mismatch_type = 'EXTERNAL_SEND_LINK_MISMATCH'
      and mismatch.subject_id = (select hold_id::text from krw_ctx)
      and mismatch.run_id = (
        select run.id
        from public.reconciliation_runs as run
        where run.request_id = '0d100000-0000-4000-8000-00000000d701'
      )
  ),
  'completed KRW external send stays linked through reconciliation'
);
select ok(
  (
    select send.actual_krw_amount = 20000
      and request.currency = 'KRW'
      and request.withdrawal_destination_id = (select krw_destination_id from krw_ctx)
      and send.method = request.destination_type
    from public.withdrawal_external_sends as send
    join public.withdrawal_requests as request on request.id = send.withdrawal_id
    where send.id = (select krw_send_id from krw_ctx)
  ),
  'completed KRW send keeps amount, currency and destination linkage'
);

-- 8. hold 해제, 재시도, 응답 유실 후 대사.
set local role service_role;
update krw_ctx
set release_hold_id = public.request_krw_withdrawal(
  happy_id,
  krw_destination_id,
  10000,
  'krw-journal-release-hold'
);

update krw_ctx
set release_id = public.release_withdrawal_hold(
  release_hold_id,
  admin_id,
  'member requested cancel',
  'krw-journal-release-0001',
  'CANCELLED'
);

select is(
  public.release_withdrawal_hold(
    (select release_hold_id from krw_ctx),
    (select admin_id from krw_ctx),
    'member requested cancel',
    'krw-journal-release-0001',
    'CANCELLED'
  ),
  (select release_id from krw_ctx),
  'release replay after a lost response returns the original reversal'
);
reset role;
select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where idempotency_key = 'krw-journal-release-0001:release'
  ),
  1,
  'release replay does not post a second reversal'
);
select ok(
  exists (
    select 1
    from public.audit_logs as audit
    where audit.action = 'release_withdrawal_hold'
      and audit.reason = 'member requested cancel'
      and audit.actor_user_id = (select admin_id from krw_ctx)
      and audit.metadata->>'result_id' = (select release_id::text from krw_ctx)
      and audit.metadata::text not like '%KRW-ACCOUNT-SHOULD-NOT-BE-IN-AUDIT%'
  ),
  'release audit links actor, reason and result without account text'
);

select public.run_financial_reconciliation('0d100000-0000-4000-8000-00000000d801');

select ok(
  not exists (
    select 1
    from public.reconciliation_mismatches as mismatch
    where mismatch.mismatch_type = 'KRW_WALLET_LIABILITY_HOLD_PARITY'
      and mismatch.subject_id = (select happy_wallet_id::text from krw_ctx)
      and mismatch.run_id = (
        select run.id
        from public.reconciliation_runs as run
        where run.request_id = '0d100000-0000-4000-8000-00000000d801'
      )
  ),
  'release and finalize leave hold-aware parity intact'
);

-- 9. USDT 외부 송금도 원화 출금 원장에 연결되고 주소 원문은 감사에 없다.
update krw_ctx
set happy_ledger_id = public.approve_deposit_request(
  public.create_deposit_request(usdt_send_id, 'KRW', 50000, 'krw-journal-usdt-send-fund'),
  admin_id,
  50000,
  'krw-journal-usdt-send-fund-ledger',
  'fund usdt withdrawal subject',
  '0d100000-0000-4000-8000-00000000e201'
);

select pg_temp.plant_verified_mining_reward(
  usdt_send_id, '0d100000-0000-4000-8000-00000000e250', 1500,
  statement_timestamp(), statement_timestamp(), 'krw-journal-usdt-mining-credit'
) from krw_ctx;

insert into public.withdrawal_destinations (
  user_id,
  destination_type,
  encrypted_value,
  value_fingerprint,
  display_hint,
  verification_status,
  verified_at,
  protection_until
)
select
  usdt_send_id,
  'USDT_ADDRESS',
  convert_to('TTESTADDRESSSHOULDNOTBEINAUDIT0001', 'UTF8'),
  'krw-journal-usdt-fp',
  'TRC20 ****0001',
  'VERIFIED',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day'
from krw_ctx;

update krw_ctx
set usdt_destination_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = krw_ctx.usdt_send_id
  and destination.destination_type = 'USDT_ADDRESS';

set local role service_role;
update krw_ctx
set usdt_withdrawal_id = public.request_usdt_withdrawal(
  usdt_send_id,
  usdt_destination_id,
  1500,
  'krw-journal-usdt-hold-0001'
);
reset role;

update krw_ctx
set usdt_external_send_id = public.record_usdt_external_send(
  usdt_withdrawal_id,
  'TRC20',
  'abc123def456',
  1.250000,
  null,
  admin_id,
  statement_timestamp(),
  'krw-journal-usdt-send-0001'
);

select is(
  public.record_usdt_external_send(
    (select usdt_withdrawal_id from krw_ctx),
    'TRC20',
    'abc123def456',
    1.250000,
    null,
    (select admin_id from krw_ctx),
    (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
    'krw-journal-usdt-send-0001'
  ),
  (select usdt_external_send_id from krw_ctx),
  'completed USDT external send replay returns the original send'
);

select throws_ok($q$select public.record_usdt_external_send(
  gen_random_uuid(), 'TRC20', 'abc123def456', 1.25, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'USDT key cannot report success for a different withdrawal');
select throws_ok($q$select public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), 'ERC20', 'abc123def456', 1.25, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'USDT key cannot change network');
select throws_ok($q$select public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def457', 1.25, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0002')$q$, '22023', 'EXTERNAL_SEND_PAYLOAD_MISMATCH',
  'fresh USDT key cannot replace the recorded transaction');
select throws_ok($q$select public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def456', 1.250001, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'USDT key cannot change precision-safe actual amount');
select throws_ok($q$select public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def456', 1.25, '{"rate":"1000"}',
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'USDT key binds conversion evidence');
select throws_ok($q$select public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def456', 1.25, null,
  (select admin_id from krw_ctx),
  (select sent_at + interval '1 second' from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0001')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'USDT key preserves actual sent time');
select is(public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), ' trc20 ', ' ABC123DEF456 ', 1.250000, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0002'), (select usdt_external_send_id from krw_ctx),
  'same normalized USDT facts under a fresh key preserve original transfer');
select throws_ok($q$select public.record_usdt_external_send(
  gen_random_uuid(), 'TRC20', 'abc123def456', 1.25, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-0002')$q$, '22023', 'IDEMPOTENCY_KEY_REUSED',
  'a successful fresh USDT retry key remains bound to its original withdrawal');
select throws_ok($q$select public.record_usdt_external_send(
  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def456', 'NaN'::numeric, null,
  (select admin_id from krw_ctx),
  (select sent_at from public.withdrawal_external_sends where id = (select usdt_external_send_id from krw_ctx)),
  'krw-journal-usdt-send-nan')$q$, '22023', 'INVALID_USDT_EXTERNAL_SEND',
  'nonfinite numeric cannot be accepted as a positive USDT payout fact');
select is((select count(*)::integer from public.withdrawal_external_sends
  where withdrawal_id = (select usdt_withdrawal_id from krw_ctx)), 1,
  'USDT rejection and retry leave exactly one external transfer');


update krw_ctx
set finalize_id = public.finalize_withdrawal_ledger(
  usdt_withdrawal_id,
  admin_id,
  'krw-journal-usdt-finalize-0001'
);

select ok(
  (
    select request.currency = 'KRW'
      and request.withdrawal_destination_id = (select usdt_destination_id from krw_ctx)
      and send.actual_usdt_amount = 1.250000
      and send.method = 'USDT_ADDRESS'
      and transaction.currency = 'KRW'
    from public.withdrawal_requests as request
    join public.withdrawal_external_sends as send on send.withdrawal_id = request.id
    join public.ledger_transactions as transaction
      on transaction.id = request.finalize_ledger_transaction_id
    where request.id = (select usdt_withdrawal_id from krw_ctx)
  ),
  'completed USDT send links KRW ledger amount, external amount and destination'
);
select ok(
  not exists (
    select 1
    from public.audit_logs as audit
    where audit.action = 'record_usdt_external_send'
      and (
        audit.metadata::text like '%TTESTADDRESSSHOULDNOTBEINAUDIT0001%'
        or audit.metadata::text like '%abc123def456%'
        or coalesce(audit.before_state::text, '') like '%TTESTADDRESSSHOULDNOTBEINAUDIT0001%'
        or coalesce(audit.after_state::text, '') like '%TTESTADDRESSSHOULDNOTBEINAUDIT0001%'
      )
  ),
  'USDT external send audit omits address and transaction hash'
);
select is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = (select usdt_send_id from krw_ctx)
      and currency = 'USDT'
  ),
  0,
  'USDT withdrawal does not create a user USDT balance'
);

-- 10. 체험 전환, 첫 환영 출금, USDT 수동 입금 불변식.
insert into public.trial_programs (
  name,
  version,
  is_enabled,
  duration_seconds,
  target_reward_krw,
  first_result_target_seconds,
  first_world_id,
  completion_copy,
  effective_at
)
select
  'KRW_JOURNAL_TRIAL',
  1,
  false,
  3600,
  9000,
  60,
  world.id,
  '테스트 체험 완료',
  statement_timestamp() - interval '2 hours'
from public.asset_worlds as world
where world.code = 'KOREA';

insert into public.trial_accounts (
  user_id,
  trial_program_id,
  trial_program_version,
  world_id,
  status,
  started_at,
  expires_at,
  last_settled_at,
  quota_consumed_bps,
  reward_atomic,
  target_reward_krw
)
select
  context.trial_id,
  program.id,
  1,
  world.id,
  'COMPLETED',
  statement_timestamp() - interval '1 hour',
  statement_timestamp(),
  statement_timestamp(),
  10000,
  9000,
  9000
from krw_ctx as context
join public.trial_programs as program on program.name = 'KRW_JOURNAL_TRIAL'
join public.asset_worlds as world on world.code = 'KOREA';

insert into public.trial_completions (
  trial_account_id,
  user_id,
  reason,
  final_quota_bps,
  final_reward_atomic,
  completed_at
)
select
  account.id,
  account.user_id,
  'QUOTA',
  10000,
  9000,
  statement_timestamp()
from public.trial_accounts as account
where account.user_id = (select trial_id from krw_ctx);

insert into public.kyc_cases (user_id, status, risk_level, decided_at, reviewed_by)
select trial_id, 'APPROVED', 'LOW', statement_timestamp(), admin_id
from krw_ctx;

create temporary table krw_trial_conversion as
select *
from public.convert_trial_welcome_reward(
  (select trial_id from krw_ctx),
  'krw-journal-trial-convert',
  '0d100000-0000-4000-8000-00000000f301',
  1,
  'krw-journal-risk-v1'
);

select is(
  (select converted_amount_atomic from krw_trial_conversion),
  5000::bigint,
  'welcome conversion remains hard-capped at 5000 KRW'
);
select ok(
  (
    select not funding_required and status = 'CONVERTED'
    from public.trial_reward_conversions as conversion
    where conversion.id = (select conversion_id from krw_trial_conversion)
  ),
  'welcome conversion still does not require funding'
);
select is(
  (
    select count(*)::integer
    from public.deposit_requests
    where user_id = (select trial_id from krw_ctx)
  ),
  0,
  'welcome conversion still does not read or create a deposit'
);

insert into public.withdrawal_destinations (
  user_id,
  destination_type,
  encrypted_value,
  value_fingerprint,
  display_hint,
  verification_status,
  verified_at,
  protection_until
)
select
  trial_id,
  'KRW_BANK',
  decode('00112233445566778899aabbccddeeff', 'hex'),
  'krw-journal-welcome-fp',
  '***-**-5000',
  'VERIFIED',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day'
from krw_ctx;

select isnt(
  public.create_welcome_reward_withdrawal_request(
    (select trial_id from krw_ctx),
    (select conversion_id from krw_trial_conversion),
    (
      select id
      from public.withdrawal_policies
      where currency = 'KRW'
        and destination_type = 'KRW_BANK'
        and version = 92300
    ),
    (
      select id
      from public.withdrawal_destinations
      where user_id = (select trial_id from krw_ctx)
        and destination_type = 'KRW_BANK'
    ),
    'krw-journal-welcome-withdraw',
    '0d100000-0000-4000-8000-00000000f302'
  ),
  null,
  'first welcome withdrawal still does not require a prior deposit'
);

select public.set_usdt_deposit_instructions(
  'TJOURNALDEPOSITADDRESS1234567890',
  'TRC20',
  (select admin_id from krw_ctx),
  'journal integrity deposit instruction',
  '0d100000-0000-4000-8000-00000000f401'
);

select public.submit_usdt_manual_deposit(
  (select usdt_deposit_id from krw_ctx),
  'TRC20',
  '0xjournaldeposit0001',
  12.500000,
  'krw-journal-usdt-manual-0001'
);

update krw_ctx
set manual_usdt_ledger_id = public.confirm_usdt_manual_deposit(
  (
    select id
    from public.usdt_manual_deposits
    where idempotency_key = 'krw-journal-usdt-manual-0001'
  ),
  15000,
  admin_id,
  'manual usdt confirmation for journal integrity',
  'krw-journal-usdt-manual-confirm'
);

select is(
  (
    select currency::text
    from public.ledger_transactions
    where id = (select manual_usdt_ledger_id from krw_ctx)
  ),
  'KRW',
  'manual USDT confirmation still posts a KRW deposit journal'
);
select is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = (select usdt_deposit_id from krw_ctx)
      and currency = 'USDT'
  ),
  0,
  'manual USDT confirmation still does not create a user USDT balance'
);

select public.run_financial_reconciliation('0d100000-0000-4000-8000-00000000f501');

select ok(
  not exists (
    select 1
    from public.reconciliation_mismatches as mismatch
    join public.wallet_accounts as account
      on account.id::text = mismatch.subject_id
    where mismatch.mismatch_type = 'KRW_WALLET_LIABILITY_HOLD_PARITY'
      and account.user_id in (
        (select partial_id from krw_ctx),
        (select happy_id from krw_ctx),
        (select usdt_send_id from krw_ctx),
        (select trial_id from krw_ctx),
        (select usdt_deposit_id from krw_ctx)
      )
      and mismatch.run_id = (
        select run.id
        from public.reconciliation_runs as run
        where run.request_id = '0d100000-0000-4000-8000-00000000f501'
      )
  ),
  'healthy deposit, hold, release, welcome and USDT flows stay in parity'
);

select * from finish();

rollback;
