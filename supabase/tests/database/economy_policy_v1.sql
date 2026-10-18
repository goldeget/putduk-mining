begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select count(*)::integer from app_private.economy_policy_versions where is_reference),
  1, 'one immutable owner reference is seeded');
select is((select manifest_digest from app_private.economy_policy_versions where is_reference),
  '158c81e91923ba31f57b457ae3a33bc4092455e4abe2a2c888d5b5d2bc33b9e0',
  'seed preserves the approved manifest exact byte digest');
select ok((select manifest_text::jsonb = config and config->>'policyVersion' = policy_version
  and approval_evidence = 'docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md'
  and manifest_digest = encode(extensions.digest(convert_to(manifest_text, 'UTF8'), 'sha256'), 'hex')
  and config_digest = encode(extensions.digest(convert_to(config::text, 'UTF8'), 'sha256'), 'hex')
  from app_private.economy_policy_versions where is_reference),
  'raw manifest and database text use their own matching digests');
select ok((select config @> '{"minimumPrincipalKrw":"100000","cycleDays":30,
  "baseCycleRateBps":1500,"microKrwPerKrw":"1000000","carryAcrossCycles":true,
  "productMultiplier":{"defaultBps":10000,"minimumBps":9000,"maximumBps":11000},
  "allocation":{"maximumTotalBps":10000,"maximumPerProductBps":10000,"capacityScope":"GLOBAL_CYCLE"},
  "campaign":{"defaultCapacityBoostBps":0,"maximumSingleCapacityBoostBps":1000,
    "maximumCombinedCapacityBoostBps":2000,"defaultSpeedMultiplierBps":10000,
    "maximumSingleSpeedMultiplierBps":12500,"maximumCombinedSpeedMultiplierBps":15000},
  "userOverride":{"defaultMultiplierBps":10000,"minimumMultiplierBps":8000,
    "maximumMultiplierBps":12000,"requiresAuditReasonStepUp":true},
  "withdrawalSources":{"miningReward":"MINING_REWARD","principalRecovery":"PRINCIPAL",
    "automaticSourceFallback":false,"mixedSources":false,"miningRewardMustBeVerified":true,
    "bonus":"SEPARATE_BONUS_POLICY"},
  "platformFeesKrw":{"krwDeposit":"0","usdtDepositConversion":"0","mining":"0",
    "krwMiningRewardWithdrawal":"0","principalRecovery":"0"},
  "futureFeeSource":"SAME_WITHDRAWAL_SOURCE_ONLY",
  "usdt":{"network":"TRC20","creditCurrency":"KRW","userUsdtWallet":false,
    "miningRewardCurrency":"KRW","networkFeeIncludedInPrincipal":false,"actualReceiptRequired":true}}'::jsonb
  from app_private.economy_policy_versions where is_reference),
  'all approved V1 scalar values and source/fee/USDT rails match the owner table');
select ok((select config->'tiers' = '[
  {"code":"L1","name":"STARTER","minimumPrincipalKrw":"100000","maximumPrincipalKrw":"499999","retentionBonusBps":1500,"slots":1},
  {"code":"L2","name":"STARTER+","minimumPrincipalKrw":"500000","maximumPrincipalKrw":"999999","retentionBonusBps":1600,"slots":1},
  {"code":"L3","name":"ACTIVE","minimumPrincipalKrw":"1000000","maximumPrincipalKrw":"2999999","retentionBonusBps":1700,"slots":2},
  {"code":"L4","name":"ADVANCED","minimumPrincipalKrw":"3000000","maximumPrincipalKrw":"4999999","retentionBonusBps":1800,"slots":2},
  {"code":"L5","name":"PRO","minimumPrincipalKrw":"5000000","maximumPrincipalKrw":"9999999","retentionBonusBps":1900,"slots":2},
  {"code":"L6","name":"PREMIUM","minimumPrincipalKrw":"10000000","maximumPrincipalKrw":"29999999","retentionBonusBps":2000,"slots":3},
  {"code":"L7","name":"PREMIUM+","minimumPrincipalKrw":"30000000","maximumPrincipalKrw":"49999999","retentionBonusBps":2100,"slots":3},
  {"code":"L8","name":"ELITE","minimumPrincipalKrw":"50000000","maximumPrincipalKrw":"99999999","retentionBonusBps":2200,"slots":3},
  {"code":"L9","name":"ULTRA","minimumPrincipalKrw":"100000000","maximumPrincipalKrw":"299999999","retentionBonusBps":2300,"slots":4},
  {"code":"L10","name":"ULTRA+","minimumPrincipalKrw":"300000000","maximumPrincipalKrw":"499999999","retentionBonusBps":2400,"slots":4},
  {"code":"L11","name":"PRIVATE","minimumPrincipalKrw":"500000000","maximumPrincipalKrw":"999999999","retentionBonusBps":2500,"slots":5},
  {"code":"L12","name":"PRIVATE+","minimumPrincipalKrw":"1000000000","maximumPrincipalKrw":"2999999999","retentionBonusBps":2500,"slots":5},
  {"code":"L13","name":"PRIVATE ELITE","minimumPrincipalKrw":"3000000000","maximumPrincipalKrw":"4999999999","retentionBonusBps":2500,"slots":5},
  {"code":"L14","name":"PRIVATE ELITE+","minimumPrincipalKrw":"5000000000","maximumPrincipalKrw":null,"retentionBonusBps":2500,"slots":5}
  ]'::jsonb from app_private.economy_policy_versions where is_reference),
  'all fourteen inclusive principal ranges, retention rates and slots match exactly');
