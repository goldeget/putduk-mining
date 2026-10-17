-- Proposal only. Primary creates the migration through the installed CLI.
-- Existing public command names, money writer and approved operator command remain.
create function app_private.worker_funding_admission_allowed() returns boolean
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='WORKER_SERVICE_ROLE_REQUIRED';end if;
 -- The canonical audit command takes the matching exclusive lock before writing.
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
 return not exists(select 1 from public.safe_mode_controls c
  where c.component in('GLOBAL','SETTLEMENT','NEW_MINING') and c.is_paused and c.starts_at<=clock_timestamp());
end;$$;

-- Private append-only attempt originals prevent a service caller from forging
-- retry exemptions by editing public failure labels or backdating timestamps.
create table app_private.worker_attempt_start_originals(
 attempt_id uuid primary key references public.system_job_attempts(id),
 job_id uuid not null references public.system_jobs(id),attempt_number integer not null,
 worker_id text not null,started_at timestamptz not null,recorded_at timestamptz not null,
 unique(job_id,attempt_number));
create table app_private.worker_pause_exemptions(
 attempt_id uuid primary key references app_private.worker_attempt_start_originals(attempt_id),
 pause_audit_id uuid not null references public.audit_logs(id),completed_at timestamptz not null);
alter table app_private.worker_attempt_start_originals enable row level security;
alter table app_private.worker_attempt_start_originals force row level security;
alter table app_private.worker_pause_exemptions enable row level security;
alter table app_private.worker_pause_exemptions force row level security;
revoke all on app_private.worker_attempt_start_originals,app_private.worker_pause_exemptions from public,anon,authenticated,service_role;
grant select on app_private.worker_attempt_start_originals,app_private.worker_pause_exemptions to service_role;
create trigger worker_attempt_start_originals_immutable before update or delete on app_private.worker_attempt_start_originals
 for each row execute function app_private.prevent_row_mutation();
create trigger worker_pause_exemptions_immutable before update or delete on app_private.worker_pause_exemptions
 for each row execute function app_private.prevent_row_mutation();

create function app_private.worker_canonical_pause_between(p_started timestamptz,p_finished timestamptz)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 return (select a.id from public.audit_logs a
 join app_private.idempotency_keys k on k.scope='safe_mode.control' and k.actor_id is null
  and k.idempotency_key=a.metadata->>'idempotency_key' and k.status='COMPLETED'
  and k.response_status=200 and k.completed_at is not null
  and k.response_payload->>'audit_id'=a.id::text and k.request_hash=a.metadata->>'request_hash'
 join public.outbox_events e on e.event_type='SAFE_MODE_CHANGED.v1' and e.schema_version=1
  and e.aggregate_type='safe_mode_control' and e.aggregate_id::text=k.response_payload->>'control_id'
  and e.payload->>'audit_id'=a.id::text and e.payload->>'request_hash'=k.request_hash
  and e.payload->>'component'=a.target_id and e.payload->'is_paused'='true'::jsonb
  and e.actor_user_id=a.actor_user_id and e.request_id=a.request_id and e.correlation_id=a.request_id
  and e.idempotency_key='safe-mode:'||k.idempotency_key
 where a.target_type='SAFE_MODE' and a.target_id in('GLOBAL','SETTLEMENT','NEW_MINING')
  and a.action='SAFE_MODE_ENABLED' and a.actor_role in('ADMIN','SUPER_ADMIN')
  and a.after_state->'is_paused'='true'::jsonb and a.after_state->>'id'=e.aggregate_id::text
  and a.after_state->>'request_id'=a.request_id::text
  and (a.after_state->>'starts_at')::timestamptz>=p_started
  and (a.after_state->>'starts_at')::timestamptz<=p_finished
  order by a.created_at,a.id limit 1);
end;$$;

-- Closed trigger authority only. No role can call this as an RPC or write its
-- private originals. It records actual INSERT time and verifies the live fence
-- before granting a canonical pause exemption on a single failure transition.
create function app_private.seal_worker_pause_attempt() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare o app_private.worker_attempt_start_originals%rowtype;
 j public.system_jobs%rowtype;pause_id uuid;instant timestamptz:=clock_timestamp();
