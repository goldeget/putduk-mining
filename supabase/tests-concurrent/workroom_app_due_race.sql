-- Fresh PostgreSQL database only. Two real connections contend on exactly the old SYNC lock.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select extensions.plan(1);
\ir resolve_disposable_dblink_host.inc
do $race$
declare ns text;conn text;u uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();rid uuid;session_name text;
 holder text:='wr207_holder';w text:='wr207_worker';m text:='wr207_member';v text;worker_pid int;member_pid int;waiting int;tick int;
begin
 select n.nspname into strict ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 conn:=pg_temp.putduk_disposable_dblink_connection();
 foreach session_name in array array[holder,w,m] loop execute format('select %I.dblink_connect($1,$2)',ns) using session_name,conn;end loop;
 -- Create actual invited member and active, due round before either contender runs.
 execute format('select %I.dblink_exec($1,$2)',ns) using holder,format($setup$
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
   confirmation_token,recovery_token,email_change,email_change_token_new)
  values(%1$L,'authenticated','authenticated',%2$L,'',now(),'{}',app_private.workroom_native_signup_metadata('{}'),now(),now(),'','','','');
  insert into auth.sessions(id,user_id,aal,created_at,updated_at) values(%3$L,%1$L,'aal1',now(),now());
  set request.jwt.claim.sub=%1$L;set request.jwt.claims=%4$L;
  do $start$begin perform public.workroom_member_command('START','app-race-start','{"instrument":"nvda","stake":50000,"expectedVersion":1,"acknowledged":true}');end$start$;
  set session_replication_role=replica;
  update app_private.workroom_rounds set started_at=clock_timestamp()-interval '1 day' where user_id=%1$L;
  set session_replication_role=origin;
  update app_private.workroom_app_jobs j set due_at=r.started_at+make_interval(secs=>(r.snapshot->>'duration')::int)
   from app_private.workroom_rounds r where r.id=j.round_id and r.user_id=%1$L;
 $setup$,u,u::text||'@race.putduk.test',sid,jsonb_build_object('role','authenticated','sub',u,'session_id',sid,'aal','aal1')::text);
 execute format('select id from %I.dblink($1,$2) x(id uuid)',ns) into strict rid using holder,format('select id from app_private.workroom_rounds where user_id=%L',u);
 execute format('select %I.dblink_exec($1,$2)',ns) using holder,'begin';
 execute format('select val from %I.dblink($1,$2) x(val text)',ns) into v using holder,
  format('select ''held'' from pg_advisory_xact_lock(hashtextextended(%L,0))','workroom:member:'||u::text);
 execute format('select %I.dblink_exec($1,$2)',ns) using w,$sql$set statement_timeout='30s';set role service_role;set request.jwt.claims='{"role":"service_role"}'$sql$;
 execute format('select %I.dblink_exec($1,$2)',ns) using m,format('set statement_timeout=''30s'';set role authenticated;set request.jwt.claim.sub=%L;set request.jwt.claims=%L',
  u,jsonb_build_object('role','authenticated','sub',u,'session_id',sid,'aal','aal1')::text);
 execute format('select p from %I.dblink($1,$2) x(p int)',ns) into worker_pid using w,'select pg_backend_pid()';
 execute format('select p from %I.dblink($1,$2) x(p int)',ns) into member_pid using m,'select pg_backend_pid()';
 execute format('select %I.dblink_send_query($1,$2)',ns) using w,format('select public.workroom_app_worker(''RECOVER'',%L)::text',jsonb_build_object('roundId',rid)::text);
 execute format('select %I.dblink_send_query($1,$2)',ns) using m,'select public.workroom_member_command(''SYNC'',''app-race-sync'',''{}'')::text';
 for tick in 1..300 loop
  select count(distinct pid) into waiting from pg_locks where locktype='advisory' and not granted and pid in(worker_pid,member_pid);
  exit when waiting=2;perform pg_sleep(.025);
 end loop;
 if waiting<>2 then raise exception 'NATIVE_BOTH_CONTENDERS_NOT_OBSERVED';end if;
 execute format('select %I.dblink_exec($1,$2)',ns) using holder,'commit';
 foreach session_name in array array[w,m] loop
  execute format('select value from %I.dblink_get_result($1) x(value text)',ns) into strict v using session_name;
 end loop;
 execute format('select verified from %I.dblink($1,$2) x(verified text)',ns) into v using holder,format($verify$
  select ((select count(*) from app_private.workroom_ledger where round_id=%1$L and kind='SETTLEMENT')=1
   and(select count(*) from app_private.workroom_app_events where kind='ROUND_COMPLETED' and resource_id=%1$L)=1
   and(select count(*) from app_private.workroom_app_inbox i join app_private.workroom_app_events e on e.id=i.event_id where e.resource_id=%1$L and i.recipient=%2$L)=1
   and not exists(select 1 from public.money_source_movements where user_id=%2$L))::text
 $verify$,rid,u);
 if v is distinct from 'true' then raise exception 'DUPLICATE_OR_MISSING_COMPLETION';end if;
 foreach session_name in array array[holder,w,m] loop execute format('select %I.dblink_disconnect($1)',ns) using session_name;end loop;
exception when others then
 foreach session_name in array array[holder,w,m] loop begin execute format('select %I.dblink_disconnect($1)',ns) using session_name;exception when others then null;end;end loop;raise;
end$race$;
select extensions.pass('concurrent real member SYNC and no-browser service RECOVER serialize a single original and point settlement');
select * from extensions.finish();
rollback;
