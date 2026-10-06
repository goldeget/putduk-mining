begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- New rollback-only catalog; this never approves the installed DRAFT seed.
create temporary table catalog_ctx(admin_id uuid,viewer_id uuid,session_id uuid,catalog_id uuid,product_id uuid,publish_at timestamptz,
 source_digest text,preview jsonb,approval jsonb,publication jsonb);
insert into catalog_ctx values('12500000-0000-4000-8000-000000000001','12500000-0000-4000-8000-000000000002',
 '12500000-0000-4000-8000-000000000003','12500000-0000-4000-8000-000000000004','12500000-0000-4000-8000-000000000005',
 clock_timestamp()+interval '1 day',null,null,null,null);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select id,'authenticated','authenticated',id::text||'@catalog.putduk.test','',statement_timestamp(),'{}','{}',
 statement_timestamp(),statement_timestamp(),'','','','' from catalog_ctx cross join lateral unnest(array[admin_id,viewer_id])id;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN'::public.app_role,admin_id from catalog_ctx
 union all select viewer_id,'VIEWER'::public.app_role,viewer_id from catalog_ctx;
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
 select session_id,admin_id,'catalog-bound-auth','catalog-test-fingerprint',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours' from catalog_ctx;
insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
 select catalog_id,(select max(version)+1 from public.product_catalog_versions),current_date,'Rollback-only sourced neutral catalog review fixture',
 '[{"name":"LBMA category identity","url":"https://www.lbma.org.uk/"}]',app_private.funding_engine_digest(jsonb_build_object('test_catalog',catalog_id)),'SYNTHETIC_LOCAL_TEST_ONLY' from catalog_ctx;
insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
 select product_id,catalog_id,(select id from public.asset_worlds order by id limit 1),'CAT_NEUTRAL','catalog-neutral','GOLD','시험 상품','Test Theme','상품 승인 명령의 로컬 시험입니다.',1 from catalog_ctx;
update catalog_ctx set source_digest=app_private.funding_engine_digest(app_private.product_catalog_source_snapshot(catalog_id));
grant select,update on catalog_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
create function pg_temp.catalog_command(p_operation text,p_key text,p_aal text default 'aal2',p_actor uuid default null,
 p_revision uuid default null,p_digest text default null,p_reason text default '상품과 출처를 실제 검토했습니다.',p_token text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare x record; proof text; previous jsonb;
begin
 select * into x from pg_temp.catalog_ctx;
 proof:=coalesce(p_token,'catalog-proof:'||p_key);
 if p_token is null and not exists(select 1 from public.admin_step_up_grants where token_hash=encode(extensions.digest(proof,'sha256'),'hex')) then
  perform public.issue_admin_step_up(x.session_id,x.admin_id,'PRODUCT_CATALOG',proof,600);
 end if;
 previous:=case p_operation when 'APPROVE' then x.preview when 'PUBLISH' then x.approval else null end;
 return public.manage_product_catalog(p_operation,x.catalog_id,coalesce(p_revision,(previous->>'revisionId')::uuid),
   coalesce(p_digest,previous->>'snapshotDigest',x.source_digest),x.publish_at,coalesce(p_actor,x.admin_id),x.session_id,
   'catalog-bound-auth',p_aal,proof,p_reason,p_key);
end;
$$;
grant execute on function pg_temp.catalog_command(text,text,text,uuid,uuid,text,text,text) to service_role;

select ok(not has_function_privilege('authenticated','public.manage_product_catalog(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.read_product_catalog_review_state(uuid,uuid,uuid,text,text)','EXECUTE'),'catalog mutation/review are service-only');
select ok(not has_table_privilege('authenticated','app_private.product_catalog_receipts','SELECT'),'private approval receipts stay off the member grant surface');
select ok((select bool_and(not prosecdef and 'search_path=pg_catalog'=any(proconfig)) from pg_proc where oid in(
 'public.manage_product_catalog(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)'::regprocedure,
 'public.read_product_catalog_review_state(uuid,uuid,uuid,text,text)'::regprocedure)),'operator commands remain fixed-path invokers');
select ok(not has_table_privilege('service_role','public.product_catalog_versions','UPDATE')
 and not has_table_privilege('service_role','public.product_rule_versions','INSERT')
 and not has_table_privilege('service_role','public.product_availability','INSERT'),'actual command adds no raw catalog relation writes');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) from pg_proc where oid=
 'app_private.execute_product_catalog_command(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)'::regprocedure),
 'private executor is fixed-path and unreachable through public RPC schema');
select ok((select count(*)=5 and bool_and((tgtype&1)=0) from pg_trigger where tgname='a_product_catalog_serialization'),
 'catalog mutation lock is acquired before tuple locks by statement triggers');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) from pg_proc where oid=
 'app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text)'::regprocedure)
 and not has_function_privilege('authenticated','app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text)','EXECUTE'),
 'private review executor does not expose owner read authority to members');
