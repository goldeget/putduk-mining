begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('service_role', 'public.read_effective_economy_policy(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.read_effective_economy_policy(bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.read_effective_economy_policy(bigint)', 'EXECUTE'),
  'only the service role can execute the canonical unattended reader');
select ok(not exists (select 1 from pg_proc as procedure_entry,
  lateral aclexplode(coalesce(procedure_entry.proacl, acldefault('f', procedure_entry.proowner))) as permission
  where procedure_entry.oid = 'public.read_effective_economy_policy(bigint)'::regprocedure
    and permission.grantee = 0 and permission.privilege_type = 'EXECUTE'),
  'the PUBLIC function default grant is explicitly removed');
select ok((select not prosecdef and provolatile = 'v' and 'search_path=pg_catalog' = any(proconfig)
  from pg_proc where oid = 'public.read_effective_economy_policy(bigint)'::regprocedure),
  'the reader is a fixed-path volatile invoker, not a definer');

set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.read_effective_economy_policy(0)$$,
  '42501', 'ECONOMY_POLICY_SERVICE_ROLE_REQUIRED',
  'a superuser call with forged service JWT claims does not impersonate the service role');
set local role anon;
select throws_ok($$select public.read_effective_economy_policy(0)$$,
  '42501', 'permission denied for function read_effective_economy_policy',
  'anonymous service claims do not bypass EXECUTE');
reset role;
set local role authenticated;
select throws_ok($$select public.read_effective_economy_policy(0)$$,
  '42501', 'permission denied for function read_effective_economy_policy',
  'an authenticated user still has no policy reader access');
reset role;

create temporary table effective_policy_ctx (
  seed_microseconds bigint, original jsonb, after_publication jsonb,
  admin_id uuid, session_id uuid, future_start timestamptz,
  draft jsonb, preview jsonb, approval jsonb, publication jsonb,
  ledger_count bigint, entry_count bigint, audit_count bigint, outbox_count bigint
);
insert into effective_policy_ctx
select (extract(epoch from effective_from) * 1000000)::bigint, null, null,
  '0e031600-0000-4000-8000-000000000001'::uuid,
  '0e031600-0000-4000-8000-000000000002'::uuid,
  clock_timestamp() + interval '1 day', null, null, null, null,
  (select count(*) from public.ledger_transactions), (select count(*) from public.ledger_entries),
  (select count(*) from public.audit_logs), (select count(*) from public.outbox_events)
from app_private.economy_policy_published as policy
join app_private.economy_policy_versions as version on version.id = policy.policy_id
where version.is_reference;
grant select, update on effective_policy_ctx to service_role;
do $$ begin execute format('grant usage on schema %I to service_role',
  (select nspname from pg_namespace where oid = pg_my_temp_schema())); end; $$;

set local role service_role;
update effective_policy_ctx set original = public.read_effective_economy_policy(seed_microseconds);
select is((select original->>'effectiveAtMicroseconds' from effective_policy_ctx),
  (select seed_microseconds::text from effective_policy_ctx),
  'the seed start boundary is selected without any microsecond rounding');
select is((select original->'policy'->>'effectiveFromMicroseconds' from effective_policy_ctx),
  (select seed_microseconds::text from effective_policy_ctx), 'the exact interval start is returned as decimal text');
select ok((select original->'policy'->>'state' = 'PUBLISHED'
  and original->'policy'->>'effectiveUntilMicroseconds' is null
  and original->>'reader' = 'EFFECTIVE_ECONOMY_POLICY'
  and original->>'policyReceiptComplete' = 'true'
  and (original->>'readAtMicroseconds')::bigint >= seed_microseconds
  and not original ? 'sourceComplete'
  and not original ? 'balance'
  and not original ? 'engineActive'
  from effective_policy_ctx),
  'policy provenance is complete but no principal, balance or engine activation is asserted');
select throws_ok($$select public.read_effective_economy_policy(
  (select seed_microseconds - 1 from effective_policy_ctx))$$,
  '22023', 'ECONOMY_POLICY_EFFECTIVE_VERSION_NOT_FOUND',
  'one microsecond before the first policy is an explicit gap, not a guessed seed fallback');
