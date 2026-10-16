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
create temporary table faq_ctx(payload jsonb,draft jsonb,preview jsonb,approval jsonb,publication jsonb,original_publication jsonb,publish_key uuid);
insert into faq_ctx(payload)values(jsonb_build_object('slug','member-faq','title','회원 안내 검토','summary','승인한 회원 안내를 읽습니다.',
 'audience','MEMBERS','segment','ALL_MEMBERS','locale','ko-KR','sourceDigest','4f0b01d18c82ceb6e477eabe72446afc76abd63d5bd82450e9bbc5799fc8533b',
 'entries',jsonb_build_array(jsonb_build_object('stableEntryId','rollback-member-guide','question','요청 처리 상태는 어디서 확인하나요?','answer','계정의 요청 내역에서 승인 상태를 확인합니다.')),
 'publishedAt',clock_timestamp()-interval '1 minute','expiresAt',clock_timestamp()+interval '2 days'));
grant select,update on faq_ctx to service_role,authenticated;
create function pg_temp.faq_command(op text,k uuid)returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare x record;c record;prev jsonb;proof text;
begin
 select * into x from pg_temp.recovery_admin_ctx;select * into c from pg_temp.faq_ctx;
 proof:='faq-proof:'||k::text;
 if not exists(select 1 from public.admin_step_up_grants where token_hash=encode(extensions.digest(proof,'sha256'),'hex'))then
  perform public.issue_admin_step_up(x.admin_session,x.actor,'LIVEOPS_CONTENT',proof,600);end if;
 prev:=case op when 'PREVIEW'then c.draft when 'APPROVE'then c.preview when 'PUBLISH'then c.approval else c.publication end;
 return public.manage_liveops_content(op,'FAQ',case when op='CREATE_DRAFT'then null else(prev->>'contentId')::uuid end,
  case when op='CREATE_DRAFT'then null else(prev->>'revisionId')::uuid end,case when op='CREATE_DRAFT'then null else prev->>'digest'end,
  case when op in ('CREATE_DRAFT','UPDATE_DRAFT')then c.payload else null end,x.actor,x.admin_session,x.auth_session::text,'aal2',proof,'합성 회원 FAQ의 검토한 원고를 처리합니다.',k::text);
end;$$;
grant execute on function pg_temp.faq_command(text,uuid)to service_role;

select lives_ok($$select app_private.validate_member_faq_payload(payload,true)from faq_ctx$$,'synthetic member FAQ matches closed canonical contract');
select throws_like($$insert into public.trust_documents(slug,document_kind,title_ko,summary_ko,visibility,status,published_at)
 values('member-faq','faq','조작된 문서','승인 원본 없는 문서','AUTHENTICATED','PUBLISHED',clock_timestamp())$$,
 'FAQ_PROJECTION_SOURCE_INVALID','unsealed member document cannot enter through the generic trust table');
insert into public.trust_documents(id,slug,document_kind,title_ko,summary_ko,visibility,status,published_at)
 values('39900000-0000-4000-8000-000000000001','rollback-decoy-faq','faq','다른 문서','다른 문서의 승인 자료','AUTHENTICATED','PUBLISHED',clock_timestamp());
insert into public.trust_versions(id,document_id,version,payload,content_hash,effective_at)
 values('39900000-0000-4000-8000-000000000002','39900000-0000-4000-8000-000000000001',1,'{"title":"다른 문서"}',repeat('0',64),clock_timestamp());
select throws_like($$update public.trust_documents set slug='member-faq'where id='39900000-0000-4000-8000-000000000001'$$,
 'FAQ_PROJECTION_IMMUTABLE','foreign document cannot change slug to enter the sealed member reader');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"slug":"faq"}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_FAQ_PAYLOAD','FAQ writer cannot edit the static public FAQ');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"audience":"PUBLIC"}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_FAQ_PAYLOAD','member source cannot be widened to PUBLIC');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"visibility":"PUBLIC"}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_FAQ_PAYLOAD','client cannot supply visibility');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"sourceDigest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_FAQ_PAYLOAD','unknown original source pin is refused');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"entries":[]}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_FAQ_PAYLOAD','empty FAQ is not a publishable projection');
