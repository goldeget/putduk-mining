begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Owner-only synthetic rows exercise the new fee boundary, not member
-- eligibility, earned rewards, holds, external transfers or a paid withdrawal.
-- Real positive-fee legacy rows must be seeded before migration 186 in the
-- separate upgrade test. This file never disables or bypasses any trigger.
create temporary table zero_fee_ctx (
  member_id uuid, admin_id uuid, currency public.currency_code,
  destination_type text, wallet_id uuid, policy_id uuid, request_id uuid
);
insert into zero_fee_ctx(member_id, admin_id, currency, destination_type) values
  ('0f106500-0000-4000-8000-000000000001', '0f106500-0000-4000-8000-000000000002', 'KRW', 'KRW_BANK'),
  ('0f106500-0000-4000-8000-000000000001', '0f106500-0000-4000-8000-000000000002', 'USDT', 'USDT_ADDRESS');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (values
  ('0f106500-0000-4000-8000-000000000001'::uuid, 'zero-fee-member@putduk.test'),
  ('0f106500-0000-4000-8000-000000000002'::uuid, 'zero-fee-admin@putduk.test')
) as person(id, email);
insert into public.user_roles(user_id, role, granted_by)
select distinct admin_id, 'ADMIN'::public.app_role, admin_id from zero_fee_ctx;
insert into public.wallet_accounts(user_id, currency)
select member_id, currency from zero_fee_ctx;
update zero_fee_ctx as context set wallet_id = account.id
from public.wallet_accounts as account
where account.user_id = context.member_id and account.currency = context.currency;

create temporary table zero_fee_history as
select id, to_jsonb(policy) as snapshot from public.withdrawal_policies as policy;
create temporary table zero_fee_economy_history as
select id, to_jsonb(policy) as snapshot from app_private.economy_policy_versions as policy;

select throws_ok(format($probe$
  insert into public.withdrawal_policies(currency, destination_type, version, is_enabled,
    minimum_amount_atomic, fee_atomic, destination_config, effective_at, approved_by)
  select currency, destination_type, 1065101, true, 1, 1, '{}'::jsonb,
    statement_timestamp() - interval '1 hour', admin_id from zero_fee_ctx where currency = %L
$probe$, currency::text), '22023', 'PLATFORM_FEES_PERMANENTLY_DISABLED',
  'a positive platform fee cannot be introduced in ' || currency::text || ' policy')
from zero_fee_ctx;

select lives_ok($probe$
  insert into public.withdrawal_policies(currency, destination_type, version, is_enabled,
    minimum_amount_atomic, fee_atomic, destination_config, effective_at, approved_by)
  select currency, destination_type, 1065102, true, 1, 0, '{}'::jsonb,
    statement_timestamp() - interval '1 hour', admin_id from zero_fee_ctx
$probe$, 'zero-fee KRW and USDT policies remain insertable');
update zero_fee_ctx as context set policy_id = policy.id
from public.withdrawal_policies as policy
where policy.currency = context.currency and policy.destination_type = context.destination_type
  and policy.version = 1065102;
select is((select count(*)::integer from zero_fee_ctx where policy_id is not null),
  2, 'both methods have a real zero-fee policy');

select throws_ok(format($probe$
  insert into public.withdrawal_requests(wallet_account_id, withdrawal_policy_id,
    user_id, currency, amount_atomic, fee_atomic, destination_type,
    destination_snapshot, status, idempotency_key)
  select wallet_id, policy_id, member_id, currency, 10000, 1, destination_type,
    '{"display":"synthetic fee-boundary fixture"}'::jsonb, 'REQUESTED',
    'zero-fee-positive-request-' || currency::text from zero_fee_ctx where currency = %L
$probe$, currency::text), '22023', 'PLATFORM_FEES_PERMANENTLY_DISABLED',
  'a direct ' || currency::text || ' request cannot inject a positive fee')
