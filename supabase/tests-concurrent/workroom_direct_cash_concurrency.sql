-- Fresh disposable native database only. Fixtures commit on independent local
-- sessions so the probes exercise actual concurrent command commits. No external
-- payment is made, no shared history is deleted, and no mining credit is planted.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();
\ir resolve_disposable_dblink_host.inc

create temporary table wc_checks(passed boolean, description text);
create temporary table wc_context(member_id uuid, destination_id uuid, logical_key text, withdrawal_id uuid);

create function pg_temp.wc_exec(p_conn text,p_sql text) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare ns text;begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 execute format('select %I.dblink_exec(%L,%L)',ns,p_conn,p_sql);
end$$;
create function pg_temp.wc_read(p_conn text,p_sql text) returns text
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare ns text;v text;begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 execute format('select value from %I.dblink(%L,%L) as t(value text)',ns,p_conn,p_sql) into v;return v;
end$$;
create function pg_temp.wc_check(p_ok boolean,p_description text) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$begin
 insert into pg_temp.wc_checks values(coalesce(p_ok,false),p_description);
end$$;

-- Both workers must demonstrably wait on the exact member advisory boundary
-- before it is released. Sleeping alone is never accepted as race evidence.
create function pg_temp.wc_race(p_member uuid,p_a text,p_b text,p_label text) returns jsonb[]
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare ns text;conn text;holder text:='wc_holder_'||p_label;
 names text[]:=array['wc_a_'||p_label,'wc_b_'||p_label];name text;
 pid_list integer[]:=array[]::integer[];pid integer;waiting integer;busy integer;
 tick integer;v text;results jsonb[]:=array[]::jsonb[];sql_text text;
begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 conn:=pg_temp.putduk_disposable_dblink_connection();
 execute format('select %I.dblink_connect(%L,%L)',ns,holder,conn);
 perform pg_temp.wc_exec(holder,'begin');
 v:=pg_temp.wc_read(holder,format('select ''locked'' from (select pg_advisory_xact_lock(hashtextextended(%L,0))) held','putduk-funding-recovery:'||p_member::text));
 if v is distinct from 'locked' then raise exception 'WORKROOM_CASH_HOLDER_NOT_LOCKED';end if;
 foreach name in array names loop
  execute format('select %I.dblink_connect(%L,%L)',ns,name,conn);
  perform pg_temp.wc_exec(name,$remote$
   create function pg_temp.wc_attempt(p_sql text) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $attempt$
   declare answer text;begin
    execute p_sql into answer;
    set constraints all immediate;
    set constraints all deferred;
    return jsonb_build_object('ok',true,'value',answer);
   exception when others then return jsonb_build_object('ok',false,'state',sqlstate,'message',sqlerrm);end
   $attempt$;
   set statement_timeout='30000ms';set lock_timeout='15000ms';set role service_role;
   set request.jwt.claims='{"role":"service_role"}';
  $remote$);
  pid:=pg_temp.wc_read(name,'select pg_backend_pid()::text')::integer;
  pid_list:=array_append(pid_list,pid);
  sql_text:=case when name=names[1] then p_a else p_b end;
  execute format('select %I.dblink_send_query(%L,%L)',ns,name,format('select pg_temp.wc_attempt(%L)::text',sql_text));
 end loop;
 for tick in 1..200 loop
  select count(distinct l.pid)::integer into waiting from pg_locks l
   where l.pid=any(pid_list) and l.locktype='advisory' and not l.granted;
  exit when waiting=2;perform pg_sleep(0.025);
 end loop;
 if waiting<>2 then raise exception 'WORKROOM_CASH_REAL_CONTENTION_REQUIRED %',p_label;end if;
 perform pg_temp.wc_check(true,p_label||': both real sessions blocked on the member boundary');
 perform pg_temp.wc_exec(holder,'commit');
 execute format('select %I.dblink_disconnect(%L)',ns,holder);
 for tick in 1..600 loop
  busy:=0;
  foreach name in array names loop
   execute format('select %I.dblink_is_busy(%L)',ns,name) into v;busy:=busy+v::integer;
  end loop;
  exit when busy=0;perform pg_sleep(0.025);
 end loop;
 if busy<>0 then raise exception 'WORKROOM_CASH_CONCURRENT_TIMEOUT %',p_label;end if;
 foreach name in array names loop
  execute format('select value from %I.dblink_get_result(%L) as t(value text)',ns,name) into v;
  results:=array_append(results,v::jsonb);
  execute format('select value from %I.dblink_get_result(%L) as t(value text)',ns,name) into v;
  execute format('select %I.dblink_disconnect(%L)',ns,name);
 end loop;
 return results;
