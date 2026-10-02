begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

create temporary table admin_test_context (
  user_id uuid not null,
  role_id uuid,
  request_id uuid not null
);

insert into admin_test_context (user_id, request_id)
values (
  'fd847e8c-890d-430e-ab65-8a8ac3102c92',
  '72fd6d3d-70ba-412a-a30a-b79e722cfb20'
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
  updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select
  user_id,
  'authenticated',
  'authenticated',
  'first-admin@putduk.test',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
from admin_test_context;

select throws_ok(
  format(
    $query$
      select public.bootstrap_first_super_admin(
        %L::uuid,
        'Initial approved operator bootstrap',
        'WRONG_CONFIRMATION',
        %L::uuid
      )
    $query$,
    (select user_id from admin_test_context),
    (select request_id from admin_test_context)
  ),
  '22023',
  'INVALID_ADMIN_BOOTSTRAP',
  'the first admin command requires the exact confirmation literal'
);

update admin_test_context
set role_id = public.bootstrap_first_super_admin(
  user_id,
  'Initial approved operator bootstrap',
  'BOOTSTRAP_FIRST_SUPER_ADMIN',
  request_id
);

select isnt(
  (select role_id from admin_test_context),
  null,
  'the first approved bootstrap returns a role id'
);

select ok(
  (
    select role.role = 'SUPER_ADMIN'
      and role.user_id = context.user_id
      and role.granted_by = context.user_id
      and role.revoked_at is null
    from admin_test_context as context
    join public.user_roles as role on role.id = context.role_id
  ),
  'the command grants exactly one active SUPER_ADMIN role to the target user'
);

select ok(
  (
    select audit.action = 'role.bootstrap_first_super_admin'
      and audit.actor_user_id = context.user_id
      and audit.target_id = context.role_id::text
      and audit.reason = 'Initial approved operator bootstrap'
    from admin_test_context as context
    join public.audit_logs as audit on audit.request_id = context.request_id
  ),
  'the role bootstrap appends the required human-reasoned audit record'
);

select throws_ok(
  format(
    $query$
      select public.bootstrap_first_super_admin(
        %L::uuid,
        'Attempted second operator bootstrap',
        'BOOTSTRAP_FIRST_SUPER_ADMIN',
        'a2c504e7-79c6-4075-9fbe-c63dbfbb2295'::uuid
      )
    $query$,
    (select user_id from admin_test_context)
  ),
  '55000',
  'FIRST_ADMIN_ALREADY_BOOTSTRAPPED',
  'the bootstrap path permanently refuses a second role grant'
);

select * from finish();

rollback;
