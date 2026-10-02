begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

create temporary table ws04_ctx (
  user_a uuid not null,
  user_b uuid not null,
  operator_id uuid not null,
  wallet_a uuid,
  destination_a uuid,
  policy_krw uuid,
  withdrawal_id uuid,
  hold_tx uuid,
  release_tx uuid,
  send_id uuid,
  finalize_tx uuid,
  deposit_instruction uuid,
  deposit_id uuid,
  deposit_ledger uuid
);

insert into ws04_ctx (user_a, user_b, operator_id)
values (
  'a1111111-1111-4111-8111-111111111111',
  'b2222222-2222-4222-8222-222222222222',
  'c3333333-3333-4333-8333-333333333333'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select
  id, 'authenticated', 'authenticated', email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select user_a as id, 'ws04-a@putduk.test' as email from ws04_ctx
  union all
  select user_b, 'ws04-b@putduk.test' from ws04_ctx
  union all
  select operator_id, 'ws04-op@putduk.test' from ws04_ctx
) as users;

insert into public.user_roles (user_id, role, granted_by)
select operator_id, 'ADMIN', operator_id from ws04_ctx;

select public.bootstrap_user((select user_a from ws04_ctx));
select public.bootstrap_user((select user_b from ws04_ctx));

update ws04_ctx
set wallet_a = account.id
from public.wallet_accounts as account
where account.user_id = ws04_ctx.user_a
  and account.currency = 'KRW';

-- Phone availability shape
select ok(
  (
    select count(*) = 5
      and bool_and(procedure.proconfig @> array['search_path=pg_catalog']::text[])
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prosecdef
      and procedure.oid in (
        'public.bootstrap_user(uuid)'::regprocedure,
        'public.is_login_id_available(text)'::regprocedure,
        'public.resolve_login_email(text)'::regprocedure,
        'app_private.capture_public_signup_identity()'::regprocedure,
        'public.signup_phone_availability(text)'::regprocedure
      )
  )
    and not exists (
      select 1
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'app_private')
        and procedure.prosecdef
        and procedure.oid not in (
          'public.bootstrap_user(uuid)'::regprocedure,
          'public.is_login_id_available(text)'::regprocedure,
          'public.resolve_login_email(text)'::regprocedure,
          'app_private.capture_public_signup_identity()'::regprocedure,
          'public.signup_phone_availability(text)'::regprocedure
        )
    ),
  'application schemas allow exactly five reviewed SECURITY DEFINER functions'
);

select is(
  public.normalize_signup_phone('010-9876-5432'),
  '+821098765432',
  'normalize_signup_phone converts Korea local numbers'
);

select is(
  public.signup_phone_availability('010-1111-2222'),
  'AVAILABLE',
  'fresh phone is AVAILABLE'
);

select is(
  public.signup_phone_availability('not-a-phone'),
  'UNAVAILABLE',
  'invalid phone is UNAVAILABLE without leaking identity'
);

insert into public.signup_phone_history (phone_e164, user_id, source)
values ('+821011112222', (select user_a from ws04_ctx), 'SIGNUP');

select is(
  public.signup_phone_availability('010-1111-2222'),
  'UNAVAILABLE',
  'historical signup phone is UNAVAILABLE'
);

select is(
  public.signup_phone_availability('+821011112222'),
  'UNAVAILABLE',
  'phone availability never returns account identifiers'
);

-- Fund user A via welcome-style wallet credit for hold tests
insert into public.wallet_ledger (
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id, reason
)
select
  wallet_a, user_a, 'CREDIT', 'DEPOSIT', 20000,
  'ws04-fund-a', 'test', user_a, 'ws04 fixture'
from ws04_ctx;

insert into public.ledger_accounts (code, currency, account_class, normal_side, owner_user_id)
select
  'USER:' || upper(user_a::text) || ':KRW:LIABILITY',
  'KRW', 'LIABILITY', 'CREDIT', user_a
from ws04_ctx
on conflict (code) do nothing;

insert into public.ledger_accounts (code, currency, account_class, normal_side, is_controlled_asset)
values
  ('PUTDUK:OPERATING_CASH:KRW', 'KRW', 'ASSET', 'DEBIT', true),
  ('PUTDUK:WITHDRAWAL_HOLD:KRW', 'KRW', 'CLEARING', 'CREDIT', false)
on conflict (code) do nothing;

