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


-- Appended to the existing rollback-only real Auth/Admin fixture prefix.
insert into public.user_profiles(user_id)select member_a from recovery_admin_ctx union all select member_b from recovery_admin_ctx on conflict(user_id)do nothing;
create temporary table domain_notice_ctx(source uuid,balance_before bigint,journals_before bigint,batch jsonb);
insert into domain_notice_ctx default values;
grant select,update on domain_notice_ctx to service_role;
grant select on domain_notice_ctx,recovery_admin_ctx to authenticated;
set local role service_role;
select public.bootstrap_user(member_a)from recovery_admin_ctx;
select public.bootstrap_user(member_b)from recovery_admin_ctx;
select public.approve_deposit_request(public.create_deposit_request(member_a,'KRW',100000,'domain-notice-fixture'),actor,100000,'domain-notice-fixture','Rollback-only canonical deposit notification fixture',gen_random_uuid())from recovery_admin_ctx;
reset role;
update domain_notice_ctx set source=(select source_event_id from public.money_source_movements where user_id=(select member_a from recovery_admin_ctx)and origin_code='KRW_DEPOSIT'and movement_kind='CREDIT'),
 balance_before=(select balance_atomic::bigint from public.wallet_balance_snapshots where user_id=(select member_a from recovery_admin_ctx)and currency='KRW'),
 journals_before=(select count(*)from public.ledger_transactions);
