begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);
do $$declare item record;grantee text;owner_oid oid:='postgres'::regrole;begin
 if (select count(*) from pg_proc where prosecdef and pronamespace in('public'::regnamespace,'app_private'::regnamespace))<>94
  or (select count(*) from pg_proc where prosecdef and left(proname,13)='workroom_app_' and pronamespace in('public'::regnamespace,'app_private'::regnamespace))<>4 then raise exception 'WORKROOM_APP_DEFINER_ROSTER';end if;
 for item in select * from(values
  ('public.workroom_app_member(text,text,jsonb)','jsonb','authenticated'),
  ('public.workroom_app_admin(text,text,jsonb,uuid,uuid,text,text)','jsonb','authenticated'),
  ('public.workroom_app_worker(text,jsonb)','jsonb','service_role'),
  ('app_private.workroom_app_cash_event()','trigger',''))
  as v(signature,returns,permitted) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature) and p.prosecdef and p.proowner=owner_oid
   and p.prorettype=item.returns::regtype and p.proconfig=array['search_path=pg_catalog'] and not exists(
   select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.privilege_type='EXECUTE' and x.grantee<>owner_oid
    and not(x.grantee=coalesce(to_regrole(nullif(item.permitted,''))::oid,owner_oid) and not x.is_grantable))) then raise exception 'WORKROOM_APP_DEFINER_ACL %',item.signature;end if;
  foreach grantee in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(grantee,item.signature,'execute')<>(grantee=item.permitted) then raise exception 'WORKROOM_APP_EXECUTE_ACL %',item.signature;end if;
  end loop;
 end loop;
end$$;
create function pg_temp.expect_error(stmt text,expected text) returns void language plpgsql as $$begin
 begin execute stmt;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'EXPECTED_ERROR_ABSENT %',expected;
end$$;
create function pg_temp.login(n integer) returns void language plpgsql as $$
declare uid text:='12070000-0000-4000-8000-'||lpad(n::text,12,'0');sid text:='12071000-0000-4000-8000-'||lpad(n::text,12,'0');begin
 perform set_config('request.jwt.claim.sub',uid,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid,'aal',case when n=3 then 'aal2' else 'aal1' end)::text,true);
end$$;
create function pg_temp.admin_op(op text,k text,args jsonb) returns jsonb language sql as $$
 select public.workroom_app_admin(op,k,args,auth.uid(),'12072000-0000-4000-8000-000000000003',
 '12071000-0000-4000-8000-000000000003','aal2')
$$;
create temporary table app_test(key text primary key,value jsonb);
grant select,insert,update on pg_temp.app_test to authenticated,service_role;
grant execute on function pg_temp.login(integer),pg_temp.expect_error(text,text),pg_temp.admin_op(text,text,jsonb) to authenticated,service_role;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
 confirmation_token,recovery_token,email_change,email_change_token_new)
select ('12070000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','app207-'||n||'@putduk.test','',
 now(),'{}',app_private.workroom_native_signup_metadata('{}'),now(),now(),'','','','' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,aal,created_at,updated_at) select
 ('12071000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('12070000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal1',now(),now() from generate_series(1,3)n;
insert into public.user_roles(user_id,role) values('12070000-0000-4000-8000-000000000003','ADMIN');
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
 values('12072000-0000-4000-8000-000000000003','12070000-0000-4000-8000-000000000003','12071000-0000-4000-8000-000000000003','app207-native',now()+interval '1 hour',now()+interval '8 hours');
insert into auth.mfa_factors(id,user_id,factor_type,status,friendly_name,secret,created_at,updated_at)
 values('12073000-0000-4000-8000-000000000003','12070000-0000-4000-8000-000000000003','totp','verified','app207-native','DISPOSABLE_FIXTURE',now(),now());
update auth.sessions set aal='aal2',factor_id='12073000-0000-4000-8000-000000000003' where id='12071000-0000-4000-8000-000000000003';
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) values(gen_random_uuid(),'12071000-0000-4000-8000-000000000003','totp',now(),now());

set local role authenticated;
select pg_temp.login(1);
do $$declare a jsonb;t jsonb;begin
 a:=public.workroom_app_member('ATTACHMENT_PREPARE','photo-prepare','{"mediaType":"image/png","sizeBytes":16}');
 insert into pg_temp.app_test values('photo',a);
 perform pg_temp.expect_error(format('select public.workroom_app_member(''ATTACHMENT_COMMIT'',''photo-commit'',%L)',jsonb_build_object('id',a->>'id')),'WORKROOM_ATTACHMENT_NOT_VERIFIED');
 perform pg_temp.expect_error('select public.workroom_app_worker(''DUE'',''{}'')','permission denied');
