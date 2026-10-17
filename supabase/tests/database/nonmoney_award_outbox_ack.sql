-- Canonical actual-service command proposal tests, rollback-only synthetic content.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Shared rollback-only fixtures for native CMS/Admin AI pgTAP owner review.
-- Include after BEGIN/no_plan(). No production credentials or monetary budget.
create temporary table recovery_admin_ctx(actor uuid,admin_session uuid,auth_session uuid,factor uuid,ordinary_admin uuid,
 member_a uuid,member_b uuid,conversation_a uuid,conversation_b uuid);
insert into recovery_admin_ctx values('38500000-0000-4000-8000-000000000001','38500000-0000-4000-8000-000000000002',
 '38500000-0000-4000-8000-000000000003','38500000-0000-4000-8000-000000000004','38500000-0000-4000-8000-000000000005',
 '38500000-0000-4000-8000-000000000006','38500000-0000-4000-8000-000000000007','38500000-0000-4000-8000-000000000008','38500000-0000-4000-8000-000000000009');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select id,'authenticated','authenticated',id::text||'@recovery.putduk.test','',statement_timestamp(),'{}','{}',
 statement_timestamp(),statement_timestamp(),'','','','' from recovery_admin_ctx cross join lateral unnest(array[actor,ordinary_admin,member_a,member_b])id;
insert into public.user_roles(user_id,role,granted_by) select actor,'SUPER_ADMIN'::public.app_role,actor from recovery_admin_ctx
 union all select ordinary_admin,'ADMIN'::public.app_role,actor from recovery_admin_ctx;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
select factor,actor,'rollback-test-totp','totp','verified',clock_timestamp(),clock_timestamp(),'ROLLBACK_ONLY_SECRET' from recovery_admin_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal,not_after)
select auth_session,actor,clock_timestamp(),clock_timestamp(),factor,'aal2',clock_timestamp()+interval '2 hours' from recovery_admin_ctx;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),auth_session,clock_timestamp(),clock_timestamp(),'totp' from recovery_admin_ctx;
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
select admin_session,actor,auth_session::text,'putduk-native-recovery-fixture',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours' from recovery_admin_ctx;
grant select,update on recovery_admin_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);