select is(public.read_effective_economy_policy((select seed_microseconds + 1 from effective_policy_ctx))
  ->'policy'->>'publicationId',
  (select original->'policy'->>'publicationId' from effective_policy_ctx),
  'one microsecond after the start uses the same publication');
set local time zone 'America/New_York';
select is(public.read_effective_economy_policy((select seed_microseconds + 1 from effective_policy_ctx))
  ->>'effectiveAtMicroseconds',
  (select (seed_microseconds + 1)::text from effective_policy_ctx),
  'UTC epoch reconstruction is independent of the session timezone and daylight saving');
set local time zone 'UTC';
select throws_ok($$select public.read_effective_economy_policy(null)$$,
  '22023', 'ECONOMY_POLICY_INVALID_EFFECTIVE_TIME', 'null event time fails closed');
select throws_ok($$select public.read_effective_economy_policy(-1)$$,
  '22023', 'ECONOMY_POLICY_INVALID_EFFECTIVE_TIME', 'negative event time fails closed');
select throws_ok($$select public.read_effective_economy_policy(9223372036854775807)$$,
  '22023', 'ECONOMY_POLICY_FUTURE_EFFECTIVE_TIME', 'the largest bigint is rejected before timestamp overflow');
select throws_ok($$select public.read_effective_economy_policy('9223372036854775808'::bigint)$$,
  '22003', null, 'out-of-range transport cannot silently truncate');
select throws_ok($$select public.read_effective_economy_policy('1.1'::bigint)$$,
  '22P02', null, 'fractional bigint text is not rounded by transport');
select throws_ok($$select public.read_effective_economy_policy(
  ((extract(epoch from clock_timestamp() + interval '1 day') * 1000000)::bigint))$$,
  '22023', 'ECONOMY_POLICY_FUTURE_EFFECTIVE_TIME', 'database time owns the future boundary');
select is((select original->'policy'->>'configText' from effective_policy_ctx),
  (select config::text from app_private.economy_policy_versions where is_reference),
  'configText is PostgreSQL JSONB serialization, not JavaScript reserialization');
select ok((select encode(extensions.digest(convert_to(original->'policy'->>'configText', 'UTF8'), 'sha256'), 'hex')
    = original->'policy'->>'configDigest'
  and encode(extensions.digest(convert_to(original->'policy'->>'manifestText', 'UTF8'), 'sha256'), 'hex')
    = original->'policy'->>'manifestDigest'
  and original->'policy'->>'configDigest' <> original->'policy'->>'manifestDigest'
  from effective_policy_ctx), 'distinct config and original manifest digests reconcile');
select is((select jsonb_array_length(original->'policy'->'approvalProof') from effective_policy_ctx),
  4, 'all original lifecycle proofs are present');
select ok((select array_agg(proof->>'state' order by (proof->>'revision')::integer)
  = array['DRAFT', 'PREVIEWED', 'APPROVED', 'PUBLISHED']
  from effective_policy_ctx, lateral jsonb_array_elements(original->'policy'->'approvalProof') as proof),
  'the exact lifecycle order accompanies the publication');
select ok((select bool_and(proof->>'approvalKind' = 'OWNER_DOCUMENT'
  and proof->>'actorUserId' is null and proof->>'adminSessionId' is null
  and proof->>'stepUpGrantId' is null)
  from effective_policy_ctx, lateral jsonb_array_elements(original->'policy'->'approvalProof') as proof),
  'owner bootstrap proof contains no fabricated administrator session');
select ok(exists(select 1 from pg_locks where pid = pg_backend_pid()
  and locktype = 'advisory' and mode = 'ShareLock' and granted),
  'the policy read holds a shared transaction advisory lock');
select ok(position('putduk-mining.economy-policy' in
  pg_get_functiondef('public.read_effective_economy_policy(bigint)'::regprocedure)) > 0
  and position('ECONOMY_POLICY_FRESH_SNAPSHOT_REQUIRED' in
  pg_get_functiondef('public.read_effective_economy_policy(bigint)'::regprocedure)) > 0,
  'the canonical publisher key and stale isolation guard remain present (source assertion only)');
