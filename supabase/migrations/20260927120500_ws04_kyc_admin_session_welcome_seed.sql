begin;

-- ---------------------------------------------------------------------------
-- KYC commands
-- ---------------------------------------------------------------------------

create function public.open_kyc_case(
  p_user_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_case_id uuid;
begin
  if p_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'INVALID_KYC_OPEN';
  end if;

  select kyc.id into v_case_id
  from public.kyc_cases as kyc
  where kyc.user_id = p_user_id
    and kyc.status in ('PENDING', 'IN_REVIEW', 'ON_HOLD', 'REQUIRES_RESUBMISSION')
  for update;

  if v_case_id is not null then
    return v_case_id;
  end if;

  insert into public.kyc_cases (user_id, status)
  values (p_user_id, 'PENDING')
  returning id into v_case_id;

  insert into public.kyc_status_history (
    case_id, from_status, to_status, actor_user_id, reason, request_id
  ) values (
    v_case_id, null, 'PENDING', p_user_id, 'KYC case opened', p_request_id
  );

  return v_case_id;
end;
$$;

revoke all on function public.open_kyc_case(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.open_kyc_case(uuid, uuid) to service_role;

create function public.submit_kyc_documents(
  p_case_id uuid,
  p_user_id uuid,
  p_document_kind text,
  p_protected_storage_path text,
  p_content_sha256 text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_case public.kyc_cases%rowtype;
  v_submission_id uuid;
begin
  if p_case_id is null
    or p_user_id is null
    or char_length(btrim(coalesce(p_document_kind, ''))) < 2
    or char_length(btrim(coalesce(p_protected_storage_path, ''))) < 3
    or p_protected_storage_path ~* '^https?://'
    or coalesce(p_content_sha256, '') !~ '^[A-Fa-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_KYC_DOCUMENT';
  end if;

  select kyc.* into v_case
  from public.kyc_cases as kyc
  where kyc.id = p_case_id
    and kyc.user_id = p_user_id
  for update;

  if v_case.id is null then
    raise exception using errcode = '55000', message = 'KYC_CASE_NOT_FOUND';
  end if;

  if v_case.status not in ('PENDING', 'REQUIRES_RESUBMISSION', 'ON_HOLD', 'IN_REVIEW') then
    raise exception using errcode = '55000', message = 'KYC_CASE_NOT_ACCEPTING_DOCUMENTS';
  end if;

  insert into public.kyc_submissions (
    case_id, user_id, document_kind, protected_storage_path, content_sha256
  ) values (
    p_case_id,
    p_user_id,
    btrim(p_document_kind),
    btrim(p_protected_storage_path),
    lower(p_content_sha256)
  ) returning id into v_submission_id;

  if v_case.status in ('PENDING', 'REQUIRES_RESUBMISSION') then
    update public.kyc_cases
    set status = 'IN_REVIEW'
    where id = p_case_id;

    insert into public.kyc_status_history (
      case_id, from_status, to_status, actor_user_id, reason, request_id
    ) values (
      p_case_id, v_case.status, 'IN_REVIEW', p_user_id, 'Documents submitted', p_request_id
    );
  end if;

  return v_submission_id;
end;
$$;

revoke all on function public.submit_kyc_documents(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_kyc_documents(uuid, uuid, text, text, text, uuid)
  to service_role;

create function public.review_kyc_case(
  p_case_id uuid,
  p_actor uuid,
  p_to_status public.kyc_status,
  p_reason text,
  p_request_id uuid,
  p_view_submission_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_case public.kyc_cases%rowtype;
begin
  if p_case_id is null
    or p_actor is null
    or p_to_status is null
    or char_length(btrim(coalesce(p_reason, ''))) < 4
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_KYC_REVIEW';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select kyc.* into v_case
  from public.kyc_cases as kyc
  where kyc.id = p_case_id
  for update;

  if v_case.id is null then
    raise exception using errcode = '55000', message = 'KYC_CASE_NOT_FOUND';
  end if;

  if p_view_submission_id is not null then
    if not exists (
      select 1 from public.kyc_submissions as submission
      where submission.id = p_view_submission_id
        and submission.case_id = p_case_id
    ) then
      raise exception using errcode = '55000', message = 'KYC_DOCUMENT_NOT_FOUND';
    end if;

    insert into public.kyc_document_view_audit (
      submission_id, case_id, viewer_user_id, request_id
    ) values (
      p_view_submission_id, p_case_id, p_actor, p_request_id
    )
    on conflict (submission_id, viewer_user_id, request_id) do nothing;
  end if;

  if p_to_status not in (
    'PENDING', 'IN_REVIEW', 'APPROVED', 'ON_HOLD', 'REJECTED', 'REQUIRES_RESUBMISSION'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_KYC_STATUS';
  end if;

  update public.kyc_cases
  set
    status = p_to_status,
    reviewed_by = p_actor,
    decided_at = case
      when p_to_status in ('APPROVED', 'REJECTED') then statement_timestamp()
      else decided_at
    end,
    decision_reason = p_reason
  where id = p_case_id;

  insert into public.kyc_status_history (
    case_id, from_status, to_status, actor_user_id, reason, request_id
  ) values (
    p_case_id, v_case.status, p_to_status, p_actor, p_reason, p_request_id
  );

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, request_id,
    before_state, after_state
  ) values (
    p_actor,
    'kyc_case.review',
    'kyc_case',
    p_case_id::text,
    p_reason,
    p_request_id,
    jsonb_build_object('status', v_case.status),
    jsonb_build_object('status', p_to_status)
  );

  return p_case_id;
end;
$$;

revoke all on function public.review_kyc_case(
  uuid, uuid, public.kyc_status, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.review_kyc_case(
  uuid, uuid, public.kyc_status, text, uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Admin session + step-up + auth rate limit
-- ---------------------------------------------------------------------------

create function public.register_admin_session(
  p_user_id uuid,
  p_auth_session_id text,
  p_session_fingerprint text,
  p_user_agent text default null,
  p_idle_seconds integer default 1800,
  p_absolute_seconds integer default 28800
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_id uuid;
begin
  if p_user_id is null
    or char_length(btrim(coalesce(p_auth_session_id, ''))) < 8
    or char_length(btrim(coalesce(p_session_fingerprint, ''))) < 8
    or coalesce(p_idle_seconds, 0) not between 300 and 7200
    or coalesce(p_absolute_seconds, 0) not between 1800 and 86400
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_SESSION';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_user_id
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  perform app_private.touch_command_rate_limit(
    'ADMIN_AUTH',
    p_user_id::text,
    30,
    900,
    900
  );

  update public.admin_sessions
  set
    revoked_at = statement_timestamp(),
    revoke_reason = 'SUPERSEDED_BY_NEW_SESSION'
  where user_id = p_user_id
    and auth_session_id = p_auth_session_id
    and revoked_at is null;

  insert into public.admin_sessions (
    user_id,
    auth_session_id,
    session_fingerprint,
    idle_expires_at,
    absolute_expires_at,
    user_agent
  ) values (
    p_user_id,
    btrim(p_auth_session_id),
    btrim(p_session_fingerprint),
    statement_timestamp() + make_interval(secs => p_idle_seconds),
    statement_timestamp() + make_interval(secs => p_absolute_seconds),
    left(coalesce(p_user_agent, ''), 500)
  ) returning id into v_id;

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_user_id,
    'ADMIN_SESSION_REGISTERED',
    null,
    'NONE',
    jsonb_build_object('admin_session_id', v_id),
    gen_random_uuid()
  );

  return v_id;
end;
$$;

revoke all on function public.register_admin_session(
  uuid, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.register_admin_session(
  uuid, text, text, text, integer, integer
) to service_role;

create function public.revoke_admin_session(
  p_session_id uuid,
  p_actor uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_session_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_SESSION_REVOKE';
  end if;

  update public.admin_sessions
  set revoked_at = statement_timestamp(), revoke_reason = p_reason
  where id = p_session_id
    and revoked_at is null
    and (user_id = p_actor or exists (
      select 1 from public.user_roles as role
      where role.user_id = p_actor
        and role.role in ('SUPER_ADMIN', 'ADMIN')
        and role.revoked_at is null
    ));

  if not found then
    raise exception using errcode = '55000', message = 'ADMIN_SESSION_NOT_FOUND';
  end if;

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_actor,
    'ADMIN_SESSION_REVOKED',
    null,
    'NONE',
    jsonb_build_object('admin_session_id', p_session_id, 'reason', p_reason),
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.revoke_admin_session(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_admin_session(uuid, uuid, text)
  to service_role;

create function public.revoke_all_admin_sessions(
  p_user_id uuid,
  p_actor uuid,
  p_reason text
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_count integer;
begin
  if p_user_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_SESSION_REVOKE_ALL';
  end if;

  if p_user_id <> p_actor and not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  update public.admin_sessions
  set revoked_at = statement_timestamp(), revoke_reason = p_reason
  where user_id = p_user_id
    and revoked_at is null;

  get diagnostics v_count = row_count;

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_actor,
    'ADMIN_SESSIONS_REVOKED_ALL',
    null,
    'NONE',
    jsonb_build_object('target_user_id', p_user_id, 'count', v_count, 'reason', p_reason),
    gen_random_uuid()
  );

  return v_count;
end;
$$;

revoke all on function public.revoke_all_admin_sessions(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_all_admin_sessions(uuid, uuid, text)
  to service_role;

create function public.issue_admin_step_up(
  p_admin_session_id uuid,
  p_user_id uuid,
  p_command_family text,
  p_token text,
  p_ttl_seconds integer default 600
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_session public.admin_sessions%rowtype;
  v_id uuid;
  v_hash text;
begin
  if p_admin_session_id is null
    or p_user_id is null
    or char_length(btrim(coalesce(p_command_family, ''))) < 3
    or char_length(btrim(coalesce(p_token, ''))) < 16
    or coalesce(p_ttl_seconds, 0) not between 60 and 900
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_STEP_UP';
  end if;

  select session.* into v_session
  from public.admin_sessions as session
  where session.id = p_admin_session_id
    and session.user_id = p_user_id
  for update;

  if v_session.id is null
    or v_session.revoked_at is not null
    or v_session.idle_expires_at <= statement_timestamp()
    or v_session.absolute_expires_at <= statement_timestamp()
  then
    raise exception using errcode = '55000', message = 'ADMIN_SESSION_EXPIRED';
  end if;

  update public.admin_sessions
  set
    last_seen_at = statement_timestamp(),
    idle_expires_at = least(
      v_session.absolute_expires_at,
      statement_timestamp() + (v_session.idle_expires_at - v_session.last_seen_at)
    )
  where id = v_session.id;

  -- Refresh idle window from configured duration via absolute cap only:
  update public.admin_sessions
  set idle_expires_at = least(
    absolute_expires_at,
    statement_timestamp() + interval '30 minutes'
  )
  where id = v_session.id;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  insert into public.admin_step_up_grants (
    admin_session_id, user_id, command_family, token_hash, expires_at
  ) values (
    p_admin_session_id,
    p_user_id,
    btrim(p_command_family),
    v_hash,
    statement_timestamp() + make_interval(secs => p_ttl_seconds)
  ) returning id into v_id;

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_user_id,
    'ADMIN_STEP_UP_ISSUED',
    null,
    'NONE',
    jsonb_build_object(
      'admin_session_id', p_admin_session_id,
      'command_family', btrim(p_command_family),
      'grant_id', v_id
    ),
    gen_random_uuid()
  );

  return v_id;
end;
$$;

revoke all on function public.issue_admin_step_up(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.issue_admin_step_up(uuid, uuid, text, text, integer)
  to service_role;

create function public.consume_admin_step_up(
  p_user_id uuid,
  p_token text,
  p_command_family text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  return app_private.consume_admin_step_up_token(
    p_user_id, p_token, p_command_family, p_request_id
  );
end;
$$;

revoke all on function public.consume_admin_step_up(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_admin_step_up(uuid, text, text, uuid)
  to service_role;

-- Seed welcome withdrawal policies (KRW 5,000 ceiling, no funding) if missing.
do $$
declare
  v_approver uuid;
begin
  select role.user_id into v_approver
  from public.user_roles as role
  where role.role = 'SUPER_ADMIN'
    and role.revoked_at is null
  order by role.granted_at
  limit 1;

  if v_approver is null then
    return;
  end if;

  if not exists (
    select 1 from public.withdrawal_policies as policy
    where policy.currency = 'KRW'
      and policy.destination_type = 'KRW_BANK'
      and policy.allows_welcome_reward
  ) then
    insert into public.withdrawal_policies (
      currency, destination_type, version, is_enabled, minimum_amount_atomic,
      fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
    ) values (
      'KRW', 'KRW_BANK', 1, true, 1, 0,
      jsonb_build_object('welcome_cap_atomic', 5000, 'funding_required', false),
      statement_timestamp(), v_approver, true
    );
  end if;

  if not exists (
    select 1 from public.withdrawal_policies as policy
    where policy.currency = 'KRW'
      and policy.destination_type = 'USDT_ADDRESS'
      and policy.allows_welcome_reward
  ) then
    insert into public.withdrawal_policies (
      currency, destination_type, version, is_enabled, minimum_amount_atomic,
      fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
    ) values (
      'KRW', 'USDT_ADDRESS', 1, true, 1, 0,
      jsonb_build_object('welcome_cap_atomic', 5000, 'funding_required', false),
      statement_timestamp(), v_approver, true
    );
  end if;
end;
$$;

-- Keep DRAFT catalog unpublished (explicit no-op guard)
do $$
begin
  if exists (
    select 1 from public.product_catalog_versions
    where status = 'DRAFT' and version = 1
  ) then
    -- intentionally leave DRAFT; do not publish
    null;
  end if;
end;
$$;

commit;