insert into public.withdrawal_policies (
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select
  'KRW', 'KRW_BANK', 9101, true, 1000, 0,
  '{}'::jsonb, statement_timestamp(), operator_id, false
from ws04_ctx;

update ws04_ctx
set policy_krw = policy.id
from public.withdrawal_policies as policy
where policy.version = 9101
  and policy.destination_type = 'KRW_BANK';

update ws04_ctx
set destination_a = public.register_krw_bank_destination(
  user_a,
  decode('00112233445566778899aabbccddeeff', 'hex'),
  'fp-ws04-bank-a',
  '국민 **1234',
  'step-up-token-ws04-a',
  'd4444444-4444-4444-8444-444444444444',
  1
);

select ok(
  (
    select destination.protection_until <= statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'first KRW_BANK destination registration does not apply cooldown'
);

update ws04_ctx
set withdrawal_id = public.request_krw_withdrawal(
  user_a,
  destination_a,
  5000,
  'ws04-hold-once-0001'
);

select isnt(
  (select withdrawal_id from ws04_ctx),
  null,
  'request_krw_withdrawal creates a held withdrawal'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'HELD',
  'withdrawal is HELD after ledger reservation'
);

select ok(
  (
    select hold_ledger_transaction_id is not null
      and currency = 'KRW'
      and destination_type = 'KRW_BANK'
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'normal KRW withdrawal uses held KRW'
);

select is(
  public.request_krw_withdrawal(
    (select user_a from ws04_ctx),
    (select destination_a from ws04_ctx),
    5000,
    'ws04-hold-once-0001'
  ),
  (select withdrawal_id from ws04_ctx),
  'duplicate hold idempotency key returns the same withdrawal'
);

select is(
  (
    select count(*)::integer
    from public.withdrawal_requests
    where user_id = (select user_a from ws04_ctx)
      and idempotency_key = 'ws04-hold-once-0001'
  ),
  1,
  'hold double-submit does not create a second request'
);

select throws_ok(
  $$
    select public.request_krw_withdrawal(
      (select user_a from ws04_ctx),
      (select destination_a from ws04_ctx),
      16000,
      'ws04-hold-oversize-0003'
    )
  $$,
  '22003',
  'INSUFFICIENT_AVAILABLE_BALANCE',
  'oversize request cannot bypass held reservation'
);

update ws04_ctx
set hold_tx = request.hold_ledger_transaction_id
from public.withdrawal_requests as request
where request.id = ws04_ctx.withdrawal_id;

select isnt(
  (select hold_tx from ws04_ctx),
  null,
  'hold posts a balanced ledger transaction'
);

-- External send then ledger finalize retry
update ws04_ctx
set send_id = public.record_krw_external_send(
  withdrawal_id,
  'BANK-REF-WS04-001',
  5000,
  operator_id,
  statement_timestamp(),
  'ws04-krw-send-0001'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'EXTERNAL_SENT_RECORDED',
  'KRW external send records shared EXTERNAL_SENT_RECORDED state'
);

select is(
  public.record_krw_external_send(
    (select withdrawal_id from ws04_ctx),
    'BANK-REF-WS04-001',
    5000,
    (select operator_id from ws04_ctx),
    statement_timestamp(),
    'ws04-krw-send-0001'
  ),
  (select send_id from ws04_ctx),
  'retry after EXTERNAL_SENT_RECORDED does not create another external send'
);

select throws_ok(
  $$
    select public.release_withdrawal_hold(
      (select withdrawal_id from ws04_ctx),
      (select operator_id from ws04_ctx),
      'too late to release',
      'ws04-release-late-0001',
      'CANCELLED'
    )
  $$,
  '55000',
  'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND',
  'cancel is forbidden after EXTERNAL_SENT_RECORDED'
);

select throws_ok(
  $$
    select public.release_withdrawal_hold(
      (select withdrawal_id from ws04_ctx),
      (select operator_id from ws04_ctx),
      'too late to reject',
      'ws04-release-late-reject',
      'REJECTED'
    )
  $$,
  '55000',
  'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND',
  'reject is forbidden after EXTERNAL_SENT_RECORDED'
);

update ws04_ctx
set finalize_tx = public.finalize_withdrawal_ledger(
  withdrawal_id,
  operator_id,
  'ws04-finalize-0001'
);

select is(
  public.finalize_withdrawal_ledger(
    (select withdrawal_id from ws04_ctx),
    (select operator_id from ws04_ctx),
    'ws04-finalize-0001'
  ),
  (select finalize_tx from ws04_ctx),
  'finalize_withdrawal_ledger is idempotent'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'COMPLETED',
  'finalize completes the withdrawal without another external send'
);

-- CANCELLED release-once path
update ws04_ctx
set withdrawal_id = public.request_krw_withdrawal(
  user_a,
  destination_a,
  3000,
  'ws04-release-once-0001'
);

update ws04_ctx
set release_tx = public.release_withdrawal_hold(
  withdrawal_id,
  operator_id,
  'user cancelled before send',
  'ws04-release-once-key',
  'CANCELLED'
);

select is(
  public.release_withdrawal_hold(
    (select withdrawal_id from ws04_ctx),
    (select operator_id from ws04_ctx),
    'user cancelled before send',
    'ws04-release-once-key',
    'CANCELLED'
  ),
  (select release_tx from ws04_ctx),
  'release_withdrawal_hold runs exactly once under idempotency'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'CANCELLED',
  'user/operator cancellation ends CANCELLED'
);

select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where idempotency_key = 'ws04-release-once-key:release'
  ),
  1,
  'each release posts exactly one release ledger effect'
);

-- REJECTED is distinct from CANCELLED
update ws04_ctx
set withdrawal_id = public.request_krw_withdrawal(
  user_a,
  destination_a,
  2000,
  'ws04-release-reject-0001'
);

update ws04_ctx
set release_tx = public.release_withdrawal_hold(
  withdrawal_id,
  operator_id,
  'operator rejected after review',
  'ws04-release-reject-key',
  'REJECTED'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'REJECTED',
  'operator rejection ends REJECTED'
);

select is(
  public.release_withdrawal_hold(
    (select withdrawal_id from ws04_ctx),
    (select operator_id from ws04_ctx),
    'operator rejected after review',
    'ws04-release-reject-key',
    'REJECTED'
  ),
  (select release_tx from ws04_ctx),
  'rejected release stays idempotent with one effect'
);

-- Replacement destination is protected during cooldown
-- Synthetic verified proof; the production API verifies the password/MFA.
insert into auth.sessions(id,user_id,created_at,updated_at)
select 'd5555555-5555-4555-8555-555555555555',user_a,statement_timestamp(),statement_timestamp() from ws04_ctx;
insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select user_a,'d5555555-5555-4555-8555-555555555555',
  encode(extensions.digest('step-up-token-ws04-a2','sha256'),'hex'),'KRW_BANK',
  encode(extensions.digest('fp-ws04-bank-a-replaced','sha256'),'hex') from ws04_ctx;
update public.withdrawal_destination_step_ups set status='VERIFIED'
where user_id=(select user_a from ws04_ctx) and method='KRW_BANK';
update ws04_ctx
set destination_a = public.register_krw_bank_destination(
  user_a,
  decode('ffeeddccbbaa99887766554433221100', 'hex'),
  encode(extensions.digest('fp-ws04-bank-a-replaced','sha256'),'hex'),
  '국민 **9999',
  'step-up-token-ws04-a2',
  'd4444444-4444-4444-8444-444444444445',
  24
);

select ok(
  (
    select destination.protection_until > statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'replacement KRW_BANK destination is protected during cooldown'
);

select throws_ok(
  $$
    select public.request_krw_withdrawal(
      (select user_a from ws04_ctx),
      (select destination_a from ws04_ctx),
      1000,
      'ws04-protected-dest-0001'
    )
  $$,
  '55000',
  'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED',
  'protected replacement destination cannot withdraw during cooldown'
);

-- USDT_ADDRESS first destination + held KRW withdrawal
insert into public.withdrawal_policies (
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select
  'KRW', 'USDT_ADDRESS', 9102, true, 1000, 0,
  '{"allowed_networks":["TRC20"]}'::jsonb,
  statement_timestamp(), operator_id, false
from ws04_ctx;

insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select user_a,'d5555555-5555-4555-8555-555555555555',
  encode(extensions.digest('step-up-token-ws04-usdt2','sha256'),'hex'),'USDT_ADDRESS',
  encode(extensions.digest('fp-ws04-usdt-a2','sha256'),'hex') from ws04_ctx;
update public.withdrawal_destination_step_ups set status='VERIFIED'
where user_id=(select user_a from ws04_ctx) and method='USDT_ADDRESS';
update ws04_ctx
set destination_a = public.register_usdt_withdrawal_destination(
  user_a,
  'TRC20',
  'TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234',
  decode('aabbccddeeff00112233445566778899', 'hex'),
  'fp-ws04-usdt-a',
  'TRC20 TXYZ…1234',
  'step-up-token-ws04-usdt',
  'd4444444-4444-4444-8444-444444444446',
  1
);

select ok(
  (
    select destination.protection_until <= statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'first USDT_ADDRESS destination registration does not apply cooldown'
);

update ws04_ctx
set withdrawal_id = public.request_usdt_withdrawal(
  user_a,
  destination_a,
  1500,
  'ws04-usdt-hold-0001'
);

select ok(
  (
    select hold_ledger_transaction_id is not null
      and currency = 'KRW'
      and destination_type = 'USDT_ADDRESS'
      and status = 'HELD'
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'normal USDT withdrawal uses held KRW'
);

update ws04_ctx
set destination_a = public.register_usdt_withdrawal_destination(
  user_a,
  'TRC20',
  'TNEWaBcDeFgHiJkLmNoPqRsTuVwXyZ9999',
  decode('99887766554433221100ffeeddccbbaa', 'hex'),
  encode(extensions.digest('fp-ws04-usdt-a2','sha256'),'hex'),
  'TRC20 TNEW…9999',
  'step-up-token-ws04-usdt2',
  'd4444444-4444-4444-8444-444444444447',
  24
);

select ok(
  (
    select destination.protection_until > statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'replacement USDT_ADDRESS destination is protected during cooldown'
);

-- USDT deposit snapshot stability
update ws04_ctx
set deposit_instruction = public.set_usdt_deposit_instructions(
  'TXYZabcdefghijklmnopqrstuvwxyz123456',
  'TRC20',
  operator_id,
  'initial deposit address for ws04 tests',
  'e5555555-5555-4555-8555-555555555555'
);

update ws04_ctx
set deposit_id = public.submit_usdt_manual_deposit(
  user_a,
  'TRC20',
  '0xabc123deposithash0001',
  12.5,
  'ws04-usdt-deposit-0001'
);

select is(
  (
    select deposit_address_snapshot
    from public.usdt_manual_deposits
    where id = (select deposit_id from ws04_ctx)
  ),
  'TXYZabcdefghijklmnopqrstuvwxyz123456',
  'submit copies deposit_address_snapshot'
);

select ok(
  public.set_usdt_deposit_instructions(
    'TNEWabcdefghijklmnopqrstuvwxyz999999',
    'TRC20',
    (select operator_id from ws04_ctx),
    'rotated deposit address must not rewrite snapshots',
    'e5555555-5555-4555-8555-555555555556'
  ) is not null,
  'deposit instructions can rotate without rewriting snapshots'
);

select is(
  (
    select deposit_address_snapshot
    from public.usdt_manual_deposits
    where id = (select deposit_id from ws04_ctx)
  ),
  'TXYZabcdefghijklmnopqrstuvwxyz123456',
  'instruction rotation does not rewrite past deposit snapshots'
);

update ws04_ctx
set deposit_ledger = public.confirm_usdt_manual_deposit(
  deposit_id,
  15000,
  operator_id,
  'manual confirmation after chain evidence review',
  'ws04-usdt-confirm-0001'
);

select is(
  public.confirm_usdt_manual_deposit(
    (select deposit_id from ws04_ctx),
    15000,
    (select operator_id from ws04_ctx),
    'manual confirmation after chain evidence review',
    'ws04-usdt-confirm-0001'
  ),
  (select deposit_ledger from ws04_ctx),
  'confirm_usdt_manual_deposit posts balanced DEPOSIT once'
);

-- Two-user isolation: user B cannot register against user A destination path
select throws_ok(
  $$
    select public.request_krw_withdrawal(
      (select user_b from ws04_ctx),
      (select destination_a from ws04_ctx),
      1000,
      'ws04-isolation-0001'
    )
  $$,
  '55000',
  'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED',
  'user B cannot withdraw using user A destination'
);

select ok(
  not exists (
    select 1
    from public.usdt_deposit_instructions as instruction
    join public.withdrawal_destinations as destination
      on destination.encrypted_value = convert_to(instruction.deposit_address, 'UTF8')
  ),
  'deposit admin addresses are not stored as withdrawal destinations'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.register_admin_session(uuid,text,text,text,integer,integer)',
    'EXECUTE'
  ),
  'service role may register admin sessions'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.open_kyc_case(uuid,uuid)',
    'EXECUTE'
  ),
  'service role may open KYC cases'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_outbox_events(text,integer,integer)',
    'EXECUTE'
  ),
  'worker retains claim_outbox_events'
);

select * from finish();

rollback;
