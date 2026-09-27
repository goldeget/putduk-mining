begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.withdrawal_destinations'::regclass),
  'withdrawal destinations keep RLS enabled'
);

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.withdrawal_destinations'::regclass),
  'withdrawal destinations keep forced RLS'
);

select ok(
  has_column_privilege('authenticated', 'public.withdrawal_destinations', 'id', 'SELECT'),
  'authenticated can read destination identity'
);

select ok(
  has_column_privilege('authenticated', 'public.withdrawal_destinations', 'display_hint', 'SELECT'),
  'authenticated can read the masked display hint'
);

select ok(
  has_column_privilege('authenticated', 'public.withdrawal_destinations', 'verification_status', 'SELECT'),
  'authenticated can read verification status'
);

select ok(
  not has_column_privilege('authenticated', 'public.withdrawal_destinations', 'encrypted_value', 'SELECT'),
  'authenticated cannot read encrypted destination values'
);

select ok(
  not has_column_privilege('authenticated', 'public.withdrawal_destinations', 'value_fingerprint', 'SELECT'),
  'authenticated cannot read destination fingerprints'
);

select ok(
  not has_column_privilege('authenticated', 'public.withdrawal_destinations', 'user_id', 'SELECT'),
  'authenticated cannot read destination owner identifiers'
);

select ok(
  not has_table_privilege('anon', 'public.withdrawal_destinations', 'SELECT'),
  'anonymous users cannot read withdrawal destinations'
);

select ok(
  not has_column_privilege('anon', 'public.withdrawal_destinations', 'id', 'SELECT'),
  'anonymous users have no column-level destination read path'
);

select ok(
  not has_table_privilege('authenticated', 'public.withdrawal_destinations', 'INSERT'),
  'authenticated users cannot insert destinations directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.withdrawal_destinations', 'UPDATE'),
  'authenticated users cannot update destination verification state directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.withdrawal_destinations', 'DELETE'),
  'authenticated users cannot delete destinations directly'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'withdrawal_destinations'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
  ),
  1,
  'exactly one authenticated SELECT policy exists for withdrawal destinations'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'withdrawal_destinations'
      and policyname = 'withdrawal_destinations_select_own_safe_projection'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%user_id%'
  ),
  1,
  'authenticated safe projection is constrained to the current owner'
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
) values
  (
    '37d97653-71a7-4788-b9ab-ea04889c0971',
    'authenticated',
    'authenticated',
    'destination-owner-a@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '169d886b-7545-4aa9-82a3-23bf14f2cd72',
    'authenticated',
    'authenticated',
    'destination-owner-b@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  );

insert into public.withdrawal_destinations (
  id,
  user_id,
  destination_type,
  encrypted_value,
  value_fingerprint,
  display_hint,
  protection_until
) values
  (
    '66217d61-cc16-4669-a0a6-05f919d87e37',
    '37d97653-71a7-4788-b9ab-ea04889c0971',
    'KRW_BANK',
    decode('01', 'hex'),
    'fixture-owner-a',
    'KB · ••••1234',
    statement_timestamp() + interval '24 hours'
  ),
  (
    'd13e193f-30fd-431e-99fe-a9be77d1132f',
    '169d886b-7545-4aa9-82a3-23bf14f2cd72',
    'KRW_BANK',
    decode('02', 'hex'),
    'fixture-owner-b',
    'SHINHAN · ••••5678',
    statement_timestamp() + interval '24 hours'
  );

select set_config(
  'request.jwt.claim.sub',
  '37d97653-71a7-4788-b9ab-ea04889c0971',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.withdrawal_destinations),
  1,
  'owner A sees exactly their own destination through RLS'
);

select is(
  (
    select count(*)::integer
    from public.withdrawal_destinations
    where id = 'd13e193f-30fd-431e-99fe-a9be77d1132f'
  ),
  0,
  'owner A cannot select owner B destination by exact ID'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '169d886b-7545-4aa9-82a3-23bf14f2cd72',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.withdrawal_destinations),
  1,
  'owner B sees exactly their own destination through RLS'
);

reset role;

select * from finish();
rollback;
