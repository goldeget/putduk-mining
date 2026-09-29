begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  has_table_privilege('service_role', 'public.mining_sessions', 'INSERT'),
  'service role can seed mining session read fixtures'
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
  has_table_privilege('service_role', 'public.world_rule_versions', 'INSERT'),
  'service role can anchor a fixture rule version'
);

select ok(
  not has_table_privilege('authenticated', 'public.world_rule_versions', 'INSERT'),
  'authenticated clients cannot insert world rule versions'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.asset_worlds',
    'is_active',
    'UPDATE'
  ),
  'service role can toggle world visibility for empty-directory evidence'
);

select * from finish();

rollback;
