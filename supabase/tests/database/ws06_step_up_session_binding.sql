-- WS-06: step-up grant는 현재 admin session과 같을 때만 소비된다.

begin;

select plan(29);

create temporary table ws06_bind (
  user_a uuid not null,
  user_b uuid not null,
  session_a uuid,
  session_b uuid,
  session_revoked uuid,
  session_idle uuid,
  session_other uuid
) on commit drop;

insert into ws06_bind (user_a, user_b)
values (
  '11111111-1111-4111-8111-111111111601',
  '22222222-2222-4222-8222-222222222601'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111601',
    'authenticated',
    'authenticated',
    'ws06-bind-a@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '22222222-2222-4222-8222-222222222601',
    'authenticated',
    'authenticated',
    'ws06-bind-b@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  );

insert into public.user_roles (user_id, role, granted_by)
values
  (
    '11111111-1111-4111-8111-111111111601',
    'ADMIN',
    '11111111-1111-4111-8111-111111111601'
  ),
  (
    '22222222-2222-4222-8222-222222222601',
    'ADMIN',
    '22222222-2222-4222-8222-222222222601'
  );

update ws06_bind
set session_a = public.register_admin_session(
  user_a,
  'auth-ws06-bind-a',
  encode(extensions.digest('fp-ws06-bind-a', 'sha256'), 'hex'),
  'PutdukAdminTest/1.0',
  1800,
  28800
);

update ws06_bind
set session_b = public.register_admin_session(
  user_a,
  'auth-ws06-bind-b',
  encode(extensions.digest('fp-ws06-bind-b', 'sha256'), 'hex'),
  'PutdukAdminTest/1.0',
  1800,
  28800
);

update ws06_bind
set session_revoked = public.register_admin_session(
  user_a,
  'auth-ws06-bind-revoked',
  encode(extensions.digest('fp-ws06-bind-revoked', 'sha256'), 'hex'),
  'PutdukAdminTest/1.0',
  1800,
  28800
);

update ws06_bind
set session_idle = public.register_admin_session(
  user_a,
  'auth-ws06-bind-idle',
  encode(extensions.digest('fp-ws06-bind-idle', 'sha256'), 'hex'),
  'PutdukAdminTest/1.0',
  1800,
  28800
);

update ws06_bind
set session_other = public.register_admin_session(
  user_b,
  'auth-ws06-bind-other',
  encode(extensions.digest('fp-ws06-bind-other', 'sha256'), 'hex'),
  'PutdukAdminTest/1.0',
  1800,
  28800
);

select public.issue_admin_step_up(
  (select session_a from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-match-token-0001',
  600
);

select public.issue_admin_step_up(
  (select session_a from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-cross-token-0001',
  600
);

select public.issue_admin_step_up(
  (select session_a from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-other-token-0001',
  600
);

select public.issue_admin_step_up(
  (select session_a from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-family-token-0001',
  600
);

select public.issue_admin_step_up(
  (select session_a from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-expire-token-0001',
  600
);

select public.issue_admin_step_up(
  (select session_revoked from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-revoke-token-0001',
  600
);

select public.issue_admin_step_up(
  (select session_idle from ws06_bind),
  (select user_a from ws06_bind),
  'WITHDRAWAL_OPERATOR',
  'ws06-bind-idle-token-0001',
  600
);

select ok(
  public.consume_admin_step_up(
    (select user_a from ws06_bind),
    'ws06-bind-match-token-0001',
    'WITHDRAWAL_OPERATOR',
    '33333333-3333-4333-8333-333333333601'::uuid,
    (select session_a from ws06_bind)
  ) is not null,
  'matching user, admin session, and family can consume'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_a from ws06_bind),
      'ws06-bind-cross-token-0001',
      'WITHDRAWAL_OPERATOR',
      '33333333-3333-4333-8333-333333333602'::uuid,
      (select session_b from ws06_bind)
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'same user with a different active admin session is denied'
);

select ok(
  (
    select consumed_at is null
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-cross-token-0001', 'sha256'),
      'hex'
    )
  ),
  'a different admin session does not consume the grant'
);

select ok(
  public.consume_admin_step_up(
    (select user_a from ws06_bind),
    'ws06-bind-cross-token-0001',
    'WITHDRAWAL_OPERATOR',
    '33333333-3333-4333-8333-333333333603'::uuid,
    (select session_a from ws06_bind)
  ) is not null,
  'the issuing admin session can still consume after a mismatch'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_a from ws06_bind),
      'ws06-bind-cross-token-0001',
      'WITHDRAWAL_OPERATOR',
      '33333333-3333-4333-8333-333333333604'::uuid,
      (select session_a from ws06_bind)
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'reusing a consumed step-up grant is denied'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_b from ws06_bind),
      'ws06-bind-other-token-0001',
      'WITHDRAWAL_OPERATOR',
      '33333333-3333-4333-8333-333333333605'::uuid,
      (select session_other from ws06_bind)
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'a different operator cannot consume the grant'
);

select ok(
  (
    select consumed_at is null
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-other-token-0001', 'sha256'),
      'hex'
    )
  ),
  'a different operator does not consume the grant'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_a from ws06_bind),
      'ws06-bind-family-token-0001',
      'DEPOSIT_CONFIRM',
      '33333333-3333-4333-8333-333333333606'::uuid,
      (select session_a from ws06_bind)
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'the wrong command family is denied'
);

select ok(
  (
    select consumed_at is null
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-family-token-0001', 'sha256'),
      'hex'
    )
  ),
  'the wrong command family does not consume the grant'
);

