-- Canonical actual-service command proposal tests, rollback-only synthetic content.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);
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

create temporary table recovery_cms_ctx(kind text not null default 'NOTICE',payload jsonb,draft jsonb,preview jsonb,approval jsonb,publication jsonb);
insert into recovery_cms_ctx(payload)values(jsonb_build_object('slug','rollback-policy-notice','title','검토용 공지','summary','로컬 검증용 안내입니다.',
 'body','이 안내는 로컬 테스트에서만 사용합니다.','ctaLabel','이용 안내 보기','ctaRoute','/about','audience','MEMBERS','segment','ALL_MEMBERS',
 'publishedAt',to_char((clock_timestamp()+interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',null,'isPinned',false));
grant select,update on recovery_cms_ctx to service_role;
create function pg_temp.recovery_cms_command(p_operation text,p_key uuid,p_revision uuid default null,p_digest text default null,p_reason text default '검토한 안내 원고를 로컬에서 처리합니다.',p_proof text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare x record;c record;proof text;previous jsonb;
begin
 select * into x from pg_temp.recovery_admin_ctx;select * into c from pg_temp.recovery_cms_ctx;
 proof:=coalesce(p_proof,'cms-proof:'||p_key::text);
 if p_proof is null and not exists(select 1 from public.admin_step_up_grants where token_hash=encode(extensions.digest(proof,'sha256'),'hex')) then
  perform public.issue_admin_step_up(x.admin_session,x.actor,'LIVEOPS_CONTENT',proof,600);end if;
 previous:=case p_operation when 'PREVIEW' then c.draft when 'APPROVE' then c.preview when 'PUBLISH' then c.approval when 'ARCHIVE' then c.publication when 'CANCEL' then c.publication else null end;
 return public.manage_liveops_content(p_operation,c.kind,(previous->>'contentId')::uuid,coalesce(p_revision,(previous->>'revisionId')::uuid),
 coalesce(p_digest,previous->>'digest'),case p_operation when 'CREATE_DRAFT' then c.payload else null end,
 x.actor,x.admin_session,x.auth_session::text,'aal2',proof,p_reason,p_key::text);
end;
$$;
grant execute on function pg_temp.recovery_cms_command(text,uuid,uuid,text,text,text) to service_role;

-- Include with native CMS fixture prefix from liveops_content_recovery.sql.
-- Native source proposal NOT RUN. Finance owns final fixture isolation/registration.
create function pg_temp.process_publication_jobs(p_worker text)returns integer
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.system_jobs%rowtype;processed integer:=0;
begin
 loop
  select * into j from public.claim_system_jobs(p_worker,1,120);
  if j.id is null then exit;end if;
  if j.job_type<>'LIVEOPS_PUBLICATION_FANOUT_V1'then raise exception 'QA_UNRELATED_READY_JOB';end if;
  perform public.complete_system_job(j.id,p_worker);processed:=processed+1;
  if processed>1000 then raise exception 'QA_PUBLICATION_LOOP_BOUND';end if;
 end loop;return processed;
end;$$;
grant execute on function pg_temp.process_publication_jobs(text)to service_role;
-- Owner updates the original NOTICE/future/EVENT cases so complete_outbox_event
-- is followed by process_publication_jobs before checking notification rows.
-- A device fault now rolls back ONLY current job's notification/chunk/next-job
-- work; the already durable publication enqueue remains PROCESSED.
-- The following dedicated test must run on an isolated rollback-only recipient fixture.
select is((select count(*)::integer from public.user_profiles),0,'101-member bounded test starts with an isolated recipient cohort');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','publication-'||i||'@recovery.putduk.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp(),'','','',''from generate_series(1,101)i;
insert into public.user_profiles(user_id,display_name)select id,'로컬 게시 알림 검증'from auth.users where email like'publication-%@recovery.putduk.test';
insert into public.notification_preferences(user_id,events_enabled,web_push_enabled,event_cooldown_minutes)
select user_id,true,false,0 from public.user_profiles;
-- Existing recovery_cms_ctx canonical NOTICE payload/approval helpers reused.
update recovery_cms_ctx set payload=jsonb_set(payload,'{publishedAt}',to_jsonb(to_char((clock_timestamp()-interval'1 second')at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
set local role service_role;
update recovery_cms_ctx set draft=pg_temp.recovery_cms_command('CREATE_DRAFT',gen_random_uuid());
update recovery_cms_ctx set preview=pg_temp.recovery_cms_command('PREVIEW',gen_random_uuid());
update recovery_cms_ctx set approval=pg_temp.recovery_cms_command('APPROVE',gen_random_uuid());
update recovery_cms_ctx set publication=pg_temp.recovery_cms_command('PUBLISH',gen_random_uuid());
reset role;
create temporary table publication_test_source as select(publication->>'outboxId')::uuid event_id,(publication->>'revisionId')::uuid revision_id from recovery_cms_ctx;
grant select on publication_test_source to service_role;
create temporary table publication_claimed_outbox as select *from public.outbox_events where false;
grant select,insert,truncate on publication_claimed_outbox to service_role;
set local role service_role;
insert into publication_claimed_outbox select *from public.claim_outbox_events('qa-publication',100,120)where id=(select event_id from publication_test_source);
select is((select count(*)::integer from publication_claimed_outbox),1,'actual canonical outbox claim owns the publication lease');
select lives_ok($$select public.complete_outbox_event(event_id,'qa-publication')from publication_test_source$$,'source intake creates durable bounded job without changing void public completion');
reset role;
select is((select count(*)::integer from app_private.liveops_publication_cohort where revision_id=(select revision_id from publication_test_source)),101,'canonical source intake freezes exactly101 recipient identities');
select is((select count(*)::integer from public.notifications where source_event_id=(select event_id from publication_test_source)),0,'source enqueue is not claimed as recipient notification delivery');
-- A later member must not enter frozen cohort.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
values('00000000-0000-4000-8000-000000000102','authenticated','authenticated','publication-102@recovery.putduk.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp(),'','','','');
insert into public.user_profiles(user_id,display_name)values('00000000-0000-4000-8000-000000000102','나중 가입 검증');
insert into public.notification_preferences(user_id,events_enabled,web_push_enabled,event_cooldown_minutes)values('00000000-0000-4000-8000-000000000102',true,false,0);
create temporary table publication_claimed as select *from public.system_jobs where false;
grant select,insert,truncate on publication_claimed to service_role;
set local role service_role;
insert into publication_claimed select *from public.claim_system_jobs('qa-publication',1,120);
-- Claim precedes canonical stops; existing source-backed CMS assertions follow.
insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
select actor,'SUPER_ADMIN','SAFE_MODE_ENABLED','SAFE_MODE',component,
 'Synthetic local component stop preserves source-backed CMS processing',gen_random_uuid(),
 jsonb_build_object('command_version',1,'idempotency_key','cms-stop-'||component,'component',component,
 'is_paused',true,'review_at',null,'expected_request_id',(select request_id from public.safe_mode_controls where safe_mode_controls.component=c.component))
from recovery_admin_ctx cross join unnest(array['GLOBAL','SETTLEMENT','NEW_MINING']) c(component);
select ok((select bool_and(is_paused) from public.safe_mode_controls where component in('GLOBAL','SETTLEMENT','NEW_MINING')),
 'all three funding stops become active after canonical CMS job claim');

reset role;
create function pg_temp.fail_next_publication_job()returns trigger language plpgsql as $$begin
 if new.job_type='LIVEOPS_PUBLICATION_FANOUT_V1'and new.payload->>'chunk_number'='2'then raise exception 'QA_NEXT_CHUNK_FAULT';end if;return new;end;$$;
create trigger qa_next_chunk_fault before insert on public.system_jobs for each row execute function pg_temp.fail_next_publication_job();
set local role service_role;
select throws_ok($direct$do $body$begin
 update public.system_jobs set status='SUCCEEDED',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null
 where id=(select id from pg_temp.publication_claimed);
 set constraints all immediate;
end;$body$;$direct$,'55000','LIVEOPS_FANOUT_CHUNK_INVALID','raw service terminal update cannot manufacture a completed publication chunk');
select throws_ok($$select public.complete_system_job(id,'wrong-worker')from publication_claimed$$,'55000','JOB_LEASE_NOT_OWNED','wrong worker cannot process cohort');
select throws_ok($$select public.complete_system_job(id,'qa-publication')from publication_claimed$$,'P0001','QA_NEXT_CHUNK_FAULT','next-job insertion failure rolls back all current chunk outputs');
reset role;drop trigger qa_next_chunk_fault on public.system_jobs;
select is((select count(*)::integer from app_private.liveops_fanout_chunk_receipts),0,'fault leaves no misleading successful chunk receipt');
select is((select count(*)::integer from public.notifications where source_event_id=(select event_id from publication_test_source)),0,'fault leaves no partial member notifications');
select is((select count(*)::integer from app_private.liveops_fanout_job_originals where revision_id=(select revision_id from publication_test_source)),1,'fault leaves no unbound second job');
set local role service_role;
select lives_ok($$select public.complete_system_job(id,'qa-publication')from publication_claimed$$,'same still-owned lease retries the sealed first chunk');
select lives_ok($$select public.complete_system_job(id,'qa-publication')from publication_claimed$$,'accepted completion replay preserves one chunk/next job');
reset role;
select is((select count(*)::integer from public.notifications where source_event_id=(select event_id from publication_test_source)),100,'first job emits at most100 actual recipient notifications');
select is((select count(*)::integer from app_private.liveops_fanout_job_originals where revision_id=(select revision_id from publication_test_source)),2,'101 recipients create exactly2 source-bound jobs');
set local role service_role;
select is(pg_temp.process_publication_jobs('qa-publication'),1,'only the remaining one-recipient job completes');
reset role;
select is((select count(*)::integer from public.notifications where source_event_id=(select event_id from publication_test_source)),101,'all frozen recipient notifications appear exactly once');
select is((select count(*)::integer from public.notifications where user_id='00000000-0000-4000-8000-000000000102'),0,'late signup is excluded from publication audience');
select is((select sum(processed_count)::integer from app_private.liveops_fanout_chunk_receipts),101,'sealed batch counts equal exact frozen cohort');
select ok(not exists(select 1 from app_private.liveops_fanout_chunk_receipts where processed_count>100),'no completed chunk exceeds deterministic bound');
set local role service_role;
select lives_ok('set constraints all immediate','all original notifications survive actual native constraints');set constraints all deferred;
reset role;
create temporary table first_due_publication_notification as select id from public.notifications where source_event_id=(select event_id from publication_test_source)and user_id='00000000-0000-4000-8000-000000000001';
grant select on first_due_publication_notification to authenticated;
insert into public.notifications(id,user_id,category,title_ko,body_ko,route,deduplication_key,created_at,scheduled_at,expires_at)
values('38900000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','service','기한 지난 로컬 안내','이 안내는 로컬 만료 경계 검사입니다.','/events','qa-expired-notification',clock_timestamp()-interval'3 seconds',clock_timestamp()-interval'2 seconds',clock_timestamp()-interval'1 second');
-- Future publication: persisted queue, trusted due RLS, current device policy.
update public.notification_preferences set web_push_enabled=true where user_id='00000000-0000-4000-8000-000000000001';
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth_secret)values('38900000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','https://updates.push.services.mozilla.com/wpush/v2/local-publication-bounded',repeat('a',87),repeat('b',24));
update recovery_cms_ctx set draft=null,preview=null,approval=null,publication=null,payload=jsonb_set(jsonb_set(payload,'{slug}','"future-bounded-publication"'),'{publishedAt}',to_jsonb(to_char((clock_timestamp()+interval'1 hour')at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
set local role service_role;
update recovery_cms_ctx set draft=pg_temp.recovery_cms_command('CREATE_DRAFT',gen_random_uuid());
update recovery_cms_ctx set preview=pg_temp.recovery_cms_command('PREVIEW',gen_random_uuid());
update recovery_cms_ctx set approval=pg_temp.recovery_cms_command('APPROVE',gen_random_uuid());
update recovery_cms_ctx set publication=pg_temp.recovery_cms_command('PUBLISH',gen_random_uuid());
reset role;
update publication_test_source set event_id=(select(publication->>'outboxId')::uuid from recovery_cms_ctx),revision_id=(select(publication->>'revisionId')::uuid from recovery_cms_ctx);
set local role service_role;
truncate publication_claimed_outbox;
insert into publication_claimed_outbox select *from public.claim_outbox_events('qa-publication',100,120)where id=(select event_id from publication_test_source);
select lives_ok($$select public.complete_outbox_event(id,'qa-publication')from publication_claimed_outbox$$,'future NOTICE intake uses actual canonical claim/completion');
select is(pg_temp.process_publication_jobs('qa-publication'),2,'future NOTICE queue executes two bounded jobs for102 frozen recipients');
reset role;
create temporary table future_publication_notification as select n.id notification_id,d.id device_id,n.scheduled_at from public.notifications n join app_private.notification_device_deliveries d on d.notification_id=n.id where n.source_event_id=(select event_id from publication_test_source)and n.user_id='00000000-0000-4000-8000-000000000001';
grant select on future_publication_notification to authenticated;
select is((select count(*)::integer from future_publication_notification),1,'enabled future notice has one actual source-bound device job');
select is((select app_private.push_send_available_at(device_id,clock_timestamp())from future_publication_notification),(select scheduled_at from future_publication_notification),'future device admission defers until exactly approved schedule');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::integer from public.notifications where id=(select id from first_due_publication_notification)),1,'due authenticated owner reads the real previously published original');
select is((select count(*)::integer from public.notifications where id='38900000-0000-4000-8000-000000000003'),0,'expired authenticated own row is excluded by the real restrictive policy');
select is((select count(*)::integer from public.notifications where id=(select notification_id from future_publication_notification)),0,'authenticated direct table read cannot expose scheduled title before publication');
select lives_ok($$update public.notifications set read_at=clock_timestamp()where id=(select notification_id from future_publication_notification)$$,'blind future mark-read updates no RLS-visible row');
reset role;
select is((select read_at is null from public.notifications where id=(select notification_id from future_publication_notification)),true,'future notification is not prematurely marked read');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000102"}',true);
set local role authenticated;
select is((select count(*)::integer from public.notifications where id=(select id from first_due_publication_notification)),0,'due scheduling never broadens existing owner RLS to a different member');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.notification_preferences set quiet_hours_start='00:00',quiet_hours_end='00:00'where user_id='00000000-0000-4000-8000-000000000001';
select ok((select app_private.push_send_available_at(device_id,scheduled_at+interval'1 second')>scheduled_at+interval'1 second'from future_publication_notification),'all-day quiet preference defers even when original publication is due');
update public.notification_preferences set quiet_hours_start=null,quiet_hours_end=null,web_push_enabled=false where user_id='00000000-0000-4000-8000-000000000001';
select is((select app_private.push_send_available_at(device_id,scheduled_at+interval'1 second')is null from future_publication_notification),true,'post-enqueue device optout still cancels current admission');
update public.notification_preferences set web_push_enabled=true where user_id='00000000-0000-4000-8000-000000000001';
update public.push_subscriptions set expires_at=clock_timestamp()-interval'1 minute'where id='38900000-0000-4000-8000-000000000001';
select is((select app_private.push_send_available_at(device_id,scheduled_at+interval'1 second')is null from future_publication_notification),true,'expired device subscription remains suppressed');
update public.push_subscriptions set expires_at=null where id='38900000-0000-4000-8000-000000000001';

-- Cancel between EVENT batches: finish the queued source with a sealed zero chunk.
update recovery_cms_ctx set kind='EVENT',draft=null,preview=null,approval=null,publication=null,payload=jsonb_build_object(
 'slug','bounded-event-cancel','title','로컬 안내 참여','cardTitle','안내 읽기','summary','로컬에서 안내를 읽고 참여해 주세요.','body','이 안내는 로컬 테스트에서만 사용합니다.',
 'participation','안내를 읽고 참여해 주세요.','exclusion','운영 혜택이나 금전 보상은 없습니다.','rewardMode','NONE','ctaLabel','안내 보기','ctaRoute','/events','audience','MEMBERS','segment','ALL_MEMBERS',
 'startsAt',to_char((clock_timestamp()-interval'1 minute')at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',to_char((clock_timestamp()+interval'1 day')at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
set local role service_role;
update recovery_cms_ctx set draft=pg_temp.recovery_cms_command('CREATE_DRAFT',gen_random_uuid());
update recovery_cms_ctx set preview=pg_temp.recovery_cms_command('PREVIEW',gen_random_uuid());
update recovery_cms_ctx set approval=pg_temp.recovery_cms_command('APPROVE',gen_random_uuid());
update recovery_cms_ctx set publication=pg_temp.recovery_cms_command('PUBLISH',gen_random_uuid());
reset role;
update publication_test_source set event_id=(select(publication->>'outboxId')::uuid from recovery_cms_ctx),revision_id=(select(publication->>'revisionId')::uuid from recovery_cms_ctx);
set local role service_role;
truncate publication_claimed_outbox;
insert into publication_claimed_outbox select *from public.claim_outbox_events('qa-publication',100,120)where id=(select event_id from publication_test_source);
select lives_ok($$select public.complete_outbox_event(id,'qa-publication')from publication_claimed_outbox$$,'EVENT source intake reuses the exact approved publication contract');
truncate publication_claimed;
insert into publication_claimed select *from public.claim_system_jobs('qa-publication',1,120);
select lives_ok($$select public.complete_system_job(id,'qa-publication')from publication_claimed$$,'first EVENT chunk processes exactly100 frozen recipients');
select lives_ok($$select pg_temp.recovery_cms_command('CANCEL',gen_random_uuid())$$,'canonical operator cancellation is the current source authority');
select is(pg_temp.process_publication_jobs('qa-publication'),1,'cancelled source remaining job completes as sealed zero chunk');
reset role;
select is((select count(*)::integer from public.notifications where source_event_id=(select event_id from publication_test_source)),100,'cancellation prevents the remaining2 recipients from receiving an obsolete event announcement');
select is((select processed_count from app_private.liveops_fanout_chunk_receipts c join app_private.liveops_fanout_job_originals j on j.job_id=c.job_id where j.revision_id=(select revision_id from publication_test_source)and j.chunk_number=2),0,'stale publication completes with explicit zero processed count');
select is((select count(*)::integer from app_private.liveops_fanout_job_originals where revision_id=(select revision_id from publication_test_source)),2,'cancellation produces no fake third continuation job');
select ok(not exists(select 1 from public.ledger_transactions where member_user_id in(select user_id from public.user_profiles)),'bounded publication changes no actual money');
set local role service_role;
select lives_ok('set constraints all immediate','future NOTICE and cancelled EVENT source-bound chunks pass native seals');set constraints all deferred;
reset role;
set local role service_role;
select throws_ok($forged$insert into public.notifications(user_id,category,title_ko,body_ko,route,source_event_id,deduplication_key,scheduled_at)
 values('00000000-0000-4000-8000-000000000001','events','위조 게시 알림','실제 발행 원본이 없는 알림입니다.','/events',
 (select event_id from pg_temp.publication_test_source),'liveops-publication:forged',clock_timestamp())$forged$,
 '42501','permission denied for table notifications','raw service insert stays denied by the existing minimum privilege');
reset role;
-- Owner-only fixture exercises the deferred seal without broadening service grants.
select throws_ok($forged$do $body$begin
 insert into public.notifications(user_id,category,title_ko,body_ko,route,source_event_id,deduplication_key,scheduled_at)
 values('00000000-0000-4000-8000-000000000001','events','위조 게시 알림','실제 발행 원본이 없는 알림입니다.','/events',
 (select event_id from pg_temp.publication_test_source),'liveops-publication:forged',clock_timestamp());
 set constraints liveops_notification_insert_original immediate;
end;$body$;$forged$,'55000','LIVEOPS_NOTIFICATION_ORIGINAL_MISMATCH','owner-only forged fixture cannot bypass the deferred source seal');
select is((select count(*)::integer from public.notifications where deduplication_key='liveops-publication:forged'),0,'failed forged insert leaves no orphan notification');
select * from finish();rollback;