select is((select count(*)from app_private.nonmoney_executor_configuration where local_qa_enabled),0::bigint,'ordinary domain notifications do not require synthetic reward activation');
set local role service_role;
select public.upsert_push_subscription(member_a,'https://fcm.googleapis.com/fcm/send/domain-notice-fixture',repeat('a',80),repeat('b',24),null,'LOCAL_NATIVE_FIXTURE')from recovery_admin_ctx;
select public.upsert_push_subscription(member_b,'https://fcm.googleapis.com/fcm/send/domain-notice-foreign-fixture',repeat('a',80),repeat('b',24),null,'LOCAL_NATIVE_FIXTURE')from recovery_admin_ctx;
reset role;
update public.notification_preferences set web_push_enabled=true,wallet_enabled=true,quiet_hours_start='00:00',quiet_hours_end='00:00'where user_id=(select member_a from recovery_admin_ctx);
update public.outbox_events set available_at='infinity'where id<>(select source from domain_notice_ctx);
update public.outbox_events set available_at='-infinity'where id=(select source from domain_notice_ctx);
set local role service_role;
select is((select id from public.claim_outbox_events('domain-notice-owner',1,300)),(select source from domain_notice_ctx),'canonical worker claims actual source once');
select throws_like($$select public.complete_outbox_event(source,'domain-notice-foreign')from domain_notice_ctx$$,'OUTBOX_LEASE_NOT_OWNED','wrong worker cannot persist domain notification');
reset role;
create function pg_temp.fail_domain_notice()returns trigger language plpgsql as $$begin raise exception 'DOMAIN_NOTICE_FAULT';end;$$;
create trigger local_domain_notice_fault before insert on public.notifications for each row execute function pg_temp.fail_domain_notice();
set local role service_role;
select throws_like($$select public.complete_outbox_event(source,'domain-notice-owner')from domain_notice_ctx$$,'DOMAIN_NOTICE_FAULT','notification fault rolls back source consumer effects');
reset role;
select is((select count(*)from app_private.domain_notification_originals),0::bigint,'fault leaves no original receipt');
select is((select count(*)from public.event_consumer_deliveries where event_id=(select source from domain_notice_ctx)),0::bigint,'fault leaves no succeeded acknowledgement');
select is((select status::text from public.outbox_events where id=(select source from domain_notice_ctx)),'PROCESSING','fault retains owned lease for real retry');
drop trigger local_domain_notice_fault on public.notifications;
set local role service_role;
select lives_ok($$select public.complete_outbox_event(source,'domain-notice-owner')from domain_notice_ctx$$,'retry persists ordinary deposit notice while rewards disabled');
select lives_ok('set constraints all immediate','source receipt and projection satisfy deferred integrity');set constraints all deferred;
reset role;
select is((select count(*)from app_private.domain_notification_originals),1::bigint,'one actual business original has one notification outcome');
select is((select count(*)from public.notifications where source_event_id=(select source from domain_notice_ctx)and category='wallet'),1::bigint,'one factual wallet notice exists');
select is((select count(*)from public.notification_deliveries where notification_id in(select notification_id from app_private.domain_notification_originals)and channel='IN_APP'and status='SENT'and delivered_at is null),1::bigint,'persistence never asserts actual device presentation');
select is((select count(*)from app_private.notification_device_deliveries),1::bigint,'only owned opted-in subscription is queued');
select is((select count(*)from public.member_event_awards),0::bigint,'ordinary notification has no nonmoney award side effect');
select is((select count(*)from public.ledger_transactions),(select journals_before from domain_notice_ctx),'consumer creates no monetary journal');
select is((select balance_atomic::bigint from public.wallet_balance_snapshots where user_id=(select member_a from recovery_admin_ctx)and currency='KRW'),(select balance_before from domain_notice_ctx),'wallet is unchanged by notification');
select throws_like($$update public.notifications set body_ko='변조'where source_event_id=(select source from domain_notice_ctx)$$,'NONMONEY_NOTIFICATION_IMMUTABLE','immutable notice cannot diverge from source');
select throws_like($$update app_private.domain_notification_originals set snapshot='{}'$$,'%append-only%','source receipt is append only');
create function pg_temp.replay_domain_notice(p_source uuid)returns void language sql security definer set search_path=pg_catalog as $$select app_private.persist_domain_original_notification(p_source)$$;
revoke all on function pg_temp.replay_domain_notice(uuid)from public;grant execute on function pg_temp.replay_domain_notice(uuid)to service_role;
set local role service_role;
select lives_ok($$select pg_temp.replay_domain_notice(source)from domain_notice_ctx$$,'internal source replay validates existing receipt');
select is(jsonb_array_length(public.claim_notification_push_deliveries('domain-notice-quiet',10,60)),0,'existing all-day quiet setting defers transactional push');
reset role;
select is((select count(*)from public.notifications where source_event_id=(select source from domain_notice_ctx)),1::bigint,'replay cannot duplicate persisted notice');
update public.notification_preferences set quiet_hours_start=null,quiet_hours_end=null,wallet_enabled=false where user_id=(select member_a from recovery_admin_ctx);
set local role service_role;
select is(jsonb_array_length(public.claim_notification_push_deliveries('domain-notice-optout',10,60)),0,'current wallet opt-out prevents send of queued notice');
reset role;
update public.notification_preferences set wallet_enabled=true where user_id=(select member_a from recovery_admin_ctx);
-- Quiet deferred queue still has future available_at; adjust queue time only as native owner.
update app_private.notification_device_deliveries set available_at=clock_timestamp()where notification_id in(select notification_id from app_private.domain_notification_originals);
set local role service_role;
update domain_notice_ctx set batch=public.claim_notification_push_deliveries('domain-notice-send',10,60);
select is((select jsonb_array_length(batch)from domain_notice_ctx),1,'existing closed PWA claim consumes current source-bound notification');
reset role;
select ok((select bool_and(title_ko not like '%100000%'and body_ko not like '%100000%'and route='/wallet')from public.notifications where source_event_id=(select source from domain_notice_ctx)),'member notice exposes no amounts or private formulas');
select ok(not has_table_privilege('service_role','app_private.domain_notification_originals','SELECT'),'service cannot read private originals directly');
select ok(not has_function_privilege('service_role','app_private.persist_domain_original_notification(uuid)','EXECUTE'),'service cannot bypass canonical consumer with direct producer call');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_a from recovery_admin_ctx))::text,true);
select is((select count(*)from public.notifications where source_event_id=(select source from domain_notice_ctx)),1::bigint,'owner sees factual domain notice');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_b from recovery_admin_ctx))::text,true);
select is((select count(*)from public.notifications where source_event_id=(select source from domain_notice_ctx)),0::bigint,'other member sees no foreign notification');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.notification_preferences set wallet_enabled=false where user_id=(select member_b from recovery_admin_ctx);
set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(member_b,'KRW',100000,'domain-notice-optout'),actor,100000,'domain-notice-optout','Rollback-only category optout source',gen_random_uuid())from recovery_admin_ctx;
reset role;
update domain_notice_ctx set source=(select source_event_id from public.money_source_movements where user_id=(select member_b from recovery_admin_ctx)and origin_code='KRW_DEPOSIT'and movement_kind='CREDIT');
update public.outbox_events set available_at='-infinity'where id=(select source from domain_notice_ctx);
set local role service_role;
select id from public.claim_outbox_events('domain-notice-optout-intake',1,300);
select lives_ok($$select public.complete_outbox_event(source,'domain-notice-optout-intake')from domain_notice_ctx$$,'category optout does not block actual domain source acknowledgement');
reset role;
select is((select outcome from app_private.domain_notification_originals where source_event_id=(select source from domain_notice_ctx)),'SUPPRESSED_PREFERENCE','optout creates sealed suppression outcome');
select is((select count(*)from public.notifications where source_event_id=(select source from domain_notice_ctx)),0::bigint,'optout produces no public notice');
update public.notification_preferences set wallet_enabled=true where user_id=(select member_b from recovery_admin_ctx);
set local role service_role;
select lives_ok($$select pg_temp.replay_domain_notice(source)from domain_notice_ctx$$,'later preference change does not rewrite sealed original suppression');
reset role;
select is((select count(*)from public.notifications where source_event_id=(select source from domain_notice_ctx)),0::bigint,'replay after opt-in still creates no duplicate or retrospective notification');
create function pg_temp.forge_domain_notice()returns void language plpgsql security definer set search_path=pg_catalog as $proof$begin
 insert into public.notifications(user_id,category,title_ko,body_ko,route,deduplication_key)select member_b,'wallet','위조','위조','/wallet','domain-original:forged'from pg_temp.recovery_admin_ctx;
 set constraints public.domain_notification_namespace immediate;
end;$proof$;
revoke all on function pg_temp.forge_domain_notice()from public;grant execute on function pg_temp.forge_domain_notice()to service_role;
set local role service_role;
select throws_like($$select pg_temp.forge_domain_notice()$$,'DOMAIN_NOTIFICATION_ORIGINAL_REQUIRED','owner-only forged source fixture cannot bypass deferred source seal');
reset role;
set local role service_role;
select throws_like($$select pg_temp.replay_domain_notice(gen_random_uuid())$$,'NONMONEY_CANONICAL_ORIGINAL_REQUIRED','unknown source ID cannot manufacture a fact');
select lives_ok('set constraints all immediate','persisted and suppressed chains finish with full integrity');
reset role;
select * from finish();rollback;
