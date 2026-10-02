begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select ok(
  has_table_privilege('authenticated', 'public.wallet_balance_snapshots', 'SELECT'),
  'authenticated users can query the RLS-backed wallet snapshot used by PUTDUK AI'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'INSERT'),
  'PUTDUK AI cannot turn an authenticated client into a wallet mutation path'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)',
    'EXECUTE'
  ),
  'AI request admission remains a server-only command'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.begin_ai_request_v2(uuid,uuid,text,jsonb,text,text,integer,integer,text,text,text,text,text)',
    'EXECUTE'
  ),
  'the truthful AI route-audit admission is executable by the service role'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_ai_request_v2(uuid,uuid,text,jsonb,text,text,integer,integer,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot forge an AI route or tool audit record'
);

select ok(
  not has_table_privilege('service_role', 'public.ai_requests', 'INSERT'),
  'the service role cannot bypass AI admission with a direct request insert'
);

select ok(
  not has_table_privilege('service_role', 'public.ai_usage', 'INSERT'),
  'the service role cannot bypass AI completion with a direct usage insert'
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
  updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values
  (
    '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
    'authenticated',
    'authenticated',
    'ai-tool-owner-a@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '5a9cc1cc-8a52-4f2f-8d08-2a4d63c7c518',
    'authenticated',
    'authenticated',
    'ai-tool-owner-b@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  );

select throws_ok(
  $query$
    select * from public.begin_ai_request_v2(
      '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00'::uuid,
      '2e49aa9a-6785-4389-9267-16809618f104'::uuid,
      repeat('c', 64),
      '{"character_count": 12}'::jsonb,
      'approved-model',
      '2026.09-foundation',
      5,
      100,
      'general_safe',
      'general_safe_question',
      'ACCOUNT_STATE',
      'GENERAL_SAFE',
      null
    )
  $query$,
  '22023',
  'INVALID_AI_ROUTE_AUDIT',
  'a non-tool route cannot claim the privileged account-state context'
);

insert into public.wallet_accounts (id, user_id, currency) values
  (
    '4deef823-98ac-4ad9-b162-b4771b26e50c',
    '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
    'KRW'
  ),
  (
    '0f17e745-ae90-4e8f-93ec-a68a6a553f1a',
    '5a9cc1cc-8a52-4f2f-8d08-2a4d63c7c518',
    'KRW'
  );

insert into public.deposit_requests (
  id,
  user_id,
  currency,
  amount_atomic,
  idempotency_key
) values
  (
    'c0b281ad-b3c5-4728-ac13-31a0d1308fac',
    '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
    'KRW',
    1000,
    'ai-tool-owner-a-deposit'
  ),
  (
    '098d0b8d-f9dc-458a-94c4-75cde6bc450d',
    '5a9cc1cc-8a52-4f2f-8d08-2a4d63c7c518',
    'KRW',
    9000,
    'ai-tool-owner-b-deposit'
  );

insert into public.kyc_cases (user_id) values
  ('76a97376-0fc1-4c70-9cf4-e0a39cfd4f00'),
  ('5a9cc1cc-8a52-4f2f-8d08-2a4d63c7c518');

set local role service_role;

select is(
  (
    select is_new
    from public.begin_ai_request_v2(
      '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
      'c5f32f37-a981-4de5-a059-292147290149',
      repeat('d', 64),
      '{"character_count": 12, "route_kind": "tool"}'::jsonb,
      'putduk-owned-read-tool-v1',
      '2026.09-foundation',
      5,
      100,
      'tool',
      'account_wallet_summary',
      'ACCOUNT_STATE',
      'ACCOUNT_STATE',
      'wallet.summary'
    )
  ),
  true,
  'the service role can execute the first owned-tool admission'
);

select lives_ok(
  $query$
    select public.complete_ai_request(
      (
        select id
        from public.ai_requests
        where client_message_id = 'c5f32f37-a981-4de5-a059-292147290149'
      ),
      '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
      'provider-request-1',
      'approved-model',
      20,
      8,
      0,
      42
    )
  $query$,
  'the service role can complete an admitted AI request'
);

select is(
  (
    select is_new
    from public.begin_ai_request_v2(
      '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
      '2ec09727-5c6c-4fe5-91c5-b415b43a497d',
      repeat('f', 64),
      '{"character_count": 9, "route_kind": "general_safe"}'::jsonb,
      'approved-model',
      '2026.09-foundation',
      5,
      100,
      'general_safe',
      'general_safe_question',
      'GENERAL_SAFE',
      'GENERAL_SAFE',
      null
    )
  ),
  true,
  'the service role can execute a second validated admission'
);

select lives_ok(
  $query$
    select public.fail_ai_request(
      (
        select id
        from public.ai_requests
        where client_message_id = '2ec09727-5c6c-4fe5-91c5-b415b43a497d'
      ),
      '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
      'FAILED',
      'PROVIDER_UNAVAILABLE'
    )
  $query$,
  'the service role can fail an admitted AI request without direct table writes'
);

select lives_ok(
  $query$
    insert into public.ai_cache (
      cache_key,
      knowledge_version,
      response_payload,
      expires_at
    ) values (
      repeat('e', 64),
      '2026.09-foundation',
      '{"answer":"safe cached fact"}'::jsonb,
      statement_timestamp() + interval '5 minutes'
    )
    on conflict (cache_key) do update
    set
      response_payload = excluded.response_payload,
      expires_at = excluded.expires_at
  $query$,
  'the service role has only the cache upsert path needed by the server'
);

reset role;

create temporary table ai_tool_admission as
select id as request_id
from public.ai_requests
where client_message_id = 'c5f32f37-a981-4de5-a059-292147290149';

select ok(
  (
    select route_kind = 'tool'
      and route_key = 'account_wallet_summary'
      and context_scope = 'ACCOUNT_STATE'
      and tool_name = 'wallet.summary'
      and safety_classification = 'ACCOUNT_STATE'
      and status = 'SUCCEEDED'
      and exists (
        select 1
        from public.ai_usage
        where request_id = (select request_id from ai_tool_admission)
          and input_tokens = 20
          and output_tokens = 8
      )
    from public.ai_requests
    where id = (select request_id from ai_tool_admission)
  ),
  'the AI audit and usage rows record the truthful completed tool boundary'
);

select ok(
  (
    select status = 'FAILED'
      and error_code = 'PROVIDER_UNAVAILABLE'
    from public.ai_requests
    where client_message_id = '2ec09727-5c6c-4fe5-91c5-b415b43a497d'
  ),
  'the terminal failure is persisted without exposing direct request updates'
);

select ok(
  exists (
    select 1
    from public.ai_cache
    where cache_key = repeat('e', 64)
      and response_payload = '{"answer":"safe cached fact"}'::jsonb
  ),
  'the server cache write is readable after the service-role call'
);

select set_config(
  'request.jwt.claim.sub',
  '76a97376-0fc1-4c70-9cf4-e0a39cfd4f00',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.wallet_balance_snapshots),
  1,
  'the AI wallet read model exposes only the current authenticated owner'
);

select is(
  (
    select count(*)::integer
    from public.wallet_balance_snapshots
    where user_id = '5a9cc1cc-8a52-4f2f-8d08-2a4d63c7c518'
  ),
  0,
  'a selected cross-user wallet ID cannot escape RLS'
);

select is(
  (select count(*)::integer from public.deposit_requests),
  1,
  'the AI deposit-status source exposes only the current owner'
);

select is(
  (select count(*)::integer from public.kyc_cases),
  1,
  'the AI KYC-status source exposes only the current owner'
);

reset role;

select * from finish();

rollback;
