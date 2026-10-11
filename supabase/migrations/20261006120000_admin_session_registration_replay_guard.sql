begin;

create or replace function public.register_admin_session(
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
  v_session public.admin_sessions%rowtype;
  v_now timestamptz;
begin
  if p_user_id is null
    or char_length(btrim(coalesce(p_auth_session_id, ''))) < 8
    or char_length(btrim(coalesce(p_session_fingerprint, ''))) < 8
    or coalesce(p_idle_seconds, 0) not between 300 and 7200
    or coalesce(p_absolute_seconds, 0) not between 1800 and 86400
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_SESSION';
  end if;

  -- Serialize registrations; the selected row lock coordinates with revocation.
  -- MFA replay may return only the same live session, never recreate it.
  perform pg_advisory_xact_lock(hashtextextended(
    'putduk:admin-session:' || p_user_id::text || ':' || btrim(p_auth_session_id), 0
  ));
  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_user_id
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  -- Preserve the existing registration request ceiling, including retries.
  perform app_private.touch_command_rate_limit('ADMIN_AUTH', p_user_id::text, 30, 900, 900);

  select session.* into v_session
  from public.admin_sessions as session
  where session.user_id = p_user_id
    and session.auth_session_id = btrim(p_auth_session_id)
  order by session.created_at desc, session.id
  limit 1
  for update;
  v_now := clock_timestamp();

  if v_session.id is not null then
    if v_session.revoked_at is not null then
      raise exception using errcode = '55000', message = 'ADMIN_SESSION_REVOKED';
    end if;
    if v_session.absolute_expires_at <= v_now then
      raise exception using errcode = '55000', message = 'ADMIN_SESSION_ABSOLUTE_EXPIRED';
    end if;
    if v_session.idle_expires_at <= v_now then
      raise exception using errcode = '55000', message = 'ADMIN_SESSION_IDLE_EXPIRED';
    end if;
    if v_session.session_fingerprint <> btrim(p_session_fingerprint) then
      raise exception using errcode = '42501', message = 'ADMIN_SESSION_FINGERPRINT_MISMATCH';
    end if;
    return v_session.id;
  end if;

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
    v_now + make_interval(secs => p_idle_seconds),
    v_now + make_interval(secs => p_absolute_seconds),
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


revoke all on function public.register_admin_session(uuid, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.register_admin_session(uuid, text, text, text, integer, integer)
  to service_role;

comment on function public.register_admin_session(uuid, text, text, text, integer, integer) is
  'Idempotent registration for one Auth session. Revocation/expiry cannot be bypassed and absolute lifetime never extends.';

commit;
