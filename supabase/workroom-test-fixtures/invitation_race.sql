-- Actual independent PostgreSQL backends contend for the last invitation use.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(1);
\ir ../supabase/tests-concurrent/resolve_disposable_dblink_host.inc
do $race$
declare conn text;invite_code text:='WR-RACE-'||upper(replace(gen_random_uuid()::text,'-',''));
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();pid_b integer;deadline timestamptz;waited boolean:=false;result text;count_users bigint;
begin
 conn:=pg_temp.putduk_disposable_dblink_connection();
 perform extensions.dblink_connect('wr_invite_a',conn);
 perform extensions.dblink_connect('wr_invite_b',conn);
 -- Setup commits in a separate backend so both writers see the same original.
 perform extensions.dblink_exec('wr_invite_a',format('insert into app_private.workroom_invites(code,max_uses,expires_at) values(%L,1,clock_timestamp()+interval ''1 hour'')',invite_code));
 perform extensions.dblink_exec('wr_invite_a','begin');
 perform extensions.dblink_exec('wr_invite_a',format('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(%L,%L,clock_timestamp(),%L::jsonb)',a,a::text||'@workroom-race.test',jsonb_build_object('workroomAcknowledged',true,'referralCode',invite_code)::text));
 perform extensions.dblink_exec('wr_invite_b',$helper$create function pg_temp.wr_try_insert(sql text) returns text language plpgsql security invoker as $$begin execute sql;return 'accepted';exception when others then return sqlstate||':'||sqlerrm;end$$$helper$);
 select pid into pid_b from extensions.dblink('wr_invite_b','select pg_backend_pid()')as x(pid integer);
 perform extensions.dblink_send_query('wr_invite_b',format('select pg_temp.wr_try_insert(%L)',format('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(%L,%L,clock_timestamp(),%L::jsonb)',b,b::text||'@workroom-race.test',jsonb_build_object('workroomAcknowledged',true,'referralCode',invite_code)::text)));
 deadline:=clock_timestamp()+interval '8 seconds';
 while clock_timestamp()<deadline loop
 if exists(select 1 from pg_stat_activity where pid=pid_b and wait_event_type='Lock') then waited:=true;exit;end if;
 perform pg_sleep(.02);
 end loop;
 if not waited then raise exception 'WORKROOM_INVITE_REAL_WAITER_REQUIRED';end if;
 perform extensions.dblink_exec('wr_invite_a','commit');
 select value into result from extensions.dblink_get_result('wr_invite_b')as x(value text);
 if result is distinct from '23514:WORKROOM_INVITATION_INVALID' then raise exception 'WORKROOM_LAST_INVITE_REPLAY_ACCEPTED %',result;end if;
 if(select used from app_private.workroom_invites where workroom_invites.code=invite_code)<>1
 or not exists(select 1 from auth.users where id=a) or exists(select 1 from auth.users where id=b)
 or not exists(select 1 from app_private.workroom_accounts where user_id=a and balance=100000)
 or(select count(*) from app_private.workroom_ledger where user_id=a and kind='WELCOME')<>1
 or exists(select 1 from app_private.workroom_accounts where user_id=b) then raise exception 'WORKROOM_INVITE_ATOMICITY_FAILED';end if;
 perform extensions.dblink_disconnect('wr_invite_a');perform extensions.dblink_disconnect('wr_invite_b');
end;
$race$;
select pass('two actual sessions serialize final invitation consumption; rejected signup rolls back identity/account/welcome atomically');
select * from finish();
rollback;