select is((select count(*)::integer from app_private.economy_policy_receipts as receipt
  join app_private.economy_policy_versions as version on version.id = receipt.policy_id
  where version.is_reference and receipt.approval_kind = 'OWNER_DOCUMENT'),
  4, 'migration bootstrap records the complete owner approval lifecycle without a fake admin');
select lives_ok($$select app_private.assert_economy_policy_receipt(id)
  from app_private.economy_policy_receipts where approval_kind = 'OWNER_DOCUMENT'$$,
  'bootstrap receipts reconcile config, audit and outbox');
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'policy events are durable but held until an explicitly implemented consumer is enabled');
select is((select count(*)::integer from app_private.economy_policy_published), 1,
  'one initial policy is published at its actual installation time');
select ok((select effective_from = published_at and effective_until is null
  and state = 'PUBLISHED' from app_private.economy_policy_published),
  'initial policy has no invented backdated start or competing interval');
select ok(not exists (select 1 from pg_class as relation join pg_namespace as namespace
  on namespace.oid = relation.relnamespace where namespace.nspname = 'app_private'
  and relation.relname in ('economy_policy_versions', 'economy_policy_receipts', 'economy_policy_publications')
  and (not relation.relrowsecurity or not relation.relforcerowsecurity)),
  'every policy table forces RLS');