begin
 if tg_table_schema<>'public' or tg_table_name<>'system_job_attempts' then
  raise exception using errcode='42501',message='WORKER_ATTEMPT_TRIGGER_SCOPE_REQUIRED';end if;
 if tg_op='INSERT' then
  select * into j from public.system_jobs where id=new.job_id;
  if j.job_type is distinct from 'FUNDING_MINING_TICK_V1' then return new;end if;
  if j.status is distinct from 'RUNNING' or j.attempts is distinct from new.attempt_number or j.lease_owner is distinct from new.worker_id
   or j.lease_expires_at is null or j.lease_expires_at<=instant or new.status is distinct from 'RUNNING'
   or new.started_at is null or new.started_at<statement_timestamp() or new.started_at>instant
   or not exists(select 1 from app_private.funding_engine_jobs where job_id=j.id) then
   raise exception using errcode='55000',message='WORKER_ATTEMPT_START_FENCE_REQUIRED';end if;
  insert into app_private.worker_attempt_start_originals values(new.id,new.job_id,new.attempt_number,new.worker_id,new.started_at,instant);
  return new;
 end if;
 select * into o from app_private.worker_attempt_start_originals where attempt_id=old.id;
 if o.attempt_id is null then
  if tg_op='UPDATE' and new.error_class='SAFE_MODE_DEFERRED' then
   raise exception using errcode='55000',message='WORKER_PAUSE_ATTEMPT_ORIGINAL_REQUIRED';end if;
  if tg_op='DELETE' then return old;end if;return new;
 end if;
 if tg_op='DELETE' then raise exception using errcode='55000',message='WORKER_ATTEMPT_ORIGINAL_IMMUTABLE';end if;
 if row(new.id,new.job_id,new.attempt_number,new.worker_id,new.started_at)
  is distinct from row(old.id,o.job_id,o.attempt_number,o.worker_id,o.started_at)
  or exists(select 1 from app_private.worker_pause_exemptions where attempt_id=old.id) then
  raise exception using errcode='55000',message='WORKER_ATTEMPT_ORIGINAL_IMMUTABLE';end if;
 if new.error_class='SAFE_MODE_DEFERRED' then
  select * into j from public.system_jobs where id=o.job_id;
  pause_id:=app_private.worker_canonical_pause_between(o.recorded_at,instant);
  if old.status is distinct from 'RUNNING' or new.status is distinct from 'RETRYABLE_FAILED' or new.error_code is distinct from 'SAFE_MODE_ACTIVE'
   or new.completed_at is null or new.completed_at<statement_timestamp() or new.completed_at>instant or pause_id is null
   or j.status is distinct from 'RUNNING' or j.attempts is distinct from o.attempt_number or j.lease_owner is distinct from o.worker_id
   or j.lease_expires_at is null or j.lease_expires_at<=instant then
   raise exception using errcode='55000',message='WORKER_CANONICAL_PAUSE_FENCE_REQUIRED';end if;
  insert into app_private.worker_pause_exemptions values(o.attempt_id,pause_id,instant);
 end if;
 return new;
