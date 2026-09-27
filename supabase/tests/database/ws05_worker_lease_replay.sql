-- WS-05 durable lease extension and operator replay regression.

begin;

select plan(13);

create temporary table ws05_worker_ctx (
  actor_id uuid primary key,
  member_id uuid not null,
  outbox_id uuid,
  idle_outbox_id uuid,
  job_id uuid,
  replay_request uuid not null
) on commit drop;

insert into ws05_worker_ctx (actor_id, member_id, replay_request)
values (
  'd4d4d4d4-eeee-4444-8aaa-bbbbbbbb0001',
  'd5d5d5d5-eeee-4444-8aaa-bbbbbbbb0002',
  'd6d6d6d6-eeee-4444-8aaa-bbbbbbbb0003'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  id,
  'authenticated',
  'authenticated',
  email,
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
from (
  select actor_id as id, 'ws05-lease-op@putduk.test' as email from ws05_worker_ctx
  union all
  select member_id, 'ws05-lease-member@putduk.test' from ws05_worker_ctx
) as users;

insert into public.user_roles (user_id, role, granted_by)
select actor_id, 'ADMIN', actor_id from ws05_worker_ctx;

insert into public.outbox_events (
  event_type, schema_version, aggregate_type, aggregate_id, payload,
  correlation_id, request_id, idempotency_key, status, attempt_count,
  max_attempts, lease_owner, lease_expires_at
)
select
  'WORKER_LEASE_PROBE.v1',
  1,
  'WORKER_TEST',
  gen_random_uuid(),
  '{}'::jsonb,
  gen_random_uuid(),
  gen_random_uuid(),
  'ws05-lease-' || gen_random_uuid()::text,
  'PROCESSING',
  1,
  3,
  'worker-a',
  statement_timestamp() + interval '30 seconds'
from ws05_worker_ctx;

update ws05_worker_ctx
set outbox_id = event.id
from public.outbox_events as event
where event.event_type = 'WORKER_LEASE_PROBE.v1'
  and event.lease_owner = 'worker-a';

create temporary table ws05_lease_before (
  expires_at timestamptz not null
) on commit drop;

insert into ws05_lease_before (expires_at)
select lease_expires_at
from public.outbox_events
where id = (select outbox_id from ws05_worker_ctx);

select cmp_ok(
  public.extend_outbox_event_lease(
    (select outbox_id from ws05_worker_ctx),
    'worker-a',
    600
  ),
  '>',
  (select expires_at from ws05_lease_before),
  'extend_outbox_event_lease moves the owned lease forward'
);

select is(
  (select attempt_count from public.outbox_events where id = (select outbox_id from ws05_worker_ctx)),
  1,
  'lease extension does not change attempt_count'
);

select throws_ok(
  $$
    select public.extend_outbox_event_lease(
      (select outbox_id from ws05_worker_ctx),
      'worker-stranger',
      600
    )
  $$,
  '55000',
  'OUTBOX_LEASE_NOT_OWNED',
  'another worker cannot extend the outbox lease'
);

update public.outbox_events
set
  status = 'DEAD_LETTER',
  attempt_count = 3,
  lease_owner = null,
  lease_expires_at = null,
  last_error_code = 'FORCE_DLQ'
where id = (select outbox_id from ws05_worker_ctx);

select is(
  public.replay_outbox_event(
    (select outbox_id from ws05_worker_ctx),
    (select actor_id from ws05_worker_ctx),
    'operator replay evidence',
    (select replay_request from ws05_worker_ctx)
  ),
  (select outbox_id from ws05_worker_ctx),
  'replay_outbox_event returns the same event id'
);

select ok(
  (
    select status = 'PENDING' and attempt_count = 0 and lease_owner is null
    from public.outbox_events
    where id = (select outbox_id from ws05_worker_ctx)
  ),
  'replay returns a dead-lettered event to a claimable pending state'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action = 'outbox.replay'
      and target_id = (select outbox_id from ws05_worker_ctx)::text
  ),
  1,
  'replay writes one audit row'
);

select lives_ok(
  $$
    select public.replay_outbox_event(
      (select outbox_id from ws05_worker_ctx),
      (select actor_id from ws05_worker_ctx),
      'operator replay evidence',
      (select replay_request from ws05_worker_ctx)
    )
  $$,
  'same replay request id is idempotent'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action = 'outbox.replay'
      and request_id = (select replay_request from ws05_worker_ctx)
  ),
  1,
  'idempotent replay does not write a second audit row'
);

select throws_ok(
  $$
    select public.replay_outbox_event(
      (select outbox_id from ws05_worker_ctx),
      (select member_id from ws05_worker_ctx),
      'member cannot replay',
      'd7d7d7d7-eeee-4444-8aaa-bbbbbbbb0004'::uuid
    )
  $$,
  '42501',
  'ADMIN_ROLE_REQUIRED',
  'a member without an operator role cannot replay'
);

insert into public.system_jobs (
  job_type, status, idempotency_key, payload, attempts, max_attempts,
  lease_owner, lease_expires_at, started_at
)
select
  'FINANCIAL_RECONCILIATION',
  'RUNNING',
  'ws05-job-lease-' || gen_random_uuid()::text,
  '{}'::jsonb,
  1,
  3,
  'worker-a',
  statement_timestamp() + interval '30 seconds',
  statement_timestamp()
from ws05_worker_ctx;

update ws05_worker_ctx
set job_id = job.id
from public.system_jobs as job
where job.lease_owner = 'worker-a'
  and job.job_type = 'FINANCIAL_RECONCILIATION';

select lives_ok(
  $$
    select public.extend_system_job_lease(
      (select job_id from ws05_worker_ctx),
      'worker-a',
      600
    )
  $$,
  'extend_system_job_lease accepts the owning worker'
);

update public.system_jobs
set
  status = 'DEAD_LETTER',
  attempts = 2,
  max_attempts = 2,
  lease_owner = null,
  lease_expires_at = null,
  dead_lettered_at = statement_timestamp(),
  last_error_code = 'FORCE_DLQ'
where id = (select job_id from ws05_worker_ctx);

select is(
  public.replay_system_job(
    (select job_id from ws05_worker_ctx),
    (select actor_id from ws05_worker_ctx),
    'operator job replay',
    'd8d8d8d8-eeee-4444-8aaa-bbbbbbbb0005'::uuid
  ),
  (select job_id from ws05_worker_ctx),
  'replay_system_job returns the job id'
);

select ok(
  (
    select
      job.status = 'PENDING'
      and job.attempts = 2
      and job.max_attempts > job.attempts
      and job.dead_lettered_at is null
    from public.system_jobs as job
    where job.id = (select job_id from ws05_worker_ctx)
  )
  and exists (
    select 1
    from public.audit_logs as audit
    where audit.action = 'system_job.replay'
      and audit.target_id = (select job_id from ws05_worker_ctx)::text
  ),
  'replay_system_job keeps attempt history, raises the claim budget, and audits'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.replay_outbox_event(uuid,uuid,text,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.extend_outbox_event_lease(uuid,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.replay_outbox_event(uuid,uuid,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.extend_system_job_lease(uuid,text,integer)',
    'EXECUTE'
  ),
  'service role may extend and replay; authenticated callers cannot'
);

select * from finish();

rollback;
