-- Root-only actual two-session races, after checked77 + checked6 fixtures.
-- Remote/other project hosts are never attempted. Both finance transactions
-- COMMIT after actual service SET CONSTRAINTS. Outer evidence rolls back only;
-- committed financial originals are retained until root's disposable reset.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table hold_cancel_race_result(kind text,actual_waiter boolean,release_lower_bound timestamptz,journal_id uuid);
create temporary table admission_v2_outcome(kind text,result jsonb,before_facts jsonb,after_facts jsonb,actual_waiter boolean,pause_at timestamptz);
create function pg_temp.clock_finance_snapshot(p_user uuid) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object(
 'admissions',(select count(*) from app_private.funding_withdrawal_clock_admissions a where a.user_id=p_user),
 'journals',(select count(*) from public.ledger_transactions t where t.member_user_id=p_user),
 'wallet',(select count(*) from public.wallet_ledger w where w.user_id=p_user),
 'sources',(select count(*) from public.money_source_movements m where m.user_id=p_user),
 'revisions',(select count(*) from public.funding_principal_revisions r where r.user_id=p_user),
 'native_holds',(select count(*) from public.funding_principal_recovery_allocations a where a.user_id=p_user),
 'native_releases',(select count(*) from public.funding_principal_recovery_releases r where r.user_id=p_user),
 'clocks',(select count(*) from app_private.funding_portion_clock_receipts c where c.user_id=p_user),
 'requests',(select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'amount_atomic',r.amount_atomic::text,
  'hold_id',r.hold_ledger_transaction_id,'release_id',r.release_ledger_transaction_id,
  'held_microseconds',((extract(epoch from r.hold_posted_at)*1000000)::bigint)::text,
  'released_microseconds',((extract(epoch from r.hold_released_at)*1000000)::bigint)::text) order by r.id)
  from public.withdrawal_requests r where r.user_id=p_user),
 'engine_state',(select to_jsonb(st) from app_private.funding_engine_state st where st.user_id=p_user));
$$;

do $race$
declare extension_schema text; connection text; host_name text; result text; hold_id uuid; release_id uuid;
 holder_pid integer; writer_pid integer; deadline timestamptz; busy integer; waited boolean; release_bound timestamptz;
 kind text; v_result jsonb; v_before jsonb; pause_audit uuid; v_pause_at timestamptz; admission_original uuid;
 run_key text:=gen_random_uuid()::text;
 original_request constant uuid:='10630000-0000-4000-8000-000000000003';
 original_member constant uuid:='10626100-0000-4000-8000-000000000002';
