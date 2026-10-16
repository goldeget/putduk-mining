begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create extension if not exists dblink with schema extensions;
create temporary table global_admission_result(
 actual_waiter boolean,release_lower_bound timestamptz,pause_at timestamptz,resume_at timestamptz,
 original_id uuid,previous_state_id uuid,receipt jsonb,expected jsonb,actual jsonb
);

-- ROOT ONLY after applying all five129 candidates to this project's fresh,
-- disposable local generation and running the separately checked77-assertion
-- canonical fixture. Two independent transactions prove the actual advisory
-- wait, not an arbitrary sleep. Only existing commands write money/control.
-- The committed source/control/selection originals are never deleted.
\ir resolve_disposable_dblink_host.inc

do $race$
declare schema_name text; connection text; host_name text; result text; run_key text:=gen_random_uuid()::text;
 holder_pid integer; member_pid integer; deadline timestamptz; busy integer; actual_waiter boolean:=false;
 original app_private.funding_allocation_originals%rowtype; catalog_digest text; product_id uuid;
 release_at timestamptz; pause_audit uuid; resume_audit uuid; member_receipt jsonb; previous_state uuid;
begin
 if not exists(select 1 from app_private.funding_engine_state s
  join app_private.funding_condition_originals c on c.id=s.condition_id
  where s.user_id='10626100-0000-4000-8000-000000000002' and c.inputs->>'input_contract_version'='2'
   and c.inputs->>'allocation_bps'='5000' and not s.cycle_closed)
  or exists(select 1 from app_private.funding_global_control_originals) then
  raise exception 'GLOBAL_ADMISSION_FRESH_CANONICAL_FIXTURE_REQUIRED'; end if;
 select a.* into original from app_private.funding_allocation_originals a
  where a.user_id='10626100-0000-4000-8000-000000000002' order by a.revision desc limit 1;
 if jsonb_array_length(original.products)<>1 then raise exception 'GLOBAL_ADMISSION_ONE_REAL_PRODUCT_REQUIRED'; end if;
 product_id:=(original.products->0->>'productId')::uuid;
 select r.snapshot_digest into catalog_digest from app_private.product_catalog_receipts r
  where r.catalog_id=original.catalog_version_id and r.state='PUBLISHED';
 select s.id into previous_state from app_private.funding_engine_state s where s.user_id=original.user_id;
 select n.nspname into schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 connection:=pg_temp.putduk_disposable_dblink_connection('PUTDUK_LOCAL_DB_HOST_UNRESOLVED');
 execute format('select %I.dblink_connect(%L,%L)',schema_name,'global_admission_holder',connection);
 execute format('select %I.dblink_connect(%L,%L)',schema_name,'global_admission_member',connection);
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_holder','begin');
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_holder','set local role service_role');
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_holder',
  'set local request.jwt.claims=''{"role":"service_role"}''');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',schema_name,'global_admission_holder',
  'select pg_backend_pid()::text from pg_advisory_xact_lock(hashtextextended(''putduk-mining.safe-mode:GLOBAL'',0))') into result;
 holder_pid:=result::integer;
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member','begin');
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member','set local statement_timeout=''15000ms''');
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member','set local role authenticated');
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member',
  'set local request.jwt.claims=''{"role":"authenticated","sub":"10626100-0000-4000-8000-000000000002"}''');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',schema_name,'global_admission_member',
  'select pg_backend_pid()::text') into result;
 member_pid:=result::integer;
 execute format('select %I.dblink_send_query(%L,%L)',schema_name,'global_admission_member',
  format('select public.confirm_funding_allocation(''CONFIRM'',%L::uuid,%L,%s,%L::jsonb,%L)::text',
  original.catalog_version_id,catalog_digest,original.revision,
  jsonb_build_array(jsonb_build_object('productId',product_id,'allocationBps','10000'))::text,'global-admission-selection-'||run_key));
 deadline:=clock_timestamp()+interval '8 seconds';
 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_locks w join pg_locks h
   on h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
   where w.pid=member_pid and h.pid=holder_pid and w.locktype='advisory' and h.locktype='advisory'
    and not w.granted and h.granted and w.mode='ShareLock' and h.mode='ExclusiveLock'
    and holder_pid=any(pg_blocking_pids(member_pid))) into actual_waiter;
  exit when actual_waiter;
  if clock_timestamp()>deadline then raise exception 'GLOBAL_ALLOCATION_ACTUAL_SHARED_WAITER_MISSING'; end if;
  perform pg_sleep(0.01);
 end loop;
 -- The new selection is already waiting. Actual canonical pause+clear now
 -- happen entirely inside the held exclusive transaction before its admission.
 execute format('select value from %I.dblink(%L,%L) as r(value text)',schema_name,'global_admission_holder',format($pause$
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
  values('10626100-0000-4000-8000-000000000001','ADMIN','SAFE_MODE_ENABLED','SAFE_MODE','GLOBAL',
  'Actual concurrent global admission pause',gen_random_uuid(),jsonb_build_object('command_version',1,
  'component','GLOBAL','is_paused',true,'review_at',null,'expected_request_id',null,'idempotency_key',%L)) returning id::text
 $pause$,'global-admission-pause-'||run_key)) into result;
 pause_audit:=result::uuid;
 execute format('select value from %I.dblink(%L,%L) as r(value text)',schema_name,'global_admission_holder',format($resume$
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
  values('10626100-0000-4000-8000-000000000001','ADMIN','SAFE_MODE_DISABLED','SAFE_MODE','GLOBAL',
  'Actual concurrent global admission resume',gen_random_uuid(),jsonb_build_object('command_version',1,
  'component','GLOBAL','is_paused',false,'review_at',null,
  'expected_request_id',(select request_id from public.safe_mode_controls where component='GLOBAL'),'idempotency_key',%L)) returning id::text
 $resume$,'global-admission-resume-'||run_key)) into result;
 resume_audit:=result::uuid;
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_holder','set constraints all immediate');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',schema_name,'global_admission_holder',
  'select clock_timestamp()::text') into result;
 release_at:=result::timestamptz;
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_holder','commit');
 deadline:=clock_timestamp()+interval '8 seconds';
 loop
  execute format('select %I.dblink_is_busy(%L)',schema_name,'global_admission_member') into busy;
  exit when busy=0;
  if clock_timestamp()>deadline then raise exception 'GLOBAL_ALLOCATION_COMMAND_TIMEOUT'; end if;
  perform pg_sleep(0.01);
 end loop;
 execute format('select value from %I.dblink_get_result(%L) as r(value text)',schema_name,'global_admission_member') into result;
 member_receipt:=result::jsonb;
 execute format('select value from %I.dblink_get_result(%L) as r(value text)',schema_name,'global_admission_member') into result;
 -- Forces the canonical member HTTP commit boundary under the actual
 -- authenticated SQL role, before RESET ROLE or the final commit.
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member','set constraints all immediate');
 execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member','commit');
 insert into pg_temp.global_admission_result(actual_waiter,release_lower_bound,pause_at,resume_at,original_id,previous_state_id,receipt)
 select actual_waiter,release_at,p.effective_at,r.effective_at,(member_receipt->>'allocationId')::uuid,previous_state,member_receipt
  from app_private.funding_global_control_originals p cross join app_private.funding_global_control_originals r
  where p.audit_id=pause_audit and r.audit_id=resume_audit;
 execute format('select %I.dblink_disconnect(%L)',schema_name,'global_admission_holder');
 execute format('select %I.dblink_disconnect(%L)',schema_name,'global_admission_member');
