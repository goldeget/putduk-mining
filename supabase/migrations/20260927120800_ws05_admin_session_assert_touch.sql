-- WS-05: assert/touch app-owned admin sessions.
-- Idle window may refresh on activity; absolute lifetime never extends.
-- Does not invent aliases for frozen WS-04 command names.

begin;

create or replace function public.assert_admin_session(
  p_user_id uuid,
  p_auth_session_id text,
  p_session_fingerprint text,
  p_idle_seconds integer default 1800
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_session public.admin_sessions%rowtype;
begin
  if p_user_id is null
    or char_length(btrim(coalesce(p_auth_session_id, ''))) < 8
    or char_length(btrim(coalesce(p_session_fingerprint, ''))) < 8
    or coalesce(p_idle_seconds, 0) not between 300 and 7200
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_SESSION_ASSERT';
  end if;

  select session.* into v_session
  from public.admin_sessions as session
  where session.user_id = p_user_id
    and session.auth_session_id = btrim(p_auth_session_id)
    and session.revoked_at is null
  order by session.created_at desc
  limit 1
  for update;

  if v_session.id is null then
    raise exception using errcode = '55000', message = 'ADMIN_SESSION_REQUIRED';
  end if;

  if v_session.session_fingerprint <> btrim(p_session_fingerprint) then
    raise exception using errcode = '42501', message = 'ADMIN_SESSION_FINGERPRINT_MISMATCH';
  end if;

  if v_session.absolute_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'ADMIN_SESSION_ABSOLUTE_EXPIRED';
  end if;

  if v_session.idle_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'ADMIN_SESSION_IDLE_EXPIRED';
  end if;

  update public.admin_sessions
  set
    last_seen_at = statement_timestamp(),
    idle_expires_at = least(
      absolute_expires_at,
      statement_timestamp() + make_interval(secs => p_idle_seconds)
    )
  where id = v_session.id;

  return v_session.id;
end;
$$;

revoke all on function public.assert_admin_session(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.assert_admin_session(uuid, text, text, integer)
  to service_role;

comment on function public.assert_admin_session(uuid, text, text, integer) is
  'Validates an app-owned admin session (revocation, idle, absolute, fingerprint) and refreshes idle only.';

-- Align step-up issue idle refresh with configurable idle seconds (absolute never extends).
create or replace function public.issue_admin_step_up(
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

commit;