begin
 if not exists(select 1 from public.withdrawal_requests r where r.id=original_request and r.user_id=original_member
  and r.status='REQUESTED' and r.hold_ledger_transaction_id is null) then
  raise exception 'HOLD_ADMISSION_FRESH_OWNER_FIXTURE_REQUIRED'; end if;
 select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 foreach host_name in array array['supabase_db_putduk-mining-clean','supabase_db_putduk-mining'] loop
  connection:=format('host=%s dbname=postgres user=postgres password=postgres connect_timeout=2',host_name);
  begin
   execute format('select %I.dblink_connect(%L,%L)',extension_schema,'hold_cancel_admission_holder',connection);
   exit;
  exception when others then connection:=null;
  end;
 end loop;
 if connection is null then raise exception 'PUTDUK_LOCAL_DB_HOST_UNRESOLVED'; end if;
 execute format('select %I.dblink_connect(%L,%L)',extension_schema,'hold_cancel_admission_writer',connection);
 -- A TEMP INVOKER captures the actual remote SQLSTATE after its subtransaction
 -- rolls back. It grants no finance authority and accepts no economic clock.
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer',$helper$
  create function pg_temp.checked_clock_attempt(p_sql text) returns jsonb
  language plpgsql security invoker set search_path=pg_catalog as $body$
  declare value text; code text; message text; started timestamptz:=statement_timestamp();
  begin
   execute p_sql into value;
   return jsonb_build_object('ok',true,'result',value,
    'statement_started_at_microseconds',((extract(epoch from started)*1000000)::bigint)::text);
  exception when others then
   get stacked diagnostics code=returned_sqlstate,message=message_text;
   return jsonb_build_object('ok',false,'sqlstate',code,'message',message,
    'statement_started_at_microseconds',((extract(epoch from started)*1000000)::bigint)::text);
  end;
  $body$;
  revoke all on function pg_temp.checked_clock_attempt(text) from public,anon,authenticated,service_role;
  grant execute on function pg_temp.checked_clock_attempt(text) to service_role;
 $helper$);
 -- Fresh admission must reject RR even without contention. A row/advisory
 -- lock alone cannot refresh its old transaction snapshot.
 v_before:=pg_temp.clock_finance_snapshot(original_member);
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','begin isolation level repeatable read');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set local role service_role');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer',
  'set local request.jwt.claims=''{"role":"service_role"}''');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_writer',
  format('select pg_temp.checked_clock_attempt(%L)::text',format(
   'select a.admission_id::text from app_private.capture_funding_withdrawal_clock_admission(%L::uuid,''HOLD'',gen_random_uuid()) a',original_request))) into result;
 v_result:=result::jsonb;
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','rollback');
 insert into pg_temp.admission_v2_outcome(kind,result,before_facts,after_facts)
 values('RR_FRESH_HOLD',v_result,v_before,pg_temp.clock_finance_snapshot(original_member));
 -- Concrete RC reproduction: the HOLD statement begins and waits first.
 -- Only then the canonical GLOBAL command publishes a current pause.
 v_before:=pg_temp.clock_finance_snapshot(original_member);
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','begin');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','set local role service_role');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder',
  'set local request.jwt.claims=''{"role":"service_role"}''');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_holder',
  'select pg_backend_pid()::text from pg_advisory_xact_lock(hashtextextended(''putduk-mining.safe-mode:GLOBAL'',0))') into result;
 holder_pid:=result::integer;
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','begin isolation level read committed');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set local statement_timeout=''15000ms''');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set local role service_role');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer',
  'set local request.jwt.claims=''{"role":"service_role"}''');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_writer',
  'select pg_backend_pid()::text') into result;writer_pid:=result::integer;
 execute format('select %I.dblink_send_query(%L,%L)',extension_schema,'hold_cancel_admission_writer',
  format('select pg_temp.checked_clock_attempt(%L)::text',format(
   'select app_private.post_withdrawal_hold(r.user_id,r.id,r.amount_atomic+r.fee_atomic,r.idempotency_key,gen_random_uuid())::text from public.withdrawal_requests r where r.id=%L::uuid',original_request)));
 deadline:=clock_timestamp()+interval '8 seconds';waited:=false;
 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_locks w join pg_locks h on h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
   where w.pid=writer_pid and h.pid=holder_pid and w.locktype='advisory' and h.locktype='advisory'
    and not w.granted and h.granted and h.mode='ExclusiveLock' and w.mode='ShareLock'
    and holder_pid=any(pg_blocking_pids(writer_pid))) into waited;
  exit when waited;
  if clock_timestamp()>deadline then raise exception 'PAUSED_HOLD_ACTUAL_SHARED_WAITER_MISSING'; end if;
  perform pg_sleep(0.01);
 end loop;
 execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_holder',format($pause$
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
  values('10626100-0000-4000-8000-000000000001','ADMIN','SAFE_MODE_ENABLED','SAFE_MODE','GLOBAL',
   'Actual waited HOLD admission pause',gen_random_uuid(),jsonb_build_object('command_version',1,
   'component','GLOBAL','is_paused',true,'review_at',null,
   'expected_request_id',(select request_id from public.safe_mode_controls where component='GLOBAL'),
   'idempotency_key',%L)) returning id::text
 $pause$,'hold-admission-pause-'||run_key)) into result;pause_audit:=result::uuid;
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','set constraints all immediate');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','commit');
 deadline:=clock_timestamp()+interval '8 seconds';
 loop
  execute format('select %I.dblink_is_busy(%L)',extension_schema,'hold_cancel_admission_writer') into busy;
  exit when busy=0;
  if clock_timestamp()>deadline then raise exception 'PAUSED_HOLD_ACTUAL_COMMAND_TIMEOUT'; end if;
  perform pg_sleep(0.01);
 end loop;
 execute format('select value from %I.dblink_get_result(%L) as r(value text)',extension_schema,'hold_cancel_admission_writer') into result;
 v_result:=result::jsonb;
 execute format('select value from %I.dblink_get_result(%L) as r(value text)',extension_schema,'hold_cancel_admission_writer') into result;
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set constraints all immediate');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','commit');
 select o.effective_at into v_pause_at from app_private.funding_global_control_originals o where o.audit_id=pause_audit;
 insert into pg_temp.admission_v2_outcome(kind,result,before_facts,after_facts,actual_waiter,pause_at)
 values('RC_WAITED_PAUSE_HOLD',v_result,v_before,pg_temp.clock_finance_snapshot(original_member),waited,v_pause_at);
 -- Resume using the existing canonical command; financial originals are never
 -- deleted to recover a fixture. The original REQUESTED intent remains fresh.
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','begin');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','set local role service_role');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder',
  'set local request.jwt.claims=''{"role":"service_role"}''');
 execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_holder',format($resume$
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
  values('10626100-0000-4000-8000-000000000001','ADMIN','SAFE_MODE_DISABLED','SAFE_MODE','GLOBAL',
   'Actual HOLD admission test resume',gen_random_uuid(),jsonb_build_object('command_version',1,
   'component','GLOBAL','is_paused',false,'review_at',null,
   'expected_request_id',(select request_id from public.safe_mode_controls where component='GLOBAL'),
   'idempotency_key',%L)) returning id::text
 $resume$,'hold-admission-resume-'||run_key)) into result;
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','set constraints all immediate');
 execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','commit');
 foreach kind in array array['HOLD','CANCEL'] loop
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','begin');
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','set local role service_role');
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder',
   'set local request.jwt.claims=''{"role":"service_role"}''');
  execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_holder',
   case when kind='HOLD' then
    'select pg_backend_pid()::text from pg_advisory_xact_lock(hashtextextended(''putduk-mining.safe-mode:GLOBAL'',0))'
   else format('select pg_backend_pid()::text from pg_advisory_xact_lock(hashtextextended(%L,0))',
    'putduk-funding-recovery:'||original_member::text) end) into result;
  holder_pid:=result::integer;
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','begin');
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set local statement_timeout=''15000ms''');
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set local role service_role');
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer',
   'set local request.jwt.claims=''{"role":"service_role"}''');
  execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_writer',
   'select pg_backend_pid()::text') into result;
  writer_pid:=result::integer;
  execute format('select %I.dblink_send_query(%L,%L)',extension_schema,'hold_cancel_admission_writer',
   case when kind='HOLD' then format($hold$
    select app_private.post_withdrawal_hold(r.user_id,r.id,r.amount_atomic+r.fee_atomic,r.idempotency_key,gen_random_uuid())::text
    from public.withdrawal_requests r where r.id=%L::uuid
   $hold$,original_request) else format($cancel$
    select public.release_withdrawal_hold(%L::uuid,'10626100-0000-4000-8000-000000000001',
    'Actual concurrent principal hold cancellation','hold-admission-source-cancel','CANCELLED')::text
   $cancel$,original_request) end);
  deadline:=clock_timestamp()+interval '8 seconds'; waited:=false;
  loop
   perform pg_stat_clear_snapshot();
   select exists(select 1 from pg_locks w join pg_locks h on h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
    where w.pid=writer_pid and h.pid=holder_pid and w.locktype='advisory' and h.locktype='advisory'
     and not w.granted and h.granted and h.mode='ExclusiveLock'
     and w.mode=case when kind='HOLD' then 'ShareLock' else 'ExclusiveLock' end
     and holder_pid=any(pg_blocking_pids(writer_pid))) into waited;
   exit when waited;
   if clock_timestamp()>deadline then raise exception 'HOLD_CANCEL_ACTUAL_ADMISSION_WAITER_MISSING'; end if;
   perform pg_sleep(0.01);
  end loop;
  execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_holder',
   'select clock_timestamp()::text') into result;
  release_bound:=result::timestamptz;
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','commit');
  deadline:=clock_timestamp()+interval '8 seconds';
  loop
   execute format('select %I.dblink_is_busy(%L)',extension_schema,'hold_cancel_admission_writer') into busy;
   exit when busy=0;
   if clock_timestamp()>deadline then raise exception 'HOLD_CANCEL_ACTUAL_COMMAND_TIMEOUT'; end if;
   perform pg_sleep(0.01);
  end loop;
  execute format('select value from %I.dblink_get_result(%L) as r(value text)',extension_schema,'hold_cancel_admission_writer') into result;
  if kind='HOLD' then hold_id:=result::uuid; else release_id:=result::uuid; end if;
  execute format('select value from %I.dblink_get_result(%L) as r(value text)',extension_schema,'hold_cancel_admission_writer') into result;
  if kind='HOLD' then
   -- Missing member principal-confirmation command is explicitly represented
   -- only by the owner-only initiating fixture. Actual kernel/native writers
   -- now complete their real originals in this same admitted service transaction.
   execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer',format($originals$
    update public.withdrawal_requests set status='HELD',hold_ledger_transaction_id=%L::uuid,
      hold_posted_at=(select posted_at from public.ledger_transactions where id=%L::uuid) where id=%L::uuid;
    insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
      correlation_id,request_id,idempotency_key,occurred_at,created_at)
    select 'WITHDRAWAL_REQUESTED.v1',1,'withdrawal_request',r.id,r.user_id,
      jsonb_build_object('user_id',r.user_id,'amount_atomic',r.amount_atomic::text,'fee_atomic','0','currency','KRW',
      'destination_type','KRW_BANK','hold_ledger_transaction_id',t.id,'welcome_reward',false),
      t.request_id,t.request_id,r.idempotency_key||':event',t.posted_at,t.posted_at
      from public.withdrawal_requests r join public.ledger_transactions t on t.id=r.hold_ledger_transaction_id where r.id=%L::uuid;
    insert into public.transaction_receipts(receipt_number,user_id,transaction_type,source_type,source_id,amount_atomic,
      currency,status,requested_at,status_timeline)
    select 'PDK-WD-'||upper(replace(r.id::text,'-','')),r.user_id,'WITHDRAWAL','withdrawal_request',r.id,r.amount_atomic,
      'KRW','HELD',r.hold_posted_at,jsonb_build_array(jsonb_build_object('status','HELD','at',r.hold_posted_at))
      from public.withdrawal_requests r where r.id=%L::uuid
   $originals$,hold_id,hold_id,original_request,original_request,original_request));
   execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_writer',
    format('select app_private.apply_principal_recovery_newest_first(%L::uuid,%L::uuid)::text',original_member,hold_id)) into result;
  end if;
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set constraints all immediate');
  execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','commit');
  insert into pg_temp.hold_cancel_race_result values(kind,waited,release_bound,case when kind='HOLD' then hold_id else release_id end);
  if kind='HOLD' then
   -- Original replay is immutable/read-only even under RR. Fresh RELEASE in
   -- that same snapshot must be rejected BEFORE creating any new receipt.
   v_before:=pg_temp.clock_finance_snapshot(original_member);
   select a.id into admission_original from app_private.funding_withdrawal_clock_admissions a
    where a.withdrawal_id=original_request and a.phase='HOLD';
   execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','begin isolation level repeatable read');
   execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','set local role service_role');
   execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer',
    'set local request.jwt.claims=''{"role":"service_role"}''');
   execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_writer',
    format('select pg_temp.checked_clock_attempt(%L)::text',format(
     'select a.admission_id::text from app_private.capture_funding_withdrawal_clock_admission(%L::uuid,''HOLD'',(select t.request_id from public.ledger_transactions t where t.id=%L::uuid)) a',original_request,hold_id))) into result;
   insert into pg_temp.admission_v2_outcome(kind,result,before_facts)
   values('RR_ORIGINAL_HOLD_REPLAY',result::jsonb||jsonb_build_object('expected_original',admission_original),v_before);
   execute format('select value from %I.dblink(%L,%L) as r(value text)',extension_schema,'hold_cancel_admission_writer',
    format('select pg_temp.checked_clock_attempt(%L)::text',format(
     'select a.admission_id::text from app_private.capture_funding_withdrawal_clock_admission(%L::uuid,''RELEASE'',gen_random_uuid()) a',original_request))) into result;
   v_result:=result::jsonb;
   execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','rollback');
   insert into pg_temp.admission_v2_outcome(kind,result,before_facts,after_facts)
   values('RR_FRESH_RELEASE',v_result,v_before,pg_temp.clock_finance_snapshot(original_member));
  end if;
 end loop;
 execute format('select %I.dblink_disconnect(%L)',extension_schema,'hold_cancel_admission_holder');
 execute format('select %I.dblink_disconnect(%L)',extension_schema,'hold_cancel_admission_writer');