select throws_like($$select app_private.validate_member_faq_payload(payload||jsonb_build_object('entries',(payload->'entries')||(payload->'entries')),true)from faq_ctx$$,'INVALID_LIVEOPS_FAQ_ENTRY','duplicate stable entry IDs are refused');
select throws_like($$select app_private.validate_member_faq_payload(jsonb_set(payload,'{entries,0,answer}','"<script>unsafe</script>"'),true)from faq_ctx$$,'INVALID_LIVEOPS_COPY','HTML does not become approved member copy');
select throws_like($$select app_private.validate_member_faq_payload(jsonb_set(payload,'{entries,0,answer}','"C:/private/identity"'),true)from faq_ctx$$,'INVALID_LIVEOPS_COPY','local source path cannot enter member copy');
select throws_like($$select app_private.validate_member_faq_payload(jsonb_set(payload,'{entries,0,answer}','"app_private auth.sessions"'),true)from faq_ctx$$,'INVALID_LIVEOPS_COPY','private schema and session markers are refused');
select throws_like($$select app_private.validate_member_faq_payload(jsonb_set(payload,'{entries,0,answer}','"{{unapproved_fact}}"'),true)from faq_ctx$$,'INVALID_LIVEOPS_COPY','unresolved facts block review and publication');
select lives_ok($$select app_private.validate_member_faq_payload(jsonb_set(payload,'{entries,0,answer}','"{{unapproved_fact}}"'),false)from faq_ctx$$,'unresolved source placeholders may be preserved only as private draft');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"publishedAt":null}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_WINDOW','publish requires a due date');
select throws_like($$select app_private.validate_member_faq_payload(payload||'{"expiresAt":"infinity"}'::jsonb,true)from faq_ctx$$,'INVALID_LIVEOPS_WINDOW','nonfinite expiration is refused');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq(),null::jsonb,'member sees no unregistered FAQ source');
select throws_like('select * from app_private.liveops_content_receipts','%permission denied%','member cannot read the private draft chain');
select throws_like($$select public.manage_liveops_content('CREATE_DRAFT','FAQ',null,null,null,null,null,null,null,'aal2','wrong-token','Unauthorized request',gen_random_uuid()::text)$$,'%permission denied%','member cannot invoke the service approval boundary');
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_like('select public.read_member_faq()','%permission denied%','anonymous caller cannot invoke member FAQ');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update faq_ctx set draft=pg_temp.faq_command('CREATE_DRAFT',gen_random_uuid());
select is((select draft->>'state'from faq_ctx),'DRAFT','shared CMS creates a private FAQ draft');
select throws_like($$select pg_temp.faq_command('CREATE_DRAFT',gen_random_uuid())$$,'LIVEOPS_FAQ_EXISTING_REVISION_REQUIRED','second FAQ source cannot silently replace the aggregate');
select throws_like($$select pg_temp.faq_command('PUBLISH',gen_random_uuid())$$,'LIVEOPS_REVISION_MISMATCH','no preview or approval bypass without an approved receipt');
update faq_ctx set preview=pg_temp.faq_command('PREVIEW',gen_random_uuid());
update faq_ctx set approval=pg_temp.faq_command('APPROVE',gen_random_uuid());
reset role;
select is((select count(*)from public.trust_versions v join public.trust_documents d on d.id=v.document_id where d.slug='member-faq'),0::bigint,'draft/preview/approval are never stored in the public version table');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update faq_ctx set publish_key=gen_random_uuid();
update faq_ctx set publication=pg_temp.faq_command('PUBLISH',publish_key);
update faq_ctx set original_publication=publication;
select is((select pg_temp.faq_command('PUBLISH',publish_key)from faq_ctx),(select publication from faq_ctx),'same MFA-bound publish intent replays the exact existing receipt');
select lives_ok('set constraints all immediate','FAQ commits only with exact shared audit/outbox/MFA/idempotency seals');set constraints all deferred;
reset role;
select is((select visibility::text from public.trust_documents where slug='member-faq'),'AUTHENTICATED','approved FAQ retains MEMBERS visibility');
select is((select count(*)from public.trust_versions v join public.trust_documents d on d.id=v.document_id where d.slug='member-faq'),1::bigint,'one approved publication creates one sealed trust version');
select throws_like($$update public.trust_versions set document_id=(select(publication->>'contentId')::uuid from faq_ctx)
 where id='39900000-0000-4000-8000-000000000002'$$,'FAQ_PROJECTION_IMMUTABLE','foreign unsealed version cannot be reassigned to the approved member document');
