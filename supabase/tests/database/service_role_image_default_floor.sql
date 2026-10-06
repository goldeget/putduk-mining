-- service_role 이미지 기본 권한이 다시 붙으면 실패한다.
-- 실효 권한(has_*_privilege)과 set role service_role 실행 결과를 같이 본다.
-- 위험한 쓰기는 이 파일의 트랜잭션 안에서만 하고 rollback 한다.
-- supabase test db 는 공유 데이터베이스가 아닌 shadow 데이터베이스에서 실행한다.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select ok(
  not exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and pg_get_userbyid(c.relowner) <> 'postgres'
  ),
  'public tables are owned by postgres'
);

select ok(
  not exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app_private')
      and c.relkind in ('r', 'v')
      and (
        has_table_privilege('service_role', c.oid, 'DELETE')
        or has_table_privilege('service_role', c.oid, 'TRUNCATE')
        or has_table_privilege('service_role', c.oid, 'REFERENCES')
        or has_table_privilege('service_role', c.oid, 'TRIGGER')
        or has_table_privilege('service_role', c.oid, 'MAINTAIN')
      )
  ),
  'service_role has no delete, truncate, references, trigger, or maintain on app relations'
);

select ok(
  (
    select coalesce(array_agg(c.relname order by c.relname), '{}'::name[])
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v')
      and has_table_privilege('service_role', c.oid, 'INSERT')
  )
  = array[
    'admin_sessions',
    'admin_step_up_grants',
    'ai_answer_sources',
    'ai_conversation_summaries',
    'ai_conversations',
    'ai_feedback',
    'ai_messages',
    'ai_tool_calls',
    'analytics_events',
    'audit_logs',
    'deposit_requests',
    'event_consumer_deliveries',
    'funding_principal_lots',
    'funding_principal_recovery_allocations',
    'funding_principal_recovery_releases',
    'funding_principal_revisions',
    'kyc_cases',
    'kyc_document_view_audit',
    'kyc_status_history',
    'kyc_submissions',
    'ledger_accounts',
    'ledger_entries',
    'ledger_transactions',
    'member_lifecycle_states',
    'member_timeline_events',
    'mining_reward_withdrawal_reservations',
    'money_source_movements',
    'notification_preferences',
    'outbox_events',
    'push_subscriptions',
    'reconciliation_mismatches',
    'reconciliation_runs',
    'safe_mode_controls',
    'security_events',
    'signup_phone_history',
    'system_job_attempts',
    'system_jobs',
    'transaction_receipts',
    'trial_accounts',
    'trial_completions',
    'trial_ledger',
    'trial_programs',
    'trial_qualification_snapshots',
    'trial_reward_conversions',
    'trial_reward_curve_points',
    'trial_reward_curves',
    'trial_sessions',
    'usdt_deposit_instruction_events',
    'usdt_deposit_instructions',
    'usdt_manual_deposits',
    'user_profiles',
    'user_roles',
    'user_settings',
    'wallet_accounts',
    'wallet_ledger',
    'withdrawal_destination_history',
    'withdrawal_destinations',
    'withdrawal_external_sends',
    'withdrawal_logical_requests',
    'withdrawal_policies',
    'withdrawal_requests'
  ]::name[],
  'service_role table insert matches the invoker and worker allowlist'
);

select ok(
  (
    select coalesce(array_agg(c.relname order by c.relname), '{}'::name[])
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v')
      and has_table_privilege('service_role', c.oid, 'UPDATE')
  )
  = array[
    'admin_sessions',
    'admin_step_up_grants',
    'deposit_requests',
    'kyc_cases',
    'ledger_accounts',
    'ledger_transactions',
    'member_lifecycle_states',
    'notification_preferences',
    'outbox_events',
    'push_subscriptions',
    'reconciliation_mismatches',
    'reconciliation_runs',
    'safe_mode_controls',
    'system_job_attempts',
    'system_jobs',
    'transaction_receipts',
    'trial_accounts',
    'trial_programs',
    'trial_reward_conversions',
    'trial_sessions',
    'usdt_deposit_instructions',
    'usdt_manual_deposits',
    'user_profiles',
    'user_roles',
    'user_settings',
    'wallet_accounts',
    'withdrawal_destinations',
    'withdrawal_logical_requests',
    'withdrawal_policies',
    'withdrawal_requests'
  ]::name[],
  'service_role table update matches the invoker and worker allowlist'
);

