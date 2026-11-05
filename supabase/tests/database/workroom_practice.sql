begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);
-- Rollback-only fixtures; replica mode here bypasses signup creation solely to
-- represent identities that were already present at the production cutover.
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values('11111111-1111-4111-8111-111111111111','old@example.test',now()),('22222222-2222-4222-8222-222222222222','admin@example.test',now()) on conflict(id) do nothing;
set local session_replication_role=origin;
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','aal1',now(),now()),
('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','aal1',now(),now());
insert into app_private.workroom_cohort(user_id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222') on conflict do nothing;do $$begin
 if to_regprocedure('public.workroom_read_state()') is null or to_regprocedure('public.workroom_admin_command(text,text,jsonb,uuid,uuid,text,text)') is null then raise exception 'workroom RPC missing';end if;
 if to_regprocedure('public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)') is not null and has_function_privilege('authenticated','public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)','execute') then raise exception 'legacy allocation remains reachable';end if;
 if to_regprocedure('public.start_trial(uuid,text)') is not null and has_function_privilege('service_role','public.start_trial(uuid,text)','execute') then raise exception 'legacy trial start remains reachable';end if;
 if has_function_privilege('anon','public.workroom_read_state()','execute') or has_function_privilege('anon','public.workroom_member_command(text,text,jsonb)','execute') or has_function_privilege('anon','public.workroom_admin_command(text,text,jsonb,uuid,uuid,text,text)','execute') then raise exception 'anonymous execution allowed';end if;
end$$;
-- Both public overloads AND their separately authenticated-granted private
-- wrappers must reject new participation; historical consumers stay untouched.
do $$declare signature text;db_role text;begin
 foreach signature in array array['public.participate_published_event(uuid,uuid,uuid,uuid)','public.participate_published_event(uuid,uuid,uuid,uuid,text)','app_private.participate_published_event(uuid,uuid,uuid,uuid)','app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'] loop
  if to_regprocedure(signature) is not null then
   foreach db_role in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(db_role,signature,'execute') then raise exception 'legacy event join reachable by % via %',db_role,signature;end if;
   end loop;
  end if;
 end loop;
end$$;
-- Everything below executes against PostgreSQL itself, never a JS balance model.
create function pg_temp.must_fail(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise exception 'Expected %, got %',expected,sqlerrm;end;raise exception 'Expected failure: %',expected;
end$$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"aal":"aal1","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
do $$declare s jsonb;original jsonb;begin
 s:=public.workroom_read_state();if s->'member'<>'null'::jsonb then raise exception 'GET initialized account';end if;
 original:=public.workroom_member_command('OPEN','open-key-0001','{}');
 if original#>>'{member,balance}'<>'100000' then raise exception 'welcome missing';end if;
 if public.workroom_member_command('OPEN','open-key-0001','{}')<>original then raise exception 'original replay changed';end if;
 perform public.workroom_member_command('OPEN','open-key-0002','{}');
 if (select count(*) from app_private.workroom_ledger where kind='WELCOME' and user_id=auth.uid())<>1 then raise exception 'duplicate welcome';end if;
end$$;
select pg_temp.must_fail($q$select public.workroom_member_command('START','open-key-0001','{"instrument":"nvda","stake":1,"acknowledged":true,"expectedVersion":1}')$q$,'WORKROOM_REQUEST_CONFLICT');
select pg_temp.must_fail($q$select public.workroom_member_command('START','bad-ack-key1','{"instrument":"nvda","stake":500,"acknowledged":false,"expectedVersion":1}')$q$,'WORKROOM_INVALID_INPUT');
select pg_temp.must_fail($q$select public.workroom_member_command('START','bad-stake-01','{"instrument":"nvda","stake":100001,"acknowledged":true,"expectedVersion":1}')$q$,'WORKROOM_INSUFFICIENT_POINTS');
select pg_temp.must_fail($q$select public.workroom_member_command('START','small-stake01','{"instrument":"nvda","stake":999,"acknowledged":true,"expectedVersion":1}')$q$,'WORKROOM_INVALID_INPUT');
select set_config('request.jwt.claims','{}',true);
select pg_temp.must_fail('select public.workroom_read_state()','WORKROOM_AUTH_REQUIRED');
select pg_temp.must_fail($q$select public.workroom_member_command('OPEN','open-key-0001','{}')$q$,'WORKROOM_AUTH_REQUIRED');
select set_config('request.jwt.claims','{"session_id":"44444444-4444-4444-8444-444444444444","aal":"aal1"}',true);
select pg_temp.must_fail('select public.workroom_read_state()','WORKROOM_AUTH_REQUIRED');
select set_config('request.jwt.claims','{"session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","aal":"aal1"}',true);
update auth.sessions set not_after=now()-interval '1 second' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.must_fail($q$select public.workroom_member_command('OPEN','open-key-0001','{}')$q$,'WORKROOM_AUTH_REQUIRED');
update auth.sessions set not_after=null where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from auth.sessions where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.must_fail('select public.workroom_read_state()','WORKROOM_AUTH_REQUIRED');
select pg_temp.must_fail($q$select public.workroom_member_command('OPEN','open-key-0001','{}')$q$,'WORKROOM_AUTH_REQUIRED');
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'aal1',now(),now());
select pg_temp.must_fail($q$select public.workroom_member_command('START','missing-version1','{"instrument":"nvda","stake":1000,"acknowledged":true}')$q$,'WORKROOM_INVALID_INPUT');
select pg_temp.must_fail($q$select public.workroom_member_command('START','bad-version-zero','{"instrument":"nvda","stake":1000,"acknowledged":true,"expectedVersion":0}')$q$,'WORKROOM_INVALID_INPUT');
select pg_temp.must_fail($q$select public.workroom_member_command('START','bad-version-frac','{"instrument":"nvda","stake":1000,"acknowledged":true,"expectedVersion":1.2}')$q$,'WORKROOM_INVALID_INPUT');
select pg_temp.must_fail($q$select public.workroom_member_command('START','bad-version-text','{"instrument":"nvda","stake":1000,"acknowledged":true,"expectedVersion":"1"}')$q$,'WORKROOM_INVALID_INPUT');
create temporary table saved(value jsonb);
insert into saved select public.workroom_member_command('START','start-key-001','{"instrument":"nvda","stake":50000,"acknowledged":true,"expectedVersion":1}');
select pg_temp.must_fail($q$select public.workroom_member_command('START','start-key-002','{"instrument":"usd","stake":1000,"acknowledged":true,"expectedVersion":1}')$q$,'WORKROOM_ACTIVE_ROUND_EXISTS');
-- Frozen condition survives a later config change. Clock fixtures use replica trigger
-- mode only inside this rolled-back superuser test transaction.
update app_private.workroom_config set roi=50,version=version+1 where instrument='nvda';
set local session_replication_role=replica;
update app_private.workroom_rounds set started_at=clock_timestamp()-interval '121 seconds' where user_id=auth.uid();
set local session_replication_role=origin;
do $$declare before_count bigint; s jsonb;begin
 select count(*) into before_count from app_private.workroom_ledger;
 s:=public.workroom_read_state();if s->'active'='null'::jsonb or (select count(*) from app_private.workroom_ledger)<>before_count then raise exception 'GET settled due round';end if;
 s:=public.workroom_member_command('SYNC','sync-key-0001','{}');
 if s#>>'{member,balance}'<>'101200' or s#>>'{history,0,returned}'<>'51200' or s#>>'{history,0,configVersion}'<>'1' then raise exception 'wrong frozen settlement %',s;end if;
 perform public.workroom_member_command('SYNC','sync-key-0002','{}');
 if (select count(*) from app_private.workroom_ledger where kind='SETTLEMENT')<>1 then raise exception 'duplicate settlement';end if;
 if public.workroom_member_command('START','start-key-001','{"instrument":"nvda","stake":50000,"acknowledged":true,"expectedVersion":1}')<>(select value from saved) then raise exception 'replay not original result';end if;
end$$;
-- The config was updated to version2 after the original START. A stale review
-- must fail before reserving stake instead of silently starting latest rules.
select pg_temp.must_fail($q$select public.workroom_member_command('START','stale-version-01','{"instrument":"nvda","stake":1000,"acknowledged":true,"expectedVersion":1}')$q$,'WORKROOM_VERSION_CONFLICT');
do $$declare s jsonb;begin s:=public.workroom_read_state();if s->'active'<>'null'::jsonb or s#>>'{member,balance}'<>'101200' then raise exception 'version conflict reserved stake';end if;end$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"session_id":"44444444-4444-4444-8444-444444444444","aal":"aal1"}',true);
do $$declare s jsonb;begin s:=public.workroom_read_state();if jsonb_array_length(s->'ledger')<>0 or jsonb_array_length(s->'history')<>0 then raise exception 'cross user leak';end if;end$$;
select pg_temp.must_fail(format('select public.workroom_member_command(''FINISH'',''other-user-1'',%L::jsonb)',jsonb_build_object('id',(select value#>>'{active,id}' from saved))),'WORKROOM_OPEN_REQUIRED');
select pg_temp.must_fail($q$select public.workroom_admin_command('READ','read-key-0001','{}','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_ADMIN_FORBIDDEN');
-- A role value in editable user metadata does not confer DB authority.
update auth.users set raw_user_meta_data='{"role":"SUPER_ADMIN"}' where id=auth.uid();
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"44444444-4444-4444-8444-444444444444"}',true);
select pg_temp.must_fail($q$select public.workroom_admin_command('READ','read-key-0001','{}','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'OPERATOR_ROLE_REQUIRED');
insert into public.user_roles(user_id,role) values(auth.uid(),'ADMIN');
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at) values('33333333-3333-4333-8333-333333333333',auth.uid(),'44444444-4444-4444-8444-444444444444','workroom-test-fingerprint',now()+interval '1 hour',now()+interval '8 hours');
select pg_temp.must_fail($q$select public.workroom_admin_command('READ','read-key-0001','{}','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_MFA_REQUIRED');
insert into auth.mfa_factors(id,user_id,factor_type,status,friendly_name,secret,created_at,updated_at) values('55555555-5555-4555-8555-555555555555',auth.uid(),'totp','verified','workroom-test','ROLLBACK_ONLY_SECRET',now(),now());
update auth.sessions set aal='aal2',factor_id='55555555-5555-4555-8555-555555555555' where id='44444444-4444-4444-8444-444444444444';
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) values(gen_random_uuid(),'44444444-4444-4444-8444-444444444444','totp',now(),now());
create temporary table invite(value jsonb);
insert into invite select public.workroom_admin_command('INVITE_CREATE','invite-key-001',jsonb_build_object('maxUses',1,'expiresAt',now()+interval '1 day','reason','가입 테스트','label','담당자'),auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
select pg_temp.must_fail($q$insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('66666666-6666-4666-8666-666666666666','no@example.test',now(),'{"role":"SUPER_ADMIN"}')$q$,'WORKROOM_INVITATION_REQUIRED');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) select '66666666-6666-4666-8666-666666666666','new@example.test',now(),jsonb_build_object('referralCode',value->>'code','workroomAcknowledged',true) from invite;
select pg_temp.must_fail(format('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(''77777777-7777-4777-8777-777777777777'',''over@example.test'',now(),%L::jsonb)',(select jsonb_build_object('referralCode',value->>'code','workroomAcknowledged',true) from invite)),'WORKROOM_INVITATION_INVALID');
do $$begin if (select used from app_private.workroom_invites where code=(select value->>'code' from invite))<>1 then raise exception 'bad consumption';end if;if (select balance from app_private.workroom_accounts where user_id='66666666-6666-4666-8666-666666666666')<>100000 then raise exception 'signup not initialized';end if;end$$;
select public.workroom_admin_command('POINT_ADJUST','point-credit-01','{"userId":"11111111-1111-4111-8111-111111111111","direction":"CREDIT","amount":10,"reason":"추가 체험"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
select public.workroom_admin_command('POINT_ADJUST','point-credit-01','{"userId":"11111111-1111-4111-8111-111111111111","direction":"CREDIT","amount":10,"reason":"추가 체험"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
select pg_temp.must_fail($q$select public.workroom_admin_command('POINT_ADJUST','point-credit-01','{"userId":"11111111-1111-4111-8111-111111111111","direction":"CREDIT","amount":11,"reason":"추가 체험"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_REQUEST_CONFLICT');
select public.workroom_admin_command('POINT_ADJUST','point-debit-001','{"userId":"11111111-1111-4111-8111-111111111111","direction":"DEBIT","amount":20,"reason":"중복 포인트 정정"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
select public.workroom_admin_command('POINT_ADJUST','point-debit-001','{"userId":"11111111-1111-4111-8111-111111111111","direction":"DEBIT","amount":20,"reason":"중복 포인트 정정"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
select pg_temp.must_fail($q$select public.workroom_admin_command('POINT_ADJUST','point-debit-001','{"userId":"11111111-1111-4111-8111-111111111111","direction":"DEBIT","amount":21,"reason":"중복 포인트 정정"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_REQUEST_CONFLICT');
select pg_temp.must_fail($q$select public.workroom_admin_command('POINT_ADJUST','point-debit-low1','{"userId":"11111111-1111-4111-8111-111111111111","direction":"DEBIT","amount":1000000,"reason":"잔액 부족 검증"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_INSUFFICIENT_POINTS');
do $$begin if (select balance from app_private.workroom_accounts where user_id='11111111-1111-4111-8111-111111111111')<>101190 then raise exception 'point adjustment replay or debit failed';end if;if not exists(select 1 from app_private.workroom_ledger where user_id='11111111-1111-4111-8111-111111111111' and kind='ADJUSTMENT' and amount=-20 and balance_after=101190 and note='운영자 차감 · 중복 포인트 정정') then raise exception 'debit ledger entry missing';end if;end$$;
select pg_temp.must_fail($q$select public.workroom_admin_command('CONFIG_SAVE','config-key-01','{"instrument":"nvda","pattern":"wave","roi":1,"duration":30,"amplitude":0,"expectedVersion":1,"reason":"조건 수정"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_VERSION_CONFLICT');
-- Early close uses the frozen curve at server time for every supported pattern.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","aal":"aal1"}',true);
create temporary table early_results(value jsonb);
do $$declare pattern_name text; s jsonb; replay jsonb; r app_private.workroom_rounds%rowtype;elapsed double precision;expected double precision;freq integer;before_balance bigint;begin
 foreach pattern_name in array array['wave','slow','balanced'] loop
  update app_private.workroom_config set pattern=pattern_name,roi=10,duration=120,amplitude=4,version=version+1 where instrument='usd';
  s:=public.workroom_member_command('START','early-start-'||pattern_name,jsonb_build_object('instrument','usd','stake',10000,'acknowledged',true,'expectedVersion',(select version from app_private.workroom_config where instrument='usd')));
  perform set_config('session_replication_role','replica',true);
  update app_private.workroom_rounds set started_at=clock_timestamp()-interval '44.4 seconds' where id=(s#>>'{active,id}')::uuid;
  perform set_config('session_replication_role','origin',true);
  s:=public.workroom_member_command('SYNC','early-sync-'||pattern_name,'{}');
  if s->'active'='null'::jsonb then raise exception 'SYNC closed early';end if;
  s:=public.workroom_member_command('FINISH','early-finish-'||pattern_name,jsonb_build_object('id',s#>>'{active,id}'));
  select * into r from app_private.workroom_rounds where id=(s#>>'{history,0,id}')::uuid;
  elapsed:=extract(epoch from(r.closed_at-r.started_at))/120;
  if elapsed not between .36 and .39 then raise exception 'early close did not use early timestamp';end if;
  freq:=case pattern_name when 'slow' then 2 when 'balanced' then 4 else 7 end;
  expected:=floor(r.stake*(100+10*elapsed+4*sin(pi()*elapsed)*(sin(freq*pi()*elapsed)+.25*sin(17*pi()*elapsed)))/100+.5);
  if abs(r.returned-expected)>1 or r.returned=11000 then raise exception 'early curve incorrect for %: % expected %',pattern_name,r.returned,expected;end if;
  insert into early_results values(app_private.workroom_round_json(r));
  replay:=public.workroom_member_command('FINISH','early-finish-'||pattern_name,jsonb_build_object('id',r.id));
  if replay<>s then raise exception 'early finish original replay changed';end if;
  before_balance:=(s#>>'{member,balance}')::bigint;
  replay:=public.workroom_member_command('FINISH','early-again-'||pattern_name,jsonb_build_object('id',r.id));
  if (replay#>>'{member,balance}')::bigint<>before_balance or (select count(*) from app_private.workroom_ledger where round_id=r.id and kind='SETTLEMENT')<>1 then raise exception 'early round settled twice';end if;
 end loop;
end$$;
select jsonb_agg(value) as workroom_early_results from early_results;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"session_id":"44444444-4444-4444-8444-444444444444","aal":"aal2"}',true);
-- Input validation and optimistic config success are independently DB enforced.
select public.workroom_admin_command('CONFIG_SAVE','config-good-01','{"instrument":"nvda","pattern":"slow","roi":-50,"duration":86400,"amplitude":15,"expectedVersion":2,"reason":"수익률·시간 상한 검증"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
do $$begin if not exists(select 1 from app_private.workroom_config where instrument='nvda' and roi=-50 and duration=86400 and version=3) then raise exception 'negative return or 24h duration not persisted';end if;end$$;
select public.workroom_admin_command('CONFIG_SAVE','config-negative-01','{"instrument":"usd","pattern":"balanced","roi":-10,"duration":30,"amplitude":0,"expectedVersion":4,"reason":"음수 수익률 경로 검증"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","aal":"aal1"}',true);
create temporary table negative_start(value jsonb);
create temporary table negative_balance_before(value bigint);
insert into negative_balance_before select balance from app_private.workroom_accounts where user_id='11111111-1111-4111-8111-111111111111';
insert into negative_start select public.workroom_member_command('START','negative-start-01','{"instrument":"usd","stake":1000,"acknowledged":true,"expectedVersion":5}');
select set_config('session_replication_role','replica',true);
update app_private.workroom_rounds set started_at=clock_timestamp()-interval '31 seconds' where id=(select (value#>>'{active,id}')::uuid from negative_start);
select set_config('session_replication_role','origin',true);
select public.workroom_member_command('SYNC','negative-sync-001','{}');
do $$declare s jsonb;begin s:=public.workroom_read_state();if s#>>'{history,0,returned}'<>'900' or s#>>'{history,0,profit}'<>'-100' or (s#>>'{member,balance}')::bigint<>(select value-100 from negative_balance_before) or s#>>'{history,0,duration}'<>'30' or s#>>'{history,0,roi}'<>'-10' then raise exception 'negative configured return or duration not applied %',s;end if;end$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"session_id":"44444444-4444-4444-8444-444444444444","aal":"aal2"}',true);
select pg_temp.must_fail($q$select public.workroom_admin_command('POINT_ADJUST','point-range01','{"userId":"11111111-1111-4111-8111-111111111111","direction":"CREDIT","amount":1000001,"reason":"범위 검증"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'WORKROOM_INVALID_INPUT');
do $$declare s jsonb;begin
 s:=public.workroom_admin_command('READ','read-page-001','{"search":"old@example.test","pageSize":1}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2');
 if s#>>'{pagination,users,total}'<>'1' or jsonb_array_length(s->'users')<>1 or s#>>'{users,0,id}'<>'11111111-1111-4111-8111-111111111111' then raise exception 'search or pagination failed';end if;
end$$;
-- Live authority is rechecked before returning a stored privileged replay.
update public.admin_sessions set revoked_at=clock_timestamp(),revoke_reason='rollback test' where id='33333333-3333-4333-8333-333333333333';
select pg_temp.must_fail($q$select public.workroom_admin_command('POINT_ADJUST','point-credit-01','{"userId":"11111111-1111-4111-8111-111111111111","direction":"CREDIT","amount":10,"reason":"추가 체험"}',auth.uid(),'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','aal2')$q$,'ADMIN_SESSION_EXPIRED');
update public.admin_sessions set revoked_at=null,revoke_reason=null where id='33333333-3333-4333-8333-333333333333';
-- Failure after invite consumption must roll back the entire signup transaction.
insert into app_private.workroom_invites(code,max_uses,expires_at) values('WR-ROLLBACK-TEST',1,now()+interval '1 day');
create function pg_temp.workroom_fail_signup() returns trigger language plpgsql as $$begin if new.id='88888888-8888-4888-8888-888888888888' then raise exception 'ROLLBACK_SIGNUP_FAILURE';end if;return new;end$$;
create trigger zzz_workroom_test_fail after insert on auth.users for each row execute function pg_temp.workroom_fail_signup();
select pg_temp.must_fail($q$insert into auth.users(id,email,raw_user_meta_data) values('88888888-8888-4888-8888-888888888888','rollback@example.test','{"referralCode":"WR-ROLLBACK-TEST","workroomAcknowledged":true}')$q$,'ROLLBACK_SIGNUP_FAILURE');
do $$begin if (select used from app_private.workroom_invites where code='WR-ROLLBACK-TEST')<>0 or exists(select 1 from app_private.workroom_accounts where user_id='88888888-8888-4888-8888-888888888888') then raise exception 'signup rollback leaked consumption/account';end if;end$$;
insert into auth.users(id,email,raw_user_meta_data) values('99999999-9999-4999-8999-999999999999','unconfirmed@example.test','{"referralCode":"WR-ROLLBACK-TEST","workroomAcknowledged":true}');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
select pg_temp.must_fail('select public.workroom_read_state()','WORKROOM_AUTH_REQUIRED');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"session_id":"44444444-4444-4444-8444-444444444444","aal":"aal1"}',true);
-- Authenticated callers cannot access private tables even with guessed UUIDs.
set local role authenticated;
select public.workroom_read_state();
do $$begin
 begin perform * from app_private.workroom_accounts;raise exception 'TABLE_DIRECT_ACCESS';exception when insufficient_privilege then null;end;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.must_fail('select public.workroom_read_state()','WORKROOM_AUTH_REQUIRED');
select extensions.pass('workroom runtime invariants and authorization checks passed');
select * from extensions.finish();
rollback;