exception when others then
 begin execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_holder','rollback'); exception when others then null; end;
 begin execute format('select %I.dblink_exec(%L,%L)',extension_schema,'hold_cancel_admission_writer','rollback'); exception when others then null; end;
 begin execute format('select %I.dblink_disconnect(%L)',extension_schema,'hold_cancel_admission_holder'); exception when others then null; end;
 begin execute format('select %I.dblink_disconnect(%L)',extension_schema,'hold_cancel_admission_writer'); exception when others then null; end;
 raise;
end;
$race$;
select ok((select bool_and(actual_waiter) and count(*)=2 from hold_cancel_race_result),
 'actual two-session HOLD GLOBAL and CANCEL member admission waiters were observed, not assumed by sleep');
select ok((select bool_and(t.posted_at>=r.release_lower_bound) from hold_cancel_race_result r
 join public.ledger_transactions t on t.id=r.journal_id),
 'both immutable financial originals are effective only after actual lock release');
select ok((select t.metadata->>'admitted_at_microseconds'=((extract(epoch from t.posted_at)*1000000)::bigint)::text
 and t.posted_at=r.hold_posted_at from public.ledger_transactions t join public.withdrawal_requests r on r.hold_ledger_transaction_id=t.id
 where r.id='10630000-0000-4000-8000-000000000003'),
 'actual waited HOLD has one exact kernel clock shared by request and original receipt');
