begin;
select plan(36);

create temporary table admin_security_ctx (
  user_id uuid, sid text, fingerprint text, session_id uuid,
  absolute_deadline timestamptz, attempt_id uuid, bucket text
) on commit drop;
insert into admin_security_ctx (user_id, sid, fingerprint, bucket)
values ('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee6106', 'putduk-security-replay-session',
  repeat('f', 64), encode(extensions.digest('putduk-security-auth-budget', 'sha256'), 'hex'));
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
  recovery_token, email_change, email_change_token_new)
select user_id, 'authenticated', 'authenticated', 'security-replay@putduk.test', '',
  statement_timestamp(), '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from admin_security_ctx;
insert into public.user_roles (user_id, role, granted_by)
select user_id, 'ADMIN', user_id from admin_security_ctx;

select lives_ok($$update admin_security_ctx set session_id = public.register_admin_session(user_id, sid, fingerprint)$$,
  'initial MFA confirmation registers a session');
update public.admin_sessions set created_at = statement_timestamp() - interval '2 hours',
  absolute_expires_at = statement_timestamp() + interval '6 hours'
where id = (select session_id from admin_security_ctx);
update admin_security_ctx set absolute_deadline = (select absolute_expires_at from public.admin_sessions where id = session_id);
select is(public.register_admin_session((select user_id from admin_security_ctx), (select sid from admin_security_ctx), (select fingerprint from admin_security_ctx)),
  (select session_id from admin_security_ctx), 'replayed MFA confirmation returns the original session');
select is((select absolute_expires_at from public.admin_sessions where id = (select session_id from admin_security_ctx)),
  (select absolute_deadline from admin_security_ctx), 'MFA replay cannot reset the absolute lifetime');
select is((select count(*) from public.admin_sessions where auth_session_id = (select sid from admin_security_ctx)), 1::bigint,
  'MFA replay does not insert another app session');
select is((select attempt_count from app_private.command_rate_limits
  where scope = 'ADMIN_AUTH' and bucket_key = (select user_id::text from admin_security_ctx)),
  2, 'idempotent confirmation preserves the existing registration request ceiling');
select throws_ok($$select public.register_admin_session((select user_id from admin_security_ctx), (select sid from admin_security_ctx), repeat('a',64))$$,
  '42501', 'ADMIN_SESSION_FINGERPRINT_MISMATCH', 'another fingerprint cannot replace the session');
select public.revoke_admin_session((select session_id from admin_security_ctx), (select user_id from admin_security_ctx), 'TEST_REVOKE');
select throws_ok($$select public.register_admin_session((select user_id from admin_security_ctx), (select sid from admin_security_ctx), (select fingerprint from admin_security_ctx))$$,
  '55000', 'ADMIN_SESSION_REVOKED', 'MFA proof cannot revive a revoked app session');
update admin_security_ctx set sid = 'putduk-security-idle-expired', session_id = public.register_admin_session(user_id, 'putduk-security-idle-expired', fingerprint);
update public.admin_sessions set created_at = statement_timestamp() - interval '1 hour', idle_expires_at = statement_timestamp() - interval '1 minute'
where id = (select session_id from admin_security_ctx);
select throws_ok($$select public.register_admin_session((select user_id from admin_security_ctx), (select sid from admin_security_ctx), (select fingerprint from admin_security_ctx))$$,
  '55000', 'ADMIN_SESSION_IDLE_EXPIRED', 'MFA proof cannot revive an idle-expired session');
update admin_security_ctx set sid = 'putduk-security-absolute-expired', session_id = public.register_admin_session(user_id, 'putduk-security-absolute-expired', fingerprint);
update public.admin_sessions set created_at = statement_timestamp() - interval '9 hours', absolute_expires_at = statement_timestamp() - interval '1 minute'
where id = (select session_id from admin_security_ctx);
select throws_ok($$select public.register_admin_session((select user_id from admin_security_ctx), (select sid from admin_security_ctx), (select fingerprint from admin_security_ctx))$$,
  '55000', 'ADMIN_SESSION_ABSOLUTE_EXPIRED', 'MFA proof cannot revive an absolute-expired session');
select lives_ok($$select public.register_admin_session((select user_id from admin_security_ctx), 'putduk-security-fresh-login', (select fingerprint from admin_security_ctx))$$,
  'fresh Auth login can establish a new app session');
select ok(has_function_privilege('service_role','public.register_admin_session(uuid,text,text,text,integer,integer)','EXECUTE'), 'service role may register');
select ok(not has_function_privilege('anon','public.register_admin_session(uuid,text,text,text,integer,integer)','EXECUTE'), 'anon cannot register');
select ok(not has_function_privilege('authenticated','public.register_admin_session(uuid,text,text,text,integer,integer)','EXECUTE'), 'authenticated cannot register');
select ok(not (select prosecdef from pg_proc where oid = 'public.register_admin_session(uuid,text,text,text,integer,integer)'::regprocedure), 'registration stays SECURITY INVOKER');

insert into public.security_events (event_type, ip_source, device_context, request_id)
select 'ADMIN_AUTH_FAILURE', 'NONE', jsonb_build_object('surface','admin_auth_failure','scope','PASSWORD','bucket',bucket), gen_random_uuid()
from admin_security_ctx cross join generate_series(1,4);
select lives_ok($$update admin_security_ctx set attempt_id = public.admit_admin_auth_attempt('PASSWORD', bucket)$$, 'one attempt reserves the last remaining failure slot');
select throws_ok($$select public.admit_admin_auth_attempt('PASSWORD', (select bucket from admin_security_ctx))$$,
  '55000', 'ADMIN_AUTH_RATE_LIMITED', 'in-flight attempt blocks another admission');
