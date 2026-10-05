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

create extension if not exists pgtap with schema extensions;

select no_plan();

create temporary table reuse_ctx (
  admin_id uuid not null,
  member_id uuid not null,
  wallet_id uuid,
  destination_id uuid,
  release_owner_id uuid,
  release_victim_id uuid,
  release_tx uuid,
  finalize_owner_id uuid,
  finalize_victim_id uuid,
  finalize_tx uuid
);

insert into reuse_ctx (admin_id, member_id) values (
  '0d110000-0000-4000-8000-0000000000a1',
  '0d110000-0000-4000-8000-0000000000b1'
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
  select admin_id as id, 'reuse-idem-admin@putduk.test' as email from reuse_ctx
  union all select member_id, 'reuse-idem-member@putduk.test' from reuse_ctx
) as person;

insert into public.user_roles (user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from reuse_ctx;

select public.bootstrap_user((select member_id from reuse_ctx));

select throws_ok(
  $reuse$
    select public.request_krw_withdrawal(
      member_id,
      '0d110000-0000-4000-8000-0000000000d1',
      1000,
      'reuse-general-closed'
    )
    from reuse_ctx
  $reuse$,
  '55000',
  'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general withdrawal stays closed'
);

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
  95110,
  true,
  1,
  0,
  '{"country":"KR"}'::jsonb,
  statement_timestamp() - interval '3 hours',
  admin_id,
  true
from reuse_ctx;

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
  member_id,
  'KRW_BANK',
  convert_to('REUSE-ACCOUNT-SHOULD-NOT-LEAK', 'UTF8'),
  'reuse-idem-bank-fp',
  '***-**-9511',
  'VERIFIED',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '1 day'
from reuse_ctx;

update reuse_ctx
set destination_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = reuse_ctx.member_id
  and destination.destination_type = 'KRW_BANK';

select public.approve_deposit_request(
  public.create_deposit_request(
    (select member_id from reuse_ctx),
    'KRW',
    50000,
    'reuse-idem-deposit-request'
  ),
  (select admin_id from reuse_ctx),
  50000,
  'reuse-idem-deposit-ledger',
  'fund idempotency reuse fixture',
  '0d110000-0000-4000-8000-0000000000c1'
);

update reuse_ctx
set wallet_id = account.id
from public.wallet_accounts as account
where account.user_id = reuse_ctx.member_id
  and account.currency = 'KRW'
  and account.closed_at is null;

-- 과거 보유만 심는다. 일반 출금 생성은 열지 않는다.
update reuse_ctx
set release_owner_id = pg_temp.seed_historical_held_withdrawal(
  member_id,
  destination_id,
  5000,
  'reuse-release-owner-hold'
);

update reuse_ctx
set release_victim_id = pg_temp.seed_historical_held_withdrawal(
  member_id,
  destination_id,
  4000,
  'reuse-release-victim-hold'
);

update reuse_ctx
set release_tx = public.release_withdrawal_hold(
  release_owner_id,
  admin_id,
  'member requested cancel',
  'reuse-release-shared',
  'CANCELLED'
);

select ok(
  (
    select status = 'CANCELLED'
      and release_ledger_transaction_id = (select release_tx from reuse_ctx)
    from public.withdrawal_requests
    where id = (select release_owner_id from reuse_ctx)
  ),
  'the first release still cancels its own withdrawal'
);

select is(
  public.release_withdrawal_hold(
    (select release_owner_id from reuse_ctx),
    (select admin_id from reuse_ctx),
    'member requested cancel',
    'reuse-release-shared',
    'CANCELLED'
  ),
  (select release_tx from reuse_ctx),
  'same withdrawal release replay still returns the original journal'
);

select throws_ok(
  $reuse$
    select public.release_withdrawal_hold(
      release_victim_id,
      admin_id,
      'member requested cancel',
      'reuse-release-shared',
      'CANCELLED'
    )
    from reuse_ctx
  $reuse$,
  '22023',
  'IDEMPOTENCY_KEY_REUSED',
  'release rejects another withdrawal idempotency key'
);

select ok(
  (
    select status = 'HELD'
      and release_ledger_transaction_id is null
      and hold_ledger_transaction_id is not null
    from public.withdrawal_requests
    where id = (select release_victim_id from reuse_ctx)
  ),
  'reused release key leaves the other hold in place'
);

select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where idempotency_key = 'reuse-release-shared:release'
  ),
  1,
  'reused release key does not post a second reversal'
);

