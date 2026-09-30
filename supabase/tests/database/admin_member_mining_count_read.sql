begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(
  has_table_privilege('service_role', 'public.mining_sessions', 'SELECT'),
  'service_role may SELECT mining_sessions for Member 360 count'
);

select ok(
  not has_table_privilege('service_role', 'public.mining_sessions', 'INSERT'),
  'service_role cannot INSERT mining_sessions'
);

select ok(
  not has_table_privilege('service_role', 'public.mining_sessions', 'UPDATE'),
  'service_role cannot UPDATE mining_sessions'
);

select ok(
  not has_table_privilege('service_role', 'public.mining_sessions', 'DELETE'),
  'service_role cannot DELETE mining_sessions'
);

select ok(
  not has_table_privilege('authenticated', 'public.mining_sessions', 'INSERT'),
  'authenticated cannot INSERT mining_sessions'
);

select ok(
  not has_table_privilege('authenticated', 'public.mining_sessions', 'UPDATE'),
  'authenticated cannot UPDATE mining_sessions'
);

select ok(
  not has_table_privilege('authenticated', 'public.mining_sessions', 'DELETE'),
  'authenticated cannot DELETE mining_sessions'
);

select ok(
  not has_table_privilege('anon', 'public.mining_sessions', 'SELECT'),
  'anon cannot SELECT mining_sessions'
);

select * from finish();

rollback;
