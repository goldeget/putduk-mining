begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Same exact reference vectors as the TypeScript verifier. These are arithmetic
-- assertions, never caller amounts supplied to the monetary dispatch command.
select is(app_private.funding_exact_default_interval(100000,1500,1500,10000,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'amountAtomic','12','default reference posts 12 from exact 12.73');
select is(app_private.funding_exact_default_interval(100000,1500,1500,10000,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'carryNum','73','default reference preserves 73/100 carry');
select is(app_private.funding_exact_default_interval(100000,1500,1500,5000,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'baseDen','200','half-allocation reference preserves exact 1273/200 BASE');
select is(app_private.funding_exact_default_interval(100000,1500,1500,5000,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'conditionalRetentionDen','100','partial allocation leaves maintenance at 1273/100');
-- Inlined owner-only fixture; standalone Supabase pgTAP runner does not mount sibling fixtures.
-- The V1 pre-credit allocation remains an explicitly postgres-only reference
-- fixture. Its DRAFT catalog source is local fixture content; publication,
-- neutral rule, availability, receipts, audit, and events use the actual
-- canonical operator lifecycle. This does not claim a real production catalog
-- or a delivered member allocation flow for V1.
create function pg_temp.plant_default_funding_allocation_original(p_user uuid,p_admin uuid,p_published boolean default true)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare v_catalog uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid(); v_rule uuid:=gen_random_uuid();
 v_a app_private.funding_allocation_originals%rowtype; v_snapshot jsonb; v_request uuid:=gen_random_uuid();
 v_instant timestamptz; v_version integer; v_session uuid:=gen_random_uuid(); v_review jsonb; v_token text;
 v_publish_at timestamptz; v_auth_session text; v_sql_role text; v_claims text;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='FUNDING_ALLOCATION_FIXTURE_OWNER_ONLY'; end if;
 v_sql_role:=current_setting('role'); v_claims:=current_setting('request.jwt.claims',true);
 select coalesce(max(version),0)+1 into v_version from public.product_catalog_versions;
 insert into public.product_catalog_versions(id,version,status,snapshot_date,methodology,source_references,content_digest,proposed_by)
 values(v_catalog,v_version,'DRAFT',current_date,'postgres-only local neutral reference source',
   '[{"name":"Local reference fixture","url":"https://putduk.test/default-foundation-reference"}]',
   app_private.funding_engine_digest(jsonb_build_object('fixture_id',v_catalog)),'LOCAL_TEST_SOURCE_ONLY');
 insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
 values(v_product,v_catalog,(select id from public.asset_worlds order by id limit 1),'REF_NEUTRAL','ref-neutral','GOLD',
   '시험 원본','Reference fixture','운영 상품이 아닌 로컬 시험 원본',1);
 if p_published then
  v_auth_session:='foundation-reference:'||v_session::text; v_publish_at:=clock_timestamp()+interval '1 second';
  insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
  values(v_session,p_admin,v_auth_session,v_auth_session,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('role','service_role',true);
  v_token:='foundation-preview:'||v_catalog::text;
  perform public.issue_admin_step_up(v_session,p_admin,'PRODUCT_CATALOG',v_token,600);
  v_review:=public.manage_product_catalog('PREVIEW',v_catalog,null,
   public.read_product_catalog_review_state(v_catalog,p_admin,v_session,v_auth_session,'aal2')->'selected'->>'sourceDigest',
   v_publish_at,p_admin,v_session,v_auth_session,'aal2',v_token,'Reviewed local reference fixture',v_token);
  v_token:='foundation-approve:'||v_catalog::text;
  perform public.issue_admin_step_up(v_session,p_admin,'PRODUCT_CATALOG',v_token,600);
  v_review:=public.manage_product_catalog('APPROVE',v_catalog,(v_review->>'revisionId')::uuid,v_review->>'snapshotDigest',
   v_publish_at,p_admin,v_session,v_auth_session,'aal2',v_token,'Reviewed local reference fixture',v_token);
  v_token:='foundation-publish:'||v_catalog::text;
  perform public.issue_admin_step_up(v_session,p_admin,'PRODUCT_CATALOG',v_token,600);
  perform public.manage_product_catalog('PUBLISH',v_catalog,(v_review->>'revisionId')::uuid,v_review->>'snapshotDigest',
   v_publish_at,p_admin,v_session,v_auth_session,'aal2',v_token,'Reviewed local reference fixture',v_token);
  perform set_config('role',v_sql_role,true);
  perform set_config('request.jwt.claims',coalesce(v_claims,'{}'),true);
  -- Bound actual schedule wait; no source clock or publication is backdated.
  perform pg_sleep(greatest(0,extract(epoch from(v_publish_at-clock_timestamp())))+0.001);
  perform app_private.assert_published_product_catalog(v_catalog);
  select id into v_rule from public.product_rule_versions where product_id=v_product;
 end if;
 v_instant:=clock_timestamp();
 v_a.id:=gen_random_uuid(); v_a.user_id:=p_user; v_a.revision:=1; v_a.catalog_version_id:=v_catalog;
 v_a.products:=jsonb_build_array(jsonb_build_object('productId',v_product,'ruleVersionId',v_rule,'allocationBps','10000'));
 v_a.effects:='{}'; v_a.effective_at:=v_instant; v_a.audit_id:=gen_random_uuid(); v_a.source_event_id:=gen_random_uuid();
 v_a.recorded_at:=clock_timestamp(); v_snapshot:=app_private.funding_allocation_snapshot(v_a);
 v_a.input_digest:=app_private.funding_engine_digest(v_snapshot);
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata)
 values(v_a.audit_id,p_user,'FUNDING_ALLOCATION_CONFIRMED','FUNDING_ENGINE_V1',v_a.id::text,
   'SYNTHETIC postgres-only pre-credit V1 allocation reference; not a member command',v_request,v_snapshot,
   jsonb_build_object('input_digest',v_a.input_digest,'fixture_provenance','POSTGRES_OWNER_ONLY_REFERENCE'));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
   correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(v_a.source_event_id,'FUNDING_ALLOCATION_CONFIRMED.v1',1,'funding_engine_v1',v_a.id,p_user,
   jsonb_build_object('user_id',p_user,'audit_id',v_a.audit_id,'input_digest',v_a.input_digest),gen_random_uuid(),v_request,
   'funding:'||v_a.id::text||':seal','infinity','SYNTHETIC_LOCAL_TEST_ONLY');
 insert into app_private.funding_allocation_originals select v_a.*;
 return v_a.id;
end;
$$;
revoke all on function pg_temp.plant_default_funding_allocation_original(uuid,uuid,boolean) from public,anon,authenticated,service_role;

-- The allocation original is an explicitly isolated V1 reference fixture.
-- Catalog operator commands, principal deposits, policy reader, canonical job
-- claims, private earned posting/public completion are actual installed paths.
create temporary table dispatch_ctx(
 admin_id uuid, member_id uuid, allocation uuid, credit uuid, activation uuid,
 job uuid, fake_job uuid, generic_job uuid, next_job uuid, earned uuid,
 original_state jsonb, journal_count bigint, wallet_count bigint, source_count bigint,
 lease_until timestamptz
);
insert into dispatch_ctx(admin_id,member_id) values(
 '10624000-0000-4000-8000-000000000001',
 '10624000-0000-4000-8000-000000000002');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@funding-dispatch.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from dispatch_ctx cross join lateral unnest(array[admin_id,member_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from dispatch_ctx;
select public.bootstrap_user(member_id) from dispatch_ctx;
update dispatch_ctx set allocation=pg_temp.plant_default_funding_allocation_original(member_id,admin_id,true);
grant select,update on dispatch_ctx to service_role;
set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',1000000000000,'dispatch-real-request'),
 admin_id,1000000000000,'dispatch-real-credit','actual local principal confirmation',gen_random_uuid()) from dispatch_ctx;
update dispatch_ctx set credit=(select id from public.money_source_movements where user_id=member_id and source_bucket='PRINCIPAL');
update dispatch_ctx set activation=app_private.activate_default_funding_engine(credit,allocation);
update dispatch_ctx set job=app_private.prepare_default_funding_job(activation);
reset role;

select ok(has_function_privilege('service_role','public.complete_system_job(uuid,text)','EXECUTE')
 and not has_function_privilege('anon','public.complete_system_job(uuid,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.complete_system_job(uuid,text)','EXECUTE'),
 'existing completion remains service-only');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
 from pg_proc where oid='public.complete_system_job(uuid,text)'::regprocedure),
 'funding dispatch keeps fixed-path invoker authority');
select ok((select available_at='infinity'::timestamptz from public.system_jobs where id=(select job from dispatch_ctx)),
 'handler connection does not make the prepared job due');
-- Match the actual service JWT together with the existing SQL service role.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*)::integer from public.claim_system_jobs('dormant-worker',100,300)),0,
 'actual claim cannot take dormant funding work');