from zero_fee_ctx;
select lives_ok($probe$
  insert into public.withdrawal_requests(wallet_account_id, withdrawal_policy_id,
    user_id, currency, amount_atomic, fee_atomic, destination_type,
    destination_snapshot, status, idempotency_key)
  select wallet_id, policy_id, member_id, currency, 10000, 0, destination_type,
    '{"display":"synthetic fee-boundary fixture"}'::jsonb, 'REQUESTED',
    'zero-fee-zero-request-' || currency::text from zero_fee_ctx
$probe$, 'zero-fee requests remain insertable at the fee boundary');
update zero_fee_ctx as context set request_id = request.id
from public.withdrawal_requests as request
where request.user_id = context.member_id
  and request.idempotency_key = 'zero-fee-zero-request-' || context.currency::text;

select throws_ok(format($probe$
  update public.withdrawal_requests set fee_atomic = 1 where id = %L::uuid
$probe$, request_id::text), '22023', 'PLATFORM_FEES_PERMANENTLY_DISABLED',
  'an existing ' || currency::text || ' zero-fee request cannot be changed to charge a fee')
from zero_fee_ctx;
select lives_ok($probe$
  update public.withdrawal_requests set fee_atomic = 0, status = 'ADMIN_PROCESSING'
  where id in (select request_id from zero_fee_ctx)
$probe$, 'ordinary zero-fee request status updates pass the new fee boundary');
select ok((select bool_and(request.fee_atomic = 0 and request.status = 'ADMIN_PROCESSING')
  from zero_fee_ctx as context join public.withdrawal_requests as request
    on request.id = context.request_id),
  'both requests preserve fee zero after their status update');
select is((select count(*)::integer from public.withdrawal_requests
  where idempotency_key like 'zero-fee-positive-request-%'), 0,
  'rejected positive-fee inserts leave no request');

select throws_ok($probe$
  update public.withdrawal_policies set fee_atomic = 1
  where id in (select policy_id from zero_fee_ctx)
$probe$, '55000', 'withdrawal_policies is append-only',
  'the new policy insert guard retains historical policy immutability');
select ok((select bool_and(policy.fee_atomic = 0)
  from zero_fee_ctx as context join public.withdrawal_policies as policy
    on policy.id = context.policy_id), 'rejected updates retain zero policy fees');
select ok(not exists(select 1 from zero_fee_history as original
  left join public.withdrawal_policies as policy on policy.id = original.id
  where policy.id is null or to_jsonb(policy) is distinct from original.snapshot),
  'existing withdrawal policies are not rewritten or deleted');
select ok(not exists(select 1 from zero_fee_economy_history as original
  left join app_private.economy_policy_versions as policy on policy.id = original.id
  where policy.id is null or to_jsonb(policy) is distinct from original.snapshot),
  'existing economic policy versions are not rewritten or deleted');

-- Positive future economic proposals for every fee field are tested through
-- the authenticated command/step-up helper in economy_policy_v1.sql.
select ok((select not prosecdef and 'search_path=pg_catalog' = any(proconfig)
  from pg_proc where oid = 'app_private.enforce_permanent_zero_fee()'::regprocedure),
  'fee guard is a fixed-path invoker function');
select ok(not has_function_privilege('anon', 'app_private.enforce_permanent_zero_fee()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.enforce_permanent_zero_fee()', 'EXECUTE')
  and not has_function_privilege('service_role', 'app_private.enforce_permanent_zero_fee()', 'EXECUTE'),
  'the trigger helper introduces no directly callable browser or service API');
select is((select count(*)::integer from pg_trigger
  where not tgisinternal and tgenabled = 'O'
    and tgfoid = 'app_private.enforce_permanent_zero_fee()'::regprocedure
    and tgname in ('withdrawal_policies_zero_fee_insert', 'withdrawal_requests_zero_fee_boundary',
      'withdrawal_external_sends_zero_fee_boundary', 'economy_policy_versions_zero_fee_insert',
      'economy_policy_receipts_zero_fee_insert')), 5,
  'all five fee guards are enabled on the live schema');

select * from finish();
rollback;