select ok(not has_table_privilege('anon', 'app_private.economy_policy_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'app_private.economy_policy_published', 'SELECT')
  and not has_function_privilege('anon',
    'public.manage_economy_policy_version(text,text,text,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.manage_economy_policy_version(text,text,text,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.read_economy_policy_version_state(uuid,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.read_economy_policy_version_state(uuid,uuid,text,text,text)', 'EXECUTE'),
  'browser roles have neither policy data nor command access');
select ok(not exists (select 1 from pg_proc join pg_namespace on pg_namespace.oid = pronamespace
  where pg_namespace.nspname in ('public', 'app_private') and proname like '%economy_policy%'
    and (prosecdef or not ('search_path=pg_catalog' = any(proconfig)))),
  'all policy functions are fixed-path invoker functions');
select throws_ok($$update app_private.economy_policy_versions set config = '{}'::jsonb where is_reference$$,
  '55000', 'economy_policy_versions is append-only', 'even the owner cannot rewrite a published config');
select throws_ok($$delete from app_private.economy_policy_publications$$,
  '55000', 'economy_policy_publications is append-only', 'published schedule points cannot be deleted');

create temporary table economy_policy_ctx (
  admin_id uuid, viewer_id uuid, session_id uuid, second_session_id uuid,
  effective_from timestamptz, draft jsonb, preview jsonb, approval jsonb, publication jsonb,
  competing_draft jsonb, competing_preview jsonb, competing_approval jsonb
);
insert into economy_policy_ctx values (
  '0e031400-0000-4000-8000-000000000001', '0e031400-0000-4000-8000-000000000002',
  '0e031400-0000-4000-8000-000000000003', '0e031400-0000-4000-8000-000000000004',
  clock_timestamp() + interval '1 day', null, null, null, null, null, null, null);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (select admin_id as id, 'economy-policy-admin@putduk.test' as email from economy_policy_ctx
  union all select viewer_id, 'economy-policy-viewer@putduk.test' from economy_policy_ctx) as person;
insert into public.user_roles(user_id, role, granted_by, granted_at)
select admin_id, 'ADMIN'::public.app_role, admin_id, clock_timestamp() - interval '1 hour' from economy_policy_ctx
union all select viewer_id, 'VIEWER'::public.app_role, viewer_id, clock_timestamp() - interval '1 hour' from economy_policy_ctx;
insert into public.admin_sessions(id, user_id, auth_session_id, session_fingerprint,
  idle_expires_at, absolute_expires_at)
select session_id, admin_id, 'economy-auth-session-current', 'economy-fingerprint-current',
  clock_timestamp() + interval '30 minutes', clock_timestamp() + interval '2 hours' from economy_policy_ctx
union all select second_session_id, admin_id, 'economy-auth-session-other', 'economy-fingerprint-other',
  clock_timestamp() + interval '30 minutes', clock_timestamp() + interval '2 hours' from economy_policy_ctx;

-- Fixtures model an already verified server identity; they are not browser
-- MFA evidence. Each new operation issues and consumes the real session-bound
-- step-up helper and invokes the actual service-only production command.
create function pg_temp.policy_command(
  p_operation text, p_key text, p_version text default 'PUTDUK-POLICY-TEST-V2',
  p_revision uuid default null, p_digest text default null, p_effective timestamptz default null,
  p_config jsonb default null, p_actor uuid default null, p_session uuid default null,
  p_auth_session text default 'economy-auth-session-current', p_aal text default 'aal2',
  p_reason text default 'Reviewed policy operation', p_token text default null
) returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare v_ctx record; v_manifest text; v_token text;
begin
  select * into v_ctx from pg_temp.economy_policy_ctx;
  v_token := coalesce(p_token, 'economy-policy-proof:' || p_key);
  if p_token is null and not exists (select 1 from public.admin_step_up_grants as proof
    where proof.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')) then
    perform public.issue_admin_step_up(v_ctx.session_id, v_ctx.admin_id, 'ECONOMY_POLICY', v_token, 600);
  end if;
  if p_operation = 'CREATE' then
    v_manifest := coalesce(p_config, (select jsonb_set(config, '{policyVersion}', to_jsonb(p_version))
      from app_private.economy_policy_versions where is_reference))::text;
  end if;
  return public.manage_economy_policy_version(p_operation, p_version, v_manifest,
    p_revision, p_digest, p_effective, coalesce(p_actor, v_ctx.admin_id),
    coalesce(p_session, v_ctx.session_id), p_auth_session, p_aal, v_token, p_reason, p_key);
end;
$$;
grant select, update on economy_policy_ctx to service_role;
do $$ begin execute format('grant usage on schema %I to service_role',
  (select nspname from pg_namespace where oid = pg_my_temp_schema())); end; $$;
grant execute on function pg_temp.policy_command(text,text,text,uuid,text,timestamptz,jsonb,uuid,uuid,text,text,text,text)
  to service_role;
create function pg_temp.policy_read(p_version text default null, p_actor uuid default null,
  p_session uuid default null, p_auth_session text default 'economy-auth-session-current',
  p_aal text default 'aal2') returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select public.read_economy_policy_version_state(coalesce(p_actor, context.admin_id),
    coalesce(p_session, context.session_id), p_auth_session, p_aal, p_version)
  from pg_temp.economy_policy_ctx as context;
$$;
grant execute on function pg_temp.policy_read(text,uuid,uuid,text,text) to service_role;

set local role service_role;
select is(pg_temp.policy_read()->'selectedVersion'->>'policyVersion', 'PUTDUK-MINING-V1-2026-10-03',
  'authorized reader selects the currently effective policy');
select is(jsonb_array_length(pg_temp.policy_read()->'selectedVersion'->'history'), 4,
  'reader returns the original complete lifecycle history');
select ok(pg_temp.policy_read()->'selectedVersion'->'configuration' =
  (select config from app_private.economy_policy_versions where is_reference),
  'service administrator query returns exact config without exposing private schema');
select throws_ok($$select pg_temp.policy_read(p_aal => 'aal1')$$,
  '42501', 'MFA_REQUIRED', 'policy read also requires fresh server AAL2');
select throws_ok($$select pg_temp.policy_read(p_actor => (select viewer_id from economy_policy_ctx))$$,
  '42501', 'OPERATOR_ROLE_REQUIRED', 'a viewer cannot read policy internals');
select throws_ok($$select pg_temp.policy_read(p_session => (select second_session_id from economy_policy_ctx))$$,
  '42501', 'ADMIN_SESSION_EXPIRED', 'read cannot cross administrator and Auth session bindings');
select throws_ok($$select pg_temp.policy_read('POLICY-NOT-FOUND')$$,
  '22023', 'ECONOMY_POLICY_VERSION_NOT_FOUND', 'unknown exact version is explicit, not a guessed fallback');
select throws_ok($$insert into public.outbox_events(event_type, schema_version, aggregate_type,
  aggregate_id, payload, correlation_id, request_id, idempotency_key)
  values ('ECONOMY_POLICY_VERSION_CHANGED.v1', 1, 'economy_policy_version', gen_random_uuid(),
    '{}'::jsonb, gen_random_uuid(), gen_random_uuid(), 'policy-forged-event')$$,
  '42501', 'ECONOMY_POLICY_COMMAND_REQUIRED', 'a direct service event cannot impersonate policy publication');
select throws_ok($$insert into app_private.economy_policy_versions select *
  from app_private.economy_policy_versions where is_reference$$,
  '42501', 'ECONOMY_POLICY_COMMAND_REQUIRED', 'service direct INSERT cannot bypass the command');
select throws_ok($$update app_private.economy_policy_versions set approval_evidence = 'changed'$$,
  '42501', 'permission denied for table economy_policy_versions', 'service has no policy UPDATE privilege');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-aal1', p_aal => 'aal1')$$,
  '42501', 'MFA_REQUIRED', 'fresh server AAL2 is required');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-viewer',
  p_actor => (select viewer_id from pg_temp.economy_policy_ctx))$$,
  '42501', 'OPERATOR_ROLE_REQUIRED', 'a viewer cannot create policy');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-wrong-session',
  p_session => (select second_session_id from pg_temp.economy_policy_ctx))$$,
  '42501', 'ADMIN_SESSION_EXPIRED', 'admin and current Auth session must match');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-other-session-proof',
  p_session => (select second_session_id from pg_temp.economy_policy_ctx),
  p_auth_session => 'economy-auth-session-other')$$,
  '42501', 'STEP_UP_REQUIRED', 'step-up proof cannot cross admin sessions');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-no-step-up',
  p_token => 'not-an-issued-policy-proof')$$,
  '42501', 'STEP_UP_REQUIRED', 'unissued proof cannot authorize a write');
