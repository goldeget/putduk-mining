begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.user_identity_profiles'::regclass
  ),
  'identity profiles enable and force RLS'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.user_consent_records'::regclass
  ),
  'consent evidence enables and forces RLS'
);

select ok(
  not has_table_privilege('anon', 'public.user_identity_profiles', 'SELECT'),
  'anonymous clients cannot read identity profiles'
);

select ok(
  not has_table_privilege('anon', 'public.user_consent_records', 'SELECT'),
  'anonymous clients cannot read consent evidence'
);

select ok(
  has_table_privilege('authenticated', 'public.user_identity_profiles', 'SELECT'),
  'authenticated clients can invoke the owner-filtered identity read'
);

select ok(
  not has_table_privilege('authenticated', 'public.user_identity_profiles', 'INSERT')
    and not has_table_privilege('authenticated', 'public.user_identity_profiles', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.user_identity_profiles', 'DELETE'),
  'authenticated clients cannot mutate server-owned identity rows'
);

select ok(
  has_table_privilege('authenticated', 'public.user_consent_records', 'SELECT'),
  'authenticated clients can invoke the owner-filtered consent read'
);

select ok(
  not has_table_privilege('authenticated', 'public.user_consent_records', 'INSERT')
    and not has_table_privilege('authenticated', 'public.user_consent_records', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.user_consent_records', 'DELETE'),
  'authenticated clients cannot forge or mutate consent evidence'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.is_login_id_available(text)',
    'EXECUTE'
  ),
  'the server role can check login ID availability'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.is_login_id_available(text)',
    'EXECUTE'
  ),
  'anonymous clients cannot enumerate login IDs through RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.is_login_id_available(text)',
    'EXECUTE'
  ),
  'authenticated clients cannot enumerate login IDs through RPC'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_login_email(text)',
    'EXECUTE'
  ),
  'the server role can resolve an ID for password authentication'
);

select ok(
  not has_function_privilege('anon', 'public.resolve_login_email(text)', 'EXECUTE')
    and not has_function_privilege(
      'authenticated',
      'public.resolve_login_email(text)',
      'EXECUTE'
    ),
  'client roles cannot resolve a login ID to private email'
);

select ok(
  not has_function_privilege(
    'service_role',
    'app_private.capture_public_signup_identity()',
    'EXECUTE'
  )
    and (
      select prosecdef
        and proconfig @> array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc
      where oid = 'app_private.capture_public_signup_identity()'::regprocedure
    ),
  'the signup capture function is trigger-only with a pinned privileged search path'
);

select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_catalog.pg_proc
    where oid = 'public.bootstrap_user(uuid)'::regprocedure
  ),
  'the server-only bootstrap owns the privileges needed for atomic foundations'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_user(uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.bootstrap_user(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.bootstrap_user(uuid)',
      'EXECUTE'
    ),
  'only the service role can invoke privileged account bootstrap'
);

select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_catalog.pg_proc
    where oid = 'public.is_login_id_available(text)'::regprocedure
  ),
  'the privileged availability lookup pins its search path'
);

select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_catalog.pg_proc
    where oid = 'public.resolve_login_email(text)'::regprocedure
  ),
  'the privileged email resolver pins its search path'
);

select is(
  public.is_login_id_available('INVALID ID'),
  false,
  'invalid login ID shapes are never reported as available'
);

select throws_ok(
  $query$
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
      updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
      '011d1d5d-4a7a-4b7d-89ea-57298ec48b9b',
      'authenticated',
      'authenticated',
      'missing-profile@putduk.test',
      '',
      statement_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      statement_timestamp(), statement_timestamp(), '', '', '', ''
    )
  $query$,
  '23514',
  'PUBLIC_SIGNUP_PROFILE_REQUIRED',
  'an Auth API email signup cannot bypass the required profile contract'
);

select throws_ok(
  $query$
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
      updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
      'b777210b-5df3-468e-bba8-35f4875b7c3c',
      'authenticated',
      'authenticated',
      'unsupported-provider@putduk.test',
      '',
      statement_timestamp(),
      '{"provider":"google","providers":["google"]}'::jsonb,
      '{}'::jsonb,
      statement_timestamp(), statement_timestamp(), '', '', '', ''
    )
  $query$,
  '22023',
  'AUTH_PROVIDER_NOT_SUPPORTED',
  'an unapproved identity provider fails closed'
);

select throws_ok(
  $query$
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
      updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
      'cff604b7-9e1f-45ef-a45c-7a5dd39930cb',
      'authenticated',
      'authenticated',
      'wrong-consent-version@putduk.test',
      '',
      statement_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'signup_source', 'PUBLIC_V1',
        'login_id', 'wrong_version',
        'legal_name', '김퍼뜭',
        'date_of_birth', '1990-01-01',
        'phone_e164', '+821011112222',
        'recovery_email', 'wrong-consent-version@putduk.test',
        'service_terms_granted', true,
        'service_terms_version', 'TERMS-KO-UNAPPROVED',
        'privacy_granted', true,
        'privacy_version', 'PRIVACY-KO-2026-09-27',
        'marketing_granted', false,
        'marketing_version', 'MARKETING-KO-2026-09-27'
      ),
      statement_timestamp(), statement_timestamp(), '', '', '', ''
    )
  $query$,
  '23514',
  'UNAPPROVED_CONSENT_VERSION',
  'unapproved legal document versions fail closed'
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
  updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
  '3f7be82f-785a-4074-bc53-e8be020ceb4d',
  'authenticated',
  'authenticated',
  'identity-owner@putduk.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'signup_source', 'PUBLIC_V1',
    'login_id', 'owner_01',
    'legal_name', '박퍼뜭',
    'date_of_birth', '1992-09-27',
    'phone_e164', '+821012345678',
    'recovery_email', 'identity-owner@putduk.test',
    'service_terms_granted', true,
    'service_terms_version', 'TERMS-KO-2026-09-27',
    'privacy_granted', true,
    'privacy_version', 'PRIVACY-KO-2026-09-27',
    'marketing_granted', false,
    'marketing_version', 'MARKETING-KO-2026-09-27'
  ),
  statement_timestamp(), statement_timestamp(), '', '', '', ''
);