select is(
  (
    select reference_id
    from public.ledger_transactions
    where idempotency_key = 'reuse-release-shared:release'
  ),
  (select release_owner_id from reuse_ctx),
  'the release journal stays attached to the first withdrawal'
);

select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where reference_id = (select release_victim_id from reuse_ctx)
      and category = 'REVERSAL'
  ),
  0,
  'the other withdrawal gets no reversal journal'
);

select is(
  app_private.available_krw_balance((select wallet_id from reuse_ctx)),
  46000::bigint,
  'reused release key does not restore the other hold'
);

select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (select release_victim_id from reuse_ctx)
      and event_type = 'WITHDRAWAL_HOLD_RELEASED.v1'
  ),
  0,
  'rejected release does not emit a hold released event'
);

update reuse_ctx
set finalize_owner_id = pg_temp.seed_historical_held_withdrawal(
  member_id,
  destination_id,
  3000,
  'reuse-finalize-owner-hold'
);

update reuse_ctx
set finalize_victim_id = pg_temp.seed_historical_held_withdrawal(
  member_id,
  destination_id,
  2000,
  'reuse-finalize-victim-hold'
);

select public.record_krw_external_send(
  (select finalize_owner_id from reuse_ctx),
  'OWNER-SEND-1001',
  3000,
  (select admin_id from reuse_ctx),
  statement_timestamp(),
  'reuse-fin-owner-send'
);

select public.record_krw_external_send(
  (select finalize_victim_id from reuse_ctx),
  'VICTIM-SEND-1001',
  2000,
  (select admin_id from reuse_ctx),
  statement_timestamp(),
  'reuse-fin-victim-send'
);

update reuse_ctx
set finalize_tx = public.finalize_withdrawal_ledger(
  finalize_owner_id,
  admin_id,
  'reuse-finalize-shared'
);

select is(
  public.finalize_withdrawal_ledger(
    (select finalize_owner_id from reuse_ctx),
    (select admin_id from reuse_ctx),
    'reuse-finalize-shared'
  ),
  (select finalize_tx from reuse_ctx),
  'same withdrawal finalize replay still returns the original journal'
);

select throws_ok(
  $reuse$
    select public.finalize_withdrawal_ledger(
      finalize_victim_id,
      admin_id,
      'reuse-finalize-shared'
    )
    from reuse_ctx
  $reuse$,
  '22023',
  'IDEMPOTENCY_KEY_REUSED',
  'finalize rejects another withdrawal idempotency key'
);

select ok(
  (
    select status = 'EXTERNAL_SENT_RECORDED'
      and finalize_ledger_transaction_id is null
      and hold_ledger_transaction_id is not null
    from public.withdrawal_requests
    where id = (select finalize_victim_id from reuse_ctx)
  ),
  'reused finalize key leaves the other withdrawal uncompleted'
);

select is(
  (
    select count(*)::integer
    from public.wallet_ledger
    where reference_id = (select finalize_victim_id from reuse_ctx)
      and direction = 'DEBIT'
      and entry_type = 'WITHDRAWAL'
  ),
  0,
  'reused finalize key does not debit the other withdrawal'
);

select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where idempotency_key = 'reuse-finalize-shared:finalize'
  ),
  1,
  'reused finalize key does not post a second withdrawal journal'
);

select is(
  (
    select reference_id
    from public.ledger_transactions
    where idempotency_key = 'reuse-finalize-shared:finalize'
  ),
  (select finalize_owner_id from reuse_ctx),
  'the finalize journal stays attached to the first withdrawal'
);

select is(
  (
    select count(*)::integer
    from public.wallet_ledger
    where reference_id = (select finalize_owner_id from reuse_ctx)
      and direction = 'DEBIT'
      and entry_type = 'WITHDRAWAL'
  ),
  1,
  'the first finalize still debits its own withdrawal once'
);

select ok(
  (
    select status = 'COMPLETED'
      and finalize_ledger_transaction_id = (select finalize_tx from reuse_ctx)
    from public.withdrawal_requests
    where id = (select finalize_owner_id from reuse_ctx)
  ),
  'the first finalize still completes its own withdrawal'
);

select is(
  app_private.available_krw_balance((select wallet_id from reuse_ctx)),
  41000::bigint,
  'reused finalize key does not release the other hold'
);

select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (select finalize_victim_id from reuse_ctx)
      and event_type = 'WITHDRAWAL_COMPLETED.v1'
  ),
  0,
  'rejected finalize does not emit a completed event'
);

select * from finish();

rollback;