insert into public.user_profiles(user_id)select member_a from recovery_admin_ctx union all select member_b from recovery_admin_ctx on conflict(user_id)do nothing;
create temporary table recovery_cms_ctx(payload jsonb,draft jsonb,preview jsonb,approval jsonb,publication jsonb);
insert into recovery_cms_ctx(payload)values(jsonb_build_object('slug','rollback-member-event-a','title','로컬 참여 확인','summary','회원 참여 기록을 확인합니다.','body','이 이벤트는 로컬에서만 진행하며 현금 보상이 없습니다.','cardTitle','참여 기록 확인','ctaLabel','참여하기','ctaRoute','/events','audience','MEMBERS','segment','ALL_MEMBERS','rewardMode','NONE','participation','참여 버튼을 누릅니다.','exclusion','종료 후에는 새로 참여할 수 없습니다.','startsAt',clock_timestamp()-interval '1 hour','endsAt',clock_timestamp()+interval '1 day'));
grant select,update on recovery_cms_ctx to service_role;
create function pg_temp.recovery_cms_command(p_operation text,p_key uuid,p_revision uuid default null,p_digest text default null,p_reason text default '검토한 안내 원고를 로컬에서 처리합니다.',p_proof text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare x record;c record;proof text;previous jsonb;
begin
 select * into x from pg_temp.recovery_admin_ctx;select * into c from pg_temp.recovery_cms_ctx;
 proof:=coalesce(p_proof,'cms-proof:'||p_key::text);
 if p_proof is null and not exists(select 1 from public.admin_step_up_grants where token_hash=encode(extensions.digest(proof,'sha256'),'hex')) then
  perform public.issue_admin_step_up(x.admin_session,x.actor,'LIVEOPS_CONTENT',proof,600);end if;
 previous:=case p_operation when 'PREVIEW' then c.draft when 'APPROVE' then c.preview when 'PUBLISH' then c.approval when 'ARCHIVE' then c.publication else null end;
 return public.manage_liveops_content(p_operation,'EVENT',(previous->>'contentId')::uuid,coalesce(p_revision,(previous->>'revisionId')::uuid),
 coalesce(p_digest,previous->>'digest'),case p_operation when 'CREATE_DRAFT' then c.payload else null end,
 x.actor,x.admin_session,x.auth_session::text,'aal2',proof,p_reason,p_key::text);
end;
$$;
grant execute on function pg_temp.recovery_cms_command(text,uuid,uuid,text,text,text) to service_role;

set local role service_role;
update recovery_cms_ctx set draft=pg_temp.recovery_cms_command('CREATE_DRAFT',gen_random_uuid());
update recovery_cms_ctx set preview=pg_temp.recovery_cms_command('PREVIEW',gen_random_uuid());
update recovery_cms_ctx set approval=pg_temp.recovery_cms_command('APPROVE',gen_random_uuid());
update recovery_cms_ctx set publication=pg_temp.recovery_cms_command('PUBLISH',gen_random_uuid());
select lives_ok('set constraints all immediate','event publication projection and immutable approval pass actual deferred native seals');set constraints all deferred;
reset role;
create temporary table event_join_ctx(event_id uuid,revision_id uuid,key uuid,receipt jsonb);
insert into event_join_ctx select(publication->>'contentId')::uuid,(publication->>'revisionId')::uuid,gen_random_uuid(),null from recovery_cms_ctx;
grant select,update on event_join_ctx to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','38500000-0000-4000-8000-000000000006')::text,true);
select is((select count(*) from public.event_member_content),1::bigint,'member reads published safe body/conditions/CTA projection');
select throws_ok('select * from app_private.liveops_content_receipts','42501',null,'member has no private CMS revision access');
select throws_ok('select * from app_private.event_join_originals','42501',null,'member has no private qualification/join original access');
select throws_like($$select public.participate_published_event(event_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid())from event_join_ctx$$,'EVENT_NOT_AVAILABLE','foreign revision cannot join');
update event_join_ctx set receipt=public.participate_published_event(event_id,revision_id,key,gen_random_uuid());
select is((select receipt->>'status' from event_join_ctx),'JOINED','explicit authenticated command joins current reviewed event');
select is((select receipt->>'replayed' from event_join_ctx),'false','first participation is a new recorded join');
select is((select public.participate_published_event(event_id,revision_id,key,gen_random_uuid())->>'replayed' from event_join_ctx),'true','same intent replays one original join');
select is((select public.participate_published_event(event_id,revision_id,gen_random_uuid(),gen_random_uuid())->>'replayed' from event_join_ctx),'true','logical repeated click has no second participant or outbox');
select throws_like($$select public.participate_published_event(gen_random_uuid(),revision_id,key,gen_random_uuid())from event_join_ctx$$,'EVENT_IDEMPOTENCY_CONFLICT','same key cannot name another event');
select is((select count(*) from public.event_participants),1::bigint,'own RLS readback contains one participant');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000007"}',true);
select is((select count(*) from public.event_participants),0::bigint,'another member cannot read joined member progress');
reset role;
select lives_ok('set constraints all immediate','canonical join passes native audit/outbox/source completion');set constraints all deferred;
select is((select count(*) from public.outbox_events where event_type='EVENT_PARTICIPATION_JOINED.v1'and actor_user_id='38500000-0000-4000-8000-000000000006'),1::bigint,'all retries keep exactly one versioned join event');
select throws_like($$update public.event_member_content set body_ko='변경'$$,'%append-only%','safe projection cannot diverge from approved revision');
select throws_like($$update public.event_participants set progress='{}'where user_id='38500000-0000-4000-8000-000000000006'$$,'EVENT_JOIN_ORIGINAL_IMMUTABLE','participant cannot replace sealed join provenance');
select throws_like($$update public.outbox_events set payload='{}'where event_type='EVENT_PARTICIPATION_JOINED.v1'$$,'EVENT_JOIN_ORIGINAL_IMMUTABLE','native join source event cannot be forged');
set local role service_role;
select throws_like($$select public.participate_published_event(event_id,revision_id,gen_random_uuid(),gen_random_uuid())from event_join_ctx$$,'%permission denied%','service cannot override authenticated joining owner');
reset role;


-- Synthetic operator approval and actual canonical deposit original; no direct grant.
select is((select count(*)from app_private.nonmoney_executor_configuration),0::bigint,'LocalQA execution is disabled by default with no implicit activation');
insert into app_private.nonmoney_executor_configuration values(true,'putduk-mining-local-recovery-20261009-fi',true,clock_timestamp());
create temporary table nonmoney_ctx(rule uuid,policy jsonb,source uuid,balance_before bigint);
insert into nonmoney_ctx(rule)values(gen_random_uuid());
grant select,update on nonmoney_ctx to service_role;
create function pg_temp.approve_nonmoney_fixture()returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x record;c record;n record;proof text:='local-nonmoney-proof-'||gen_random_uuid()::text;
begin
 select * into x from pg_temp.recovery_admin_ctx;select * into c from pg_temp.event_join_ctx;select * into n from pg_temp.nonmoney_ctx;
 perform public.issue_admin_step_up(x.admin_session,x.actor,'LIVEOPS_CONTENT',proof,600);
 return app_private.approve_local_nonmoney_policy(c.event_id,c.revision_id,n.rule,1,'DEPOSIT_CONFIRMED.v1','BADGE','LOCAL_DEPOSIT_MISSION','로컬 입금 기록 확인',x.actor,x.admin_session,x.auth_session::text,'aal2',proof,'실제 입금 완료 원본으로 로컬 배지를 검증합니다.',gen_random_uuid());
end;$$;
grant execute on function pg_temp.approve_nonmoney_fixture()to service_role;
select ok(not has_function_privilege('service_role','app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)','EXECUTE'),'private LocalQA approval has no service API grant');
select ok(not has_function_privilege('authenticated','app_private.evaluate_nonmoney_original(uuid)','EXECUTE'),'member cannot directly invoke mission evaluator');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update nonmoney_ctx set policy=pg_temp.approve_nonmoney_fixture();
select lives_ok('set constraints all immediate','synthetic operator review retains real TOTP grant/audit/approval seals');set constraints all deferred;
select public.bootstrap_user(member_a)from recovery_admin_ctx;
select public.approve_deposit_request(public.create_deposit_request(member_a,'KRW',100000,'local-nonmoney-source'),actor,100000,'local-nonmoney-actual-credit','Local actual deposit original for mission proof',gen_random_uuid())from recovery_admin_ctx;
reset role;
update nonmoney_ctx set source=(select source_event_id from public.money_source_movements where user_id=(select member_a from recovery_admin_ctx)and origin_code='KRW_DEPOSIT'and movement_kind='CREDIT'),balance_before=(select balance_atomic::bigint from public.wallet_balance_snapshots where user_id=(select member_a from recovery_admin_ctx)and currency='KRW');
update public.outbox_events set available_at='-infinity'where id=(select source from nonmoney_ctx);
set local role service_role;
select is((select id from public.claim_outbox_events('local-nonmoney-owner',1,60)),(select source from nonmoney_ctx),'existing worker acquires genuine canonical deposit event');
reset role;
create function pg_temp.fail_reward_notification()returns trigger language plpgsql as $$begin raise exception 'LOCAL_NOTIFICATION_ATOMIC_FAULT';end;$$;
create trigger local_notification_atomic_fault before insert on public.notifications for each row execute function pg_temp.fail_reward_notification();
set local role service_role;
select throws_like($$select public.complete_outbox_event((select source from nonmoney_ctx),'local-nonmoney-owner')$$,'LOCAL_NOTIFICATION_ATOMIC_FAULT','notification failure rolls back entire qualification/award/participant/outbox transaction');
reset role;
select is((select count(*)from public.member_event_awards),0::bigint,'injected notification failure leaves no partial award');
select is((select count(*)from public.outbox_events where event_type='EVENT_REWARD_GRANTED.v1'),0::bigint,'injected notification failure leaves no partial reward outbox');
select is((select status::text from public.event_participants where id=(select(receipt->>'participantId')::uuid from event_join_ctx)),'JOINED','injected failure leaves participant joined');
drop trigger local_notification_atomic_fault on public.notifications;
set local role service_role;
select lives_ok($$select public.complete_outbox_event((select source from nonmoney_ctx),'local-nonmoney-owner')$$,'source-bound worker evaluates actual deposit and grants approved badge');
reset role;
select is((select count(*)from public.member_event_awards),1::bigint,'one stable claim and append-only award exists');
select is((select status::text from public.event_participants where id=(select(receipt->>'participantId')::uuid from event_join_ctx)),'REWARDED','participant completion and reward commit together');
select is((select balance_atomic::bigint from public.wallet_balance_snapshots where user_id=(select member_a from recovery_admin_ctx)and currency='KRW'),(select balance_before from nonmoney_ctx),'nonmoney badge never changes wallet balance');
select is((select count(*)from public.outbox_events where event_type='EVENT_REWARD_GRANTED.v1'),1::bigint,'one versioned reward event is committed');
select is((select count(*)from public.notifications where source_event_id in(select outbox_id from public.member_event_awards)),1::bigint,'reward same transaction persists one source-bound in-app notification');
select is((select count(*)from public.notification_deliveries where channel='IN_APP'and notification_id in(select notification_id from app_private.nonmoney_reward_notification_originals)and status='SENT'and delivered_at is null),1::bigint,'in-app persistence does not claim actual browser presentation');
select throws_like($$update public.notifications set body_ko='변조'where source_event_id in(select outbox_id from public.member_event_awards)$$,'NONMONEY_NOTIFICATION_IMMUTABLE','user-visible notification cannot diverge from sealed reward');
set local role service_role;
select lives_ok('set constraints all immediate','award replay and business-source original seals pass native deferred checks');set constraints all deferred;
select throws_like($$select public.complete_outbox_event((select source from nonmoney_ctx),'local-nonmoney-owner')$$,'OUTBOX_LEASE_NOT_OWNED','completed source cannot generate a duplicate reward');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is((select count(id)from public.member_event_awards),1::bigint,'member sees own safe achievement readback');
select is((select count(*)from public.notifications where deduplication_key in(select 'nonmoney-award:'||id::text from public.member_event_awards)),1::bigint,'member reads own persisted reward notice using only safe granted award ID');
select throws_ok('select qualification from public.member_event_awards','42501',null,'member cannot read private qualification/source evidence');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000007"}',true);
select is((select count(id)from public.member_event_awards),0::bigint,'another member sees no foreign achievement');
reset role;
-- An opted-out member still receives the nonmoney achievement, without a notice.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000007"}',true);
select public.participate_published_event(event_id,revision_id,gen_random_uuid(),gen_random_uuid())from event_join_ctx;
reset role;
insert into public.notification_preferences(user_id,events_enabled)select member_b,false from recovery_admin_ctx on conflict(user_id)do update set events_enabled=false;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.bootstrap_user(member_b)from recovery_admin_ctx;
select public.approve_deposit_request(public.create_deposit_request(member_b,'KRW',100000,'local-nonmoney-optout'),actor,100000,'local-nonmoney-optout-credit','Local opted-out mission actual credit',gen_random_uuid())from recovery_admin_ctx;
reset role;
update nonmoney_ctx set source=(select source_event_id from public.money_source_movements where user_id=(select member_b from recovery_admin_ctx)and origin_code='KRW_DEPOSIT'and movement_kind='CREDIT');
update public.outbox_events set available_at='-infinity'where id=(select source from nonmoney_ctx);
set local role service_role;
select id from public.claim_outbox_events('local-nonmoney-optout-owner',1,60);
select lives_ok($$select public.complete_outbox_event((select source from nonmoney_ctx),'local-nonmoney-optout-owner')$$,'opt-out does not erase a legitimately qualified achievement');
reset role;
select is((select count(*)from public.member_event_awards where user_id=(select member_b from recovery_admin_ctx)),1::bigint,'opted-out member receives exactly one achieved badge');
select is((select count(*)from public.notifications where user_id=(select member_b from recovery_admin_ctx)and source_event_id in(select outbox_id from public.member_event_awards)),0::bigint,'category opt-out suppresses persisted reward notice');
select is((select outcome from app_private.nonmoney_reward_notification_originals where user_id=(select member_b from recovery_admin_ctx)),'SUPPRESSED_PREFERENCE','suppression is a sealed original instead of unrecorded loss');
set local role service_role;
select lives_ok('set constraints all immediate','both persisted and suppressed notification chains satisfy deferred source seals');
reset role;

-- Dedicated acknowledgement assertions. The canonical fixture above is copied
-- unchanged through its final seal check from nonmoney_source_bound_local_qa_rewards.sql.
-- It uses synthetic SQL Auth/session rows, not real HTTP/Auth evidence.
create temporary table award_ack_ctx(event_id uuid,suppressed_id uuid,forged_id uuid,
  awards bigint,notices bigint,in_app bigint,devices bigint,journals bigint);
insert into award_ack_ctx
select
  (select outbox_id from public.member_event_awards where user_id=(select member_a from recovery_admin_ctx)),
  (select outbox_id from public.member_event_awards where user_id=(select member_b from recovery_admin_ctx)),
  gen_random_uuid(),
  (select count(*) from public.member_event_awards),
  (select count(*) from public.notifications),
  (select count(*) from public.notification_deliveries),
  (select count(*) from app_private.notification_device_deliveries),
  (select count(*) from public.ledger_transactions);
grant select on award_ack_ctx to service_role;
select ok(not (select prosecdef from pg_proc where oid='public.complete_outbox_event(uuid,text)'::regprocedure),'public dispatcher remains SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='app_private.complete_system_outbox_original(uuid,text)'::regprocedure),'preserved installed dispatcher remains SECURITY INVOKER');
select ok(not has_function_privilege('authenticated','public.complete_outbox_event(uuid,text)','EXECUTE'),'member cannot acknowledge any outbox');
select ok(not has_function_privilege('anon','app_private.ack_nonmoney_award_outbox(uuid,text)','EXECUTE'),'anon cannot invoke private award acknowledgement');
select ok(not has_function_privilege('authenticated','app_private.ack_nonmoney_award_outbox(uuid,text)','EXECUTE'),'member cannot invoke private award acknowledgement');
select ok(not has_function_privilege('authenticated','app_private.complete_system_outbox_original(uuid,text)','EXECUTE'),'member cannot bypass wrapper through preserved original');
select is((select count(*) from app_private.nonmoney_reward_notification_originals),2::bigint,'both persisted and suppressed originals exist before acknowledgement');
set constraints all deferred;
update public.outbox_events set available_at='infinity' where id<>(select event_id from award_ack_ctx);
update public.outbox_events set available_at='-infinity' where id=(select event_id from award_ack_ctx);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select id from public.claim_outbox_events('award-ack-owner',1,300)),(select event_id from award_ack_ctx),'real Worker claim owns the existing award envelope');
select throws_like($$select public.complete_outbox_event(event_id,'foreign-ack-worker') from award_ack_ctx$$,'OUTBOX_LEASE_NOT_OWNED','foreign Worker cannot acknowledge award');
select throws_like($$select app_private.ack_nonmoney_award_outbox(event_id,'foreign-ack-worker') from award_ack_ctx$$,'OUTBOX_LEASE_NOT_OWNED','service direct private acknowledgement retains the same owned-lease guard');
select throws_like($$select app_private.complete_system_outbox_original(event_id,'award-ack-owner') from award_ack_ctx$$,'OUTBOX_HANDLER_UNSUPPORTED','service original alias cannot bypass the new award source validator');
reset role;
update public.outbox_events set lease_expires_at=clock_timestamp()-interval '1 second' where id=(select event_id from award_ack_ctx);
set local role service_role;
select throws_like($$select public.complete_outbox_event(event_id,'award-ack-owner') from award_ack_ctx$$,'OUTBOX_LEASE_NOT_OWNED','expired lease cannot acknowledge award');
reset role;
update public.outbox_events set lease_expires_at=clock_timestamp()+interval '5 minutes' where id=(select event_id from award_ack_ctx);
create function pg_temp.fail_award_ack_receipt() returns trigger language plpgsql as $$
begin
 if new.consumer_name='nonmoney_award_ack.v1' then raise exception 'AWARD_ACK_ATOMIC_FAULT';end if;
 return new;