select public.issue_admin_step_up(session_id, admin_id, 'ECONOMY_POLICY',
  'economy-policy-proof:policy-expired-session', 600) from economy_policy_ctx;
update public.admin_sessions set idle_expires_at = clock_timestamp() - interval '1 microsecond'
where id = (select session_id from economy_policy_ctx);
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-expired-session')$$,
  '42501', 'ADMIN_SESSION_EXPIRED', 'database time rejects an expired admin session');
select throws_ok($$select pg_temp.policy_read()$$,
  '42501', 'ADMIN_SESSION_EXPIRED', 'database time also rejects reading with an expired admin session');
update public.admin_sessions set idle_expires_at = clock_timestamp() + interval '30 minutes'
where id = (select session_id from economy_policy_ctx);
select public.issue_admin_step_up(session_id, admin_id, 'ECONOMY_POLICY',
  'economy-policy-proof:policy-expired-proof', 600) from economy_policy_ctx;
reset role;
update public.admin_step_up_grants set issued_at = clock_timestamp() - interval '20 minutes',
  expires_at = clock_timestamp() - interval '10 minutes'
where token_hash = encode(extensions.digest('economy-policy-proof:policy-expired-proof', 'sha256'), 'hex');
set local role service_role;
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-expired-proof')$$,
  '42501', 'STEP_UP_REQUIRED', 'an expired one-use proof cannot authorize policy');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-blank-reason', p_reason => ' ')$$,
  '22023', 'INVALID_ECONOMY_POLICY_COMMAND', 'a blank audit reason is rejected');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-invalid-product-range',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{productMultiplier,minimumBps}', '12000') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_MULTIPLIER', 'product default must fit its versioned range');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-invalid-campaign-limits',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{campaign,maximumCombinedSpeedMultiplierBps}', '12000') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_CAMPAIGN', 'combined campaign maximum cannot be smaller than its single maximum');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-tier-gap',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{tiers,1,minimumPrincipalKrw}', '"500001"') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_TIERS', 'a one-KRW tier gap is rejected');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-zero-slots',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{tiers,13,slots}', '0') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_TIERS', 'slot count is a positive integer, not a frozen five-slot ceiling');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-negative-fee',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{platformFeesKrw,mining}', '"-1"') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_FEE', 'future fee amounts remain nonnegative whole KRW');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-overallocation',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{allocation,maximumTotalBps}', '10001') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_ALLOCATION', 'global allocation cannot exceed one 100-percent unit');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-changed-carry-unit',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{microKrwPerKrw}', '"100000"') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'ECONOMY_POLICY_PROTOCOL_CHANGE_REQUIRES_APPROVAL', 'existing carry uses its immutable arithmetic unit');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-mixed-source',
  p_config => (select jsonb_set(jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"'),
    '{withdrawalSources,mixedSources}', 'true') from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'ECONOMY_POLICY_PROTOCOL_CHANGE_REQUIRES_APPROVAL', 'mixed withdrawal sources fail closed');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-new-hidden-knob',
  p_config => (select jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-TEST-V2"') ||
    '{"hiddenReward":123}'::jsonb from app_private.economy_policy_versions where is_reference))$$,
  '22023', 'INVALID_ECONOMY_POLICY_SHAPE', 'unreviewed policy fields are rejected');
update economy_policy_ctx set draft = pg_temp.policy_command('CREATE', 'policy-v2-create');
reset role;
select is((select draft->>'state' from economy_policy_ctx), 'DRAFT', 'real command creates a draft');
select is((select count(*)::integer from app_private.economy_policy_published), 1,
  'creating a draft does not activate a second policy');