select ok((select count(*)=3 and bool_and(clock.effective_at=t.posted_at) from public.funding_principal_recovery_allocations a
 join app_private.funding_portion_transitions clock on clock.kind='HOLD' and clock.original_id=a.id
 join public.ledger_transactions t on t.id=a.hold_ledger_transaction_id
 where a.hold_ledger_transaction_id=(select journal_id from hold_cancel_race_result where kind='HOLD')),
 'actual native HOLD automatically captures all three newest-first immutable lot clocks');
select ok((select count(*)=3 and bool_and(c.accumulated_eligible_microseconds=p.accumulated_eligible_microseconds)
 and bool_and(c.effective_at>p.effective_at) and bool_and(c.resumed_at=c.effective_at)
 from app_private.funding_portion_clock_receipts c join app_private.funding_portion_clock_receipts p on p.id=c.previous_clock_id
 join app_private.funding_portion_transitions t on t.id=c.transition_id
 join public.funding_principal_recovery_releases r on r.id=t.original_id where t.kind='RELEASE'
 and r.release_ledger_transaction_id=(select journal_id from hold_cancel_race_result where kind='CANCEL')),
 'real waited CANCEL excludes its entire hold interval, preserves each accumulated age and resumes prospectively');
select is((select coverage from public.money_source_summaries where user_id='10626100-0000-4000-8000-000000000002'),
 'COMPLETE','both actual service commits retain balanced journals and classified principal reservation/release parity');
