begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  'every public table has RLS enabled'
);

select ok(
  (
    select bool_and(c.relforcerowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  'every public table forces RLS for defense in depth'
);

select ok(
  not has_table_privilege('anon', 'public.wallet_ledger', 'SELECT'),
  'anonymous clients cannot read the wallet ledger'
);

select ok(
  has_table_privilege('authenticated', 'public.wallet_ledger', 'SELECT'),
  'authenticated clients may read rows filtered by wallet RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'INSERT'),
  'authenticated clients cannot insert wallet ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'UPDATE'),
  'authenticated clients cannot update wallet ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'DELETE'),
  'authenticated clients cannot delete wallet ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.trial_ledger', 'INSERT'),
  'authenticated clients cannot insert trial ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.mining_settlements', 'INSERT'),
  'authenticated clients cannot create mining settlements'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_update_own'
      and qual is not null
      and with_check is not null
  ),
  'profile update policy constrains old and new rows'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'user_settings_update_own'
      and qual is not null
      and with_check is not null
  ),
  'settings update policy constrains old and new rows'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'wallet_ledger',
        'trial_ledger',
        'mining_settlements',
        'mining_settlement_segments'
      )
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'asset ledgers and settlements have no client mutation policies'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prosecdef
  ),
  'application schemas contain no SECURITY DEFINER functions'
);

select ok(
  (
    select count(*) = 4
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'world_rule_versions_prevent_update_delete',
        'trial_reward_curves_prevent_update_delete',
        'trial_reward_curve_points_prevent_update_delete',
        'mining_equipment_history_prevent_delete'
      )
  ),
  'versioned economy inputs and equipment history are mutation protected'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname = 'trial_programs_validate_before_enable'
  ),
  'trial programs must pass curve validation before enablement'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT'),
  'authenticated clients cannot read Web Push credentials'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT'),
  'authenticated clients cannot write Web Push credentials directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.upsert_push_subscription(uuid,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'service role can register a push subscription atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_push_subscription(uuid,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the push registration command directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.revoke_push_subscription(uuid,text)',
    'EXECUTE'
  ),
  'service role can revoke a push subscription atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.revoke_push_subscription(uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the push revocation command directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.analytics_events', 'INSERT'),
  'analytics events are ingested by the server only'
);

select ok(
  to_regclass('public.analytics_events_request_id_unique') is not null,
  'analytics request ids have a database deduplication boundary'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_requests', 'INSERT'),
  'AI requests are orchestrated by the server only'
);

select ok(
  not has_table_privilege('anon', 'public.event_rules', 'SELECT'),
  'internal event rule payloads are not exposed publicly'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_cache', 'SELECT'),
  'AI cache rows are server-only'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'notifications_mark_own_read'
      and qual is not null
      and with_check is not null
  ),
  'notification read updates constrain old and new rows'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_preferences'
      and policyname = 'notification_preferences_update_own'
      and qual is not null
      and with_check is not null
  ),
  'notification preference updates constrain old and new rows'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trust_versions'
      and policyname = 'trust_versions_read_public'
      and cmd = 'SELECT'
  ),
  'published trust versions have an explicit public read policy'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'DELETE'
  ),
  'client roles have no direct DELETE grants on public tables'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'INSERT'
  ),
  'client roles have no direct INSERT grants on public tables'
);

select ok(
  has_function_privilege('service_role', 'public.bootstrap_user(uuid)', 'EXECUTE'),
  'service role can execute bootstrap_user'
);
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_user(uuid)', 'EXECUTE'),
  'authenticated clients cannot execute bootstrap_user'
);

select ok(
  has_function_privilege('service_role', 'public.start_trial(uuid,text)', 'EXECUTE'),
  'service role can execute start_trial'
);
select ok(
  not has_function_privilege('authenticated', 'public.start_trial(uuid,text)', 'EXECUTE'),
  'authenticated clients cannot execute start_trial'
);

select ok(
  has_function_privilege('service_role', 'public.settle_trial(uuid,text)', 'EXECUTE'),
  'service role can execute settle_trial'
);
select ok(
  not has_function_privilege('authenticated', 'public.settle_trial(uuid,text)', 'EXECUTE'),
  'authenticated clients cannot execute settle_trial'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_deposit_request(uuid,public.currency_code,bigint,text)',
    'EXECUTE'
  ),
  'service role can execute create_deposit_request'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_deposit_request(uuid,public.currency_code,bigint,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute create_deposit_request'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)',
    'EXECUTE'
  ),
  'service role can execute create_withdrawal_request'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute create_withdrawal_request'
);

select ok(
  not has_table_privilege('authenticated', 'public.withdrawal_policies', 'SELECT'),
  'withdrawal policies are exposed through bounded server views only'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname = 'withdrawal_policies_prevent_update_delete'
  ),
  'withdrawal policy versions are append-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute approve_deposit_request'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute approve_deposit_request'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_mining_settlement(uuid,uuid,timestamp with time zone,timestamp with time zone,bigint,public.currency_code,jsonb,text)',
    'EXECUTE'
  ),
  'service role can execute record_mining_settlement'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_mining_settlement(uuid,uuid,timestamp with time zone,timestamp with time zone,bigint,public.currency_code,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute record_mining_settlement'
);

select ok(
  (
    select count(*) = 3
      and bool_and('security_invoker=true' = any (coalesce(view.reloptions, '{}'::text[])))
    from pg_class as view
    join pg_namespace as namespace on namespace.oid = view.relnamespace
    where namespace.nspname = 'public'
      and view.relname in (
        'wallet_balance_snapshots',
        'trial_account_snapshots',
        'mining_active_session_snapshots'
      )
  ),
  'all user read models are security-invoker views'
);

select ok(
  not has_table_privilege('anon', 'public.wallet_balance_snapshots', 'SELECT'),
  'anonymous clients cannot read wallet balance snapshots'
);

select ok(
  has_table_privilege('authenticated', 'public.wallet_balance_snapshots', 'SELECT'),
  'authenticated clients can read their RLS-filtered wallet snapshots'
);

select ok(
  not has_table_privilege('anon', 'public.trial_account_snapshots', 'SELECT'),
  'anonymous clients cannot read trial account snapshots'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.mining_active_session_snapshots',
    'SELECT'
  ),
  'authenticated clients can read their RLS-filtered active mining snapshot'
);

select ok(
  to_regclass('public.ai_requests_user_client_message_unique') is not null,
  'AI client message ids have a per-user database deduplication boundary'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)',
    'EXECUTE'
  ),
  'service role can admit AI requests'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot admit AI requests directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_ai_request(uuid,uuid,text,text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'service role can complete AI requests with usage'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_ai_request(uuid,uuid,text,text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot complete AI requests directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.fail_ai_request(uuid,uuid,public.ai_request_status,text)',
    'EXECUTE'
  ),
  'service role can record AI failures and cancellations'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.fail_ai_request(uuid,uuid,public.ai_request_status,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot record AI terminal states directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_first_super_admin(uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute the one-time first admin bootstrap'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.bootstrap_first_super_admin(uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bootstrap the first admin'
);

select * from finish();

rollback;