select lives_ok($$select public.finish_admin_auth_attempt((select attempt_id from admin_security_ctx), true)$$, 'successful attempt releases its reservation');
select lives_ok($$update admin_security_ctx set attempt_id = public.admit_admin_auth_attempt('PASSWORD', bucket)$$, 'success preserves the remaining failure allowance');
select lives_ok($$select public.finish_admin_auth_attempt((select attempt_id from admin_security_ctx), false)$$, 'failed attempt records its failure atomically');
select lives_ok($$select public.finish_admin_auth_attempt((select attempt_id from admin_security_ctx), false)$$, 'identical failure completion is idempotent');
select is((select count(*) from public.security_events where event_type='ADMIN_AUTH_FAILURE' and device_context->>'bucket'=(select bucket from admin_security_ctx)), 5::bigint, 'one attempt contributes only one failure');
select throws_ok($$select public.finish_admin_auth_attempt((select attempt_id from admin_security_ctx), true)$$,
  '55000', 'ADMIN_AUTH_ATTEMPT_OUTCOME_CONFLICT', 'success cannot overwrite a recorded failure');
select lives_ok($$select public.admit_admin_auth_attempt('PASSWORD', repeat('b',64))$$, 'another subject has an independent budget');
select lives_ok($$select public.admit_admin_auth_attempt('TOTP', (select bucket from admin_security_ctx))$$, 'TOTP and password budgets stay separate');
select ok(not exists(select 1 from public.security_events where event_type='ADMIN_AUTH_ATTEMPT_STARTED' and
  (user_id is not null or user_agent is not null or trusted_client_ip is not null)), 'reservations store no identity or untrusted IP fields');
select is((select count(*) from public.security_events where event_type='ADMIN_AUTH_ATTEMPT_FINISHED' and request_id=(select attempt_id from admin_security_ctx)), 1::bigint, 'terminal auth outcome is appended once');
create temporary table pending_auth_attempts on commit drop as
select public.admit_admin_auth_attempt('TOTP', repeat('c',64)) as id from generate_series(1,5);
select is((select count(*) from pending_auth_attempts), 5::bigint, 'five unfinished attempts reserve five slots');
select throws_ok($$select public.admit_admin_auth_attempt('TOTP', repeat('c',64))$$,
  '55000', 'ADMIN_AUTH_RATE_LIMITED', 'unfinished attempts cannot overrun the failure budget');
select ok(not has_function_privilege('anon','public.admit_admin_auth_attempt(text,text)','EXECUTE'), 'anon cannot reserve auth budget');
select ok(not has_function_privilege('authenticated','public.finish_admin_auth_attempt(uuid,boolean)','EXECUTE'), 'authenticated cannot forge auth results');
select throws_ok($$select public.admit_admin_auth_attempt('TOTP', 'raw-email@example.com')$$,
  '22023', 'INVALID_ADMIN_AUTH_ATTEMPT', 'raw identifiers cannot enter the attempt store');
select ok(not exists(select 1 from pg_proc where oid in ('public.admit_admin_auth_attempt(text,text)'::regprocedure, 'public.finish_admin_auth_attempt(uuid,boolean)'::regprocedure) and prosecdef), 'new auth commands are SECURITY INVOKER');
select throws_ok($$select public.admit_admin_auth_attempt('PASSWORD', (select bucket from admin_security_ctx))$$,
  '55000', 'ADMIN_AUTH_RATE_LIMITED', 'five failures deny subsequent attempts');

insert into public.security_events (event_type, ip_source, device_context, request_id, occurred_at)
select 'ADMIN_AUTH_FAILURE', 'NONE',
  jsonb_build_object('surface','admin_auth_failure','scope','PASSWORD','bucket',repeat('d',64)),
  gen_random_uuid(), clock_timestamp() - interval '16 minutes'
from generate_series(1,5);
select lives_ok($$select public.admit_admin_auth_attempt('PASSWORD', repeat('d',64))$$,
  'failures outside the existing 15-minute window do not block admission');

with fixture as materialized (select gen_random_uuid() as id from generate_series(1,5))
insert into public.security_events (id, event_type, ip_source, device_context, request_id, occurred_at)
select id, 'ADMIN_AUTH_ATTEMPT_STARTED', 'NONE',
  jsonb_build_object('surface','admin_auth_attempt','scope','TOTP','bucket',repeat('e',64)),
  id, clock_timestamp() - interval '16 minutes'
from fixture;
select lives_ok($$select public.admit_admin_auth_attempt('TOTP', repeat('e',64))$$,
  'crashed reservations stop consuming slots after the existing 15-minute window');

insert into public.security_events (event_type, ip_source, device_context, request_id, occurred_at)
select 'ADMIN_AUTH_FAILURE', 'NONE',
  jsonb_build_object('surface','admin_auth_failure','scope','TOTP','bucket',repeat('f',64)),
  gen_random_uuid(), clock_timestamp() - interval '14 minutes'
from generate_series(1,5);
select throws_ok($$select public.admit_admin_auth_attempt('TOTP', repeat('f',64))$$,
  '55000', 'ADMIN_AUTH_RATE_LIMITED', 'failures inside the existing 15-minute window stay charged');
select * from finish();
rollback;
