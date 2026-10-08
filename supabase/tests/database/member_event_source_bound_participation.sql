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

-- Native worker claim followed by existing completion, all rollback-only.
update public.outbox_events set available_at='-infinity' where id=(select(receipt->>'outboxId')::uuid from event_join_ctx);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select id from public.claim_outbox_events('local-event-native-owner',1,60)),(select(receipt->>'outboxId')::uuid from event_join_ctx),'worker claims exact source-bound event with live durable lease');
select throws_like($$select public.complete_outbox_event((select(receipt->>'outboxId')::uuid from event_join_ctx),'local-event-wrong-worker')$$,'OUTBOX_LEASE_NOT_OWNED','wrong worker cannot consume member join');
select lives_ok($$select public.complete_outbox_event((select(receipt->>'outboxId')::uuid from event_join_ctx),'local-event-native-owner')$$,'canonical completion verifies original and consumes join');
select is((select status::text from public.outbox_events where id=(select(receipt->>'outboxId')::uuid from event_join_ctx)),'PROCESSED','source-bound join is durably processed');
select is((select count(*)from public.event_consumer_deliveries where event_id=(select(receipt->>'outboxId')::uuid from event_join_ctx) and consumer_name='member_event_join.v1' and status='SUCCEEDED'),1::bigint,'exactly one internal consumer effect is stored');
select is((select status::text from public.event_participants where id=(select(receipt->>'participantId')::uuid from event_join_ctx)),'JOINED','join consumption does not claim mission completion or reward');
select throws_like($$select public.complete_outbox_event((select(receipt->>'outboxId')::uuid from event_join_ctx),'local-event-native-owner')$$,'OUTBOX_LEASE_NOT_OWNED','completed event cannot be consumed a second time');
reset role;
select throws_like($$update public.event_consumer_deliveries set status='FAILED'where consumer_name='member_event_join.v1'$$,'EVENT_JOIN_DELIVERY_IMMUTABLE','delivery receipt cannot be replaced after native consumption');
select throws_like($$update app_private.event_join_consumer_receipts set digest=repeat('0',64)$$,'%append-only%','private delivery original remains immutable');
select lives_ok('set constraints all immediate','join and worker completion retain exact original seals');
set constraints all deferred;

select * from finish();rollback;
