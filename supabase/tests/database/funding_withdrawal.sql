begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

create temporary table funding_test_context (
  user_id uuid not null,
  operator_id uuid not null,
  wallet_id uuid,
  deposit_id uuid,
  ledger_id uuid,
  policy_id uuid,
  withdrawal_id uuid
);

insert into funding_test_context (user_id, operator_id)
values (
  'e124f156-f70a-44af-9262-939070de75bb',
  '4a5929d4-f26d-4e73-b568-87048b950f29'
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
  updated_at
)
select
  id,
  'authenticated',
  'authenticated',
  email,
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
from (
  select user_id as id, 'funding-user@putduk.test' as email
  from funding_test_context
  union all
  select operator_id, 'funding-operator@putduk.test'
  from funding_test_context
) as users;

insert into public.user_roles (user_id, role, granted_by)
select operator_id, 'ADMIN', operator_id
from funding_test_context;

select public.bootstrap_user((select user_id from funding_test_context));

update funding_test_context
set wallet_id = account.id
from public.wallet_accounts as account
where account.user_id = funding_test_context.user_id
  and account.currency = 'KRW';

update funding_test_context
set deposit_id = public.create_deposit_request(
  user_id,
  'KRW',
  100000,
  'funding-deposit-0001'
);

select is(
  (
    select status::text
    from public.deposit_requests
    where id = (select deposit_id from funding_test_context)
  ),
  'AWAITING_TRANSFER',
  'a KRW funding request starts in the bank-transfer waiting state'
);

update funding_test_context
set ledger_id = public.approve_deposit_request(
  deposit_id,
  operator_id,
  100000,
  'funding-ledger-0001',
  'Verified matching bank transfer for pgTAP',
  '42655c4c-ab80-497b-a917-e9d92dc793be'
);

select isnt(
  (select ledger_id from funding_test_context),
  null,
  'deposit approval atomically returns a ledger credit id'
);

select is(
  (
    select status::text
    from public.deposit_requests
    where id = (select deposit_id from funding_test_context)
  ),
  'APPROVED',
  'deposit approval advances the request to APPROVED'
);

select is(
  (
    select sum(
      case when direction = 'CREDIT' then amount_atomic else -amount_atomic end
    )::bigint
    from public.wallet_ledger
    where wallet_account_id = (select wallet_id from funding_test_context)
  ),
  100000::bigint,
  'wallet balance is derived from the approved immutable credit'
);

select public.approve_deposit_request(
  (select deposit_id from funding_test_context),
  (select operator_id from funding_test_context),
  100000,
  'funding-ledger-0001',
  'Verified matching bank transfer for pgTAP',
  '42655c4c-ab80-497b-a917-e9d92dc793be'
);

select is(
  (
    select count(*)::integer
    from public.wallet_ledger
    where reference_type = 'deposit_request'
      and reference_id = (select deposit_id from funding_test_context)
  ),
  1,
  'repeating a deposit approval never duplicates the ledger credit'
);

with inserted as (
  insert into public.withdrawal_policies (
    currency,
    destination_type,
    version,
    is_enabled,
    minimum_amount_atomic,
    fee_atomic,
    destination_config,
    effective_at,
    approved_by
  )
  select
    'KRW',
    'BANK_ACCOUNT',
    1,
    true,
    10000,
    1000,
    '{"country":"KR"}'::jsonb,
    statement_timestamp() - interval '1 hour',
    operator_id
  from funding_test_context
  returning id
)
update funding_test_context
set policy_id = inserted.id
from inserted;

update funding_test_context
set withdrawal_id = public.create_withdrawal_request(
  user_id,
  wallet_id,
  policy_id,
  20000,
  'BANK_ACCOUNT',
  '{"display":"***-**-1234","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
  'funding-withdrawal-0001'
);

select isnt(
  (select withdrawal_id from funding_test_context),
  null,
  'an eligible policy-bound withdrawal request is created'
);

select ok(
  (
    select request.status = 'REQUESTED'
      and request.fee_atomic = 1000
      and request.amount_atomic = 20000
      and request.withdrawal_policy_id = context.policy_id
    from funding_test_context as context
    join public.withdrawal_requests as request
      on request.id = context.withdrawal_id
  ),
  'the request snapshots the approved policy fee and remains pending review'
);

select is(
  public.create_withdrawal_request(
    (select user_id from funding_test_context),
    (select wallet_id from funding_test_context),
    (select policy_id from funding_test_context),
    20000,
    'BANK_ACCOUNT',
    '{"display":"***-**-1234","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
    'funding-withdrawal-0001'
  ),
  (select withdrawal_id from funding_test_context),
  'repeating the withdrawal idempotency key returns the original request'
);

select throws_ok(
  format(
    $query$
      select public.create_withdrawal_request(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        80000,
        'BANK_ACCOUNT',
        '{"display":"***-**-5678","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
        'funding-withdrawal-0002'
      )
    $query$,
    (select user_id from funding_test_context),
    (select wallet_id from funding_test_context),
    (select policy_id from funding_test_context)
  ),
  '22003',
  'INSUFFICIENT_AVAILABLE_BALANCE',
  'pending withdrawals reserve amount plus policy fee from availability'
);

select is(
  (
    select count(*)::integer
    from public.wallet_ledger
    where wallet_account_id = (select wallet_id from funding_test_context)
  ),
  1,
  'a withdrawal request does not debit the ledger before operator processing'
);

select * from finish();

rollback;