exception when others then
 begin execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_holder','rollback'); exception when others then null; end;
 begin execute format('select %I.dblink_exec(%L,%L)',schema_name,'global_admission_member','rollback'); exception when others then null; end;
 begin execute format('select %I.dblink_disconnect(%L)',schema_name,'global_admission_holder'); exception when others then null; end;
 begin execute format('select %I.dblink_disconnect(%L)',schema_name,'global_admission_member'); exception when others then null; end;
 raise;
end;
$race$;

select ok((select actual_waiter from global_admission_result),'actual member waited on GLOBAL shared admission while retaining member-first serialization');
select ok((select a.effective_at>=g.release_lower_bound and a.effective_at>g.resume_at
 from app_private.funding_allocation_originals a join global_admission_result g on g.original_id=a.id),
 'accepted new selection cannot be effective before real control admission or the actual resume original');
select ok((select c.effective_at=a.effective_at and s.cursor_at=a.effective_at
 and e.settled_to=a.effective_at and e.condition_id=previous.condition_id
 from global_admission_result g join app_private.funding_allocation_originals a on a.id=g.original_id
 join app_private.funding_condition_originals c on c.allocation_original_id=a.id
 join app_private.funding_engine_state s on s.condition_id=c.id
 join app_private.funding_earned_receipts e on e.id=s.earned_receipt_id
 join app_private.funding_engine_state_receipts previous on previous.id=g.previous_state_id),
 'old condition earns through the admitted boundary; new speed is never applied to pre-admission history');
select is((select e.calculation->>'globalEligibleMicroseconds' from global_admission_result g
 join app_private.funding_earned_receipts e on e.cause_allocation_id=g.original_id),
 (select ((extract(epoch from(e.settled_to-e.settled_from-(g.resume_at-g.pause_at)))*1000000)::bigint)::text
 from global_admission_result g join app_private.funding_earned_receipts e on e.cause_allocation_id=g.original_id),
 'pre-admission old-speed calculation excludes exactly the immutable actual pause duration');
select ok((select e.calculation-array['globalControlContractVersion','globalEligibleMicroseconds','globalControlOriginalIds']
 =app_private.funding_exact_forward_interval((c.inputs->>'principal_atomic')::bigint,
 (c.inputs->>'base_bps')::integer,(c.inputs->>'retention_bps')::integer,
 (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::bigint,
 (extract(epoch from(e.settled_to-e.settled_from-(g.resume_at-g.pause_at)))*1000000)::bigint,
 (c.inputs->>'allocation_bps')::numeric,10000,cap.base_capacity_num,cap.base_capacity_den,cap.retention_capacity_num,cap.retention_capacity_den,
 s.base_used_num,s.base_used_den,s.retention_used_num,s.retention_used_den,s.carry_num,s.carry_den,0,1)
 from global_admission_result g join app_private.funding_earned_receipts e on e.cause_allocation_id=g.original_id
 join app_private.funding_engine_state_receipts s on s.id=g.previous_state_id
 join app_private.funding_condition_originals c on c.id=s.condition_id
 join app_private.funding_cycle_windows w on w.id=s.cycle_id
 join app_private.funding_effective_capacity_receipts cap on cap.state_id=s.id),
 'accepted amount and exact used/carry match independent old-condition reference with paused time excluded');
select is((select coverage from public.money_source_summaries where user_id='10626100-0000-4000-8000-000000000002'),
 'COMPLETE','actual concurrent member/control commits preserve balanced verified source coverage');
select finish();
rollback;