select throws_like($$insert into public.trust_versions(document_id,version,payload,content_hash,effective_at)
 select(publication->>'contentId')::uuid,999,payload,repeat('0',64),clock_timestamp()from faq_ctx$$,
 'FAQ_PROJECTION_SOURCE_INVALID','unsealed new version cannot join the approved member projection');
select throws_like($$update public.trust_versions set payload='{}'where id=(select(publication->>'revisionId')::uuid from faq_ctx)$$,'FAQ_PROJECTION_IMMUTABLE','published FAQ payload is immutable');
select throws_like($$delete from public.trust_versions where id=(select(publication->>'revisionId')::uuid from faq_ctx)$$,'FAQ_PROJECTION_IMMUTABLE','published FAQ cannot be deleted');
select throws_like($$update public.trust_documents set visibility='PUBLIC'where slug='member-faq'$$,'FAQ_PROJECTION_IMMUTABLE','member FAQ cannot acquire a public visibility');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq()->>'title','회원 안내 검토','member read returns the approved due payload');
select is(public.read_member_faq()->>'audience','MEMBERS','member DTO declares exact audience');
select is((select count(*)from public.trust_documents where slug='member-faq'),0::bigint,'raw member document and operator metadata stay private even when due');
select is((select count(*)from public.trust_versions where document_id=(public.read_member_faq()->>'contentId')::uuid),0::bigint,'member reads only the narrow DTO, not raw version/operator metadata');
select ok(not(public.read_member_faq() ?|array['auditId','actorId','adminSessionId','stepUpToken','outboxId','snapshot']),'member DTO excludes operator/proof/internal fields');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is(public.read_member_faq(),null::jsonb,'authenticated role without UID cannot read member FAQ');
select is((select count(*)from public.trust_versions where document_id=(select(publication->>'contentId')::uuid from faq_ctx)),0::bigint,
 'direct SELECT shares the missing-UID boundary');
reset role;
update auth.users set banned_until=clock_timestamp()+interval '1 hour'where id='38500000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq(),null::jsonb,'banned account cannot read member FAQ');
select is((select count(*)from public.trust_versions where document_id=(select(publication->>'contentId')::uuid from faq_ctx)),0::bigint,
 'direct SELECT shares the active-account read boundary');
reset role;
update auth.users set banned_until=null where id='38500000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq()->>'title','회원 안내 검토','restored active identity reads the same sealed due version');
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is((select count(*)from public.trust_documents where slug='member-faq'),0::bigint,'anon RLS cannot read member FAQ document');
select is((select count(*)from public.trust_versions v join public.trust_documents d on d.id=v.document_id where d.slug='member-faq'),0::bigint,'anon RLS cannot read approved member FAQ versions');
reset role;

-- Revised future publication cannot leak draft copy or overwrite current copy.
update faq_ctx set payload=payload||jsonb_build_object('title','다음 예약 안내','publishedAt',clock_timestamp()+interval '1 day','expiresAt',clock_timestamp()+interval '2 days');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update faq_ctx set draft=pg_temp.faq_command('UPDATE_DRAFT',gen_random_uuid());
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq()->>'title','회원 안내 검토','later private draft does not leak through an already published parent');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update faq_ctx set preview=pg_temp.faq_command('PREVIEW',gen_random_uuid());
update faq_ctx set approval=pg_temp.faq_command('APPROVE',gen_random_uuid());
update faq_ctx set publication=pg_temp.faq_command('PUBLISH',gen_random_uuid());
select lives_ok('set constraints all immediate','future FAQ publication retains complete approval/projection seals');set constraints all deferred;
reset role;
select is((select title_ko from public.trust_documents where slug='member-faq'),'회원 안내 검토','future publication does not overwrite existing document metadata');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq()->>'title','회원 안내 검토','future title does not replace current due member payload');
select is((select title_ko from public.trust_documents where slug='member-faq'),null::text,'member cannot bypass the DTO to read raw document metadata');
select is((select count(*)from public.trust_versions where document_id=(public.read_member_faq()->>'contentId')::uuid),0::bigint,'native RLS hides all raw member FAQ versions including future payload');
reset role;