select throws_ok($$select public.complete_system_job(job,'dispatch-worker') from dispatch_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','public completion cannot earn from unclaimed original');
insert into public.system_jobs(job_type,idempotency_key,payload,payload_version,available_at)
values('FUNDING_MINING_TICK_V1','dispatch-forged-funding-envelope',
 '{"user_id":"10624000-0000-4000-8000-000000000002","activation_id":"10624000-0000-4000-8000-000000000003","expected_state_id":"10624000-0000-4000-8000-000000000004"}',1,'infinity');
update dispatch_ctx set fake_job=(select id from public.system_jobs where idempotency_key='dispatch-forged-funding-envelope');
select throws_ok($$select public.complete_system_job(fake_job,'dispatch-worker') from dispatch_ctx$$,
 '55000','FUNDING_JOB_ORIGINAL_REQUIRED','funding type and plausible payload cannot replace sealed job original');
select is((select status::text from public.system_jobs where id=(select fake_job from dispatch_ctx)),'PENDING',
 'forged funding job is not falsely marked successful');
select is((select count(*)::integer from app_private.funding_earned_receipts),0,
 'rejected public completion creates no earned original');
reset role;

-- Only the postgres owner releases this rollback fixture. Runtime scheduling,
-- allocation and cycle adapters remain unconnected by migration124000.
update public.system_jobs set available_at=clock_timestamp() where id=(select job from dispatch_ctx);
set local role service_role;
select is((select count(*)::integer from public.claim_system_jobs('dispatch-worker',100,300)),1,
 'canonical claim acquires exactly the owner-released sealed original');
select throws_ok($$select public.complete_system_job(job,'foreign-worker') from dispatch_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','public completion rechecks worker ownership before effects');
update dispatch_ctx set lease_until=(select lease_expires_at from public.system_jobs where id=job);
reset role;
update public.system_jobs set lease_expires_at=clock_timestamp()-interval '1 microsecond' where id=(select job from dispatch_ctx);
set local role service_role;
select throws_ok($$select public.complete_system_job(job,'dispatch-worker') from dispatch_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','public completion uses actual clock and rejects expired fence');
select is((select revision::integer from app_private.funding_engine_state where user_id=(select member_id from dispatch_ctx)),0,
 'failed fence preserves cursor and used state');
reset role;
update public.system_jobs set lease_expires_at=(select lease_until from dispatch_ctx) where id=(select job from dispatch_ctx);
set local role service_role;
select lives_ok($$select public.complete_system_job(job,'dispatch-worker') from dispatch_ctx$$,
 'existing public completion posts from exact original and current attempt');
set constraints all immediate;
set constraints all deferred;
update dispatch_ctx set earned=(select id from app_private.funding_earned_receipts where job_id=job);
select ok((select earned is not null from dispatch_ctx),'public completion accepted an actual earned original');
select is((select status::text from public.system_jobs where id=(select job from dispatch_ctx)),'SUCCEEDED',
 'funding producer completes job atomically');
select is((select status from public.system_job_attempts where job_id=(select job from dispatch_ctx) and attempt_number=1),'SUCCEEDED',
 'funding producer completes matching durable attempt atomically');
select ok((select e.amount_atomic>0 and e.calculation->>'qualifiedRetentionNum'='0'
 from app_private.funding_earned_receipts e join dispatch_ctx c on c.earned=e.id),
 'actual elapsed BASE posts while maintenance stays conditional');
select ok((select sum(case side when 'DEBIT' then amount_atomic else -amount_atomic end)=0 and count(*)=2
 from public.ledger_entries where transaction_id=(select ledger_transaction_id from public.mining_reward_credits
 where funding_earned_receipt_id=(select earned from dispatch_ctx))),
 'public completion creates one balanced canonical reward journal');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from dispatch_ctx)),'COMPLETE',
 'public completion preserves verified source coverage');
