begin;

-- Existing completion command only: monetary inputs and clock remain inside
-- the sealed private producer. This does not release dormant funding jobs,
-- activate members, publish catalogs or broaden supported condition histories.
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
    select * into v_job from public.system_jobs where id = p_job_id for update;
    if v_job.job_type is distinct from 'FUNDING_MINING_TICK_V1' then
      raise exception using errcode = '55000', message = 'FUNDING_JOB_ORIGINAL_MISMATCH';
    end if;
    -- Read the durable attempt after serialization, never from caller payload.
    -- The producer validates the live fence or exact accepted completion replay,
    -- and commits earned/state/posting/job/attempt success in one transaction.
    perform app_private.process_default_funding_job(p_job_id, p_worker_id, v_job.attempts);
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

revoke all on function public.complete_system_job(uuid,text) from public,anon,authenticated;
grant execute on function public.complete_system_job(uuid,text) to service_role;
comment on function public.complete_system_job(uuid,text) is
  'Canonical worker completion; sealed funding jobs dispatch to the fenced private earned producer, without amount/time arguments or automatic scheduling.';

commit;