select ok(
  (
    select login_id = 'owner_01'
      and legal_name = '박퍼뜭'
      and date_of_birth = date '1992-09-27'
      and phone_e164 = '+821012345678'
      and recovery_email = 'identity-owner@putduk.test'
    from public.user_identity_profiles
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
  ),
  'the Auth insert atomically captures normalized server-owned identity'
);

select ok(
  exists (
    select 1
    from public.user_profiles
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and display_name = '박퍼뜭'
  )
    and exists (
      select 1
      from public.user_settings
      where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
    )
    and exists (
      select 1
      from public.notification_preferences
      where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
    )
    and (
      select count(*) = 1
        and bool_and(currency = 'KRW')
      from public.wallet_accounts
      where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
    )
    and not exists (
      select 1
      from public.wallet_accounts
      where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
        and currency = 'USDT'
    ),
  'signup bootstraps profile, settings, and a KRW wallet only'
);

select is(
  (
    select count(*)::integer
    from public.user_consent_records
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
  ),
  3,
  'signup records separate terms, privacy, and marketing evidence'
);

select is(
  (
    select count(distinct request_id)::integer
    from public.user_consent_records
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
  ),
  1,
  'the three signup choices share one correlation request ID'
);

select is(
  (
    select granted
    from public.user_consent_records
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and consent_key = 'MARKETING'
  ),
  false,
  'optional marketing refusal is retained as affirmative evidence'
);

select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and event_type = 'MEMBER_PROFILE_CAPTURED.v1'
  ),
  1,
  'signup emits one versioned profile-captured outbox event'
);

select is(
  (
    select count(*)::integer
    from public.member_timeline_events
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and event_type = 'MEMBER_PROFILE_CAPTURED'
  ),
  1,
  'signup appends one member timeline fact'
);

update auth.users
set raw_user_meta_data = raw_user_meta_data || '{"login_id":"forged_admin"}'::jsonb
where id = '3f7be82f-785a-4074-bc53-e8be020ceb4d';

select is(
  (
    select login_id
    from public.user_identity_profiles
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
  ),
  'owner_01',
  'later user_metadata edits cannot change server-owned identity truth'
);

select throws_ok(
  $query$
    update public.user_consent_records
    set granted = true
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and consent_key = 'MARKETING'
  $query$,
  '55000',
  'user_consent_records is append-only',
  'consent evidence cannot be rewritten'
);

select throws_ok(
  $query$
    delete from public.user_consent_records
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and consent_key = 'MARKETING'
  $query$,
  '55000',
  'user_consent_records is append-only',
  'consent evidence cannot be deleted'
);

select lives_ok(
  $query$
    insert into public.user_consent_records (
      user_id,
      consent_key,
      consent_version,
      granted,
      captured_via,
      request_id,
      metadata
    ) values (
      '3f7be82f-785a-4074-bc53-e8be020ceb4d',
      'MARKETING',
      'MARKETING-KO-2026-09-27',
      true,
      'SETTINGS',
      '27684480-790d-4135-98d3-ef062d1b1c99',
      '{"locale":"ko-KR"}'::jsonb
    )
  $query$,
  'a later optional-consent choice is appended under the same document version'
);

select is(
  (
    select count(*)::integer
    from public.user_consent_records
    where user_id = '3f7be82f-785a-4074-bc53-e8be020ceb4d'
      and consent_key = 'MARKETING'
      and consent_version = 'MARKETING-KO-2026-09-27'
  ),
  2,
  'optional consent history preserves both refusal and later grant'
);

select set_config(
  'request.jwt.claim.sub',
  '3f7be82f-785a-4074-bc53-e8be020ceb4d',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.user_identity_profiles),
  1,
  'an authenticated owner reads exactly their identity row'
);

select is(
  (select count(*)::integer from public.user_consent_records),
  4,
  'an authenticated owner reads exactly their consent history'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'e0767225-5d04-48f1-81a6-29614a98b8e9',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.user_identity_profiles),
  0,
  'another authenticated user cannot read the owner identity row'
);

select is(
  (select count(*)::integer from public.user_consent_records),
  0,
  'another authenticated user cannot read the owner consent history'
);

reset role;

select is(
  public.is_login_id_available('owner_01'),
  false,
  'the server availability function rejects a captured login ID'
);

select is(
  public.is_login_id_available('fresh_01'),
  true,
  'the server availability function accepts a valid unused login ID'
);

select is(
  public.resolve_login_email('OWNER_01'),
  'identity-owner@putduk.test',
  'the server resolver normalizes login ID case without exposing the RPC to clients'
);

select is(
  (
    select count(*)::integer
    from public.user_consent_records
    where consent_key in ('SERVICE_TERMS', 'PRIVACY')
      and granted
      and consent_version in (
        'TERMS-KO-2026-09-27',
        'PRIVACY-KO-2026-09-27'
      )
  ),
  2,
  'both required consents retain approved version and granted evidence'
);

select * from finish();

rollback;
