begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

set local session_replication_role = replica;
insert into auth.users (id, email, email_confirmed_at)
values ('a1111111-1111-4111-8111-111111111111', 'deposit-credit@test.putduk', now())
on conflict (id) do nothing;
set local session_replication_role = origin;

insert into app_private.workroom_accounts (user_id, name, balance, room)
values ('a1111111-1111-4111-8111-111111111111', 'Deposit Test', 0, 'WR-DEPOSIT-TEST')
on conflict (user_id) do update set balance = 0;

insert into public.wallet_accounts (id, user_id, currency)
values (
  'c1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  'KRW'
)
on conflict (user_id, currency) do nothing;

insert into public.ledger_transactions (
  id,
  category,
  currency,
  idempotency_key,
  reference_type,
  reference_id,
  member_user_id,
  request_id,
  correlation_id,
  description,
  posted_at,
  created_at
) values (
  'd1111111-1111-4111-8111-111111111111',
  'DEPOSIT',
  'KRW',
  'deposit-credit-test-ledger',
  'deposit_request',
  'b1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  'e1111111-1111-4111-8111-111111111111',
  'f1111111-1111-4111-8111-111111111111',
  'Deposit credit test',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.wallet_ledger (
  id,
  wallet_account_id,
  user_id,
  direction,
  entry_type,
  amount_atomic,
  idempotency_key,
  reference_type,
  reference_id,
  reason
) values (
  '71111111-1111-4111-8111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  'CREDIT',
  'DEPOSIT',
  25000,
  'deposit-credit-test-wallet',
  'deposit_request',
  'b1111111-1111-4111-8111-111111111111',
  'Approved deposit test'
)
on conflict (id) do nothing;

insert into public.deposit_requests (
  id,
  user_id,
  currency,
  amount_atomic,
  status,
  idempotency_key
) values (
  'b1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  'KRW',
  25000,
  'REQUESTED',
  'deposit-credit-test-001'
)
on conflict (id) do nothing;

update public.deposit_requests
set
  status = 'APPROVED',
  approved_amount_atomic = 25000,
  ledger_transaction_id = 'd1111111-1111-4111-8111-111111111111',
  wallet_ledger_id = '71111111-1111-4111-8111-111111111111'
where id = 'b1111111-1111-4111-8111-111111111111';

select extensions.is(
  (select balance from app_private.workroom_accounts
   where user_id = 'a1111111-1111-4111-8111-111111111111'),
  25000::bigint,
  'approved deposit credits monitoring balance once'
);

select extensions.is(
  (select count(*) from app_private.workroom_ledger
   where user_id = 'a1111111-1111-4111-8111-111111111111'
     and kind = 'DEPOSIT'),
  1::bigint,
  'approved deposit creates one monitoring ledger row'
);

update public.deposit_requests
set
  status = 'APPROVED',
  approved_amount_atomic = 25000,
  ledger_transaction_id = 'd1111111-1111-4111-8111-111111111111',
  wallet_ledger_id = '71111111-1111-4111-8111-111111111111'
where id = 'b1111111-1111-4111-8111-111111111111';

select extensions.is(
  (select balance from app_private.workroom_accounts
   where user_id = 'a1111111-1111-4111-8111-111111111111'),
  25000::bigint,
  'repeated approved status update does not double credit'
);

select extensions.is(
  (select amount from app_private.workroom_ledger
   where user_id = 'a1111111-1111-4111-8111-111111111111'
     and kind = 'DEPOSIT'),
  25000::bigint,
  'monitoring ledger preserves approved amount'
);

select * from extensions.finish();
rollback;
