begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 검증된 원금 CREDIT 두 건이 한 출금보다 작을 때 부분 배분으로 hold까지 간다.
-- 같은 키 재시도는 hold를 하나 더 만들지 않는다. 부족한 금액은 성공으로 끝내지 않는다.

create temporary table source_hold_ctx (
  member_id uuid,
  empty_id uuid,
  admin_id uuid,
  bank_id uuid,
  withdrawal_id uuid
);
insert into source_hold_ctx(member_id, empty_id, admin_id) values (
  '10610000-0000-4000-8000-000000000201',
  '10610000-0000-4000-8000-000000000202',
  '10610000-0000-4000-8000-000000000203'
);
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select person, 'authenticated', 'authenticated', person::text || '@source-hold.putduk.test', '',
  statement_timestamp(), '{}', '{}', statement_timestamp(), statement_timestamp(), '', '', '', ''
from source_hold_ctx
cross join lateral unnest(array[member_id, empty_id, admin_id]) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN', admin_id from source_hold_ctx;
select public.bootstrap_user(person)
from source_hold_ctx
cross join lateral unnest(array[member_id, empty_id]) as person;

insert into public.withdrawal_policies(
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select 'KRW', 'KRW_BANK', 1061001, true, 1, 0, '{}'::jsonb,
  statement_timestamp() - interval '1 hour', admin_id, false
from source_hold_ctx;
insert into public.withdrawal_destinations(
  user_id, destination_type, encrypted_value, value_fingerprint, display_hint,
  verification_status, verified_at, protection_until
)
select person, 'KRW_BANK', decode(repeat('ab', 32), 'hex'),
  encode(extensions.digest(person::text || 'KRW_BANK', 'sha256'), 'hex'),
  '원본 시험 계좌', 'VERIFIED',
  statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 day'
from source_hold_ctx
cross join lateral unnest(array[member_id, empty_id]) as person;
update source_hold_ctx
set bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = source_hold_ctx.member_id
  and destination.destination_type = 'KRW_BANK';

grant select, update on source_hold_ctx to service_role;
set local role service_role;
select public.approve_deposit_request(
  public.create_deposit_request(member_id, 'KRW', 4000, 'source-hold-deposit-a'),
  admin_id, 4000, 'source-hold-credit-a', 'first verified principal', gen_random_uuid()
) from source_hold_ctx;
select public.approve_deposit_request(
  public.create_deposit_request(member_id, 'KRW', 6000, 'source-hold-deposit-b'),
  admin_id, 6000, 'source-hold-credit-b', 'second verified principal', gen_random_uuid()
) from source_hold_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'both principal credits finish their original receipts');
set constraints deposit_requests_money_source_complete deferred;

update source_hold_ctx
set withdrawal_id = public.request_krw_withdrawal(
  member_id, bank_id, 9000, 'source-hold-span-0001');
select is(
  public.request_krw_withdrawal(
    (select member_id from source_hold_ctx),
    (select bank_id from source_hold_ctx),
    9000,
    'source-hold-span-0001'
  ),
  (select withdrawal_id from source_hold_ctx),
  'the same request returns the original hold'
);
reset role;

select is(
  (select status from public.withdrawal_requests where id = (select withdrawal_id from source_hold_ctx)),
  'HELD',
  'verified principal credit reaches hold'
);
select is(
  (select count(*)::integer from public.withdrawal_requests
    where user_id = (select member_id from source_hold_ctx)
      and idempotency_key = 'source-hold-span-0001'),
  1,
  'retry does not insert a second request'
);
select is(
  (select count(*)::integer from public.ledger_transactions
    where idempotency_key = 'source-hold-span-0001:hold'),
  1,
  'retry does not post a second hold journal'
);
select ok(
  (
    select count(*)::integer = 2
      and bool_and(allocation.policy_code = 'NEWEST_FIRST')
      and sum(allocation.allocation_micro_krw) = app_private.funding_principal_micro_krw(9000)
      and bool_and(lot.origin_code in ('KRW_DEPOSIT', 'USDT_KRW_DEPOSIT'))
    from public.funding_principal_recovery_allocations as allocation
    join public.funding_principal_lots as lot on lot.id = allocation.lot_id
    where allocation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id
      from public.withdrawal_requests
      where id = (select withdrawal_id from source_hold_ctx)
    )
  ),
  'newest-first partial allocation uses both principal credits and not a bonus'
);
select is(
  (select count(*)::integer from public.wallet_ledger
    where user_id = (select member_id from source_hold_ctx) and direction = 'DEBIT'),
  0,
  'hold does not debit the wallet projection'
);

insert into public.wallet_ledger(
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id
)
select id, user_id, 'CREDIT', 'DEPOSIT', 5000, 'source-hold-extra-wallet', 'test', user_id
from public.wallet_accounts
where user_id = (select member_id from source_hold_ctx) and currency = 'KRW';
set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(member_id, bank_id, 2000, 'source-hold-short-0002')
    from source_hold_ctx$$,
  '55000', 'WITHDRAWAL_SOURCE_INSUFFICIENT',
  'a short verified principal balance is not reported as a successful hold'
);
select throws_ok(
  $$select public.request_krw_withdrawal(empty_id,
      (select id from public.withdrawal_destinations where user_id = empty_id),
      1000, 'source-hold-empty-0003') from source_hold_ctx$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'an unclassified wallet credit is not a verified source'
);
reset role;
insert into public.wallet_ledger(
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id
)
select id, user_id, 'CREDIT', 'DEPOSIT', 8000, 'source-hold-unclassified', 'test', user_id
from public.wallet_accounts
where user_id = (select empty_id from source_hold_ctx) and currency = 'KRW';
set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(empty_id,
      (select id from public.withdrawal_destinations where user_id = empty_id),
      1000, 'source-hold-unclassified-0004') from source_hold_ctx$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'wallet balance without a verified credit still cannot hold'
);
reset role;
select is(
  (select count(*)::integer from public.withdrawal_requests
    where user_id = (select member_id from source_hold_ctx)),
  1,
  'the rejected short request leaves the original hold alone'
);

select * from finish();
rollback;