exception when others then
 foreach name in array array_append(names,holder) loop
  begin execute format('select %I.dblink_disconnect(%L)',ns,name);exception when others then null;end;
 end loop;raise;
end$$;

do $fixture$
declare ns text;conn text;begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 conn:=pg_temp.putduk_disposable_dblink_connection();
 execute format('select %I.dblink_connect(%L,%L)',ns,'wc_setup',conn);
 perform pg_temp.wc_exec('wc_setup',$setup$
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
   raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
  select id,'authenticated','authenticated',email,'',clock_timestamp(),'{}'::jsonb,
   app_private.workroom_native_signup_metadata('{}'::jsonb),clock_timestamp(),clock_timestamp(),'','','',''
  from (values
   ('0dc51111-0000-4000-8000-0000000000a1'::uuid,'wc-concurrent-operator@example.test'),
   ('0dc51111-0000-4000-8000-0000000000b1'::uuid,'wc-concurrent-member-a@example.test'),
   ('0dc51111-0000-4000-8000-0000000000b2'::uuid,'wc-concurrent-member-b@example.test')) x(id,email);
  insert into public.user_roles(user_id,role,granted_by)
  values('0dc51111-0000-4000-8000-0000000000a1','ADMIN','0dc51111-0000-4000-8000-0000000000a1');
  insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,
   fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
  values('KRW','KRW_BANK',11110659,true,1,0,'{"allowed_bank_codes":["KB"]}',clock_timestamp()-interval '1 hour',
   '0dc51111-0000-4000-8000-0000000000a1',false);
  do $members$
  declare member uuid;deposit uuid;begin
   foreach member in array array['0dc51111-0000-4000-8000-0000000000b1','0dc51111-0000-4000-8000-0000000000b2']::uuid[] loop
    perform public.bootstrap_user(member);
    insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
     display_hint,verification_status,verified_at,protection_until)
    values(member,'KRW_BANK',decode(repeat('ab',32),'hex'),encode(extensions.digest(member::text,'sha256'),'hex'),
     'KB local concurrent fixture','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
    deposit:=public.create_deposit_request(member,'KRW',10000,'wc-deposit-request-'||member::text);
    execute 'set local role service_role';
    perform public.approve_deposit_request(deposit,'0dc51111-0000-4000-8000-0000000000a1',10000,
     'wc-deposit-approval-'||member::text,'actual canonical local deposit',gen_random_uuid());
    set constraints all immediate;
    set constraints all deferred;
    execute 'reset role';
   end loop;
  end$members$;
 $setup$);
 execute format('select %I.dblink_disconnect(%L)',ns,'wc_setup');
exception when others then
 begin execute format('select %I.dblink_disconnect(%L)',ns,'wc_setup');exception when others then null;end;raise;
end$fixture$;

insert into wc_context(member_id,destination_id)
select user_id,id from public.withdrawal_destinations
where user_id in('0dc51111-0000-4000-8000-0000000000b1','0dc51111-0000-4000-8000-0000000000b2');

do $probes$
declare member uuid;dest uuid;policy uuid;prepare_sql text;hold_sql text;replies jsonb[];
 key text;withdrawal uuid;conn text;ns text;result text;value jsonb;hold_id uuid;scenario text;attempt_a text;attempt_b text;
begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 select id into policy from public.withdrawal_policies where currency='KRW' and destination_type='KRW_BANK' and version=11110659;
 foreach member in array array['0dc51111-0000-4000-8000-0000000000b1','0dc51111-0000-4000-8000-0000000000b2']::uuid[] loop
  select destination_id into dest from wc_context where member_id=member;
  scenario:=case when member='0dc51111-0000-4000-8000-0000000000b1' then 'paid' else 'released' end;
  prepare_sql:=format('select public.prepare_workroom_cash_withdrawal(%L::uuid,''KRW_BANK'',7000,%L::uuid,11110659,null,%L::uuid)::text',member,policy,dest);
  replies:=pg_temp.wc_race(member,prepare_sql,prepare_sql,'prepare_'||scenario);
  perform pg_temp.wc_check((replies[1]->>'ok')::boolean and(replies[2]->>'ok')::boolean,'concurrent preparation succeeds through the real service RPC');
  key:=(replies[1]->>'value')::jsonb->>'key';
  perform pg_temp.wc_check(key is not null and key=((replies[2]->>'value')::jsonb->>'key'),'competing preparation recovers one immutable pending key');
  update wc_context set logical_key=key where member_id=member;
  hold_sql:=format('select public.hold_workroom_cash_withdrawal(%L::uuid,%L,''KRW_BANK'',%L::uuid,7000)::text',member,key,dest);
  replies:=pg_temp.wc_race(member,hold_sql,hold_sql,'hold_'||scenario);
  perform pg_temp.wc_check((replies[1]->>'ok')::boolean and(replies[2]->>'ok')::boolean and replies[1]->>'value'=replies[2]->>'value','same-key concurrent HOLD returns one original withdrawal');
  withdrawal:=(replies[1]->>'value')::uuid;
  update wc_context set withdrawal_id=withdrawal where member_id=member;
  perform pg_temp.wc_check((select count(*)=1 from public.withdrawal_requests where user_id=member and idempotency_key=key),'one withdrawal row after competing commits');
  select hold_ledger_transaction_id into hold_id from public.withdrawal_requests where id=withdrawal;
  perform pg_temp.wc_check((select count(*)=1 from public.ledger_transactions where member_user_id=member and metadata->>'phase'='HOLD'),'one balanced HOLD journal after competing commits');
  perform pg_temp.wc_check((select sum(amount_atomic)=7000 from app_private.workroom_cash_reservations where withdrawal_id=withdrawal),'one exact deposit-backed reservation after competing commits');
  conn:=pg_temp.putduk_disposable_dblink_connection();
  execute format('select %I.dblink_connect(%L,%L)',ns,'wc_checks',conn);
  perform pg_temp.wc_exec('wc_checks',$helper$
   create function pg_temp.wc_attempt(p_sql text) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $attempt$
   declare answer text;begin execute p_sql into answer;set constraints all immediate;return jsonb_build_object('ok',true,'value',answer);
   exception when others then return jsonb_build_object('ok',false,'state',sqlstate,'message',sqlerrm);end$attempt$;
   set role service_role;set request.jwt.claims='{"role":"service_role"}';
  $helper$);
  value:=pg_temp.wc_read('wc_checks',format('select pg_temp.wc_attempt(%L)::text',format('select public.hold_workroom_cash_withdrawal(%L::uuid,%L,''KRW_BANK'',%L::uuid,6000)::text',member,key,dest)))::jsonb;
  perform pg_temp.wc_check((value->>'ok')::boolean is false,'changed amount cannot reuse a prepared key');
  value:=pg_temp.wc_read('wc_checks',format('select pg_temp.wc_attempt(%L)::text',format('select public.hold_workroom_cash_withdrawal(%L::uuid,''wc-unprepared-different-key'',''KRW_BANK'',%L::uuid,7000)::text',member,dest)))::jsonb;
  perform pg_temp.wc_check((value->>'ok')::boolean is false,'a fresh different key cannot bypass preparation or reserve the remaining credit');
  perform pg_temp.wc_check((select count(*)=1 from app_private.workroom_cash_withdrawals where user_id=member),'rejected fresh and mismatched keys create no second cash withdrawal');
  if scenario='paid' then
   result:=pg_temp.wc_read('wc_checks',format('select public.record_krw_external_send(%L::uuid,''WC-LOCAL-CONCURRENT-7000'',7000,%L::uuid,clock_timestamp(),''wc-record-paid-send'')::text',withdrawal,'0dc51111-0000-4000-8000-0000000000a1'));
  end if;
  execute format('select %I.dblink_disconnect(%L)',ns,'wc_checks');
  attempt_a:=format('select public.release_withdrawal_hold(%L::uuid,%L::uuid,''reviewed concurrent cancellation'',%L,''CANCELLED'')::text',withdrawal,'0dc51111-0000-4000-8000-0000000000a1','wc-release-'||scenario);
  attempt_b:=format('select public.finalize_withdrawal_ledger(%L::uuid,%L::uuid,%L)::text',withdrawal,'0dc51111-0000-4000-8000-0000000000a1','wc-finalize-'||scenario);
  replies:=pg_temp.wc_race(member,attempt_a,attempt_b,'terminal_'||scenario);
  perform pg_temp.wc_check(case when scenario='paid' then(replies[1]->>'ok')::boolean is false and(replies[2]->>'ok')::boolean else(replies[1]->>'ok')::boolean and(replies[2]->>'ok')::boolean is false end,'terminal race admits only the disposition supported by external-send evidence');
  perform pg_temp.wc_check((select count(*)=1 and min(d.phase)=case when scenario='paid' then 'FINALIZE' else 'RELEASE' end from app_private.workroom_cash_dispositions d where d.withdrawal_id=withdrawal),'terminal race writes one mutually exclusive cash disposition');
  replies:=pg_temp.wc_race(member,case when scenario='paid' then attempt_b else attempt_a end,
   case when scenario='paid' then attempt_b else attempt_a end,'replay_'||scenario);
  perform pg_temp.wc_check((replies[1]->>'ok')::boolean and(replies[2]->>'ok')::boolean
   and replies[1]->>'value'=replies[2]->>'value','concurrent terminal replay recovers one original journal');
  replies:=pg_temp.wc_race(member,hold_sql,hold_sql,'old_hold_'||scenario);
  perform pg_temp.wc_check((replies[1]->>'ok')::boolean and(replies[2]->>'ok')::boolean
   and replies[1]->>'value'=withdrawal::text and replies[2]->>'value'=withdrawal::text,
   'old HOLD replay after terminal state never creates another reservation');
 end loop;
