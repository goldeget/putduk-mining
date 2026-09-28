-- WS-05 admin session assert/touch and single-use step-up evidence.

begin;

select plan(12);

create temporary table ws05_admin_ctx (
  user_id uuid primary key,
  auth_session_id text not null,
  fingerprint text not null,
  admin_session_id uuid,
  step_token text
) on commit drop;

insert into ws05_admin_ctx (user_id, auth_session_id, fingerprint)
values (
  'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001',
  'auth-session-ws05-0001',
  encode(extensions.digest('fp-ws05-admin-1', 'sha256'), 'hex')
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  user_id,
  'authenticated',
  'authenticated',
  'ws05-admin@putduk.test',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
from ws05_admin_ctx;

insert into public.user_roles (user_id, role, granted_by)
select user_id, 'ADMIN', user_id from ws05_admin_ctx;

select lives_ok(
  $$
    update ws05_admin_ctx as ctx
    set admin_session_id = public.register_admin_session(
      ctx.user_id,
      ctx.auth_session_id,
      ctx.fingerprint,
      'PutdukAdminTest/1.0',
      1800,
      28800
    )
  $$,
  'register_admin_session creates an app-owned session'
);

select ok(
  (select admin_session_id is not null from ws05_admin_ctx),
  'admin session id is returned'
);

select is(
  public.assert_admin_session(
    (select user_id from ws05_admin_ctx),
    (select auth_session_id from ws05_admin_ctx),
    (select fingerprint from ws05_admin_ctx),
    1800
  ),
  (select admin_session_id from ws05_admin_ctx),
  'assert_admin_session accepts matching fingerprint and touches idle'
);

select throws_ok(
  $$
    select public.assert_admin_session(
      (select user_id from ws05_admin_ctx),
      (select auth_session_id from ws05_admin_ctx),
      encode(extensions.digest('wrong-fingerprint', 'sha256'), 'hex'),
      1800
    )
  $$,
  '42501',
  'ADMIN_SESSION_FINGERPRINT_MISMATCH',
  'fingerprint mismatch is denied'
);

select lives_ok(
  $$
    update ws05_admin_ctx set step_token = 'ws05-step-up-token-single-use-01'
  $$,
  'prepare step-up token'
);

select lives_ok(
  $$
    select public.issue_admin_step_up(
      (select admin_session_id from ws05_admin_ctx),
      (select user_id from ws05_admin_ctx),
      'WITHDRAWAL_OPERATOR',
      (select step_token from ws05_admin_ctx),
      600
    )
  $$,
  'issue_admin_step_up binds grant to session and family'
);

select lives_ok(
  $$
    select public.consume_admin_step_up(
      (select user_id from ws05_admin_ctx),
      (select step_token from ws05_admin_ctx),
      'WITHDRAWAL_OPERATOR',
      'bbbbbbbb-cccc-4ddd-8eee-ffffffff0001'::uuid
    )
  $$,
  'first consume_admin_step_up succeeds'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_id from ws05_admin_ctx),
      (select step_token from ws05_admin_ctx),
      'WITHDRAWAL_OPERATOR',
      'bbbbbbbb-cccc-4ddd-8eee-ffffffff0002'::uuid
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'reusing a consumed step-up grant is denied'
);

select lives_ok(
  $$
    select public.revoke_admin_session(
      (select admin_session_id from ws05_admin_ctx),
      (select user_id from ws05_admin_ctx),
      'TEST_REVOKE'
    )
  $$,
  'revoke_admin_session ends the current app session'
);

select throws_ok(
  $$
    select public.assert_admin_session(
      (select user_id from ws05_admin_ctx),
      (select auth_session_id from ws05_admin_ctx),
      (select fingerprint from ws05_admin_ctx),
      1800
    )
  $$,
  '55000',
  'ADMIN_SESSION_REQUIRED',
  'revoked sessions are rejected by assert'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.assert_admin_session(uuid,text,text,integer)',
    'EXECUTE'
  ),
  'service role may assert admin sessions'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.assert_admin_session(uuid,text,text,integer)',
    'EXECUTE'
  ),
  'authenticated role cannot assert admin sessions directly'
);

select * from finish();

rollback;