select is((select eligible_principal_atomic from public.money_source_summaries where user_id=(select member_id from dispatch_ctx)),
 '1000000000000','funding reward never increases principal');
update dispatch_ctx set original_state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=member_id),
 journal_count=(select count(*) from public.ledger_transactions), wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements);
select lives_ok($$select public.complete_system_job(job,'dispatch-worker') from dispatch_ctx$$,
 'lost completion response replays original without a second effect');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from dispatch_ctx)),
 (select original_state from dispatch_ctx),'public replay preserves exact cursor used and carry');
select is((select count(*) from public.ledger_transactions),(select journal_count from dispatch_ctx),'public replay writes no second journal');
select is((select count(*) from public.wallet_ledger),(select wallet_count from dispatch_ctx),'public replay writes no second wallet projection');
select is((select count(*) from public.money_source_movements),(select source_count from dispatch_ctx),'public replay writes no second source original');
select throws_ok($$select public.complete_system_job(job,'foreign-worker') from dispatch_ctx$$,
 '22023','FUNDING_ACCEPTED_JOB_CONFLICT','accepted completion replay rejects changed worker identity');
update dispatch_ctx set next_job=app_private.prepare_default_funding_job(activation);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select next_job from dispatch_ctx);
set local role service_role;
select id from public.claim_system_jobs('dispatch-worker',100,300);
reset role;
create function pg_temp.reject_dispatch_wallet() returns trigger language plpgsql as $$
begin
 if new.reference_type='mining_reward_credit' then raise exception using errcode='P0001',message='DISPATCH_LATE_WALLET_FAILURE'; end if;
 return new;
