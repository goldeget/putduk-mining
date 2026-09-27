begin;

create table public.user_identity_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  login_id text not null,
  legal_name text not null,
  date_of_birth date not null,
  phone_e164 text not null,
  recovery_email text not null,
  verified_phone_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint user_identity_profiles_login_id_format
    check (login_id ~ '^[a-z][a-z0-9_]{3,19}$'),
  constraint user_identity_profiles_legal_name_length
    check (char_length(btrim(legal_name)) between 2 and 40),
  constraint user_identity_profiles_legal_name_normalized
    check (legal_name = btrim(legal_name)),
  constraint user_identity_profiles_date_of_birth_floor
    check (date_of_birth >= date '1900-01-01'),
  constraint user_identity_profiles_date_of_birth_ceiling
    check (date_of_birth <= current_date),
  constraint user_identity_profiles_phone_format
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint user_identity_profiles_recovery_email_format
    check (
      recovery_email = lower(btrim(recovery_email))
      and recovery_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
);

create unique index user_identity_profiles_login_id_unique_idx
  on public.user_identity_profiles (lower(login_id));
create unique index user_identity_profiles_phone_unique_idx
  on public.user_identity_profiles (phone_e164);
create unique index user_identity_profiles_recovery_email_unique_idx
  on public.user_identity_profiles (lower(recovery_email));

create table public.user_consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_key text not null,
  consent_version text not null,
  granted boolean not null,
  captured_via text not null,
  request_id uuid not null,
  captured_at timestamptz not null default statement_timestamp(),
  metadata jsonb not null default '{}'::jsonb,
  constraint user_consent_records_key
    check (consent_key in ('SERVICE_TERMS', 'PRIVACY', 'MARKETING')),
  constraint user_consent_records_version_format
    check (consent_version ~ '^[A-Z0-9][A-Z0-9._-]{2,63}$'),
  constraint user_consent_records_capture_source
    check (captured_via in ('SIGNUP', 'SETTINGS', 'ADMIN_LEGAL_UPDATE')),
  constraint user_consent_records_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint user_consent_records_request_once
    unique (user_id, consent_key, consent_version, request_id)
);

create index user_consent_records_user_key_captured_idx
  on public.user_consent_records (user_id, consent_key, captured_at desc, id desc);

create trigger user_identity_profiles_set_updated_at
before update on public.user_identity_profiles
for each row execute function app_private.set_updated_at();

create trigger user_consent_records_prevent_update_delete
before update or delete on public.user_consent_records
for each row execute function app_private.prevent_row_mutation();

alter table public.user_identity_profiles enable row level security;
alter table public.user_identity_profiles force row level security;
alter table public.user_consent_records enable row level security;
alter table public.user_consent_records force row level security;

revoke all on table public.user_identity_profiles from anon, authenticated, service_role;
revoke all on table public.user_consent_records from anon, authenticated, service_role;
grant select on public.user_identity_profiles to authenticated, service_role;
grant select on public.user_consent_records to authenticated, service_role;

create policy user_identity_profiles_select_own
on public.user_identity_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_consent_records_select_own
on public.user_consent_records
for select
to authenticated
using ((select auth.uid()) = user_id);