select ok(
  (
    select coalesce(array_agg(c.relname order by c.relname), '{}'::name[])
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v')
      and has_table_privilege('service_role', c.oid, 'SELECT')
  )
  = array[
    'admin_sessions',
    'admin_step_up_grants',
    'ai_answer_sources',
    'ai_conversation_summaries',
    'ai_conversations',
    'ai_feedback',
    'ai_messages',
    'ai_requests',
    'ai_tool_calls',
    'analytics_events',
    'asset_worlds',
    'audit_logs',
    'block_rules',
    'crypto_withdrawals',
    'deposit_requests',
    'event_consumer_deliveries',
    'event_participants',
    'funding_principal_lots',
    'funding_principal_recovery_allocations',
    'funding_principal_recovery_releases',
    'funding_principal_revisions',
    'kyc_cases',
    'kyc_document_view_audit',
    'kyc_status_history',
    'kyc_submissions',
    'ledger_accounts',
    'ledger_entries',
    'ledger_transactions',
    'member_lifecycle_states',
    'member_timeline_events',
    'mining_reward_credits',
    'mining_reward_withdrawal_reservations',
    'mining_sessions',
    'money_source_movements',
    'money_source_summaries',
    'notification_preferences',
    'notifications',
    'outbox_events',
    'push_subscriptions',
    'reconciliation_mismatches',
    'reconciliation_runs',
    'risk_flags',
    'safe_mode_controls',
    'security_events',
    'signup_phone_history',
    'system_job_attempts',
    'system_jobs',
    'transaction_receipts',
    'trial_accounts',
    'trial_completions',
    'trial_ledger',
    'trial_programs',
    'trial_qualification_snapshots',
    'trial_reward_conversions',
    'trial_reward_curve_points',
    'trial_reward_curves',
    'trial_sessions',
    'usdt_deposit_instruction_events',
    'usdt_deposit_instructions',
    'usdt_manual_deposits',
    'user_consent_records',
    'user_identity_profiles',
    'user_profiles',
    'user_roles',
    'user_settings',
    'wallet_accounts',
    'wallet_balance_snapshots',
    'wallet_ledger',
    'withdrawal_destination_history',
    'withdrawal_destination_step_ups',
    'withdrawal_destinations',
    'withdrawal_external_sends',
    'withdrawal_logical_requests',
    'withdrawal_policies',
    'withdrawal_requests'
  ]::name[],
  'service_role table select matches explicit read grants'
);

select ok(
  not exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    join pg_attribute as a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attnum > 0
      and not a.attisdropped
      and has_column_privilege('service_role', c.oid, a.attnum, 'INSERT')
      and not has_table_privilege('service_role', c.oid, 'INSERT')
      and c.relname not in (
        'ai_cache',
        'ai_requests',
        'ai_usage',
        'withdrawal_destination_step_ups'
      )
  ),
  'column insert without table insert stays on the reviewed AI and step-up tables'
);

select ok(
  has_column_privilege('service_role', 'public.ai_requests', 'user_id', 'INSERT')
  and not has_table_privilege('service_role', 'public.ai_requests', 'INSERT'),
  'AI admission keeps column insert and not table insert'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.withdrawal_destination_step_ups',
    'status',
    'UPDATE'
  )
  and not has_table_privilege(
    'service_role',
    'public.withdrawal_destination_step_ups',
    'UPDATE'
  ),
  'destination step-up keeps column update and not table update'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  ),
  'deposit approval execute is service_role only'
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
    'a1100001-1030-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'priv-floor-member@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    'a1100001-1030-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'priv-floor-operator@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  );

select ok(
  not exists (
    select 1
    from auth.users
    where email in (
      'priv-floor-member@putduk.test',
      'priv-floor-operator@putduk.test'
    )
      and (
        confirmation_token is null
        or recovery_token is null
        or email_change is null
        or email_change_token_new is null
      )
  ),
  'direct auth inserts keep GoTrue token strings'
);

insert into public.user_roles (user_id, role, granted_by)
values (
  'a1100001-1030-4000-8000-000000000002',
  'ADMIN',
  'a1100001-1030-4000-8000-000000000002'
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
  approved_by
) values (
  'KRW',
  'BANK_ACCOUNT',
  91030,
  true,
  1000,
  0,
  '{"country":"KR"}'::jsonb,
  statement_timestamp() - interval '1 hour',
  'a1100001-1030-4000-8000-000000000002'
);

insert into public.outbox_events (
  event_type,
  schema_version,
  aggregate_type,
  aggregate_id,
  payload,
  correlation_id,
  request_id,
  idempotency_key
) values (
  'PRIV_FLOOR_PROBE.v1',
  1,
  'PRIV_FLOOR',
  'a1100001-1030-4000-8000-000000000004',
  '{}'::jsonb,
  'a1100001-1030-4000-8000-000000000005',
  'a1100001-1030-4000-8000-000000000006',
  'priv-floor-outbox-0001'
);

set local role service_role;

select throws_ok(
  'delete from public.ledger_entries',
  '42501',
  'permission denied for table ledger_entries',
  'service_role delete on ledger_entries is denied at execution'
);

select throws_ok(
  'truncate table public.wallet_ledger',
  '42501',
  'permission denied for table wallet_ledger',
  'service_role truncate on wallet_ledger is denied at execution'
);

select throws_ok(
  'lock table public.ledger_entries in share mode',
  '42501',
  'permission denied for table ledger_entries',
  'service_role share lock on ledger_entries is denied without maintain'
);

create temporary table priv_floor_ids (
  deposit_id uuid,
  ledger_id uuid,
  withdrawal_id uuid
) on commit drop;