end;$$;
create trigger award_ack_atomic_fault before insert on public.event_consumer_deliveries
for each row execute function pg_temp.fail_award_ack_receipt();
set local role service_role;
select throws_like($$select public.complete_outbox_event(event_id,'award-ack-owner') from award_ack_ctx$$,'AWARD_ACK_ATOMIC_FAULT','acknowledgement error rolls back receipt and terminal state');
reset role;
select is((select status::text from public.outbox_events where id=(select event_id from award_ack_ctx)),'PROCESSING','failed acknowledgement preserves owned lease for retry');
select is((select count(*) from public.event_consumer_deliveries where event_id=(select event_id from award_ack_ctx) and consumer_name='nonmoney_award_ack.v1'),0::bigint,'failed acknowledgement commits no partial receipt');
drop trigger award_ack_atomic_fault on public.event_consumer_deliveries;
set local role service_role;
select lives_ok($$select public.complete_outbox_event(event_id,'award-ack-owner') from award_ack_ctx$$,'same leased retry acknowledges sealed existing award and notice');
select lives_ok('set constraints all immediate','acknowledged award retains all native deferred source and notification seals');
set constraints all deferred;
select throws_like($$select public.complete_outbox_event(event_id,'award-ack-owner') from award_ack_ctx$$,'OUTBOX_LEASE_NOT_OWNED','response-loss repeat cannot acknowledge without a new lease');
reset role;
select is((select status::text from public.outbox_events where id=(select event_id from award_ack_ctx)),'PROCESSED','award outbox reaches actual PROCESSED state');
select is((select count(*) from public.event_consumer_deliveries where event_id=(select event_id from award_ack_ctx) and consumer_name='nonmoney_award_ack.v1'),1::bigint,'exactly one source-bound acknowledgement receipt exists');
update public.outbox_events set status='PROCESSING',lease_owner='award-ack-replay',
  lease_expires_at=clock_timestamp()+interval '5 minutes',processed_at=null