end;$$;
revoke all on function app_private.seal_worker_pause_attempt(),app_private.worker_canonical_pause_between(timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function app_private.worker_canonical_pause_between(timestamptz,timestamptz) to service_role;
create trigger worker_attempt_insert_original after insert on public.system_job_attempts
 for each row execute function app_private.seal_worker_pause_attempt();
create trigger worker_attempt_pause_seal before update or delete on public.system_job_attempts
 for each row execute function app_private.seal_worker_pause_attempt();

create function app_private.worker_chargeable_attempts(p_job uuid,p_attempts integer) returns bigint
language sql stable security invoker set search_path=pg_catalog as $$
 select p_attempts::bigint-count(*) from app_private.worker_pause_exemptions e
 join app_private.worker_attempt_start_originals o on o.attempt_id=e.attempt_id
 where o.job_id=p_job and o.attempt_number<=p_attempts;
$$;

-- A stop may have resumed between completion rejection and failure recording.
-- Only the actual currently stopped state or an immutable canonical pause
-- receipt that intersects this attempt can justify not charging retry budget.
create function app_private.worker_funding_pause_observed(p_started timestamptz) returns boolean
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='WORKER_SERVICE_ROLE_REQUIRED';end if;
 if not app_private.worker_funding_admission_allowed() then return true;end if;
 return exists(select 1 from public.audit_logs a
 join app_private.idempotency_keys k on k.scope='safe_mode.control' and k.actor_id is null
  and k.idempotency_key=a.metadata->>'idempotency_key' and k.status='COMPLETED'
  and k.response_status=200 and k.completed_at is not null
  and k.response_payload->>'audit_id'=a.id::text and k.request_hash=a.metadata->>'request_hash'
 join public.outbox_events e on e.event_type='SAFE_MODE_CHANGED.v1' and e.schema_version=1
  and e.aggregate_type='safe_mode_control' and e.aggregate_id::text=k.response_payload->>'control_id'
  and e.payload->>'audit_id'=a.id::text and e.payload->>'request_hash'=k.request_hash
  and e.payload->>'component'=a.target_id and e.payload->'is_paused'='true'::jsonb
  and e.actor_user_id=a.actor_user_id and e.request_id=a.request_id and e.correlation_id=a.request_id
  and e.idempotency_key='safe-mode:'||k.idempotency_key
 where a.target_type='SAFE_MODE' and a.target_id in('GLOBAL','SETTLEMENT','NEW_MINING')
  and a.action='SAFE_MODE_ENABLED' and a.actor_role in('ADMIN','SUPER_ADMIN')
  and a.after_state->'is_paused'='true'::jsonb and a.after_state->>'id'=e.aggregate_id::text
  and a.after_state->>'request_id'=a.request_id::text
  and (a.after_state->>'starts_at')::timestamptz>=p_started
  and (a.after_state->>'starts_at')::timestamptz<=clock_timestamp());
end;$$;

create function app_private.claim_system_jobs_scoped(
 p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_allow_funding boolean
) returns setof public.system_jobs language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare funding_allowed boolean;
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='WORKER_SERVICE_ROLE_REQUIRED';end if;
 if char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 120
  or p_batch_size is null or p_batch_size not between 1 and 100
  or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 or p_allow_funding is null then
  raise exception using errcode='22023',message='INVALID_JOB_CLAIM_CONTEXT';end if;
 funding_allowed:=false;
 if p_allow_funding then funding_allowed:=app_private.worker_funding_admission_allowed();end if;
 -- Preserve due work and attempts while stopped. SKIP LOCKED also prevents a
 -- cleanup row from blocking a completion while shared component locks are held.
 with exhausted as(
  select j.id from public.system_jobs j where
   (j.job_type<>'FUNDING_MINING_TICK_V1' or funding_allowed)
   and app_private.worker_chargeable_attempts(j.id,j.attempts)>=j.max_attempts
   and(j.status in('PENDING','FAILED') or(j.status='RUNNING' and j.lease_expires_at<statement_timestamp()))
  order by j.priority,j.available_at,j.created_at,j.id for update skip locked limit p_batch_size
 ) update public.system_jobs j set status='DEAD_LETTER',lease_owner=null,lease_expires_at=null,
  dead_lettered_at=statement_timestamp(),last_error_code=coalesce(j.last_error_code,'MAX_ATTEMPTS_EXHAUSTED')
  from exhausted x where j.id=x.id;
 return query
 with candidates as(
  select j.id from public.system_jobs j where
   (j.job_type<>'FUNDING_MINING_TICK_V1' or funding_allowed)
   and app_private.worker_chargeable_attempts(j.id,j.attempts)<j.max_attempts
   and((j.status in('PENDING','FAILED') and j.available_at<=statement_timestamp())
    or(j.status='RUNNING' and j.lease_expires_at<statement_timestamp()))
  order by j.priority,j.available_at,j.created_at,j.id for update skip locked limit p_batch_size
 ),claimed as(
  update public.system_jobs j set status='RUNNING',attempts=j.attempts+1,
   started_at=coalesce(j.started_at,statement_timestamp()),lease_owner=p_worker_id,
   lease_expires_at=statement_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
  from candidates c where j.id=c.id returning j.*
 ),attempt_rows as(
  insert into public.system_job_attempts(job_id,attempt_number,worker_id,status,started_at)
   select c.id,c.attempts,p_worker_id,'RUNNING',statement_timestamp() from claimed c returning job_id
 ) select c.* from claimed c join attempt_rows a on a.job_id=c.id;
end;$$;

create or replace function public.claim_system_jobs(
 p_worker_id text,p_batch_size integer default 25,p_lease_seconds integer default 120
) returns setof public.system_jobs language plpgsql security invoker set search_path=pg_catalog as $$
begin return query select * from app_private.claim_system_jobs_scoped(p_worker_id,p_batch_size,p_lease_seconds,true);end;$$;
-- No default on the fourth argument: old three-argument PostgREST calls remain
-- unambiguous, and old direct callers receive the same authoritative DB gate.
create function public.claim_system_jobs(
 p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_allow_funding boolean
) returns setof public.system_jobs language plpgsql security invoker set search_path=pg_catalog as $$
begin return query select * from app_private.claim_system_jobs_scoped(p_worker_id,p_batch_size,p_lease_seconds,p_allow_funding);end;$$;

create or replace function public.complete_system_job(
  p_job_id uuid,
  p_worker_id text
)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_job public.system_jobs%rowtype;
  v_user uuid;
  v_attempt integer;
  v_admission_allowed boolean := true;
begin
  -- Resolve immutable identity without a row lock. Funding completion must take
  -- its member boundary before the job row, matching foreground money commands.
  select * into v_job from public.system_jobs where id = p_job_id;
  if v_job.job_type = 'FUNDING_MINING_TICK_V1' then
    select user_id into v_user from app_private.funding_engine_jobs
    where job_id = p_job_id;
    if v_user is null then
      raise exception using errcode = '55000', message = 'FUNDING_JOB_ORIGINAL_REQUIRED';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('putduk-funding-recovery:' || v_user::text, 0));
    -- Lock order: member -> shared component locks -> job. Capture the stop
    -- decision here, but authenticate the live fence before reporting it.
    if not exists(select 1 from app_private.funding_earned_receipts where job_id=p_job_id) then
      v_admission_allowed := app_private.worker_funding_admission_allowed();
    end if;
    select * into v_job from public.system_jobs where id = p_job_id for update;
    if v_job.job_type is distinct from 'FUNDING_MINING_TICK_V1' then
      raise exception using errcode = '55000', message = 'FUNDING_JOB_ORIGINAL_MISMATCH';
    end if;
    -- A stop never gives an unowned caller a completion capability.
    -- Accepted response-loss replay retains its original receipt even stopped.
    if not exists(select 1 from app_private.funding_earned_receipts where job_id=p_job_id) then
      perform app_private.assert_funding_job_fence(p_job_id,p_worker_id,v_job.attempts);
      if not v_admission_allowed then
        raise exception using errcode='55000',message='SAFE_MODE_ACTIVE';
      end if;
    end if;
    -- Read the durable attempt after serialization, never from caller payload.
    -- The producer validates the live fence or exact accepted completion replay,
    -- and commits earned/state/posting/job/attempt success in one transaction.
    perform app_private.process_default_funding_job(p_job_id, p_worker_id, v_job.attempts);
    return;
  end if;

  if v_job.job_type = 'LIVEOPS_PUBLICATION_FANOUT_V1' then
    perform app_private.process_liveops_fanout_job(p_job_id,p_worker_id);
    return;
  end if;

  -- Preserve the existing non-funding completion behavior and signature.
  update public.system_jobs as job
  set status = 'SUCCEEDED', completed_at = statement_timestamp(),
    lease_owner = null, lease_expires_at = null, last_error_code = null
  where job.id = p_job_id and job.status = 'RUNNING'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at >= statement_timestamp()
  returning job.attempts into v_attempt;
  if v_attempt is null then
    raise exception using errcode = '55000', message = 'JOB_LEASE_NOT_OWNED';
  end if;
  update public.system_job_attempts
  set status = 'SUCCEEDED', completed_at = statement_timestamp()
  where job_id = p_job_id and attempt_number = v_attempt;