select ok(not has_table_privilege('service_role','public.product_visuals','SELECT'),
 'canonical review does not restore raw private visual SELECT');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) from pg_proc where oid=
 'app_private.validate_product_catalog_publication_trigger()'::regprocedure)
 and not has_function_privilege('service_role','app_private.validate_product_catalog_publication_trigger()','EXECUTE')
 and not has_function_privilege('authenticated','app_private.validate_product_catalog_publication_trigger()','EXECUTE'),
 'deferred publication validator is closed fixed-path trigger-only owner authority');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select pg_temp.catalog_command('PREVIEW','catalog-aal-invalid',p_aal=>'aal1')$$,'42501','MFA_REQUIRED','preview needs actual server AAL2');
select throws_ok($$select pg_temp.catalog_command('PREVIEW','catalog-viewer-denied',p_actor=>(select viewer_id from catalog_ctx))$$,'42501','OPERATOR_ROLE_REQUIRED','a viewer cannot review/approve');
select throws_ok($$select pg_temp.catalog_command('PREVIEW','catalog-proof-denied',p_token=>'unknown-proof-1234567890')$$,'42501','STEP_UP_REQUIRED','preview requires its own unconsumed proof');
select throws_ok($$select pg_temp.catalog_command('PREVIEW','catalog-digest-denied',p_digest=>repeat('0',64))$$,'40001','PRODUCT_CATALOG_PREVIEW_CHANGED','seed/source-label digest cannot replace full snapshot digest');
select is((select count(*)::integer from app_private.product_catalog_receipts),0,'invalid preview writes no receipt');
update catalog_ctx set preview=pg_temp.catalog_command('PREVIEW','catalog-preview-exact');
select is((select preview->>'state' from catalog_ctx),'PREVIEWED','actual operator preview is persisted');
select is((select status::text from public.product_catalog_versions where id=(select catalog_id from catalog_ctx)),'DRAFT','preview does not approve/publish');
select is((select count(*)::integer from public.product_rule_versions where product_id=(select product_id from catalog_ctx)),0,'preview attests a plan without creating rules');
select ok((select preview->>'snapshotDigest'<>source_digest from catalog_ctx),'preview digest binds neutral plan and availability time beyond source snapshot');
set local timezone='Asia/Seoul';
reset role;
-- Full private source/seal assertions are owner-only fixture proof reads.
-- Canonical commands below still run as the real service_role.
select is((select app_private.funding_engine_digest(app_private.product_catalog_source_snapshot(catalog_id)) from catalog_ctx),
 (select source_digest from catalog_ctx),'complete source digest is invariant across session time zones');
select lives_ok($$select app_private.assert_product_catalog_receipt((preview->>'revisionId')::uuid) from catalog_ctx$$,
 'UTC preview receipt remains exact in an Asia/Seoul session');
set local role service_role;
select is(pg_temp.catalog_command('PREVIEW','catalog-preview-exact'),(select preview from catalog_ctx),'same-key preview replay returns exact receipt');
select is((select count(*)::integer from app_private.product_catalog_receipts where catalog_id=(select catalog_id from catalog_ctx)),1,'replay adds no extra operation receipt');
select throws_ok($$select pg_temp.catalog_command('PREVIEW','catalog-preview-exact',p_reason=>'다른 내용으로 검토했습니다.')$$,'22023','IDEMPOTENCY_PAYLOAD_MISMATCH','same key cannot change intent');
select throws_ok($$select pg_temp.catalog_command('APPROVE','catalog-stale-approval',p_revision=>'12500000-0000-4000-8000-000000000099')$$,'40001','PRODUCT_CATALOG_REVISION_CHANGED','approval cannot skip or swap preview');
update catalog_ctx set approval=pg_temp.catalog_command('APPROVE','catalog-approval-exact');
select lives_ok('set constraints all immediate','real service APPROVE commit validator reads complete private seals');
set constraints all deferred;
select is((select approval->>'state' from catalog_ctx),'APPROVED','actual approval records the previewed neutral rule');
select ok((select rule_payload='{}' and approved_by=(select admin_id from catalog_ctx) and effective_at=(select publish_at from catalog_ctx)
 from public.product_rule_versions where product_id=(select product_id from catalog_ctx)),'only the exact approved empty rule is inserted');
select ok((select status='AVAILABLE' and available_from=(select publish_at from catalog_ctx) and available_to is null and segment_key is null
 from public.product_availability where product_id=(select product_id from catalog_ctx)),'availability exactly matches operator preview');
select throws_ok($$update public.mining_products set name_ko='변경' where id=(select product_id from catalog_ctx)$$,
 '42501',null,'raw service cannot mutate approved product snapshot');