select ok((select ledger_count = (select count(*) from public.ledger_transactions)
  and entry_count = (select count(*) from public.ledger_entries)
  and audit_count = (select count(*) from public.audit_logs)
  and outbox_count = (select count(*) from public.outbox_events) from effective_policy_ctx),
  'policy reads create no money, audit or outbox writes');
reset role;

-- A future successor is created through the actual session-bound production
-- lifecycle; no policy table, historical clock or ledger is forged for tests.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select admin_id, 'authenticated', 'authenticated', 'effective-policy-admin@putduk.test', '',
  clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp(), '', '', '', ''
from effective_policy_ctx;
insert into public.user_roles(user_id, role, granted_by, granted_at)
select admin_id, 'ADMIN'::public.app_role, admin_id, clock_timestamp() - interval '1 hour'
from effective_policy_ctx;
insert into public.admin_sessions(id, user_id, auth_session_id, session_fingerprint,
  idle_expires_at, absolute_expires_at)
select session_id, admin_id, 'effective-policy-auth-session', 'effective-policy-fingerprint',
  clock_timestamp() + interval '30 minutes', clock_timestamp() + interval '2 hours'
from effective_policy_ctx;

create function pg_temp.effective_reader_policy_command(p_operation text, p_revision uuid default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare v_context record; v_token text; v_manifest text; v_digest text;
begin
  select * into v_context from pg_temp.effective_policy_ctx;
  v_token := 'effective-policy-proof:' || p_operation;
  perform public.issue_admin_step_up(v_context.session_id, v_context.admin_id, 'ECONOMY_POLICY', v_token, 600);
  if p_operation = 'CREATE' then
    select jsonb_set(config, '{policyVersion}', '"PUTDUK-READER-TEST-V2"'::jsonb)::text into v_manifest
      from app_private.economy_policy_versions where is_reference;
  else
    v_digest := v_context.draft->>'configDigest';
  end if;
  return public.manage_economy_policy_version(p_operation, 'PUTDUK-READER-TEST-V2', v_manifest,
    p_revision, v_digest, case when p_operation = 'CREATE' then null else v_context.future_start end,
    v_context.admin_id, v_context.session_id, 'effective-policy-auth-session', 'aal2', v_token,
    'Reviewed future policy for exact event reader', 'effective-policy-reader:' || p_operation);
end;
$$;
grant execute on function pg_temp.effective_reader_policy_command(text,uuid) to service_role;

set local role service_role;
update effective_policy_ctx set draft = pg_temp.effective_reader_policy_command('CREATE');
update effective_policy_ctx set preview = pg_temp.effective_reader_policy_command('PREVIEW', (draft->>'revisionId')::uuid);
update effective_policy_ctx set approval = pg_temp.effective_reader_policy_command('APPROVE', (preview->>'revisionId')::uuid);
update effective_policy_ctx set publication = pg_temp.effective_reader_policy_command('PUBLISH', (approval->>'revisionId')::uuid);
update effective_policy_ctx set after_publication = public.read_effective_economy_policy(seed_microseconds);
select is((select after_publication->'policy'->>'publicationId' from effective_policy_ctx),
  (select original->'policy'->>'publicationId' from effective_policy_ctx),
  'a future append does not change the historical event publication');
select is((select after_publication->'policy'->>'effectiveUntilMicroseconds' from effective_policy_ctx),
  (select ((extract(epoch from future_start) * 1000000)::bigint)::text from effective_policy_ctx),
  'a published successor closes the original interval at its exact future start');
select throws_ok($$select public.read_effective_economy_policy(
  (select (extract(epoch from future_start) * 1000000)::bigint from effective_policy_ctx))$$,
  '22023', 'ECONOMY_POLICY_FUTURE_EFFECTIVE_TIME',
  'publication does not allow processing an event before the real database clock reaches it');
select ok(not exists (select 1 from public.outbox_events where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
  and (available_at <> 'infinity'::timestamptz or status <> 'PENDING'
    or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'the reader and future publication do not activate policy outbox consumption');
select ok((select ledger_count = (select count(*) from public.ledger_transactions)
  and entry_count = (select count(*) from public.ledger_entries) from effective_policy_ctx),
  'the future lifecycle and historical reads still create no authoritative money');
reset role;

select * from finish();
rollback;
