begin;

-- Pending requests reserve the existing five-failure/15-minute budget. A crash
-- stays charged until that same window expires; success releases its reservation.
create index security_events_admin_auth_bucket_idx
  on public.security_events (event_type, (device_context->>'scope'), (device_context->>'bucket'), occurred_at)
  where event_type in ('ADMIN_AUTH_FAILURE', 'ADMIN_AUTH_ATTEMPT_STARTED');
create unique index security_events_admin_auth_finish_once_idx
  on public.security_events (request_id)
  where event_type = 'ADMIN_AUTH_ATTEMPT_FINISHED';

create function public.admit_admin_auth_attempt(p_scope text, p_bucket text)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_now timestamptz;
  v_count integer;
  v_id uuid;
begin
  if p_scope is null or p_scope not in ('PASSWORD', 'TOTP')
    or coalesce(p_bucket, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_AUTH_ATTEMPT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('putduk:admin-auth:' || p_scope || ':' || p_bucket, 0));
  v_now := clock_timestamp();
  select count(*) into v_count
  from public.security_events as event
  where event.event_type in ('ADMIN_AUTH_FAILURE', 'ADMIN_AUTH_ATTEMPT_STARTED')
    and event.device_context->>'scope' = p_scope
    and event.device_context->>'bucket' = p_bucket
    and event.occurred_at >= v_now - interval '15 minutes'
    and (event.event_type = 'ADMIN_AUTH_FAILURE' or not exists (
      select 1 from public.security_events as finished
      where finished.event_type = 'ADMIN_AUTH_ATTEMPT_FINISHED'
        and finished.request_id = event.id
    ));
  if v_count >= 5 then
    raise exception using errcode = '55000', message = 'ADMIN_AUTH_RATE_LIMITED';
  end if;
  v_id := gen_random_uuid();
  insert into public.security_events (id, event_type, ip_source, device_context, request_id, occurred_at)
  values (v_id, 'ADMIN_AUTH_ATTEMPT_STARTED', 'NONE',
    jsonb_build_object('surface', 'admin_auth_attempt', 'scope', p_scope, 'bucket', p_bucket), v_id, v_now);
  return v_id;
end;
$$;

create function public.finish_admin_auth_attempt(p_attempt_id uuid, p_succeeded boolean)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_attempt public.security_events%rowtype;
  v_finished public.security_events%rowtype;
  v_scope text;
  v_bucket text;
begin
  if p_attempt_id is null or p_succeeded is null then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_AUTH_ATTEMPT';
  end if;
  select event.* into v_attempt from public.security_events as event
  where event.id = p_attempt_id and event.event_type = 'ADMIN_AUTH_ATTEMPT_STARTED';
  if v_attempt.id is null then
    raise exception using errcode = '55000', message = 'ADMIN_AUTH_ATTEMPT_NOT_FOUND';
  end if;
  v_scope := v_attempt.device_context->>'scope';
  v_bucket := v_attempt.device_context->>'bucket';
  perform pg_advisory_xact_lock(hashtextextended('putduk:admin-auth:' || v_scope || ':' || v_bucket, 0));
  select event.* into v_finished from public.security_events as event
  where event.event_type = 'ADMIN_AUTH_ATTEMPT_FINISHED' and event.request_id = p_attempt_id;
  if v_finished.id is not null then
    if v_finished.device_context->'succeeded' <> to_jsonb(p_succeeded) then
      raise exception using errcode = '55000', message = 'ADMIN_AUTH_ATTEMPT_OUTCOME_CONFLICT';
    end if;
    return;
  end if;
  insert into public.security_events (event_type, ip_source, device_context, request_id)
  values ('ADMIN_AUTH_ATTEMPT_FINISHED', 'NONE',
    jsonb_build_object('surface', 'admin_auth_attempt', 'scope', v_scope, 'bucket', v_bucket, 'succeeded', p_succeeded), p_attempt_id);
  if not p_succeeded then
    insert into public.security_events (event_type, ip_source, device_context, request_id)
    values ('ADMIN_AUTH_FAILURE', 'NONE',
      jsonb_build_object('surface', 'admin_auth_failure', 'scope', v_scope, 'bucket', v_bucket), p_attempt_id);
  end if;
end;
$$;

revoke all on function public.admit_admin_auth_attempt(text, text), public.finish_admin_auth_attempt(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admit_admin_auth_attempt(text, text), public.finish_admin_auth_attempt(uuid, boolean)
  to service_role;

comment on function public.admit_admin_auth_attempt(text, text) is
  'Atomic service-only auth admission: existing failures plus unfinished requests reserve five attempts per 15-minute bucket.';
comment on function public.finish_admin_auth_attempt(uuid, boolean) is
  'Idempotent immutable auth outcome: releases successful reservations, records failures atomically, rejects contradictory retries.';

commit;