set local role service_role;
select is(pg_temp.policy_command('CREATE', 'policy-v2-create'),
  (select draft from economy_policy_ctx), 'verified retry returns its immutable original receipt');
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-v2-create', p_reason => 'different reason')$$,
  '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'changed input cannot borrow a completed key');
select throws_ok($$select pg_temp.policy_command('PUBLISH', 'policy-premature-publish',
  p_revision => (select (draft->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => (select draft->>'configDigest' from economy_policy_ctx),
  p_effective => (select effective_from from economy_policy_ctx))$$,
  '40001', 'ECONOMY_POLICY_REVISION_CHANGED', 'draft cannot skip preview and approval');
select throws_ok($$select pg_temp.policy_command('PREVIEW', 'policy-past-preview',
  p_revision => (select (draft->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => (select draft->>'configDigest' from economy_policy_ctx), p_effective => '2000-01-01Z')$$,
  '22023', 'INVALID_ECONOMY_POLICY_EFFECTIVE_TIME', 'past effective time cannot rewrite economic history');
select throws_ok($$select pg_temp.policy_command('PREVIEW', 'policy-wrong-digest',
  p_revision => (select (draft->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => repeat('a',64), p_effective => (select effective_from from economy_policy_ctx))$$,
  '40001', 'ECONOMY_POLICY_REVISION_CHANGED', 'preview binds the actual immutable config digest');
update economy_policy_ctx set preview = pg_temp.policy_command('PREVIEW', 'policy-v2-preview',
  p_revision => (draft->>'revisionId')::uuid, p_digest => draft->>'configDigest', p_effective => effective_from);
select throws_ok($$select pg_temp.policy_command('APPROVE', 'policy-stale-approval',
  p_revision => (select (draft->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => (select draft->>'configDigest' from economy_policy_ctx),
  p_effective => (select effective_from from economy_policy_ctx))$$,
  '40001', 'ECONOMY_POLICY_REVISION_CHANGED', 'approval cannot use a stale observed revision');
select throws_ok($$select pg_temp.policy_command('APPROVE', 'policy-changed-preview-time',
  p_revision => (select (preview->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => (select preview->>'configDigest' from economy_policy_ctx),
  p_effective => (select effective_from + interval '1 second' from economy_policy_ctx))$$,
  '40001', 'ECONOMY_POLICY_PREVIEW_CHANGED', 'approval cannot silently change the previewed start');
update economy_policy_ctx set approval = pg_temp.policy_command('APPROVE', 'policy-v2-approve',
  p_revision => (preview->>'revisionId')::uuid, p_digest => preview->>'configDigest', p_effective => effective_from);
update economy_policy_ctx set competing_draft = pg_temp.policy_command('CREATE', 'policy-v3-create',
  p_version => 'PUTDUK-POLICY-TEST-V3');
update economy_policy_ctx set competing_preview = pg_temp.policy_command('PREVIEW', 'policy-v3-preview',
  p_version => 'PUTDUK-POLICY-TEST-V3', p_revision => (competing_draft->>'revisionId')::uuid,
  p_digest => competing_draft->>'configDigest', p_effective => effective_from + interval '1 day');
update economy_policy_ctx set competing_approval = pg_temp.policy_command('APPROVE', 'policy-v3-approve',
  p_version => 'PUTDUK-POLICY-TEST-V3', p_revision => (competing_preview->>'revisionId')::uuid,
  p_digest => competing_preview->>'configDigest', p_effective => effective_from + interval '1 day');
update economy_policy_ctx set publication = pg_temp.policy_command('PUBLISH', 'policy-v2-publish',
  p_revision => (approval->>'revisionId')::uuid, p_digest => approval->>'configDigest', p_effective => effective_from);
select throws_ok($$select pg_temp.policy_command('PUBLISH', 'policy-v3-publish-stale-predecessor',
  p_version => 'PUTDUK-POLICY-TEST-V3',
  p_revision => (select (competing_approval->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => (select competing_approval->>'configDigest' from economy_policy_ctx),
  p_effective => (select effective_from + interval '1 day' from economy_policy_ctx))$$,
  '40001', 'ECONOMY_POLICY_PREVIEW_CHANGED', 'a competing publication invalidates stale preview approval');
select is(pg_temp.policy_command('PUBLISH', 'policy-v2-publish',
  p_revision => (select (approval->>'revisionId')::uuid from economy_policy_ctx),
  p_digest => (select approval->>'configDigest' from economy_policy_ctx),
  p_effective => (select effective_from from economy_policy_ctx)),
  (select publication from economy_policy_ctx), 'publish retry does not duplicate or reorder the timeline');
select throws_ok($$update public.outbox_events set payload = '{}'::jsonb
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'$$,
  '55000', 'ECONOMY_POLICY_EVENT_IS_IMMUTABLE', 'worker write privilege cannot rewrite policy event meaning');
select lives_ok($$update public.outbox_events set last_error_code = 'TEST_DELIVERY_RETRY'
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'$$,
  'workers retain delivery-state updates without editing semantic receipts');
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select publication->>'state' from economy_policy_ctx), 'PUBLISHED',
  'actual four-step service lifecycle publishes one future policy');
select is((select count(*)::integer from app_private.economy_policy_receipts where
  policy_id = (select (draft->>'policyId')::uuid from economy_policy_ctx)), 4,
  'each state has exactly one immutable transition');
select ok(not exists (select 1 from public.audit_logs where target_id = 'PUTDUK-POLICY-TEST-V2'
  and (metadata ? 'step_up_token' or metadata ? 'manifest_text')),
  'plaintext step-up and private config are absent from persisted audit metadata');
select ok(not exists (select 1 from app_private.economy_policy_published as left_policy
  join app_private.economy_policy_published as right_policy on left_policy.policy_id <> right_policy.policy_id
  and tstzrange(left_policy.effective_from, left_policy.effective_until, '[)') &&
    tstzrange(right_policy.effective_from, right_policy.effective_until, '[)')),
  'published effective intervals cannot overlap');
select is((select effective_until from app_private.economy_policy_published
  where policy_version = 'PUTDUK-MINING-V1-2026-10-03'),
  (select effective_from from economy_policy_ctx),
  'only the future derived interval boundary changes when a successor is published');
select is((select policy_version from app_private.economy_policy_published
  where effective_from <= clock_timestamp() and (effective_until is null or effective_until > clock_timestamp())),
  'PUTDUK-MINING-V1-2026-10-03', 'future publication does not apply early');
select is((select count(*)::integer from app_private.economy_policy_published
  where policy_version = 'PUTDUK-POLICY-TEST-V3'), 0,
  'a stale approved competitor remains unapplied');
set local role service_role;
select is(pg_temp.policy_read()->'selectedVersion'->>'policyVersion', 'PUTDUK-MINING-V1-2026-10-03',
  'read default ignores a future successor and unapproved drafts');
select is(pg_temp.policy_read('PUTDUK-POLICY-TEST-V2')->'selectedVersion'->'latestRevision'->>'state',
  'PUBLISHED', 'explicit selection reads a future published version for administrator review');
select is(pg_temp.policy_read()->'latestPublication'->>'policyVersion', 'PUTDUK-POLICY-TEST-V2',
  'read exposes the actual forward schedule predecessor for the next preview');
reset role;
select lives_ok($$select app_private.assert_economy_policy_receipt(id)
  from app_private.economy_policy_receipts$$, 'every transition reconciles immutable config, proof, audit and event');

-- Other economic values remain editable; platform fees are permanently zero.
-- These are test-only proposed values, never another production policy seed.
create temporary table policy_future_ctx(configuration jsonb, draft jsonb, preview jsonb, approval jsonb, publication jsonb);
insert into policy_future_ctx(configuration)
select jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-EDITED-NUMBERS"')
from app_private.economy_policy_versions where is_reference;
update policy_future_ctx set configuration = configuration || '{
  "minimumPrincipalKrw":"200000","cycleDays":45,"baseCycleRateBps":1800,
  "productMultiplier":{"defaultBps":12000,"minimumBps":7000,"maximumBps":14000},
  "allocation":{"maximumTotalBps":9000,"maximumPerProductBps":9000,"capacityScope":"GLOBAL_CYCLE"},
  "campaign":{"defaultCapacityBoostBps":500,"maximumSingleCapacityBoostBps":1500,
    "maximumCombinedCapacityBoostBps":3000,"defaultSpeedMultiplierBps":11000,
    "maximumSingleSpeedMultiplierBps":14000,"maximumCombinedSpeedMultiplierBps":18000},
  "userOverride":{"defaultMultiplierBps":13000,"minimumMultiplierBps":6000,
    "maximumMultiplierBps":16000,"requiresAuditReasonStepUp":true},
  "platformFeesKrw":{"krwDeposit":"0","usdtDepositConversion":"0","mining":"0",
    "krwMiningRewardWithdrawal":"0","principalRecovery":"0"}}'::jsonb;
update policy_future_ctx set configuration = jsonb_set(jsonb_set(jsonb_set(configuration,
  '{tiers,0,minimumPrincipalKrw}', '"200000"'), '{tiers,13,retentionBonusBps}', '3500'), '{tiers,13,slots}', '7');
grant select, update on policy_future_ctx to service_role;
set local role service_role;
-- Each otherwise valid future proposal goes through the real authenticated
-- command and step-up boundary. It cannot enable even a one-KRW platform fee.
select throws_ok(format($probe$
  select pg_temp.policy_command('CREATE', %L, p_version => %L,
    p_config => (select jsonb_set(jsonb_set(configuration,
      '{policyVersion}', to_jsonb(%L::text)),
      array['platformFeesKrw', %L], '"1"'::jsonb) from policy_future_ctx))
$probe$, 'policy-fee-rejected-' || fee_name, 'PUTDUK-FEE-REJECTED-' || upper(fee_name),
  'PUTDUK-FEE-REJECTED-' || upper(fee_name), fee_name),
  '22023', 'PLATFORM_FEES_PERMANENTLY_DISABLED',
  'future economic policy cannot introduce fee: ' || fee_name)
from (values ('krwDeposit'), ('usdtDepositConversion'), ('mining'),
  ('krwMiningRewardWithdrawal'), ('principalRecovery')) as fees(fee_name);
update policy_future_ctx set draft = pg_temp.policy_command('CREATE', 'policy-edited-create',
  p_version => 'PUTDUK-POLICY-EDITED-NUMBERS', p_config => configuration);
update policy_future_ctx set preview = pg_temp.policy_command('PREVIEW', 'policy-edited-preview',
  p_version => 'PUTDUK-POLICY-EDITED-NUMBERS', p_revision => (draft->>'revisionId')::uuid,
  p_digest => draft->>'configDigest', p_effective => (select effective_from + interval '2 days' from economy_policy_ctx));
update policy_future_ctx set approval = pg_temp.policy_command('APPROVE', 'policy-edited-approve',
  p_version => 'PUTDUK-POLICY-EDITED-NUMBERS', p_revision => (preview->>'revisionId')::uuid,
  p_digest => preview->>'configDigest', p_effective => (select effective_from + interval '2 days' from economy_policy_ctx));
update policy_future_ctx set publication = pg_temp.policy_command('PUBLISH', 'policy-edited-publish',
  p_version => 'PUTDUK-POLICY-EDITED-NUMBERS', p_revision => (approval->>'revisionId')::uuid,
  p_digest => approval->>'configDigest', p_effective => (select effective_from + interval '2 days' from economy_policy_ctx));
select is((select publication->>'state' from policy_future_ctx), 'PUBLISHED',
  'authorized new version changes numbers beyond initial ceilings through the full lifecycle');
select ok(pg_temp.policy_read('PUTDUK-POLICY-EDITED-NUMBERS')->'selectedVersion'->'configuration' =
  (select configuration from policy_future_ctx), 'administrator reads the exact newly published numeric configuration');
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select config->'platformFeesKrw'->>'krwMiningRewardWithdrawal'
  from app_private.economy_policy_versions where policy_version = 'PUTDUK-POLICY-EDITED-NUMBERS'),
  '0', 'the future policy preserves the permanent zero platform fee');
select is((select count(*)::integer from app_private.economy_policy_versions
  where policy_version like 'PUTDUK-FEE-REJECTED-%'), 0,
  'rejected positive-fee commands persist no draft version');
select is((select config->'tiers'->13->>'slots' from app_private.economy_policy_versions
  where policy_version = 'PUTDUK-POLICY-EDITED-NUMBERS'), '7', 'slot budget is versioned rather than fixed to initial five');
select is((select manifest_digest from app_private.economy_policy_versions where is_reference),
  '158c81e91923ba31f57b457ae3a33bc4092455e4abe2a2c888d5b5d2bc33b9e0',
  'new numeric policy does not rewrite the original approved bytes');

-- A nested temporary trigger is not a trusted command boundary. Even if it
-- reaches depth two, deferred reconciliation rejects an orphan version or an
-- attempt to make an APPROVED (not PUBLISHED) receipt effective.
create temporary table policy_guard_attack(mode text);
create function pg_temp.probe_policy_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
declare v_config jsonb; v_audit uuid := gen_random_uuid();
begin
  if new.mode = 'ORPHAN_VERSION' then
    select jsonb_set(config, '{policyVersion}', '"PUTDUK-POLICY-ORPHAN"') into v_config
    from app_private.economy_policy_versions where is_reference;
    insert into public.audit_logs(id, action, target_type, target_id, reason, request_id)
    values (v_audit, 'TEST_ORPHAN', 'TEST_ONLY', 'orphan-policy', 'Transaction rollback probe', gen_random_uuid());
    insert into app_private.economy_policy_versions(policy_version, manifest_text, manifest_digest,
      config, config_digest, approval_evidence, approval_evidence_digest, created_audit_id)
    values ('PUTDUK-POLICY-ORPHAN', v_config::text,
      encode(extensions.digest(convert_to(v_config::text, 'UTF8'), 'sha256'), 'hex'),
      v_config, encode(extensions.digest(convert_to(v_config::text, 'UTF8'), 'sha256'), 'hex'),
      v_config->>'approvalEvidence', (select approval_evidence_digest
        from app_private.economy_policy_versions where is_reference), v_audit);
  else
    insert into app_private.economy_policy_publications(policy_id, receipt_id, effective_from, published_at)
    select receipt.policy_id, receipt.id, receipt.effective_from, receipt.created_at
    from app_private.economy_policy_receipts as receipt
    where receipt.id = (select (competing_approval->>'revisionId')::uuid from pg_temp.economy_policy_ctx);
  end if;
  set constraints all immediate;
  return new;
end;
$$;
create trigger policy_guard_nested_probe before insert on policy_guard_attack
for each row execute function pg_temp.probe_policy_guard();
grant insert on policy_guard_attack to service_role;
grant execute on function pg_temp.probe_policy_guard() to service_role;
set local role service_role;
select throws_ok($$insert into pg_temp.policy_guard_attack values ('ORPHAN_VERSION')$$,
  '55000', 'ECONOMY_POLICY_RECEIPT_MISMATCH', 'nested depth alone cannot create policy without its canonical receipt');
select throws_ok($$insert into pg_temp.policy_guard_attack values ('UNPUBLISHED_RECEIPT')$$,
  '55000', 'ECONOMY_POLICY_RECEIPT_MISMATCH', 'nested depth cannot publish an unapproved transition');
reset role;
select is((select count(*)::integer from app_private.economy_policy_versions
  where policy_version = 'PUTDUK-POLICY-ORPHAN'), 0, 'deferred failure leaves no orphan policy source');

-- A newer unrevoked low-privilege role must override an older ADMIN grant.
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'VIEWER', admin_id from economy_policy_ctx;
set local role service_role;
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-demoted-actor', p_version => 'PUTDUK-POLICY-DEMOTED')$$,
  '42501', 'OPERATOR_ROLE_REQUIRED', 'latest role is checked, not any historical allowed role');
select throws_ok($$select pg_temp.policy_read()$$,
  '42501', 'OPERATOR_ROLE_REQUIRED', 'latest role change also removes policy read authority');
reset role;
update public.user_roles set revoked_at = clock_timestamp()
where user_id = (select admin_id from economy_policy_ctx) and role = 'VIEWER';

-- Failure injection runs through the real command; fixtures never synthesize
-- success state, the policy receipt, audit or completed logical key.
create function pg_temp.reject_policy_event() returns trigger language plpgsql as $$
begin
  if new.idempotency_key = 'economy-policy:policy-outbox-failure' then
    raise exception using errcode = 'P0001', message = 'POLICY_OUTBOX_FAILURE_INJECTED';
  end if;
  return new;
end;
$$;
create trigger test_policy_outbox_failure before insert on public.outbox_events
for each row execute function pg_temp.reject_policy_event();
set local role service_role;
select public.issue_admin_step_up(session_id, admin_id, 'ECONOMY_POLICY',
  'economy-policy-proof:policy-outbox-failure', 600) from economy_policy_ctx;
select throws_ok($$select pg_temp.policy_command('CREATE', 'policy-outbox-failure',
  p_version => 'PUTDUK-POLICY-FAILURE')$$,
  'P0001', 'POLICY_OUTBOX_FAILURE_INJECTED', 'outbox failure rejects the entire policy transition');
reset role;
select is((select count(*)::integer from app_private.economy_policy_versions
  where policy_version = 'PUTDUK-POLICY-FAILURE'), 0, 'failed outbox leaves no policy source');
select is((select count(*)::integer from public.audit_logs where target_id = 'PUTDUK-POLICY-FAILURE'),
  0, 'failed outbox leaves no orphaned approval audit');
select is((select count(*)::integer from app_private.idempotency_keys
  where scope = 'economy.policy' and idempotency_key = 'policy-outbox-failure'),
  0, 'failed transition leaves no completed or processing logical key');
select is((select count(*)::integer from public.admin_step_up_grants where
  token_hash = encode(extensions.digest('economy-policy-proof:policy-outbox-failure', 'sha256'), 'hex')
    and consumed_at is null and consume_request_id is null), 1,
  'the previously issued proof survives failure without consumption');
drop trigger test_policy_outbox_failure on public.outbox_events;
set local role service_role;
select is(pg_temp.policy_command('CREATE', 'policy-outbox-failure',
  p_version => 'PUTDUK-POLICY-FAILURE')->>'state', 'DRAFT',
  'the same key and unconsumed proof recover after a transient event failure');
reset role;
select is((select count(*)::integer from app_private.economy_policy_versions
  where policy_version = 'PUTDUK-POLICY-FAILURE'), 1, 'recovery writes one policy version');
select is((select count(*)::integer from public.admin_step_up_grants where
  token_hash = encode(extensions.digest('economy-policy-proof:policy-outbox-failure', 'sha256'), 'hex')
    and consumed_at is not null and consume_request_id is not null), 1,
  'successful recovery consumes the original proof exactly once');
set constraints all immediate;

select * from finish();
rollback;
