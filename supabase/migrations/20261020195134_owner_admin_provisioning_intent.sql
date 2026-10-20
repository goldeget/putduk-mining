begin;

-- Owner-authorized maintenance admission for one planned NEW Auth identity.
-- No public RPC, new SECURITY DEFINER, member identity/consent, or money writer.
create table app_private.owner_admin_provision_intents (
  request_id uuid primary key,
  planned_auth_user_id uuid not null unique,
  email_sha256 text not null check (email_sha256 ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'OWNER_SUPER_ADMIN' check (purpose = 'OWNER_SUPER_ADMIN'),
  role public.app_role not null default 'SUPER_ADMIN' check (role = 'SUPER_ADMIN'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  reason text not null check (reason = btrim(reason) and char_length(reason) between 10 and 500),
  authorization_reference text not null check (
    authorization_reference ~ '^[A-Za-z0-9][A-Za-z0-9:/._# -]{0,239}$'
  ),
  constraint owner_admin_provision_intent_window check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  )
);

create table app_private.owner_admin_provision_receipts (
  request_id uuid primary key references app_private.owner_admin_provision_intents(request_id),
  auth_user_id uuid not null unique references auth.users(id),
  role_id uuid not null unique references public.user_roles(id),
  audit_id uuid not null unique references public.audit_logs(id),
  committed_at timestamptz not null,
  receipt_digest text not null check (receipt_digest ~ '^[0-9a-f]{64}$')
);

alter table app_private.owner_admin_provision_intents enable row level security;
alter table app_private.owner_admin_provision_intents force row level security;
alter table app_private.owner_admin_provision_receipts enable row level security;
alter table app_private.owner_admin_provision_receipts force row level security;
revoke all on app_private.owner_admin_provision_intents from public, anon, authenticated, service_role;
revoke all on app_private.owner_admin_provision_receipts from public, anon, authenticated, service_role;
grant select, insert on app_private.owner_admin_provision_intents to service_role;
grant select on app_private.owner_admin_provision_receipts to service_role;

create function app_private.guard_owner_admin_provision_intent()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  if new.created_at is distinct from statement_timestamp()
    or new.expires_at is null or new.expires_at <= clock_timestamp()
    or new.expires_at > new.created_at + interval '15 minutes'
  then
    raise exception using errcode = '23514', message = 'OWNER_ADMIN_INTENT_WINDOW_INVALID';
  end if;
  -- Intent registration is privileged maintenance SQL. Do not grant service_role
  -- broad auth.users reads merely to make its table INSERT ACL sufficient.
  if not has_table_privilege(current_user, 'auth.users', 'SELECT') then
    raise exception using errcode = '42501', message = 'OWNER_ADMIN_INTENT_REGISTRATION_PRIVILEGE_REQUIRED';
  end if;
  if exists(select 1 from auth.users where id = new.planned_auth_user_id) then
    raise exception using errcode = '23514', message = 'OWNER_ADMIN_NEW_IDENTITY_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_owner_admin_provision_intent() from public, anon, authenticated, service_role;
create trigger owner_admin_provision_intent_admission before insert
on app_private.owner_admin_provision_intents for each row
execute function app_private.guard_owner_admin_provision_intent();
create trigger owner_admin_provision_intents_immutable before update or delete
on app_private.owner_admin_provision_intents for each row
execute function app_private.prevent_row_mutation();
create trigger owner_admin_provision_receipts_immutable before update or delete
on app_private.owner_admin_provision_receipts for each row
execute function app_private.prevent_row_mutation();

create function app_private.capture_owner_admin_provision(
  p_auth_user_id uuid, p_email text, p_provider text,
  p_flow text, p_request_id text
)
returns boolean language plpgsql volatile security invoker set search_path = pg_catalog
as $$
declare
  v_intent app_private.owner_admin_provision_intents%rowtype;
  v_request_id uuid;
  v_role_id uuid;
  v_audit_id uuid;
  v_committed_at timestamptz;
  v_receipt_digest text;
begin
  if p_flow is distinct from 'OWNER_ADMIN_PROVISION_V1' then
    return false;
  end if;
  if pg_trigger_depth() <> 1 then
    raise exception using errcode = '42501', message = 'OWNER_ADMIN_TRIGGER_ONLY';
  end if;
  if p_request_id is null or p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'OWNER_ADMIN_REQUEST_INVALID';
  end if;
  v_request_id := p_request_id::uuid;
  select * into v_intent from app_private.owner_admin_provision_intents
  where request_id = v_request_id for update;
  if not found or v_intent.created_at > clock_timestamp()
    or v_intent.expires_at <= clock_timestamp()
    or exists(select 1 from app_private.owner_admin_provision_receipts where request_id = v_request_id)
  then
    raise exception using errcode = '23514', message = 'OWNER_ADMIN_INTENT_UNAVAILABLE';
  end if;
  if v_intent.purpose <> 'OWNER_SUPER_ADMIN' or v_intent.role <> 'SUPER_ADMIN'
    or p_auth_user_id is distinct from v_intent.planned_auth_user_id
    or p_provider is distinct from 'email' or p_email is null
    or encode(extensions.digest(convert_to(lower(btrim(p_email)), 'UTF8'), 'sha256'), 'hex')
      is distinct from v_intent.email_sha256
  then
    raise exception using errcode = '23514', message = 'OWNER_ADMIN_INTENT_MISMATCH';
  end if;
  if exists(select 1 from public.user_profiles where user_id = p_auth_user_id)
    or exists(select 1 from public.user_roles where user_id = p_auth_user_id)
    or exists(select 1 from public.user_identity_profiles where user_id = p_auth_user_id)
    or exists(select 1 from public.user_consent_records where user_id = p_auth_user_id)
  then
    raise exception using errcode = '23514', message = 'OWNER_ADMIN_NEW_IDENTITY_REQUIRED';
  end if;

  insert into public.user_profiles(user_id, display_name) values(p_auth_user_id, '운영자');
  insert into public.user_roles(user_id, role, granted_by)
  values(p_auth_user_id, 'SUPER_ADMIN', null) returning id into v_role_id;
  v_committed_at := clock_timestamp();
  insert into public.audit_logs(
    actor_user_id, actor_role, action, target_type, target_id,
    reason, request_id, after_state, metadata
  ) values (
    null, null, 'role.owner_authorized_new_super_admin', 'user_role', v_role_id::text,
    v_intent.reason, v_request_id,
    jsonb_build_object('user_id', p_auth_user_id, 'role_id', v_role_id,
      'role', 'SUPER_ADMIN', 'granted_at', v_committed_at),
    jsonb_build_object('authorization_source', 'OWNER_DIRECT_CURRENT_CHAT',
      'purpose', 'OWNER_SUPER_ADMIN', 'new_identity_only', true,
      'authorization_reference', v_intent.authorization_reference)
  ) returning id into v_audit_id;
  v_receipt_digest := encode(extensions.digest(
    jsonb_build_object('request_id', v_request_id, 'auth_user_id', p_auth_user_id,
      'role_id', v_role_id, 'audit_id', v_audit_id,
      'committed_at', to_char(v_committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,
    'sha256'), 'hex');
  insert into app_private.owner_admin_provision_receipts(
    request_id, auth_user_id, role_id, audit_id, committed_at, receipt_digest
  ) values(v_request_id, p_auth_user_id, v_role_id, v_audit_id, v_committed_at, v_receipt_digest);
  if not exists(
    select 1 from app_private.owner_admin_provision_receipts r
    join public.user_roles u on u.id = r.role_id and u.user_id = r.auth_user_id
    join public.audit_logs a on a.id = r.audit_id and a.request_id = r.request_id
      and a.target_type = 'user_role' and a.target_id = r.role_id::text
    where r.request_id = v_request_id and r.auth_user_id = p_auth_user_id
      and u.role = 'SUPER_ADMIN' and u.granted_by is null and u.revoked_at is null
      and a.action = 'role.owner_authorized_new_super_admin'
      and a.actor_user_id is null and a.actor_role is null
      and r.receipt_digest = v_receipt_digest
  ) then
    raise exception using errcode = '23514', message = 'OWNER_ADMIN_RECEIPT_UNCONFIRMED';
  end if;
  return true;
end;
$$;
revoke all on function app_private.capture_owner_admin_provision(uuid,text,text,text,text)
  from public, anon, authenticated, service_role;

-- Fail closed if the deployed existing PUBLIC_V1 body differs from the reviewed
-- source/actual metadata. No other existing function or trigger is replaced.
do $$
begin
  if (select encode(extensions.digest(prosrc, 'sha256'), 'hex') from pg_proc
      where oid = 'app_private.capture_public_signup_identity()'::regprocedure)
      is distinct from 'aa8866a8ec616fe3b0166edd5937f26621ec552e773e28b188163c7875d80720'
  then
    raise exception using errcode = '23514', message = 'ORIGINAL_SIGNUP_CAPTURE_SOURCE_CHANGED';
  end if;
end;
$$;
create or replace function app_private.capture_public_signup_identity()
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
  -- BEGIN owner-only provision intent; the original PUBLIC_V1 body follows unchanged.
  if app_private.capture_owner_admin_provision(
    new.id, new.email, new.raw_app_meta_data ->> 'provider',
    new.raw_user_meta_data ->> 'identity_flow',
    new.raw_user_meta_data ->> 'provision_request_id'
  ) then
    return new;
  end if;
  -- END owner-only provision intent.
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
comment on table app_private.owner_admin_provision_intents is 'Private, immutable owner approval for one planned new SUPER_ADMIN Auth identity, valid for at most fifteen minutes. Register through privileged maintenance SQL; no secret or plaintext email is stored.';
comment on table app_private.owner_admin_provision_receipts is 'Immutable atomic binding of the new owner Auth identity, role, audit and consumed provisioning intent.';
commit;