insert into priv_floor_ids (deposit_id)
select public.create_deposit_request(
  'a1100001-1030-4000-8000-000000000001',
  'KRW',
  50000,
  'priv-floor-deposit-0001'
);

select is(
  (
    select status::text
    from public.deposit_requests
    where id = (select deposit_id from priv_floor_ids)
  ),
  'AWAITING_TRANSFER',
  'service_role can open a KRW deposit request'
);

update priv_floor_ids
set ledger_id = public.approve_deposit_request(
  deposit_id,
  'a1100001-1030-4000-8000-000000000002',
  50000,
  'priv-floor-ledger-0001',
  'privilege floor deposit approval',
  'a1100001-1030-4000-8000-000000000003'
);

select is(
  (
    select coalesce(sum(
      case
        when direction = 'CREDIT' then amount_atomic
        else -amount_atomic
      end
    ), 0)::bigint
    from public.wallet_ledger
    where user_id = 'a1100001-1030-4000-8000-000000000001'
  ),
  50000::bigint,
  'service_role deposit approval writes the ledger credit'
);

select throws_ok(
  $legacy$
  select public.create_withdrawal_request(
    'a1100001-1030-4000-8000-000000000001',
    (
      select id
      from public.wallet_accounts
      where user_id = 'a1100001-1030-4000-8000-000000000001'
        and currency = 'KRW'
    ),
    (
      select id
      from public.withdrawal_policies
      where version = 91030
        and currency = 'KRW'
        and destination_type = 'BANK_ACCOUNT'
    ),
    10000,
    'BANK_ACCOUNT',
    '{"display":"***-**-1234","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
    'priv-floor-withdrawal-0001'
  )
  $legacy$,
  '42501',
  'permission denied for function create_withdrawal_request',
  'service_role cannot execute the retired writer even with a funded wallet'
);

select lives_ok(
  'select id from public.block_rules limit 1',
  'service_role can read block rules for the restrictions screen'
);

select lives_ok(
  'select id from public.event_participants limit 1',
  'service_role can read event participation for the member screen'
);

select lives_ok(
  'select id from public.notifications limit 1',
  'service_role can read notifications for the member screen'
);

select isnt(
  public.upsert_push_subscription(
    'a1100001-1030-4000-8000-000000000001',
    'https://push.example.test/priv-floor',
    repeat('a', 40),
    repeat('b', 16),
    null,
    'priv-floor'
  ),
  null,
  'service_role can save a push subscription'
);

select is(
  (
    select count(*)::integer
    from public.claim_outbox_events('priv-floor-worker', 10, 60)
    where idempotency_key = 'priv-floor-outbox-0001'
  ),
  1,
  'service_role worker can claim a pending outbox event'
);

reset role;

select ok(
  not exists (
    select 1
    from pg_default_acl as d
    left join pg_namespace as n on n.oid = d.defaclnamespace
    where pg_get_userbyid(d.defaclrole) = 'postgres'
      and coalesce(n.nspname, '') = 'public'
      and d.defaclobjtype in ('r', 'f', 'S')
      and d.defaclacl::text like '%service_role=%'
  ),
  'postgres public defaults do not grant service_role on new tables, functions, or sequences'
);

set local role postgres;

create table public.priv_floor_probe (
  id integer primary key
);

create function public.priv_floor_probe_fn()
returns integer
language sql
as $$ select 1 $$;

create sequence public.priv_floor_probe_seq;

reset role;

select ok(
  not has_table_privilege('service_role', 'public.priv_floor_probe', 'SELECT')
  and not has_table_privilege('service_role', 'public.priv_floor_probe', 'INSERT')
  and not has_table_privilege('service_role', 'public.priv_floor_probe', 'UPDATE')
  and not has_table_privilege('service_role', 'public.priv_floor_probe', 'DELETE')
  and not has_table_privilege('service_role', 'public.priv_floor_probe', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.priv_floor_probe', 'MAINTAIN'),
  'a new postgres-owned public table does not grant service_role'
);

select ok(
  not has_function_privilege('public', 'public.priv_floor_probe_fn()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.priv_floor_probe_fn()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.priv_floor_probe_fn()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.priv_floor_probe_fn()', 'EXECUTE'),
  'a new postgres-owned public function is not executable by public, anon, authenticated, or service_role'
);

select ok(
  not has_sequence_privilege('service_role', 'public.priv_floor_probe_seq', 'USAGE')
  and not has_sequence_privilege('service_role', 'public.priv_floor_probe_seq', 'SELECT')
  and not has_sequence_privilege('service_role', 'public.priv_floor_probe_seq', 'UPDATE'),
  'a new postgres-owned sequence does not grant service_role usage, select, or update'
);

grant usage on sequence public.priv_floor_probe_seq to service_role;

set local role service_role;

select lives_ok(
  $$ select nextval('public.priv_floor_probe_seq') $$,
  'usage alone lets service_role take the next sequence value'
);

select throws_ok(
  $$ select setval('public.priv_floor_probe_seq', 1) $$,
  '42501',
  'permission denied for sequence priv_floor_probe_seq',
  'usage does not let service_role rewrite the sequence'
);

select * from finish();

rollback;