-- Native source consumption is explicit no-fanout, not fake alert delivery.
update public.outbox_events set available_at='-infinity'where id=(select(publication->>'outboxId')::uuid from faq_ctx);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.claim_outbox_events('local-faq-worker',100,60)$$,'native worker can claim versioned content source');
select lives_ok($$select public.complete_outbox_event((select(publication->>'outboxId')::uuid from faq_ctx),'local-faq-worker')$$,'FAQ source completes without inventing publication notifications');
reset role;
select is((select count(*)from app_private.liveops_fanout_job_originals where revision_id=(select(publication->>'revisionId')::uuid from faq_ctx)),0::bigint,'FAQ does not create an unapproved all-member alert job');
select is((select count(*)from public.notifications where source_event_id=(select(publication->>'outboxId')::uuid from faq_ctx)),0::bigint,'FAQ worker creates no fake delivered notification');
select is((select status::text from public.outbox_events where id=(select(publication->>'outboxId')::uuid from faq_ctx)),'PROCESSED','FAQ source has an authoritative worker completion state');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_like($$select pg_temp.faq_command('CANCEL',gen_random_uuid())$$,'LIVEOPS_REVISION_STATE','FAQ cannot use the event CANCEL lifecycle');
select lives_ok($$update faq_ctx set publication=pg_temp.faq_command('ARCHIVE',gen_random_uuid())$$,'MFA-approved FAQ archive uses the existing sealed lifecycle');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq(),null::jsonb,'archived FAQ disappears from member read API');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok('set constraints all immediate','archive/worker/member visibility remain valid at the deferred service commit boundary');
reset role;
set constraints all deferred;

-- Public trust payloads do not share the member FAQ expiration data contract.
insert into public.trust_documents(id,slug,document_kind,title_ko,summary_ko,visibility,status,published_at)
 values('39900000-0000-4000-8000-000000000003','rollback-public-date-shape','guide','공개 문서','다른 JSON 계약','PUBLIC','PUBLISHED',clock_timestamp()-interval '1 minute');
insert into public.trust_versions(document_id,version,payload,content_hash,effective_at)
 values('39900000-0000-4000-8000-000000000003',1,'{"expiresAt":"not-a-date"}',repeat('0',64),clock_timestamp()-interval '1 minute');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is((select count(*)from public.trust_versions where document_id='39900000-0000-4000-8000-000000000003'),1::bigint,
 'narrow FAQ DTO does not cast arbitrary PUBLIC payload fields');
reset role;

-- Real local DB wall clock, not a mocked time or a modified sealed row.
update faq_ctx set payload=payload||jsonb_build_object('title','만료 경계 안내','publishedAt',clock_timestamp()-interval '1 second','expiresAt',clock_timestamp()+interval '5 seconds');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update faq_ctx set draft=pg_temp.faq_command('UPDATE_DRAFT',gen_random_uuid());
update faq_ctx set preview=pg_temp.faq_command('PREVIEW',gen_random_uuid());
update faq_ctx set approval=pg_temp.faq_command('APPROVE',gen_random_uuid());
update faq_ctx set publication=pg_temp.faq_command('PUBLISH',gen_random_uuid());
select lives_ok('set constraints all immediate','re-publication after archive remains MFA-bound and sealed');set constraints all deferred;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"38500000-0000-4000-8000-000000000006"}',true);
select is(public.read_member_faq()->>'title','만료 경계 안내','due re-publication is visible before its expiration');
select pg_sleep(6);
select is(public.read_member_faq(),null::jsonb,'expired latest due FAQ does not fall back to an older unexpired version');
select is((select count(*)from public.trust_versions where id=(select(publication->>'revisionId')::uuid from faq_ctx)),0::bigint,
 'direct member SELECT also hides the expired answer version');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok('set constraints all immediate','expiry clock test preserves the immutable version and receipt seal');
reset role;
select * from finish();rollback;