end;
$$;

create or replace function public.fail_system_job(
 p_job_id uuid,p_worker_id text,p_error_code text,p_error_class text,p_retry_delay_seconds integer default 60
) returns public.system_job_status language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.system_jobs%rowtype;attempt public.system_job_attempts%rowtype;
 owner_id uuid;deferred boolean:=false;permanent boolean;result public.system_job_status;instant timestamptz;
 effective_attempts bigint;
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='WORKER_SERVICE_ROLE_REQUIRED';end if;
 if char_length(btrim(coalesce(p_error_code,''))) not between 1 and 120
  or char_length(btrim(coalesce(p_error_class,''))) not between 1 and 120
  or p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 86400
  or upper(btrim(p_error_class))='SAFE_MODE_DEFERRED' then
  raise exception using errcode='22023',message='INVALID_JOB_FAILURE_CONTEXT';end if;
 select user_id into owner_id from app_private.funding_engine_jobs where job_id=p_job_id;
 if owner_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
  -- Match claim/completion order even if an exclusive pause writer is queued.
  perform app_private.worker_funding_admission_allowed();
 end if;
 select * into j from public.system_jobs where id=p_job_id for update;
 instant:=clock_timestamp();
 if j.id is null or j.status<>'RUNNING' or j.lease_owner is distinct from p_worker_id
  or j.lease_expires_at is null or j.lease_expires_at<=instant then
  raise exception using errcode='55000',message='JOB_LEASE_NOT_OWNED';end if;
 select * into attempt from public.system_job_attempts where job_id=j.id and attempt_number=j.attempts;
 if attempt.id is null or attempt.worker_id is distinct from p_worker_id or attempt.status<>'RUNNING' then
  raise exception using errcode='55000',message='JOB_LEASE_NOT_OWNED';end if;
 permanent:=upper(btrim(p_error_class))='PERMANENT';
 if not permanent and owner_id is not null and j.job_type='FUNDING_MINING_TICK_V1'
  and p_error_code='SAFE_MODE_ACTIVE' then
  deferred:=app_private.worker_canonical_pause_between(
   (select recorded_at from app_private.worker_attempt_start_originals where attempt_id=attempt.id),instant) is not null;
 end if;
 effective_attempts:=app_private.worker_chargeable_attempts(j.id,j.attempts)-case when deferred then 1 else 0 end;
 result:=case when not deferred and(permanent or effective_attempts>=j.max_attempts)
  then 'DEAD_LETTER'::public.system_job_status else 'FAILED'::public.system_job_status end;
 update public.system_job_attempts set status=case when result='DEAD_LETTER' then 'PERMANENT_FAILED' else 'RETRYABLE_FAILED' end,
  error_code=p_error_code,error_class=case when deferred then 'SAFE_MODE_DEFERRED' else p_error_class end,
  completed_at=instant where id=attempt.id;
 update public.system_jobs set status=result,available_at=instant+make_interval(secs=>p_retry_delay_seconds),
  lease_owner=null,lease_expires_at=null,dead_lettered_at=case when result='DEAD_LETTER' then instant else null end,
  last_error_code=p_error_code where id=j.id;
 return result;
end;$$;

revoke all on function app_private.worker_funding_admission_allowed(),
 app_private.worker_chargeable_attempts(uuid,integer),app_private.worker_funding_pause_observed(timestamptz),
 app_private.claim_system_jobs_scoped(text,integer,integer,boolean),
 public.claim_system_jobs(text,integer,integer),public.claim_system_jobs(text,integer,integer,boolean),
 public.fail_system_job(uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.worker_funding_admission_allowed(),
 app_private.worker_chargeable_attempts(uuid,integer),app_private.worker_funding_pause_observed(timestamptz),
 app_private.claim_system_jobs_scoped(text,integer,integer,boolean),
 public.claim_system_jobs(text,integer,integer),public.claim_system_jobs(text,integer,integer,boolean),
 public.fail_system_job(uuid,text,text,text,integer) to service_role;