where id=(select event_id from award_ack_ctx);
create function pg_temp.corrupt_existing_award_ack_receipt() returns trigger language plpgsql as $$
begin
 if new.consumer_name='nonmoney_award_ack.v1' then
  update public.event_consumer_deliveries set status='FAILED'
   where event_id=new.event_id and consumer_name=new.consumer_name;
 end if;
 return new;
end;$$;
create trigger award_ack_corrupt_existing before insert on public.event_consumer_deliveries
for each row execute function pg_temp.corrupt_existing_award_ack_receipt();
set local role service_role;
select throws_like($$select public.complete_outbox_event(event_id,'award-ack-replay') from award_ack_ctx$$,'NONMONEY_AWARD_ACK_RECEIPT_INVALID','temporary owner-controlled fault cannot make an invalid existing receipt pass replay');
reset role;
drop trigger award_ack_corrupt_existing on public.event_consumer_deliveries;
select is((select status::text from public.event_consumer_deliveries where event_id=(select event_id from award_ack_ctx) and consumer_name='nonmoney_award_ack.v1'),'SUCCEEDED','receipt corruption is rolled back with rejected replay');
set local role service_role;
select lives_ok($$select public.complete_outbox_event(event_id,'award-ack-replay') from award_ack_ctx$$,'controlled at-least-once replay validates original acknowledgement');
reset role;
select is((select count(*) from public.event_consumer_deliveries where event_id=(select event_id from award_ack_ctx) and consumer_name='nonmoney_award_ack.v1'),1::bigint,'controlled replay retains one acknowledgement');
update public.outbox_events set available_at='infinity' where id<>(select suppressed_id from award_ack_ctx);
update public.outbox_events set available_at='-infinity' where id=(select suppressed_id from award_ack_ctx);
set local role service_role;
select is((select id from public.claim_outbox_events('award-ack-suppressed',1,300)),(select suppressed_id from award_ack_ctx),'Worker claims opted-out award without inventing a notification');
select lives_ok($$select public.complete_outbox_event(suppressed_id,'award-ack-suppressed') from award_ack_ctx$$,'sealed preference suppression is a valid acknowledgement outcome');
select lives_ok('set constraints all immediate','suppressed and persisted acknowledged chains retain all native seals');
set constraints all deferred;
reset role;
select is((select status::text from public.outbox_events where id=(select suppressed_id from award_ack_ctx)),'PROCESSED','suppressed award outbox reaches actual PROCESSED state');
insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key)
select forged_id,'EVENT_REWARD_GRANTED.v1',1,'event_reward',gen_random_uuid(),
  (select member_a from recovery_admin_ctx),'{}',gen_random_uuid(),gen_random_uuid(),'forged-award-ack' from award_ack_ctx;
