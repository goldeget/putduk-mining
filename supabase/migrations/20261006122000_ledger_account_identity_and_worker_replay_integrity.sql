begin;

-- Posted journal meaning cannot change through an account identity update.
-- Account closure remains available and cannot be reopened or redated.
create function app_private.guard_ledger_account_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (to_jsonb(new) - 'closed_at') is distinct from (to_jsonb(old) - 'closed_at') then
    raise exception using errcode = '55000', message = 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE';
  end if;
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception using errcode = '55000', message = 'LEDGER_ACCOUNT_CLOSURE_IS_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_ledger_account_identity()
  from public, anon, authenticated;
grant execute on function app_private.guard_ledger_account_identity() to service_role;

create trigger ledger_accounts_identity_immutable
before update on public.ledger_accounts
for each row execute function app_private.guard_ledger_account_identity();

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
  v_replay public.audit_logs%rowtype;
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

  -- A replay request owns one immutable audit receipt across later states.
  -- Serialize the request as well as the target so concurrent target changes
  -- cannot reuse one approval for a different replay.
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-replay-outbox_event:' || p_request_id::text, 0));
  select audit.* into v_replay
  from public.audit_logs as audit
  where audit.request_id = p_request_id
    and audit.action = 'outbox.replay'
  order by audit.created_at, audit.id
  limit 1;
  if v_replay.id is not null then
    if v_replay.target_id is distinct from p_event_id::text
      or v_replay.actor_user_id is distinct from p_actor_id
      or v_replay.reason is distinct from btrim(p_reason)
    then
      raise exception using errcode = '22023', message = 'REPLAY_IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return p_event_id;
  end if;

  select event.* into v_event
  from public.outbox_events as event
  where event.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception using errcode = '55000', message = 'OUTBOX_EVENT_NOT_FOUND';
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
  v_replay public.audit_logs%rowtype;
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

  -- A replay request owns one immutable audit receipt across later states.
  -- Serialize the request as well as the target so concurrent target changes
  -- cannot reuse one approval for a different replay.
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-replay-system_job:' || p_request_id::text, 0));
  select audit.* into v_replay
  from public.audit_logs as audit
  where audit.request_id = p_request_id
    and audit.action = 'system_job.replay'
  order by audit.created_at, audit.id
  limit 1;
  if v_replay.id is not null then
    if v_replay.target_id is distinct from p_job_id::text
      or v_replay.actor_user_id is distinct from p_actor_id
      or v_replay.reason is distinct from btrim(p_reason)
    then
      raise exception using errcode = '22023', message = 'REPLAY_IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return p_job_id;
  end if;

  select job.* into v_job
  from public.system_jobs as job
  where job.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception using errcode = '55000', message = 'SYSTEM_JOB_NOT_FOUND';
  end if;

  if v_job.status <> 'DEAD_LETTER'::public.system_job_status then
    raise exception using errcode = '55000', message = 'JOB_NOT_REPLAYABLE';
  end if;

  if v_job.attempts >= 100 then
    raise exception using errcode = '55000', message = 'JOB_REPLAY_BUDGET_EXHAUSTED';
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

  return p_job_id;
end;
$$;

revoke all on function public.replay_outbox_event(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.replay_system_job(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.replay_outbox_event(uuid, uuid, text, uuid) to service_role;
grant execute on function public.replay_system_job(uuid, uuid, text, uuid) to service_role;

comment on function public.replay_outbox_event(uuid, uuid, text, uuid) is
  'One audited replay per request id. Later retry returns its receipt without changing delivery state. Conflicting intent is rejected.';
comment on function public.replay_system_job(uuid, uuid, text, uuid) is
  'One audited replay per request id. Retains attempts; refuses an exhausted absolute budget without recording a false recovery.';

commit;
