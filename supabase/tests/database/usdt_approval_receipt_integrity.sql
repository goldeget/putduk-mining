begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- 이 파일의 fixtures와 의도적 불일치는 모두 마지막 rollback으로 없어진다.
-- 기존 분개·감사 기록을 삭제하거나 공유 DB를 초기화하지 않는다.
create temporary table usdt_receipt_ctx (
  main_id uuid, other_id uuid, blocked_id uuid, member_id uuid,
  admin_id uuid, admin_two_id uuid, journal_id uuid, wallet_ledger_id uuid,
  legacy_id uuid default '0d430000-0000-4000-8000-00000000d004'
);
insert into usdt_receipt_ctx (
  main_id, other_id, blocked_id, member_id, admin_id, admin_two_id, journal_id, wallet_ledger_id
) values (
  '0d430000-0000-4000-8000-00000000d001',
  '0d430000-0000-4000-8000-00000000d002',
  '0d430000-0000-4000-8000-00000000d003',
  '0d430000-0000-4000-8000-000000000101',
  '0d430000-0000-4000-8000-0000000000a1',
  '0d430000-0000-4000-8000-0000000000a2', null, null
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select id, 'authenticated', 'authenticated', email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select member_id as id, 'usdt-receipt-member@putduk.test' as email from usdt_receipt_ctx
  union all select admin_id, 'usdt-receipt-admin-a@putduk.test' from usdt_receipt_ctx
  union all select admin_two_id, 'usdt-receipt-admin-b@putduk.test' from usdt_receipt_ctx
) as person;
insert into public.user_roles (user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from usdt_receipt_ctx
union all select admin_two_id, 'ADMIN'::public.app_role, admin_two_id from usdt_receipt_ctx;
select public.bootstrap_user((select member_id from usdt_receipt_ctx));
insert into public.usdt_manual_deposits (
  id, user_id, network, tx_hash, sent_usdt_amount, deposit_address_snapshot,
  network_snapshot, idempotency_key
)
select deposit_id, member_id, 'TRC20', 'fixture-transfer-' || deposit_id::text,
  10.000001, 'fixture-address-snapshot', 'TRC20', 'fixture-request-' || deposit_id::text
from usdt_receipt_ctx
cross join lateral unnest(array[main_id, other_id, blocked_id, legacy_id]) as ids(deposit_id);

select ok(
  not has_function_privilege('anon',
    'public.confirm_usdt_manual_deposit(uuid,bigint,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.confirm_usdt_manual_deposit(uuid,bigint,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.confirm_usdt_manual_deposit(uuid,bigint,uuid,text,text)', 'EXECUTE'),
  'only the server role can execute the frozen confirmation command'
);
select ok(
  (select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc where oid =
    'public.confirm_usdt_manual_deposit(uuid,bigint,uuid,text,text)'::regprocedure),
  'confirmation keeps security invoker and a pinned search path'
);

-- 실제 service_role 권한으로 첫 적립을 실행한다.
grant select, update on usdt_receipt_ctx to service_role;
set local role service_role;
update usdt_receipt_ctx set journal_id = public.confirm_usdt_manual_deposit(
  main_id, 15000, admin_id, 'manual transfer evidence matched', 'usdt-receipt-main-v1'
);
reset role;
update usdt_receipt_ctx set wallet_ledger_id = deposit.wallet_ledger_id
from public.usdt_manual_deposits as deposit where deposit.id = main_id;
select ok(
  (select deposit.status = 'CONFIRMED' and deposit.credited_krw = 15000
    and deposit.ledger_transaction_id = ctx.journal_id
    and deposit.wallet_ledger_id = ctx.wallet_ledger_id
    and deposit.confirmed_by = ctx.admin_id and deposit.confirmed_at is not null
    from usdt_receipt_ctx as ctx join public.usdt_manual_deposits as deposit
      on deposit.id = ctx.main_id),
  'service-role confirmation stores the amount and both real receipt links'
);
select ok(
  (select count(*) = 2
    and sum(amount_atomic) filter (where side = 'DEBIT') = 15000::numeric
    and sum(amount_atomic) filter (where side = 'CREDIT') = 15000::numeric
    from public.ledger_entries where transaction_id = (select journal_id from usdt_receipt_ctx)),
  'confirmation creates exactly two balanced real KRW entries'
);
select ok(
  (select transaction.request_id = audit.request_id
    and transaction.request_id = event.request_id
    and transaction.correlation_id = event.correlation_id
    and event.schema_version = 1 and event.payload->>'credited_krw' = '15000'
    and event.payload->>'ledger_transaction_id' = transaction.id::text
    and audit.actor_user_id = ctx.admin_id and audit.actor_role = 'ADMIN'
    from usdt_receipt_ctx as ctx
    join public.ledger_transactions as transaction on transaction.id = ctx.journal_id
    join public.audit_logs as audit on audit.request_id = transaction.request_id
      and audit.action = 'usdt_manual_deposit.confirm'
    join public.outbox_events as event on event.request_id = transaction.request_id
      and event.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'),
  'journal, audit and the unchanged v1 event share the same command receipt'
);
select ok(
  (select not (metadata ?| array['tx_hash', 'deposit_address_snapshot'])
    from public.ledger_transactions where id = (select journal_id from usdt_receipt_ctx))
  and (select deposit_address_snapshot = 'fixture-address-snapshot'
    and network_snapshot = 'TRC20' from public.usdt_manual_deposits
    where id = (select main_id from usdt_receipt_ctx)),
  'new journals do not duplicate transfer secrets and request snapshots stay intact'
);
select is(
  public.confirm_usdt_manual_deposit((select main_id from usdt_receipt_ctx), 15000,
    (select admin_id from usdt_receipt_ctx), 'manual transfer evidence matched', 'usdt-receipt-main-v1'),
  (select journal_id from usdt_receipt_ctx), 'the same payload returns the verified original receipt'
);
select is(
  public.confirm_usdt_manual_deposit((select main_id from usdt_receipt_ctx), 15000,
    (select admin_two_id from usdt_receipt_ctx), 'manual transfer evidence matched', 'usdt-receipt-main-v1'),
  (select journal_id from usdt_receipt_ctx), 'another authorized operator can retry the same global key'
);
select is(
  public.confirm_usdt_manual_deposit((select main_id from usdt_receipt_ctx), 15000,
    (select admin_two_id from usdt_receipt_ctx), 'second operator receipt review', 'usdt-receipt-retry-v1'),
  (select journal_id from usdt_receipt_ctx), 'a fresh key may verify an already confirmed matching amount'
);

-- 이전 함수의 정상 영수증: 요청 hash/키 저장소/actor_role 없이도 금전 증거는 존재한다.
insert into public.ledger_transactions (
  category, currency, idempotency_key, reference_type, reference_id, member_user_id,
  request_id, correlation_id, description, metadata, created_by
)
select 'DEPOSIT', 'KRW', 'usdt-receipt-legacy:ledger', 'usdt_manual_deposit', legacy_id,
  member_id, gen_random_uuid(), gen_random_uuid(), 'legacy fixture journal', '{}'::jsonb, admin_id
from usdt_receipt_ctx;
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select legacy.id, entry.account_id, entry.sequence, entry.side, 23456
from public.ledger_transactions as legacy cross join public.ledger_entries as entry
where legacy.idempotency_key = 'usdt-receipt-legacy:ledger'
  and entry.transaction_id = (select journal_id from usdt_receipt_ctx);
insert into public.wallet_ledger (
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id, reason, created_by
)
select wallet.id, ctx.member_id, 'CREDIT', 'DEPOSIT', 23456, 'usdt-receipt-legacy:wallet',
  'usdt_manual_deposit', ctx.legacy_id, 'legacy transfer verified manually', ctx.admin_id
from usdt_receipt_ctx as ctx join public.wallet_accounts as wallet
  on wallet.user_id = ctx.member_id and wallet.currency = 'KRW';
update public.usdt_manual_deposits as deposit
set status = 'CONFIRMED', credited_krw = 23456, ledger_transaction_id = journal.id,
  wallet_ledger_id = projection.id, confirmed_by = ctx.admin_id, confirmed_at = statement_timestamp()
from usdt_receipt_ctx as ctx, public.ledger_transactions as journal, public.wallet_ledger as projection
where deposit.id = ctx.legacy_id and journal.idempotency_key = 'usdt-receipt-legacy:ledger'
  and projection.idempotency_key = 'usdt-receipt-legacy:wallet';
insert into public.outbox_events (
  event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
  payload, correlation_id, request_id, idempotency_key
)
select 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1', 1, 'usdt_manual_deposit', ctx.legacy_id, ctx.admin_id,
  jsonb_build_object('user_id', ctx.member_id, 'credited_krw', '23456', 'ledger_transaction_id', journal.id),
  journal.correlation_id, journal.request_id, 'usdt-receipt-legacy:event'
from usdt_receipt_ctx as ctx join public.ledger_transactions as journal
  on journal.idempotency_key = 'usdt-receipt-legacy:ledger';
insert into public.audit_logs (actor_user_id, action, target_type, target_id, reason, request_id, after_state)
select ctx.admin_id, 'usdt_manual_deposit.confirm', 'usdt_manual_deposit', ctx.legacy_id::text,
  'legacy transfer verified manually', journal.request_id,
  jsonb_build_object('credited_krw', '23456', 'ledger_transaction_id', journal.id)
from usdt_receipt_ctx as ctx join public.ledger_transactions as journal
  on journal.idempotency_key = 'usdt-receipt-legacy:ledger';
select throws_ok($$
  select public.confirm_usdt_manual_deposit(legacy_id, 23456, admin_id,
    'legacy reason was changed later', 'usdt-receipt-legacy') from usdt_receipt_ctx
$$, '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'a legacy receipt key still requires the original reason');
select is(
  public.confirm_usdt_manual_deposit((select legacy_id from usdt_receipt_ctx), 23456,
    (select admin_two_id from usdt_receipt_ctx), 'legacy transfer verified manually', 'usdt-receipt-legacy'),
  (select ledger_transaction_id from public.usdt_manual_deposits where id = (select legacy_id from usdt_receipt_ctx)),
  'a complete pre-migration receipt remains retryable without new money or a backfill'
);
select throws_ok($$
  select public.confirm_usdt_manual_deposit(main_id, 15001, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-main-v1') from usdt_receipt_ctx
$$, '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'same key with a changed amount is rejected');
select throws_ok($$
  select public.confirm_usdt_manual_deposit(main_id, 15000, admin_id,
    'a different confirmation reason', 'usdt-receipt-main-v1') from usdt_receipt_ctx
$$, '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'same key with a changed reason is rejected');
select throws_ok($$
  select public.confirm_usdt_manual_deposit(main_id, 15001, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-wrong-amount') from usdt_receipt_ctx
$$, '22023', 'USDT_CONFIRMED_AMOUNT_MISMATCH', 'a new key cannot approve a different confirmed amount');
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 15000, admin_two_id,
    'manual transfer evidence matched', 'usdt-receipt-main-v1') from usdt_receipt_ctx
$$, '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'the key cannot point at another deposit even for another operator');
select throws_ok($$
  select public.confirm_usdt_manual_deposit(main_id, 15000, member_id,
    'manual transfer evidence matched', 'usdt-receipt-main-v1') from usdt_receipt_ctx
$$, '42501', 'OPERATOR_ROLE_REQUIRED', 'a cached response never bypasses current operator authorization');

select throws_ok($test$
  do $body$
  begin
    insert into public.wallet_ledger (
      wallet_account_id, user_id, direction, entry_type, amount_atomic,
      idempotency_key, reference_type, reference_id, reason, created_by
    ) select projection.wallet_account_id, projection.user_id, 'CREDIT', 'DEPOSIT',
      15000, 'usdt-receipt-duplicate-wallet', 'usdt_manual_deposit', projection.reference_id,
      'duplicate test projection', projection.created_by
    from public.wallet_ledger as projection
    where projection.id = (select wallet_ledger_id from usdt_receipt_ctx);
    perform public.confirm_usdt_manual_deposit(
      (select main_id from usdt_receipt_ctx), 15000, (select admin_id from usdt_receipt_ctx),
      'manual transfer evidence matched', 'usdt-receipt-main-v1');
  end;
  $body$;
$test$, '55000', 'USDT_CONFIRMATION_RECEIPT_MISMATCH',
  'a valid linked row cannot conceal a second wallet credit for the same deposit');

update public.usdt_manual_deposits set wallet_ledger_id = null
where id = (select main_id from usdt_receipt_ctx);
select throws_ok($$
  select public.confirm_usdt_manual_deposit(main_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-main-v1') from usdt_receipt_ctx
$$, '55000', 'USDT_CONFIRMATION_RECEIPT_MISMATCH', 'cached responses recheck missing wallet linkage');
select ok(
  (select wallet_ledger_id is null from public.usdt_manual_deposits
    where id = (select main_id from usdt_receipt_ctx)),
  'receipt verification does not silently repair a missing link'
);
update public.usdt_manual_deposits set wallet_ledger_id = ctx.wallet_ledger_id
from usdt_receipt_ctx as ctx where id = ctx.main_id;

-- 아웃박스 증거만 훼손해도 같은 키의 재시도를 성공으로 보고하지 않는다.
update public.outbox_events set payload = payload || '{"credited_krw":"15001"}'::jsonb
where aggregate_id = (select main_id from usdt_receipt_ctx)
  and event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1';
select throws_ok($$
  select public.confirm_usdt_manual_deposit(main_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-main-v1') from usdt_receipt_ctx
$$, '55000', 'USDT_CONFIRMATION_RECEIPT_MISMATCH', 'retry verifies outbox payload against the real money receipt');
update public.outbox_events set payload = payload || '{"credited_krw":"15000"}'::jsonb
where aggregate_id = (select main_id from usdt_receipt_ctx)
  and event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1';

-- 오래된 코드가 만든 분개 키와 충돌해도 그 분개를 다른 입금에 연결하지 않는다.
insert into public.ledger_transactions (
  category, currency, idempotency_key, reference_type, reference_id, member_user_id,
  request_id, correlation_id, description, created_by
)
select 'DEPOSIT', 'KRW', 'usdt-receipt-old-key:ledger', 'test', other_id,
  member_id, gen_random_uuid(), gen_random_uuid(), 'unrelated fixture journal', admin_id
from usdt_receipt_ctx;
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select collision.id, entry.account_id, entry.sequence, entry.side, 7
from public.ledger_transactions as collision
cross join public.ledger_entries as entry
where collision.idempotency_key = 'usdt-receipt-old-key:ledger'
  and entry.transaction_id = (select journal_id from usdt_receipt_ctx);
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-old-key') from usdt_receipt_ctx
$$, '22023', 'USDT_CONFIRMATION_KEY_COLLISION', 'a preexisting journal key is never adopted');

insert into public.wallet_ledger (
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id, reason, created_by
)
select wallet.id, ctx.member_id, 'CREDIT', 'DEPOSIT', 7,
  'usdt-receipt-wallet-collision:wallet', 'test', ctx.other_id, 'fixture projection', ctx.admin_id
from usdt_receipt_ctx as ctx join public.wallet_accounts as wallet
  on wallet.user_id = ctx.member_id and wallet.currency = 'KRW';
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-wallet-collision') from usdt_receipt_ctx
$$, '23505', null, 'a wallet-key collision rolls back the new journal');
insert into public.outbox_events (
  event_type, schema_version, aggregate_type, aggregate_id, payload,
  correlation_id, request_id, idempotency_key
)
select 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1', 1, 'test', other_id, '{}'::jsonb,
  gen_random_uuid(), gen_random_uuid(), 'usdt-receipt-event-collision:event'
from usdt_receipt_ctx;
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-event-collision') from usdt_receipt_ctx
$$, '23505', null, 'an outbox-key collision rolls back all preceding money writes');
select ok(
  (select status = 'SUBMITTED' and credited_krw is null and ledger_transaction_id is null
    and wallet_ledger_id is null from public.usdt_manual_deposits
    where id = (select other_id from usdt_receipt_ctx))
  and not exists (select 1 from public.ledger_transactions
    where idempotency_key in ('usdt-receipt-wallet-collision:ledger', 'usdt-receipt-event-collision:ledger'))
  and not exists (select 1 from public.wallet_ledger
    where reference_type = 'usdt_manual_deposit' and reference_id = (select other_id from usdt_receipt_ctx))
  and not exists (select 1 from public.audit_logs
    where action = 'usdt_manual_deposit.confirm' and target_id = (select other_id::text from usdt_receipt_ctx))
  and not exists (select 1 from app_private.idempotency_keys
    where scope = 'usdt_manual_deposit.confirm'
      and idempotency_key in ('usdt-receipt-old-key', 'usdt-receipt-wallet-collision', 'usdt-receipt-event-collision')),
  'all collision failures leave the deposit, journal, wallet, audit and request record uncommitted'
);
update public.usdt_manual_deposits set credited_krw = 1
where id = (select other_id from usdt_receipt_ctx);
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-partial') from usdt_receipt_ctx
$$, '55000', 'USDT_CONFIRMATION_RECEIPT_MISMATCH', 'partial submitted money state is not overwritten or repaired');
update public.usdt_manual_deposits set credited_krw = null
where id = (select other_id from usdt_receipt_ctx);

insert into app_private.idempotency_keys (scope, actor_id, idempotency_key, request_hash, status)
select 'usdt_manual_deposit.confirm', null, 'usdt-receipt-processing',
  encode(extensions.digest(convert_to(jsonb_build_object(
    'deposit_id', blocked_id, 'credited_krw', '15000',
    'reason', 'manual transfer evidence matched')::text, 'UTF8'), 'sha256'), 'hex'), 'PROCESSING'
from usdt_receipt_ctx;
select throws_ok($$
  select public.confirm_usdt_manual_deposit(blocked_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-processing') from usdt_receipt_ctx
$$, '40001', 'USDT_CONFIRMATION_IN_PROGRESS', 'a processing request is not silently stolen');
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 0, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-zero') from usdt_receipt_ctx
$$, '22023', 'INVALID_USDT_DEPOSIT_CONFIRMATION', 'zero cannot become authoritative money');
select throws_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 15000, admin_id,
    'short', 'usdt-receipt-short-reason') from usdt_receipt_ctx
$$, '22023', 'INVALID_USDT_DEPOSIT_CONFIRMATION', 'the existing operator reason requirement stays intact');

select lives_ok($$
  select public.confirm_usdt_manual_deposit(other_id, 9007199254740993::bigint, admin_id,
    'manual transfer evidence matched', repeat('z', 200)) from usdt_receipt_ctx
$$, 'a 200-character key and an amount above JavaScript safe integer remain exact');
select is(
  (select credited_krw::text from public.usdt_manual_deposits
    where id = (select other_id from usdt_receipt_ctx)),
  '9007199254740993', 'the stored approved KRW value is not rounded'
);

insert into public.safe_mode_controls (component, is_paused, reason, changed_by, request_id)
select 'DEPOSIT', true, 'receipt test safe mode', admin_id, gen_random_uuid() from usdt_receipt_ctx
on conflict (component) do update set is_paused = true, starts_at = statement_timestamp(), reason = excluded.reason,
  changed_by = excluded.changed_by, request_id = excluded.request_id;
select is(
  public.confirm_usdt_manual_deposit((select main_id from usdt_receipt_ctx), 15000,
    (select admin_id from usdt_receipt_ctx), 'manual transfer evidence matched', 'usdt-receipt-main-v1'),
  (select journal_id from usdt_receipt_ctx), 'safe mode permits an already verified cached receipt'
);
select is(
  public.confirm_usdt_manual_deposit((select main_id from usdt_receipt_ctx), 15000,
    (select admin_two_id from usdt_receipt_ctx), 'operator checks existing receipt', 'usdt-receipt-safe-read'),
  (select journal_id from usdt_receipt_ctx), 'safe mode permits a fresh-key receipt check without new money'
);
select throws_ok($$
  select public.confirm_usdt_manual_deposit(blocked_id, 15000, admin_id,
    'manual transfer evidence matched', 'usdt-receipt-safe-write') from usdt_receipt_ctx
$$, '55000', 'SAFE_MODE_ACTIVE', 'safe mode still blocks new USDT credits');

select is((select count(*)::integer from public.ledger_transactions
  where reference_type = 'usdt_manual_deposit' and reference_id = (select main_id from usdt_receipt_ctx)),
  1, 'all retries and rejected payloads leave exactly one main deposit journal');
select is((select count(*)::integer from public.wallet_ledger
  where reference_type = 'usdt_manual_deposit' and reference_id = (select main_id from usdt_receipt_ctx)),
  1, 'all retries leave exactly one main wallet credit');
select is((select count(*)::integer from public.audit_logs
  where action = 'usdt_manual_deposit.confirm' and target_id = (select main_id::text from usdt_receipt_ctx)),
  1, 'retries retain the original operator audit instead of manufacturing another approval');
select is((select count(*)::integer from public.outbox_events
  where event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'
    and aggregate_id = (select main_id from usdt_receipt_ctx)),
  1, 'retries never duplicate the downstream confirmation event');
select is((select count(*)::integer from public.wallet_accounts
  where user_id = (select member_id from usdt_receipt_ctx) and currency = 'USDT'),
  0, 'manual USDT confirmation never creates a user USDT wallet');

select * from finish();
rollback;