end;
$$;
create trigger dispatch_reject_wallet before insert on public.wallet_ledger for each row execute function pg_temp.reject_dispatch_wallet();
set local role service_role;
select throws_ok($$select public.complete_system_job(next_job,'dispatch-worker') from dispatch_ctx$$,
 'P0001','DISPATCH_LATE_WALLET_FAILURE','late canonical failure rolls back public dispatch monetary effect');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from dispatch_ctx)),
 (select original_state from dispatch_ctx),'public posting failure restores cursor used and carry');
select is((select count(*) from public.ledger_transactions),(select journal_count from dispatch_ctx),'public posting failure rolls back preceding journal');
select is((select count(*) from public.wallet_ledger),(select wallet_count from dispatch_ctx),'public posting failure creates no wallet credit');
select is((select count(*) from public.money_source_movements),(select source_count from dispatch_ctx),'public posting failure creates no source original');
select is((select status::text from public.system_jobs where id=(select next_job from dispatch_ctx)),'RUNNING',
 'public posting failure does not falsely complete job');
select is((select status from public.system_job_attempts where job_id=(select next_job from dispatch_ctx) and attempt_number=1),'RUNNING',
 'public posting failure does not falsely complete attempt');
reset role;
drop trigger dispatch_reject_wallet on public.wallet_ledger;
set local role service_role;
select lives_ok($$select public.complete_system_job(next_job,'dispatch-worker') from dispatch_ctx$$,
 'failed dispatch retries same valid attempt after rollback');
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::integer from app_private.funding_earned_receipts),2,
 'two accepted intervals create only two original earnings');
select ok(not exists(select 1 from public.system_jobs where job_type='FUNDING_MINING_TICK_V1'
 and available_at<>'infinity'::timestamptz and id not in(select job from dispatch_ctx union all select next_job from dispatch_ctx)),
 'completion does not schedule the next funding job or release a forged job');
select ok(not exists(select 1 from public.outbox_events where event_type in(
 'FUNDING_ACTIVATED.v1','FUNDING_JOB_PREPARED.v1','FUNDING_EARNED_ACCEPTED.v1') and available_at<>'infinity'::timestamptz),
 'completion does not release economic outbox consumers');
insert into public.system_jobs(job_type,idempotency_key,payload,available_at)
values('NONFUNDING_DISPATCH_REFERENCE','dispatch-generic-original','{}',clock_timestamp());
update dispatch_ctx set generic_job=(select id from public.system_jobs where idempotency_key='dispatch-generic-original');
select id from public.claim_system_jobs('generic-worker',100,300);
select lives_ok($$select public.complete_system_job(generic_job,'generic-worker') from dispatch_ctx$$,
 'existing nonfunding completion retains its behavior');
select is((select status::text from public.system_jobs where id=(select generic_job from dispatch_ctx)),'SUCCEEDED',
 'ordinary job can still complete');
select is((select count(*)::integer from app_private.funding_earned_receipts),2,
 'ordinary completion cannot create funded earnings');
reset role;
select * from finish();
rollback;