-- bootstrap_user is invoked through a server-only service-role RPC. Its former
-- invoker mode depended on broad table/auth-schema grants that are intentionally
-- absent under the opt-in Data API model.
alter function public.bootstrap_user(uuid) security definer;
alter function public.bootstrap_user(uuid) set search_path = pg_catalog;
revoke all on function public.bootstrap_user(uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_user(uuid)
  to service_role;

create function public.is_login_id_available(p_login_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    coalesce(p_login_id, '') ~ '^[a-z][a-z0-9_]{3,19}$'
    and not exists (
      select 1
      from public.user_identity_profiles as identity
      where lower(identity.login_id) = lower(p_login_id)
    );
$$;

revoke all on function public.is_login_id_available(text)
  from public, anon, authenticated;
grant execute on function public.is_login_id_available(text)
  to service_role;

create function public.resolve_login_email(p_login_id text)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth_user.email
  from public.user_identity_profiles as identity
  join auth.users as auth_user on auth_user.id = identity.user_id
  where lower(identity.login_id) = lower(btrim(p_login_id))
  limit 1;
$$;

revoke all on function public.resolve_login_email(text)
  from public, anon, authenticated;
grant execute on function public.resolve_login_email(text)
  to service_role;

create function app_private.capture_public_signup_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_login_id text;
  v_legal_name text;
  v_date_of_birth date;
  v_phone_e164 text;
  v_recovery_email text;
  v_terms_version text;
  v_privacy_version text;
  v_marketing_version text;
  v_service_terms_granted boolean;
  v_privacy_granted boolean;
  v_marketing_granted boolean;
  v_provider text;
  v_request_id uuid := gen_random_uuid();
begin
  -- Direct SQL fixtures and trusted maintenance inserts do not carry a provider.
  -- Every Auth API-created identity does, so unsupported/bypassed public signups
  -- fail closed without coupling production migrations to test-only metadata.
  v_provider := btrim(coalesce(new.raw_app_meta_data ->> 'provider', ''));
  if v_provider = '' then
    return new;
  end if;
  if v_provider <> 'email' then
    raise exception using errcode = '22023', message = 'AUTH_PROVIDER_NOT_SUPPORTED';
  end if;
  if coalesce(new.raw_user_meta_data ->> 'signup_source', '') <> 'PUBLIC_V1' then
    raise exception using errcode = '23514', message = 'PUBLIC_SIGNUP_PROFILE_REQUIRED';
  end if;

  v_login_id := lower(btrim(coalesce(new.raw_user_meta_data ->> 'login_id', '')));
  v_legal_name := btrim(coalesce(new.raw_user_meta_data ->> 'legal_name', ''));
  v_phone_e164 := btrim(coalesce(new.raw_user_meta_data ->> 'phone_e164', ''));
  v_recovery_email := lower(btrim(coalesce(new.raw_user_meta_data ->> 'recovery_email', '')));
  v_terms_version := btrim(coalesce(new.raw_user_meta_data ->> 'service_terms_version', ''));
  v_privacy_version := btrim(coalesce(new.raw_user_meta_data ->> 'privacy_version', ''));
  v_marketing_version := btrim(coalesce(new.raw_user_meta_data ->> 'marketing_version', ''));

  if jsonb_typeof(new.raw_user_meta_data -> 'service_terms_granted') is distinct from 'boolean'
    or jsonb_typeof(new.raw_user_meta_data -> 'privacy_granted') is distinct from 'boolean'
    or jsonb_typeof(new.raw_user_meta_data -> 'marketing_granted') is distinct from 'boolean'
  then
    raise exception using errcode = '23514', message = 'INVALID_CONSENT_EVIDENCE';
  end if;

  v_service_terms_granted := (new.raw_user_meta_data ->> 'service_terms_granted')::boolean;
  v_privacy_granted := (new.raw_user_meta_data ->> 'privacy_granted')::boolean;
  v_marketing_granted := (new.raw_user_meta_data ->> 'marketing_granted')::boolean;

  begin
    v_date_of_birth := (new.raw_user_meta_data ->> 'date_of_birth')::date;
  exception when others then
    raise exception using errcode = '22007', message = 'INVALID_DATE_OF_BIRTH';
  end;

  if v_date_of_birth is null
    or v_date_of_birth < date '1900-01-01'
    or v_date_of_birth > current_date
  then
    raise exception using errcode = '22007', message = 'INVALID_DATE_OF_BIRTH';
  end if;
  if not v_service_terms_granted or not v_privacy_granted then
    raise exception using errcode = '23514', message = 'REQUIRED_CONSENT_MISSING';
  end if;
  if v_terms_version <> 'TERMS-KO-2026-09-27'
    or v_privacy_version <> 'PRIVACY-KO-2026-09-27'
    or v_marketing_version <> 'MARKETING-KO-2026-09-27'
  then
    raise exception using errcode = '23514', message = 'UNAPPROVED_CONSENT_VERSION';
  end if;
  if v_recovery_email <> lower(btrim(coalesce(new.email, ''))) then
    raise exception using errcode = '23514', message = 'RECOVERY_EMAIL_MISMATCH';
  end if;

  insert into public.user_identity_profiles (
    user_id,
    login_id,
    legal_name,
    date_of_birth,
    phone_e164,
    recovery_email
  ) values (
    new.id,
    v_login_id,
    v_legal_name,
    v_date_of_birth,
    v_phone_e164,
    v_recovery_email
  );

  insert into public.user_profiles (user_id, display_name)
  values (new.id, v_legal_name)
  on conflict (user_id) do update
  set display_name = excluded.display_name;

  -- Complete every application-owned account foundation in the same Auth
  -- transaction. The command remains idempotent for later login recovery.
  perform public.bootstrap_user(new.id);

  insert into public.user_consent_records (
    user_id,
    consent_key,
    consent_version,
    granted,
    captured_via,
    request_id,
    metadata
  ) values
    (new.id, 'SERVICE_TERMS', v_terms_version, true, 'SIGNUP', v_request_id, jsonb_build_object('locale', 'ko-KR')),
    (new.id, 'PRIVACY', v_privacy_version, true, 'SIGNUP', v_request_id, jsonb_build_object('locale', 'ko-KR')),
    (new.id, 'MARKETING', v_marketing_version, v_marketing_granted, 'SIGNUP', v_request_id, jsonb_build_object('locale', 'ko-KR'));

  insert into public.outbox_events (
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    payload,
    correlation_id,
    request_id,
    idempotency_key
  ) values (
    'MEMBER_PROFILE_CAPTURED.v1',
    1,
    'user_identity_profile',
    new.id,
    new.id,
    jsonb_build_object(
      'user_id', new.id,
      'required_consent_versions', jsonb_build_array(v_terms_version, v_privacy_version),
      'marketing_granted', v_marketing_granted
    ),
    v_request_id,
    v_request_id,
    'member-profile:' || new.id::text
  );

  insert into public.member_timeline_events (
    user_id,
    event_type,
    source_type,
    source_id,
    summary_code,
    metadata,
    occurred_at
  ) values (
    new.id,
    'MEMBER_PROFILE_CAPTURED',
    'user_identity_profile',
    new.id,
    'SIGNUP_PROFILE_COMPLETED',
    jsonb_build_object('consent_version', v_terms_version),
    statement_timestamp()
  );

  return new;
end;
$$;

revoke all on function app_private.capture_public_signup_identity()
  from public, anon, authenticated, service_role;

create trigger capture_public_signup_identity
after insert on auth.users
for each row execute function app_private.capture_public_signup_identity();

comment on table public.user_identity_profiles is
  'Server-captured signup identity. raw_user_meta_data is input only and is never an authorization source.';
comment on table public.user_consent_records is
  'Append-only, versioned consent evidence. Required and optional choices remain distinct.';
comment on function public.resolve_login_email(text) is
  'Service-role-only login identifier resolution. Authentication responses must remain enumeration-resistant.';

commit;