update public.outbox_events set available_at='infinity' where id<>(select forged_id from award_ack_ctx);
update public.outbox_events set available_at='-infinity' where id=(select forged_id from award_ack_ctx);
set local role service_role;
select is((select id from public.claim_outbox_events('award-ack-forged',1,300)),(select forged_id from award_ack_ctx),'forged outbox receives a real lease but gains no business authority');
select throws_like($$select public.complete_outbox_event(forged_id,'award-ack-forged') from award_ack_ctx$$,'NONMONEY_AWARD_ORIGINAL_REQUIRED','outbox-only event missing sealed award is rejected');
reset role;
select is((select count(*) from public.event_consumer_deliveries where event_id=(select forged_id from award_ack_ctx)),0::bigint,'missing sealed original produces no acknowledgement');
select is((select count(*) from public.member_event_awards),(select awards from award_ack_ctx),'acknowledgement creates no second award');
select is((select count(*) from public.notifications),(select notices from award_ack_ctx),'acknowledgement creates no second notification');
select is((select count(*) from public.notification_deliveries),(select in_app from award_ack_ctx),'acknowledgement creates no second in-app delivery');
select is((select count(*) from app_private.notification_device_deliveries),(select devices from award_ack_ctx),'acknowledgement creates no second push fanout');
select is((select count(*) from public.ledger_transactions),(select journals from award_ack_ctx),'acknowledgement never posts money');
select * from finish();
rollback;