select throws_ok($$update public.product_rule_versions set rule_payload='{"reward":1}' where product_id=(select product_id from catalog_ctx)$$,
 '42501',null,'raw service cannot mutate approved neutral rule');
set local timezone='UTC';
update catalog_ctx set publication=pg_temp.catalog_command('PUBLISH','catalog-publish-exact');
select lives_ok('set constraints all immediate','real service PUBLISH commit validator reads complete private seals');
set constraints all deferred;
select is((select publication->>'state' from catalog_ctx),'PUBLISHED','deterministic publish completes reviewed lifecycle');
reset role;
select lives_ok($$select app_private.assert_published_product_catalog(catalog_id) from catalog_ctx$$,'publication verifies all three audit/event/proof receipts and exact rule plan');
set local timezone='Asia/Seoul';
select lives_ok($$select app_private.assert_published_product_catalog(catalog_id) from catalog_ctx$$,
 'later policy/member session time zone does not invalidate original publication');
set local role service_role;
select is(pg_temp.catalog_command('PUBLISH','catalog-publish-exact'),(select publication from catalog_ctx),'publish replay returns exact immutable result');
select is(pg_temp.catalog_command('PREVIEW','catalog-preview-exact'),(select preview from catalog_ctx),'old preview can recover after later publication');
select is((select count(*)::integer from app_private.product_catalog_receipts where catalog_id=(select catalog_id from catalog_ctx)),3,'all replays leave only three original receipts');
select is((select count(*)::integer from public.admin_step_up_grants where command_family='PRODUCT_CATALOG' and consumed_at is not null),3,'one proof is consumed per accepted transition');
select throws_ok($$update public.outbox_events set payload='{}' where id=(select outbox_id from app_private.product_catalog_receipts where state='PUBLISHED' and catalog_id=(select catalog_id from catalog_ctx))$$,
 '55000','PRODUCT_CATALOG_EVENT_IMMUTABLE','workers cannot rewrite catalog semantic receipt');
select lives_ok($$select public.read_product_catalog_review_state(catalog_id,admin_id,session_id,'catalog-bound-auth','aal2') from catalog_ctx$$,'real protected operator state read works');
select is((select count(*)::integer from public.audit_logs where action='PRODUCT_CATALOG_REVIEW_READ'),1,'protected review logs authorized access');
select throws_ok($$select public.read_product_catalog_review_state(catalog_id,admin_id,session_id,'different-auth','aal2') from catalog_ctx$$,
 '42501','ADMIN_SESSION_EXPIRED','review read rejects a crossed Auth session');
select is((select count(*)::integer from public.audit_logs where action='PRODUCT_CATALOG_REVIEW_READ'),1,'denied private read writes no access receipt');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.read_product_catalog_review_state(catalog_id,admin_id,session_id,'catalog-bound-auth','aal2') from catalog_ctx$$,
 '42501','PRODUCT_CATALOG_SERVICE_ROLE_REQUIRED','service SQL role with crossed member JWT cannot read private review');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*)::integer from public.audit_logs where action='PRODUCT_CATALOG_REVIEW_READ'),1,
 'wrong service JWT is denied before audit or private read');
select throws_ok($$update app_private.idempotency_keys set response_payload='{}' where scope='product.catalog'
 and idempotency_key='catalog-publish-exact'$$,'55000','PRODUCT_CATALOG_COMPLETION_IMMUTABLE',
 'service cannot forge completed catalog replay payload');
select throws_ok($$delete from app_private.idempotency_keys where scope='product.catalog'
 and idempotency_key='catalog-publish-exact'$$,'42501','permission denied for table idempotency_keys',
 'service DELETE privilege stays revoked for accepted catalog completion');
reset role;
select throws_ok($$delete from app_private.idempotency_keys where scope='product.catalog'
 and idempotency_key='catalog-publish-exact'$$,'55000','PRODUCT_CATALOG_COMPLETION_IMMUTABLE',
 'owner DELETE still hits completed catalog immutability trigger');
select throws_ok($$update public.mining_products set name_ko='변경' where id=(select product_id from catalog_ctx)$$,
 '55000','PUBLISHED_CATALOG_PRODUCT_MUTATION_FORBIDDEN','existing owner-side immutable child guard still blocks edits');
select throws_ok($$update public.product_catalog_versions set status='DRAFT' where id=(select catalog_id from catalog_ctx)$$,
 '55000','INVALID_CATALOG_STATUS_TRANSITION','existing catalog transition guard rejects published-to-draft downgrade');
select is((select status::text from public.product_catalog_versions where id='20000000-0000-4000-8000-000000000001'),'DRAFT','installed seed remains DRAFT');
set constraints all immediate;
select * from finish();
rollback;
