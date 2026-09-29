begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260928232923'
  ),
  'mining fixture grant migration is absent from schema history'
);

select ok(
  not has_table_privilege('authenticated', 'public.mining_sessions', 'INSERT'),
  'authenticated clients cannot insert mining sessions'
);

select ok(
  not has_table_privilege('anon', 'public.mining_sessions', 'INSERT'),
  'anonymous clients cannot insert mining sessions'
);

select ok(
  not has_table_privilege('service_role', 'public.mining_sessions', 'INSERT'),
  'service role has no test-only mining session insert'
);

select ok(
  not has_table_privilege('service_role', 'public.mining_farms', 'INSERT'),
  'service role has no test-only mining farm insert'
);

select ok(
  not has_table_privilege('service_role', 'public.mining_equipment', 'INSERT'),
  'service role has no test-only mining equipment insert'
);

select ok(
  not has_table_privilege('service_role', 'public.world_rules', 'INSERT'),
  'service role has no test-only world rule insert'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.world_rule_versions',
    'INSERT'
  ),
  'service role has no test-only world rule version insert'
);

select ok(
  not has_column_privilege(
    'service_role',
    'public.asset_worlds',
    'is_active',
    'UPDATE'
  ),
  'service role has no test-only world visibility update'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.mining_active_session_snapshots',
    'SELECT'
  ),
  'service role has no test-only mining snapshot select'
);

select * from finish();

rollback;