select ok((select result->>'ok'='false' and result->>'sqlstate'='25000'
 and result->>'message'='WITHDRAWAL_CLOCK_FRESH_SNAPSHOT_REQUIRED' from admission_v2_outcome where kind='RR_FRESH_HOLD'),
 'actual fresh HOLD under REPEATABLE READ is rejected with the exact fresh-snapshot contract');
select ok((select before_facts=after_facts from admission_v2_outcome where kind='RR_FRESH_HOLD'),
 'RR fresh rejection creates no receipt/journal/wallet/source/principal/portion original');
select ok((select actual_waiter from admission_v2_outcome where kind='RC_WAITED_PAUSE_HOLD'),
 'RC HOLD actually waits on GLOBAL admission before the canonical pause is published');
select ok((select (extract(epoch from pause_at)*1000000)::bigint>(result->>'statement_started_at_microseconds')::bigint
 from admission_v2_outcome where kind='RC_WAITED_PAUSE_HOLD'),
 'actual sealed pause is later than HOLD statement time: historical statement-time safety would miss it');
select ok((select result->>'ok'='false' and result->>'sqlstate'='55000' and result->>'message'='SAFE_MODE_ACTIVE'
 from admission_v2_outcome where kind='RC_WAITED_PAUSE_HOLD'),
 'new financial admission checks the same actual clock and rejects the newly committed pause');
select ok((select before_facts=after_facts from admission_v2_outcome where kind='RC_WAITED_PAUSE_HOLD')
 and not exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id='10630000-0000-4000-8000-000000000003'
 and a.effective_at between (select pause_at from admission_v2_outcome where kind='RC_WAITED_PAUSE_HOLD')
 and (select o.effective_at from app_private.funding_global_control_originals o join public.audit_logs a on a.id=o.audit_id
 where a.reason='Actual HOLD admission test resume')),
 'RC pause rejection leaves no admitted receipt or finance/source/clock original during the actual pause');
select ok((select result->>'ok'='true' and result->>'result'=result->>'expected_original'
 from admission_v2_outcome where kind='RR_ORIGINAL_HOLD_REPLAY'),
 'same immutable original phase replay remains recoverable before the fresh-admission RR gate');
select ok((select result->>'ok'='false' and result->>'sqlstate'='25000'
 and result->>'message'='WITHDRAWAL_CLOCK_FRESH_SNAPSHOT_REQUIRED' from admission_v2_outcome where kind='RR_FRESH_RELEASE'),
 'a fresh RELEASE under RR is denied even after its immutable HOLD replay succeeded');
select ok((select before_facts=after_facts from admission_v2_outcome where kind='RR_FRESH_RELEASE'),
 'RR original replay plus denied fresh RELEASE creates no extra receipt or financial/source/clock original');
select finish();
rollback;
