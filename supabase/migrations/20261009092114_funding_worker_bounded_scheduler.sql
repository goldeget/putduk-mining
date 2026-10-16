begin;
-- Proposal only. Primary must create a new migration and run native tests.
-- No money, time, rate, allocation or principal amount is accepted from JS.
create function public.schedule_due_funding_jobs(
 p_batch_size integer default 25,p_after_user_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare candidate record;current_state app_private.funding_engine_state_receipts%rowtype;
 activation app_private.funding_engine_activations%rowtype;job public.system_jobs%rowtype;
 target timestamptz;policy_until timestamptz;job_id uuid;scanned integer:=0;scheduled integer:=0;
 blocked integer:=0;busy integer:=0;last_user uuid;next_cursor uuid;diagnostic text;
begin
 if current_user<>'service_role' or current_setting('role',true) is distinct from 'service_role'
  or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED';end if;
 if p_batch_size is null or p_batch_size not between 1 and 100 then
  raise exception using errcode='22023',message='FUNDING_SCHEDULER_BATCH_INVALID';end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED';end if;
 -- Fast fail-closed observation only, taking no lock before the member lock.
 -- The canonical guard is rechecked under the member lock below.
 if exists(select 1 from public.safe_mode_controls where component in('GLOBAL','SETTLEMENT','NEW_MINING')
  and is_paused and starts_at<=clock_timestamp()) then
  return jsonb_build_object('contract_version',1,'scanned',0,'scheduled',0,'blocked',0,'busy',0,
   'paused',true,'next_cursor',null);
 end if;
 for candidate in
  select s.user_id,s.id,s.activation_id from app_private.funding_engine_state s
  join app_private.funding_engine_activations a on a.id=s.activation_id
  join app_private.funding_cycle_windows c on c.id=s.cycle_id
  where a.runtime_version=2 and not s.cycle_closed and s.cursor_at<least(clock_timestamp(),c.cycle_end)
   and (p_after_user_id is null or s.user_id>p_after_user_id)
   and not exists(select 1 from app_private.funding_engine_jobs f join public.system_jobs j on j.id=f.job_id
    where f.expected_state_id=s.id and not(j.status='PENDING' and j.attempts=0
     and j.available_at='infinity'::timestamptz and j.last_error_code='FUNDING_ENGINE_RUNTIME_NOT_CONNECTED'))
  order by s.user_id limit p_batch_size
 loop
  scanned:=scanned+1;last_user:=candidate.user_id;
  -- Different workers cannot prepare two jobs for the same state. A busy
  -- member never blocks the batch; completion uses this exact same lock.
  if not pg_try_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||candidate.user_id::text,0)) then
   busy:=busy+1;continue;end if;
  begin
   select * into current_state from app_private.funding_engine_state where user_id=candidate.user_id;
   if current_state.id is distinct from candidate.id or current_state.cycle_closed then
    blocked:=blocked+1;continue;end if;
   select * into activation from app_private.funding_engine_activations where id=current_state.activation_id;
   select effective_until into policy_until from app_private.economy_policy_published
    where publication_id=activation.policy_publication_id;
   select least(clock_timestamp(),c.cycle_end,coalesce(policy_until,'infinity'::timestamptz)) into target
    from app_private.funding_cycle_windows c where c.id=current_state.cycle_id;
   if target is null or target<=current_state.cursor_at then blocked:=blocked+1;continue;end if;
   -- Existing current-only reader verifies activation/condition seals, exact
   -- principal originals, allocation and event-time policy. No history repair.
   perform app_private.read_neutral_funding_job_inputs(activation.id,current_state.id,target);
   perform app_private.assert_funding_global_execution_allowed();
   job_id:=app_private.prepare_default_funding_job(activation.id);
   select * into job from public.system_jobs where id=job_id for update;
   if job.job_type is distinct from 'FUNDING_MINING_TICK_V1' or job.payload_version<>1
    or job.idempotency_key is distinct from 'funding:state:'||current_state.id::text
    or job.payload is distinct from jsonb_build_object('user_id',candidate.user_id,
     'activation_id',activation.id,'expected_state_id',current_state.id) then
    raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_MISMATCH';end if;
   -- Release only the exact never-attempted dormant sealed original. Retry,
   -- running, terminal and unrelated infinity jobs are never changed here.
   update public.system_jobs set available_at=clock_timestamp(),last_error_code=null
    where id=job_id and status='PENDING' and attempts=0 and available_at='infinity'::timestamptz
     and last_error_code='FUNDING_ENGINE_RUNTIME_NOT_CONNECTED';
   if found then scheduled:=scheduled+1;end if;
  exception when sqlstate '55000' then
   -- The subtransaction also rolls back any preparation/seal on failure.
   blocked:=blocked+1;
  end;
 end loop;
 if scanned=p_batch_size then next_cursor:=last_user;end if;
 return jsonb_build_object('contract_version',1,'scanned',scanned,'scheduled',scheduled,
  'blocked',blocked,'busy',busy,'paused',false,'next_cursor',next_cursor);
end;
$$;
revoke all on function public.schedule_due_funding_jobs(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.schedule_due_funding_jobs(integer,uuid) to service_role;
comment on function public.schedule_due_funding_jobs(integer,uuid) is
 'Bounded original-backed operational producer only; canonical fenced completion remains the sole financial writer.';

commit;