end$$;
reset role;
insert into storage.objects(id,bucket_id,name,metadata) select gen_random_uuid(),'workroom-support-attachments',value->>'path','{"mimetype":"image/png","size":16}'
 from pg_temp.app_test where key='photo';
set local role authenticated;
do $$declare f jsonb;t jsonb;args jsonb;begin
 select value into f from pg_temp.app_test where key='photo';
 perform public.workroom_app_member('ATTACHMENT_COMMIT','photo-commit',jsonb_build_object('id',f->>'id'));
 args:=jsonb_build_object('body','비공개 문의','attachmentIds',jsonb_build_array(f->>'id'));
 t:=public.workroom_app_member('SUPPORT_SEND','support-send-1',args);
 if public.workroom_app_member('SUPPORT_SEND','support-send-1',args)<>t or t#>>'{thread,messages,0,attachments,0,id}'<>f->>'id' then raise exception 'SEND_REPLAY_OR_ATTACHMENT';end if;
 if public.workroom_app_member('ATTACHMENT_READ',null,jsonb_build_object('id',f->>'id'))->>'path' is distinct from f->>'path' then raise exception 'PHOTO_OWNER_PATH';end if;
 insert into pg_temp.app_test values('thread',t->'thread'->'id');
 perform pg_temp.expect_error('select public.workroom_app_member(''SUPPORT_SEND'',''support-send-1'',''{"body":"변경"}'')','WORKROOM_REQUEST_CONFLICT');
 perform pg_temp.login(2);
 perform pg_temp.expect_error(format('select public.workroom_app_member(''ATTACHMENT_READ'',null,%L)',jsonb_build_object('id',f->>'id')),'WORKROOM_ATTACHMENT_NOT_FOUND');
 perform pg_temp.expect_error(format('select public.workroom_app_member(''SUPPORT_READ'',null,%L)',jsonb_build_object('threadId',t#>>'{thread,id}')),'WORKROOM_THREAD_NOT_FOUND');
 perform pg_temp.expect_error('select pg_temp.admin_op(''SUPPORT_READ'',null,''{}'')','WORKROOM_ADMIN_FORBIDDEN');
end$$;
select pg_temp.login(3);
do $$declare tid jsonb;args jsonb;answer jsonb;begin
 select value into tid from pg_temp.app_test where key='thread';args:=jsonb_build_object('threadId',tid);
 perform pg_temp.admin_op('SUPPORT_ASSIGN','support-assign-1',args);
 answer:=pg_temp.admin_op('SUPPORT_REPLY','support-reply-1',args||'{"body":"비공개 답변"}');
 if pg_temp.admin_op('SUPPORT_REPLY','support-reply-1',args||'{"body":"비공개 답변"}')<>answer or answer#>>'{thread,status}'<>'ANSWERED' then raise exception 'REPLY_REPLAY';end if;
 if (pg_temp.admin_op('NOTIFICATIONS_READ',null,'{}')->>'unreadCount')::int<1 then raise exception 'ADMIN_INBOX_MISSING';end if;
 perform pg_temp.admin_op('SUPPORT_RESOLVE','support-resolve-1',args);
 perform pg_temp.login(1);
 if (public.workroom_app_member('NOTIFICATIONS_READ',null,'{}')->>'unreadCount')::int<>1 then raise exception 'MEMBER_INBOX_COUNT';end if;
 answer:=public.workroom_app_member('NOTIFICATIONS_READ',null,'{}')#>'{items,0}';
 if answer->>'type'<>'SUPPORT_ANSWERED' or answer->>'route'<>'/workroom/support?thread='||(tid#>>'{}') then raise exception 'MEMBER_INBOX_SOURCE';end if;
 perform public.workroom_app_member('NOTIFICATION_READ','notif-read-1',jsonb_build_object('id',answer->'id'));
 if public.workroom_app_member('NOTIFICATIONS_READ',null,'{}')->>'unreadCount'<>'0' then raise exception 'READ_NOT_PERSISTED';end if;
 answer:=public.workroom_app_member('SUPPORT_READ',null,args||'{"limit":1}');
 if answer->>'nextCursor' is null or answer#>>'{items,0,messages,0,senderRole}'<>'ADMIN' then raise exception 'MESSAGE_PAGE';end if;
 perform public.workroom_app_member('SUPPORT_SEEN','thread-seen-1',args||jsonb_build_object('messageId',answer#>>'{items,0,messages,0,id}'));
 if public.workroom_app_member('SUPPORT_READ',null,args)#>>'{items,0,unreadCount}'<>'0' then raise exception 'CURSOR_MISSING';end if;
end$$;
reset role;

-- Register a locally constructed, non-routable fixture using the genuine session/epoch protocol.
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare u uuid:='12070000-0000-4000-8000-000000000001';s uuid:='12071000-0000-4000-8000-000000000001';i uuid:=gen_random_uuid();
 permit jsonb;bound jsonb;begin
 permit:=public.member_push_endpoint_command(u,s,'ISSUE','https://push.example.invalid/207',repeat('a',88),repeat('b',22),null,'native',0,i,null);
 bound:=public.member_push_endpoint_command(u,s,'REGISTER','https://push.example.invalid/207',repeat('a',88),repeat('b',22),null,'native',0,i,(permit->>'permitId')::uuid);
 insert into pg_temp.app_test values('subscription',jsonb_build_object('subscriptionId',bound->'subscriptionId'));
end$$;
reset role;
set local role authenticated;
select pg_temp.login(1);
do $$declare s jsonb;begin
 select value into s from pg_temp.app_test where key='subscription';perform public.workroom_app_member('PUSH_BIND_MEMBER','fixture-bind',s);
 s:=public.workroom_member_command('START','fixture-start-1','{"instrument":"nvda","stake":50000,"expectedVersion":1,"acknowledged":true}');
 insert into pg_temp.app_test values('rid',s#>'{active,id}');
end$$;
reset role;
-- Age only the disposable clock for a round created through real START. Check the unmodified job first.
do $$begin
 if not exists(select 1 from app_private.workroom_app_jobs j join app_private.workroom_rounds r on r.id=j.round_id
  where j.round_id=(select (value#>>'{}')::uuid from pg_temp.app_test where key='rid') and j.due_at=r.started_at+make_interval(secs=>(r.snapshot->>'duration')::integer))
  then raise exception 'START_JOB_NOT_ATOMIC';end if;
end$$;
set local session_replication_role=replica;
update app_private.workroom_rounds set started_at=clock_timestamp()-interval '2 days' where id=(select (value#>>'{}')::uuid from pg_temp.app_test where key='rid');
set local session_replication_role=origin;
update app_private.workroom_app_jobs j set due_at=r.started_at+make_interval(secs=>(r.snapshot->>'duration')::integer) from app_private.workroom_rounds r
 where r.id=j.round_id and r.id=(select (value#>>'{}')::uuid from pg_temp.app_test where key='rid');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare args jsonb;claim jsonb;lease jsonb;ack jsonb;begin
 select jsonb_build_object('roundId',value) into args from pg_temp.app_test where key='rid';
 if public.workroom_app_worker('RECOVER',args)->>'settled'<>'1' or public.workroom_app_worker('RECOVER',args)->>'settled'<>'0' then raise exception 'DUE_SETTLEMENT_REPLAY';end if;
 claim:=public.workroom_app_worker('CLAIM_PUSH','{"workerId":"native207","leaseSeconds":60}')->0;
 if claim is null then raise exception 'DEVICE_NOT_LEASED';end if;
 lease:=jsonb_build_object('workerId','native207','deliveryId',claim->'deliveryId','leaseToken',claim->'leaseToken','attempt',claim->'attempt');
 if public.workroom_app_worker('ADMIT_PUSH',lease)->>'allowed'<>'true' then raise exception 'DEVICE_NOT_ADMITTED';end if;
 ack:=lease||'{"status":"RETRY","httpStatus":429,"errorCode":"PUSH_PROVIDER_RETRY"}';
 if public.workroom_app_worker('ACK_PUSH',ack)->>'status'<>'RETRY' or public.workroom_app_worker('ACK_PUSH',ack)->>'status'<>'RETRY' then raise exception 'RETRY_RECEIPT';end if;
end$$;
reset role;
update app_private.workroom_app_push set available_at=clock_timestamp() where worker is null and status='RETRY';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare c jsonb;l jsonb;u uuid:='12070000-0000-4000-8000-000000000001';s uuid:='12071000-0000-4000-8000-000000000001';begin
 c:=public.workroom_app_worker('CLAIM_PUSH','{"workerId":"native207","leaseSeconds":60}')->0;
 l:=jsonb_build_object('workerId','native207','deliveryId',c->'deliveryId','leaseToken',c->'leaseToken','attempt',c->'attempt');
 perform public.member_push_endpoint_command(u,s,'REVOKE','https://push.example.invalid/207',null,null,null,null,null,gen_random_uuid(),null);
 if public.workroom_app_worker('ADMIT_PUSH',l)->>'allowed'<>'false' then raise exception 'REVOKED_DEVICE_ADMITTED';end if;
 if public.workroom_app_worker('ACK_PUSH',l||'{"status":"ABORTED","httpStatus":null,"errorCode":"PUSH_ADMISSION_DENIED"}')->>'status'<>'CANCELLED' then raise exception 'REVOKED_DELIVERY_NOT_CANCELLED';end if;
end$$;
reset role;
do $$declare r uuid;begin
 select (value#>>'{}')::uuid into r from pg_temp.app_test where key='rid';
 if (select count(*) from app_private.workroom_ledger where kind='SETTLEMENT' and round_id=r)<>1
  or(select count(*) from app_private.workroom_app_events where kind='ROUND_COMPLETED' and resource_id=r)<>1
  or not exists(select 1 from app_private.workroom_app_jobs where round_id=r and settled_at>due_at)
  or exists(select 1 from public.money_source_movements where user_id='12070000-0000-4000-8000-000000000001') then raise exception 'POINT_CASH_ORIGINAL_CROSSED';end if;
end$$;
set constraints all immediate;
set constraints all deferred;
-- Distinguish administrator origin from the same identity's member devices; re-check admin session after claim.
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare u uuid:='12070000-0000-4000-8000-000000000003';s uuid:='12071000-0000-4000-8000-000000000003';q jsonb;r jsonb;i uuid:=gen_random_uuid();begin
 q:=public.member_push_endpoint_command(u,s,'ISSUE','https://push.example.invalid/207-admin',repeat('a',88),repeat('b',22),null,'native',0,i,null);
 r:=public.member_push_endpoint_command(u,s,'REGISTER','https://push.example.invalid/207-admin',repeat('a',88),repeat('b',22),null,'native',0,i,(q->>'permitId')::uuid);
 insert into pg_temp.app_test values('admin_device',jsonb_build_object('subscriptionId',r->'subscriptionId'));
end$$;
reset role;
set local role authenticated;
select pg_temp.login(3);
do $$declare args jsonb;begin
 select value into args from pg_temp.app_test where key='admin_device';
 perform pg_temp.admin_op('PUSH_BIND_ADMIN','admin-device-marker',args);
 perform pg_temp.expect_error(format('select public.workroom_app_member(''PUSH_BIND_MEMBER'',''cross-origin-marker'',%L)',args),'WORKROOM_DEVICE_AUDIENCE_CONFLICT');
 perform pg_temp.login(1);
 perform public.workroom_app_member('SUPPORT_SEND','second-inquiry','{"body":"새 문의"}');
end$$;
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare c jsonb;l jsonb;a jsonb;begin
 c:=public.workroom_app_worker('CLAIM_PUSH','{"workerId":"admin207","leaseSeconds":60}')->0;
 l:=jsonb_build_object('workerId','admin207','deliveryId',c->'deliveryId','leaseToken',c->'leaseToken','attempt',c->'attempt');
 if public.workroom_app_worker('ADMIT_PUSH',l)->>'allowed' is distinct from 'true' then raise exception 'LIVE_ADMIN_DEVICE_NOT_ADMITTED';end if;
 a:=l||'{"status":"ACCEPTED","httpStatus":201,"errorCode":null}';
 if public.workroom_app_worker('ACK_PUSH',a)->>'status' is distinct from 'ACCEPTED' or public.workroom_app_worker('ACK_PUSH',a)->>'status' is distinct from 'ACCEPTED' then raise exception 'ADMIN_PROVIDER_ACCEPTANCE_RECEIPT';end if;
end$$;
reset role;
set local role authenticated;
select pg_temp.login(1);
do $$begin perform public.workroom_app_member('SUPPORT_SEND','third-inquiry','{"body":"추가 문의"}');end$$;
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare c jsonb;begin
 c:=public.workroom_app_worker('CLAIM_PUSH','{"workerId":"admin207","leaseSeconds":60}')->0;
 insert into pg_temp.app_test values('leased_admin',jsonb_build_object('workerId','admin207','deliveryId',c->'deliveryId','leaseToken',c->'leaseToken','attempt',c->'attempt'));
end$$;
reset role;
update public.admin_sessions set revoked_at=clock_timestamp(),revoke_reason='native revoke' where id='12072000-0000-4000-8000-000000000003';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
do $$declare l jsonb;begin
 select value into l from pg_temp.app_test where key='leased_admin';
 if public.workroom_app_worker('ADMIT_PUSH',l)->>'allowed' is distinct from 'false' then raise exception 'EXPIRED_ADMIN_DEVICE_ADMITTED';end if;
 perform public.workroom_app_worker('ACK_PUSH',l||'{"status":"ABORTED","httpStatus":null,"errorCode":"PUSH_ADMISSION_DENIED"}');
end$$;
reset role;
-- Exercise production cash producers with synthetic assets and a recorded mock transfer only.
select public.bootstrap_user('12070000-0000-4000-8000-000000000001');
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,fee_atomic,
 destination_config,effective_at,approved_by,allows_welcome_reward)
 values('KRW','KRW_BANK',12070001,true,1,0,'{"allowed_bank_codes":["KB"]}',now()-interval '1 hour','12070000-0000-4000-8000-000000000003',false);
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,display_hint,verification_status,verified_at,protection_until)
 values('12070000-0000-4000-8000-000000000001','KRW_BANK',decode(repeat('ab',32),'hex'),encode(extensions.digest('app207-fixture','sha256'),'hex'),
 'KB ••••1234','VERIFIED',now()-interval '2 days',now()-interval '1 day');
set local role service_role;
do $$declare u uuid:='12070000-0000-4000-8000-000000000001';a uuid:='12070000-0000-4000-8000-000000000003';r uuid;begin
 r:=public.create_deposit_request(u,'KRW',100000,'app207-deposit');
 perform public.approve_deposit_request(r,a,100000,'app207-approve','Disposable approval',gen_random_uuid());
end$$;
set constraints all immediate;
set constraints all deferred;
do $$declare u uuid:='12070000-0000-4000-8000-000000000001';a uuid:='12070000-0000-4000-8000-000000000003';
 p uuid;d uuid;r uuid;k text;begin
 select id into strict p from public.withdrawal_policies where version=12070001;
 select id into strict d from public.withdrawal_destinations where user_id=u;
 k:=public.prepare_workroom_cash_withdrawal(u,'KRW_BANK',40000,p,12070001,null,d)->>'key';
 r:=public.hold_workroom_cash_withdrawal(u,k,'KRW_BANK',d,40000);
 perform public.record_krw_external_send(r,'APP207-NATIVE',40000,a,clock_timestamp(),'app207-fixture-send');
 insert into pg_temp.app_test values('withdraw',to_jsonb(r));
end$$;
do $$declare r uuid;begin
 select (value#>>'{}')::uuid into strict r from pg_temp.app_test where key='withdraw';
 perform public.finalize_withdrawal_ledger(r,'12070000-0000-4000-8000-000000000003','app207-finalize');
 perform public.finalize_withdrawal_ledger(r,'12070000-0000-4000-8000-000000000003','app207-finalize');
end$$;
set constraints all immediate;
reset role;
do $$declare u uuid:='12070000-0000-4000-8000-000000000001';a uuid:='12070000-0000-4000-8000-000000000003';begin
 if (select count(*) from app_private.workroom_app_events where member_id=u and kind in('DEPOSIT_CONFIRMED','WITHDRAWAL_COMPLETED'))<>2
  or (select count(*) from app_private.workroom_app_inbox i join app_private.workroom_app_events e on e.id=i.event_id
    where i.recipient=a and i.audience='ADMIN' and e.member_id=u and e.kind in('KRW_DEPOSIT_REQUESTED','KRW_WITHDRAWAL_REQUESTED'))<>2
  or (select count(*) from app_private.workroom_app_inbox i join app_private.workroom_app_events e on e.id=i.event_id
    where i.recipient=u and i.audience='MEMBER' and e.kind in('DEPOSIT_CONFIRMED','WITHDRAWAL_COMPLETED'))<>2
  then raise exception 'VERIFIED_CASH_ORIGINAL_INBOX_MISSING';end if;
end$$;
set local role authenticated;
select pg_temp.login(1);
do $$declare rid uuid;result jsonb;begin
 select (value#>>'{}')::uuid into strict rid from pg_temp.app_test where key='rid';
 result:=public.workroom_app_member('ROUND_READ',null,jsonb_build_object('roundId',rid));
 if result#>>'{round,id}'<>rid::text or result#>>'{round,status}'<>'completed' then raise exception 'EXACT_RESULT_LINK_MISSING';end if;
 perform pg_temp.login(2);
 perform pg_temp.expect_error(format('select public.workroom_app_member(''ROUND_READ'',null,%L)',jsonb_build_object('roundId',rid)::text),'WORKROOM_ROUND_NOT_FOUND');
end$$;
reset role;
select extensions.pass('real signup, owner/MFA inquiry and photo, read cursor, no-browser settlement, retry receipt and revoked binding');
select * from extensions.finish();
rollback;
