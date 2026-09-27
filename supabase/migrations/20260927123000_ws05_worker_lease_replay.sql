-- WS-05: durable lease extension and auditable operator replay.
-- Does not alias these commands and does not edit earlier migrations.

begin;

create or replace function public.extend_outbox_event_lease(
  p_event_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_expires timestamptz;
begin
  if p_event_id is null
    or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
    or coalesce(p_lease_seconds, 0) not between 10 and 3600
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_LEASE_EXTEND';
  end if;

  select event.* into v_event
  from public.outbox_events as event
  where event.id = p_event_id
  for update;

  if v_event.id is null
    or v_event.status <> 'PROCESSING'::public.outbox_status
    or v_event.lease_owner is distinct from btrim(p_worker_id)
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at < statement_timestamp()
  then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;

  v_expires := statement_timestamp() + make_interval(secs => p_lease_seconds);
  if v_expires < v_event.lease_expires_at then
    v_expires := v_event.lease_expires_at;
  end if;

  update public.outbox_events
  set lease_expires_at = v_expires
  where id = p_event_id;

  return v_expires;
end;
$$;

create or replace function public.extend_system_job_lease(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_job public.system_jobs%rowtype;
  v_expires timestamptz;
begin
  if p_job_id is null
    or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
    or coalesce(p_lease_seconds, 0) not between 10 and 3600
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_LEASE_EXTEND';
  end if;

  select job.* into v_job
  from public.system_jobs as job
  where job.id = p_job_id
  for update;

  if v_job.id is null
    or v_job.status <> 'RUNNING'::public.system_job_status
    or v_job.lease_owner is distinct from btrim(p_worker_id)
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at < statement_timestamp()
  then
    raise exception using errcode = '55000', message = 'JOB_LEASE_NOT_OWNED';
  end if;

  v_expires := statement_timestamp() + make_interval(secs => p_lease_seconds);
  if v_expires < v_job.lease_expires_at then
    v_expires := v_job.lease_expires_at;
  end if;

  update public.system_jobs
  set lease_expires_at = v_expires
  where id = p_job_id;

  return v_expires;
end;
$$;

create or replace function public.replay_outbox_event(
  p_event_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_role public.app_role;
  v_already boolean;
begin
  if p_event_id is null
    or p_actor_id is null
    or p_request_id is null
    or char_length(btrim(coalesce(p_reason, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_REPLAY';
  end if;

  select role.role into v_role
  from public.user_roles as role
  where role.user_id = p_actor_id
    and role.role in ('SUPER_ADMIN', 'ADMIN')
    and role.revoked_at is null
  order by role.granted_at
  limit 1;

  if v_role is null then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select event.* into v_event
  from public.outbox_events as event
  where event.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception using errcode = '55000', message = 'OUTBOX_EVENT_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.audit_logs as audit
    where audit.request_id = p_request_id
      and audit.action = 'outbox.replay'
      and audit.target_id = p_event_id::text
  ) into v_already;

  if v_already and v_event.status = 'PENDING'::public.outbox_status then
    return v_event.id;
  end if;

  if v_event.status <> 'DEAD_LETTER'::public.outbox_status then
    raise exception using errcode = '55000', message = 'OUTBOX_NOT_REPLAYABLE';
  end if;

  update public.outbox_events
  set
    status = 'PENDING',
    attempt_count = 0,
    available_at = statement_timestamp(),
    lease_owner = null,
    lease_expires_at = null,
    processed_at = null,
    last_error_code = null
  where id = p_event_id;

  if not v_already then
    insert into public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      reason,
      request_id,
      before_state,
      after_state,
      metadata
    ) values (
      p_actor_id,
      v_role,
      'outbox.replay',
      'outbox_event',
      p_event_id::text,
      btrim(p_reason),
      p_request_id,
      jsonb_build_object(
        'status', v_event.status,
        'attempt_count', v_event.attempt_count,
        'last_error_code', v_event.last_error_code
      ),
      jsonb_build_object(
        'status', 'PENDING',
        'attempt_count', 0
      ),
      jsonb_build_object('command', 'replay_outbox_event')
    );
  end if;

  return p_event_id;
end;
$$;

create or replace function public.replay_system_job(
  p_job_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_job public.system_jobs%rowtype;
  v_role public.app_role;
  v_already boolean;
  v_max_attempts integer;
begin
  if p_job_id is null
    or p_actor_id is null
    or p_request_id is null
    or char_length(btrim(coalesce(p_reason, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_REPLAY';
  end if;

  select role.role into v_role
  from public.user_roles as role
  where role.user_id = p_actor_id
    and role.role in ('SUPER_ADMIN', 'ADMIN')
    and role.revoked_at is null
  order by role.granted_at
  limit 1;

  if v_role is null then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select job.* into v_job
  from public.system_jobs as job
  where job.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception using errcode = '55000', message = 'SYSTEM_JOB_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.audit_logs as audit
    where audit.request_id = p_request_id
      and audit.action = 'system_job.replay'
      and audit.target_id = p_job_id::text
  ) into v_already;

  if v_already and v_job.status = 'PENDING'::public.system_job_status then
    return v_job.id;
  end if;

  if v_job.status <> 'DEAD_LETTER'::public.system_job_status then
    raise exception using errcode = '55000', message = 'JOB_NOT_REPLAYABLE';
  end if;

  v_max_attempts := least(100, v_job.attempts + 12);

  update public.system_jobs
  set
    status = 'PENDING',
    max_attempts = v_max_attempts,
    available_at = statement_timestamp(),
    lease_owner = null,
    lease_expires_at = null,
    dead_lettered_at = null,
    last_error_code = null
  where id = p_job_id;

  if not v_already then
    insert into public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      reason,
      request_id,
      before_state,
      after_state,
      metadata
    ) values (
      p_actor_id,
      v_role,
      'system_job.replay',
      'system_job',
      p_job_id::text,
      btrim(p_reason),
      p_request_id,
      jsonb_build_object(
        'status', v_job.status,
        'attempts', v_job.attempts,
        'max_attempts', v_job.max_attempts,
        'last_error_code', v_job.last_error_code
      ),
      jsonb_build_object(
        'status', 'PENDING',
        'attempts', v_job.attempts,
        'max_attempts', v_max_attempts
      ),
      jsonb_build_object('command', 'replay_system_job')
    );
  end if;

  return p_job_id;
end;
$$;

revoke all on function public.extend_outbox_event_lease(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.extend_system_job_lease(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.replay_outbox_event(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.replay_system_job(uuid, uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.extend_outbox_event_lease(uuid, text, integer)
  to service_role;
grant execute on function public.extend_system_job_lease(uuid, text, integer)
  to service_role;
grant execute on function public.replay_outbox_event(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.replay_system_job(uuid, uuid, text, uuid)
  to service_role;

grant select, insert on table public.audit_logs to service_role;

comment on function public.extend_outbox_event_lease(uuid, text, integer) is
  'Extends the current worker lease for a PROCESSING outbox event. Does not change attempt_count.';
comment on function public.extend_system_job_lease(uuid, text, integer) is
  'Extends the current worker lease for a RUNNING system job. Does not change attempts.';
comment on function public.replay_outbox_event(uuid, uuid, text, uuid) is
  'Operator replay of a DEAD_LETTER outbox event back to PENDING, with an audit row. Same request id is idempotent.';
comment on function public.replay_system_job(uuid, uuid, text, uuid) is
  'Operator replay of a DEAD_LETTER system job. Attempt history stays; the claim budget increases. Same request id is idempotent.';

commit;