end$probes$;

select ok(passed,description) from wc_checks;
select ok(not exists(select 1 from app_private.funding_engine_activations where user_id in(select member_id from wc_context)),'direct deposits and cash withdrawals never activate mining');
select ok(not exists(select 1 from public.money_source_movements where user_id in(select member_id from wc_context) and source_bucket='MINING_REWARD'),'direct deposit fixtures never fabricate mining rewards');
select ok(not exists(select 1 from public.ledger_transactions t join public.ledger_entries e on e.transaction_id=t.id where t.member_user_id in(select member_id from wc_context) group by t.id having sum(case when e.side='DEBIT' then e.amount_atomic else -e.amount_atomic end)<>0),'every canonical cash journal remains balanced after actual concurrent commits');
select ok((select coverage='COMPLETE' and eligible_principal_atomic='3000' and held_principal_atomic='0' and recovered_principal_atomic='7000' from public.money_source_summaries where user_id='0dc51111-0000-4000-8000-0000000000b1'),'paid concurrent withdrawal conserves available, held and finalized principal');
select ok((select coverage='COMPLETE' and eligible_principal_atomic='10000' and held_principal_atomic='0' and recovered_principal_atomic='0' from public.money_source_summaries where user_id='0dc51111-0000-4000-8000-0000000000b2'),'cancelled concurrent withdrawal restores deposit availability exactly once');
select is((select app_private.available_krw_balance(id) from public.wallet_accounts where user_id='0dc51111-0000-4000-8000-0000000000b1' and currency='KRW'),3000::bigint,'wallet availability agrees with the paid source fold');
select is((select app_private.available_krw_balance(id) from public.wallet_accounts where user_id='0dc51111-0000-4000-8000-0000000000b2' and currency='KRW'),10000::bigint,'wallet availability agrees with the released source fold');
select ok((select count(*)=2 and bool_and(balance=100000) from app_private.workroom_accounts where user_id in(select member_id from wc_context)),'real cash races leave noncash practice balances unchanged');
select ok(not exists(select 1 from public.funding_principal_recovery_allocations where user_id in(select member_id from wc_context)),'direct cash never adopts legacy principal allocation machinery');
select * from finish();
rollback;