update public.admin_step_up_grants
set
  issued_at = statement_timestamp() - interval '2 minutes',
  expires_at = statement_timestamp() - interval '1 minute'
where token_hash = encode(
  extensions.digest('ws06-bind-expire-token-0001', 'sha256'),
  'hex'
)
  and consumed_at is null;

select is(
  (
    select count(*)::integer
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-expire-token-0001', 'sha256'),
      'hex'
    )
      and expires_at < statement_timestamp()
      and consumed_at is null
  ),
  1,
  'expired grant fixture is prepared'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_a from ws06_bind),
      'ws06-bind-expire-token-0001',
      'WITHDRAWAL_OPERATOR',
      '33333333-3333-4333-8333-333333333607'::uuid,
      (select session_a from ws06_bind)
    )
  $$,
  '42501',
  'STEP_UP_REQUIRED',
  'an expired step-up grant is denied'
);

select ok(
  (
    select consumed_at is null
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-expire-token-0001', 'sha256'),
      'hex'
    )
  ),
  'an expired step-up grant is not consumed'
);

select lives_ok(
  $$
    select public.revoke_admin_session(
      (select session_revoked from ws06_bind),
      (select user_a from ws06_bind),
      'TEST_REVOKE'
    )
  $$,
  'revoke the session that issued the grant'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_a from ws06_bind),
      'ws06-bind-revoke-token-0001',
      'WITHDRAWAL_OPERATOR',
      '33333333-3333-4333-8333-333333333608'::uuid,
      (select session_revoked from ws06_bind)
    )
  $$,
  '42501',
  'ADMIN_SESSION_EXPIRED',
  'a revoked grant session is denied'
);

select ok(
  (
    select consumed_at is null
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-revoke-token-0001', 'sha256'),
      'hex'
    )
  ),
  'a revoked grant session does not consume the grant'
);

update public.admin_sessions
set
  created_at = statement_timestamp() - interval '5 minutes',
  last_seen_at = statement_timestamp() - interval '5 minutes',
  idle_expires_at = statement_timestamp() - interval '1 minute'
where id = (select session_idle from ws06_bind)
  and revoked_at is null;

select is(
  (
    select count(*)::integer
    from public.admin_sessions
    where id = (select session_idle from ws06_bind)
      and revoked_at is null
      and idle_expires_at < statement_timestamp()
  ),
  1,
  'idle-expired grant session fixture is prepared'
);

select throws_ok(
  $$
    select public.consume_admin_step_up(
      (select user_a from ws06_bind),
      'ws06-bind-idle-token-0001',
      'WITHDRAWAL_OPERATOR',
      '33333333-3333-4333-8333-333333333609'::uuid,
      (select session_idle from ws06_bind)
    )
  $$,
  '42501',
  'ADMIN_SESSION_EXPIRED',
  'an expired grant session is denied'
);

select ok(
  (
    select consumed_at is null
    from public.admin_step_up_grants
    where token_hash = encode(
      extensions.digest('ws06-bind-idle-token-0001', 'sha256'),
      'hex'
    )
  ),
  'an expired grant session does not consume the grant'
);

select ok(
  to_regprocedure('public.consume_admin_step_up(uuid,text,text,uuid)') is null,
  'legacy 4-argument public.consume_admin_step_up cannot bypass session binding'
);

select ok(
  to_regprocedure(
    'app_private.consume_admin_step_up_token(uuid,text,text,uuid)'
  ) is null,
  'legacy 4-argument private consume helper cannot bypass session binding'
);

select is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'consume_admin_step_up'
  ),
  1,
  'only the session-bound public consume_admin_step_up remains'
);

select is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname = 'consume_admin_step_up_token'
  ),
  1,
  'only the session-bound private consume helper remains'
);

select ok(
  to_regprocedure(
    'public.consume_admin_step_up(uuid,text,text,uuid,uuid)'
  ) is not null,
  'session-bound public.consume_admin_step_up exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.consume_admin_step_up(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service role may execute the session-bound consume wrapper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_admin_step_up(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated role cannot execute consume_admin_step_up'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.consume_admin_step_up(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anon role cannot execute consume_admin_step_up'
);

select ok(
  has_function_privilege(
    'service_role',
    'app_private.consume_admin_step_up_token(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service role may execute the session-bound private helper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'app_private.consume_admin_step_up_token(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated role cannot execute the private consume helper'
);

select ok(
  not has_function_privilege(
    'anon',
    'app_private.consume_admin_step_up_token(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anon role cannot execute the private consume helper'
);

select * from finish();

rollback;
