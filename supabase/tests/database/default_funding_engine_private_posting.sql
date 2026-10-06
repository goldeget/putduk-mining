begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Inlined from supabase/test-fixtures/default-funding-allocation-original.sql
-- because the Supabase test runner may mount/pipe only this test file.
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
create temporary table engine_ctx(
 admin_id uuid,member_id uuid,other_id uuid,no_alloc_id uuid,draft_id uuid,label_id uuid,
 allocation uuid,other_allocation uuid,draft_allocation uuid,label_allocation uuid,
 credit uuid,other_credit uuid,no_alloc_credit uuid,draft_credit uuid,label_credit uuid,
 activation uuid,job uuid,earned uuid,second_job uuid,second_earned uuid,third_job uuid,lease_until timestamptz,source_count bigint,ledger_count bigint,
 legacy_wallet_count bigint,legacy_settlement_count bigint
);
insert into engine_ctx(admin_id,member_id,other_id,no_alloc_id,draft_id,label_id) values(
 '10623000-0000-4000-8000-000000000001','10623000-0000-4000-8000-000000000002',
 '10623000-0000-4000-8000-000000000003','10623000-0000-4000-8000-000000000004',
 '10623000-0000-4000-8000-000000000005','10623000-0000-4000-8000-000000000006');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@default-engine.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from engine_ctx cross join lateral unnest(array[admin_id,member_id,other_id,no_alloc_id,draft_id,label_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from engine_ctx;
select public.bootstrap_user(person) from engine_ctx cross join lateral unnest(array[member_id,other_id,no_alloc_id,draft_id,label_id]) person;
update engine_ctx set allocation=pg_temp.plant_default_funding_allocation_original(member_id,admin_id,true),
 other_allocation=pg_temp.plant_default_funding_allocation_original(other_id,admin_id,true),
 draft_allocation=pg_temp.plant_default_funding_allocation_original(draft_id,admin_id,false),
 label_allocation=pg_temp.plant_default_funding_allocation_original(label_id,admin_id,true);
grant select,update on engine_ctx to service_role;
set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(person,'KRW',amount,'engine-principal-request:'||person),
 admin_id,amount,'engine-principal-credit:'||person,'actual local principal confirmation',gen_random_uuid())
from engine_ctx cross join lateral (values(member_id,1000000000000::bigint),(other_id,100000::bigint),
 (no_alloc_id,100000::bigint),(draft_id,100000::bigint),(label_id,100000::bigint)) fixture(person,amount);
reset role;
update engine_ctx set credit=(select id from public.money_source_movements where user_id=member_id and source_bucket='PRINCIPAL'),
 other_credit=(select id from public.money_source_movements where user_id=other_id and source_bucket='PRINCIPAL'),
 no_alloc_credit=(select id from public.money_source_movements where user_id=no_alloc_id and source_bucket='PRINCIPAL'),
 draft_credit=(select id from public.money_source_movements where user_id=draft_id and source_bucket='PRINCIPAL'),
 label_credit=(select id from public.money_source_movements where user_id=label_id and source_bucket='PRINCIPAL');

select ok(not has_table_privilege('service_role','app_private.funding_allocation_originals','INSERT'),
 'missing allocation producer is not disguised as a service writer');
select ok(not has_function_privilege('service_role','pg_temp.plant_default_funding_allocation_original(uuid,uuid,boolean)','EXECUTE'),
 'synthetic allocation/catalog fixture stays postgres-only');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in(
 'app_private.funding_engine_epochs'::regclass,'app_private.funding_allocation_originals'::regclass,
 'app_private.funding_engine_activations'::regclass,'app_private.funding_engine_state_receipts'::regclass,
 'app_private.funding_engine_jobs'::regclass,'app_private.funding_earned_receipts'::regclass,
 'app_private.funding_retention_qualifications'::regclass)),'all new facts force RLS');
select ok(not has_function_privilege('authenticated','app_private.activate_default_funding_engine(uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','app_private.process_default_funding_job(uuid,text,integer)','EXECUTE'),
 'no client activation or monetary producer');
select ok((select bool_and(not prosecdef and proconfig @> array['search_path=pg_catalog']::text[])
 from pg_proc where oid in('app_private.activate_default_funding_engine(uuid,uuid)'::regprocedure,
 'app_private.process_default_funding_job(uuid,text,integer)'::regprocedure)), 'producer is invoker with fixed paths');
select ok(not has_function_privilege('service_role','public.record_mining_settlement(uuid,uuid,timestamp with time zone,timestamp with time zone,bigint,public.currency_code,jsonb,text)','EXECUTE'),
 'caller-amount legacy settlement remains revoked');

set local role service_role;
update engine_ctx set legacy_wallet_count=(select count(*) from public.wallet_ledger),
 legacy_settlement_count=(select count(*) from public.mining_settlements);
select throws_ok($$select public.record_mining_settlement(
 gen_random_uuid(),gen_random_uuid(),clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 second',
 999999::bigint,'KRW'::public.currency_code,'[]'::jsonb,'engine-legacy-caller-amount-denied')$$,
 '42501','permission denied for function record_mining_settlement',
 'actual service invocation is denied before legacy caller-amount code or effects');
select is((select count(*) from public.wallet_ledger),(select legacy_wallet_count from engine_ctx),
 'denied legacy invocation produces no wallet credit');
select is((select count(*) from public.mining_settlements),(select legacy_settlement_count from engine_ctx),
 'denied legacy invocation produces no settlement header');
select throws_ok($$select app_private.activate_default_funding_engine(no_alloc_credit,null) from engine_ctx$$,
 '55000','FUNDING_ALLOCATION_ORIGINAL_REQUIRED','real principal without an allocation original fails');
select throws_ok($$select app_private.activate_default_funding_engine(credit,other_allocation) from engine_ctx$$,
 '55000','FUNDING_ALLOCATION_UNSUPPORTED','another member allocation cannot activate real principal');
select throws_ok($$select app_private.activate_default_funding_engine(draft_credit,draft_allocation) from engine_ctx$$,
 '55000','FUNDING_PUBLISHED_CATALOG_REQUIRED','sealed member assignment cannot make DRAFT catalog authoritative');
update engine_ctx set activation=app_private.activate_default_funding_engine(credit,allocation);
select is((select app_private.activate_default_funding_engine(credit,allocation) from engine_ctx),
 (select activation from engine_ctx),'activation exact retry returns original');
select throws_ok($$select app_private.activate_default_funding_engine(credit,other_allocation) from engine_ctx$$,
 '22023','FUNDING_ACTIVATION_CONFLICT','accepted activation rejects changed original ID');
select is((select a.effective_at from app_private.funding_engine_activations a join engine_ctx c on a.id=c.activation),
 (select effective_at from public.money_source_movements m join engine_ctx c on m.id=c.credit),'first cycle anchor is actual fresh credit instant');
select is((select cycle_ordinal from app_private.funding_cycle_windows w join app_private.funding_engine_activations a on a.first_cycle_id=w.id
 join engine_ctx c on c.activation=a.id),0,'one member global first cycle');
select is((select count(*)::integer from app_private.funding_engine_activations),1,'negative activation cases wrote no facts');
select throws_ok($$insert into app_private.funding_engine_activations(id,user_id,trigger_credit_movement_id,trigger_principal_revision_id,
 allocation_original_id,policy_publication_id,first_cycle_id,principal_atomic,effective_at,input_digest,audit_id,source_event_id)
 select gen_random_uuid(),a.user_id,a.trigger_credit_movement_id,a.trigger_principal_revision_id,a.allocation_original_id,
 gen_random_uuid(),a.first_cycle_id,a.principal_atomic,a.effective_at,a.input_digest,gen_random_uuid(),gen_random_uuid()
 from app_private.funding_engine_activations a join engine_ctx c on c.activation=a.id$$,
 '55000','FUNDING_ACTIVATION_ORIGINAL_MISMATCH','direct service activation cannot substitute policy publication');
update engine_ctx set job=app_private.prepare_default_funding_job(activation);
select is((select app_private.prepare_default_funding_job(activation) from engine_ctx),(select job from engine_ctx),'prepared state has one immutable logical job');
select ok((select j.available_at='infinity'::timestamptz from public.system_jobs j join engine_ctx c on j.id=c.job),
 'foundation never schedules its own prepared job');
select throws_ok($$select app_private.process_default_funding_job(job,'engine-worker',1) from engine_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','unclaimed job cannot post');
select throws_ok($$update public.system_jobs set payload=payload||'{"amount_atomic":"999999"}' where id=(select job from engine_ctx)$$,
 '55000','FUNDING_OPERATIONAL_ORIGINAL_IMMUTABLE','claimed job payload cannot be replaced by a reward amount');
reset role;

-- Owner releases only this rollback fixture job; production preparation remains
-- at infinity. Actual canonical claim supplies the attempt/lease original.
update public.system_jobs set available_at=clock_timestamp() where id=(select job from engine_ctx);
set local role service_role;
select id from public.claim_system_jobs('engine-worker',100,300);
select throws_ok($$select app_private.process_default_funding_job(job,'another-worker',1) from engine_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','wrong worker fails before earned or money writes');
select throws_ok($$select app_private.process_default_funding_job(job,'engine-worker',2) from engine_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','stale attempt fails before earned or money writes');
update engine_ctx set lease_until=(select lease_expires_at from public.system_jobs where id=job);
reset role;
update public.system_jobs set lease_expires_at=clock_timestamp()-interval '1 microsecond' where id=(select job from engine_ctx);
set local role service_role;
select throws_ok($$select app_private.process_default_funding_job(job,'engine-worker',1) from engine_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','actual expired lease cannot post an earned original');
select is((select count(*)::integer from app_private.funding_earned_receipts),0,'expired lease creates no earned original');
reset role;
-- Restore only the owner-controlled negative fixture lease to its actual claim
-- value; no runtime command is granted a lease-revival bypass.
update public.system_jobs set lease_expires_at=(select lease_until from engine_ctx) where id=(select job from engine_ctx);
set local role service_role;
select throws_ok($$insert into app_private.funding_earned_receipts(id,user_id,activation_id,cycle_id,job_id,attempt_number,worker_id,fence_expires_at,
 previous_state_id,next_state_id,settled_from,settled_to,calculation,amount_atomic,input_digest,credit_id,settlement_id,audit_id,source_event_id)
 select gen_random_uuid(),a.user_id,a.id,a.first_cycle_id,c.job,1,'engine-worker',j.lease_expires_at,s.id,gen_random_uuid(),s.cursor_at,
 least(clock_timestamp(),w.cycle_end),'{}',999999,repeat('0',64),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
 from engine_ctx c join app_private.funding_engine_activations a on a.id=c.activation
 join app_private.funding_engine_state s on s.user_id=a.user_id join app_private.funding_cycle_windows w on w.id=a.first_cycle_id
 join public.system_jobs j on j.id=c.job$$,
 '55000','FUNDING_EARNED_CALCULATION_MISMATCH','direct service earned INSERT cannot choose a caller reward amount');
update engine_ctx set earned=app_private.process_default_funding_job(job,'engine-worker',1);
-- Force the actual deferred completeness validators now, not just at rollback.
set constraints all immediate;
set constraints all deferred;
set local time zone 'Asia/Seoul';
select is((select app_private.activate_default_funding_engine(credit,allocation) from engine_ctx),
 (select activation from engine_ctx),'activation seal replay is independent of session TimeZone');
select is((select app_private.process_default_funding_job(job,'engine-worker',1) from engine_ctx),
 (select earned from engine_ctx),'earned seal retry across TimeZone returns original without another credit');
select is((select (app_private.read_default_funding_inputs(credit,allocation)->>'principal_atomic') from engine_ctx),
 '1000000000000','allocation and policy original digest remain valid across TimeZone');
set local time zone 'UTC';
select throws_ok($$select app_private.process_default_funding_job(job,'another-worker',1) from engine_ctx$$,
 '22023','FUNDING_ACCEPTED_JOB_CONFLICT','accepted job rejects changed worker identity');
select is((select count(*)::integer from app_private.funding_earned_receipts),1,'one job produced exactly one earned original');
select ok((select amount_atomic>0 from app_private.funding_earned_receipts where id=(select earned from engine_ctx)),
 'real server interval posts a positive whole reward for the reference high principal');
select is((select calculation->>'qualifiedRetentionNum' from app_private.funding_earned_receipts where id=(select earned from engine_ctx)),
 '0','first live interval cannot spend conditional retention before cycle end');
select is((select count(*)::integer from app_private.funding_retention_qualifications),0,'no premature retention qualification');
select is((select revision::integer from app_private.funding_engine_state where user_id=(select member_id from engine_ctx)),1,
 'accepted original advances monotone state exactly once');
select is((select s.cursor_at from app_private.funding_engine_state s join engine_ctx c on s.user_id=c.member_id),
 (select e.settled_to from app_private.funding_earned_receipts e join engine_ctx c on e.id=c.earned),'cursor is the original accepted endpoint');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from engine_ctx)),'COMPLETE',
 'actual funded mining posting preserves truthful source coverage');
select is((select eligible_principal_atomic from public.money_source_summaries where user_id=(select member_id from engine_ctx)),
 '1000000000000','mining credit never becomes extra principal');
select ok((select app_private.money_source_credit_verified(m) from public.money_source_movements m
 join public.mining_reward_credits credit on credit.ledger_transaction_id=m.ledger_transaction_id
 join engine_ctx c on credit.funding_earned_receipt_id=c.earned),'actual new credit passes existing source validator');
select ok((select sum(case side when 'DEBIT' then amount_atomic else -amount_atomic end)=0 and count(*)=2
 from public.ledger_entries where transaction_id=(select ledger_transaction_id from public.mining_reward_credits
 where funding_earned_receipt_id=(select earned from engine_ctx))),'reward journal is balanced with exactly two entries');
select is((select count(*)::integer from public.mining_settlements where funding_earned_receipt_id=(select earned from engine_ctx)),1,
 'canonical settlement binds the earned original');
select ok((select mining_session_id is null from public.mining_settlements where funding_earned_receipt_id=(select earned from engine_ctx)),
 'funded reporting does not fabricate a legacy mining session');
select ok((select rule_version_id is null from public.mining_settlement_segments where funding_earned_receipt_id=(select earned from engine_ctx)),
 'funded reporting does not fabricate a legacy world rule');
select is((select status::text from public.system_jobs where id=(select job from engine_ctx)),'SUCCEEDED','earned effects and job success commit together');
select is((select status from public.system_job_attempts where job_id=(select job from engine_ctx) and attempt_number=1),'SUCCEEDED',
 'same attempt completes with the monetary effect');
select throws_ok($$update public.system_jobs set status='RUNNING',completed_at=null where id=(select job from engine_ctx)$$,
 '55000','FUNDING_ACCEPTED_COMPLETION_IMMUTABLE','accepted job completion cannot be reopened after its original is consumed');
select throws_ok($$update public.system_job_attempts set status='RUNNING',completed_at=null where job_id=(select job from engine_ctx) and attempt_number=1$$,
 '55000','FUNDING_ACCEPTED_COMPLETION_IMMUTABLE','accepted successful attempt remains a durable completion proof');
select throws_ok($$update public.outbox_events set payload='{}' where id=(select source_event_id from app_private.funding_earned_receipts where id=(select earned from engine_ctx))$$,
 '55000','FUNDING_OPERATIONAL_ORIGINAL_IMMUTABLE','earned original event payload cannot mutate');
select throws_ok($$insert into public.mining_reward_credits(user_id,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at)
 select user_id,amount_atomic,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),effective_at from public.mining_reward_credits
 where funding_earned_receipt_id=(select earned from engine_ctx)$$,
 '42501','FUNDING_EARNED_ORIGINAL_REQUIRED','service cannot use new INSERT privilege for an unearned legacy credit');
select throws_ok($$insert into public.mining_reward_credits(user_id,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at,funding_earned_receipt_id)
 select user_id,amount_atomic+1,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),effective_at,funding_earned_receipt_id
 from public.mining_reward_credits where funding_earned_receipt_id=(select earned from engine_ctx)$$,
 '55000','FUNDING_CANONICAL_POST_MISMATCH','caller cannot inflate a canonical credit from an earned original');
reset role;

-- Unknown wallet label is deliberately NOT a money source. Actual new deposit
-- for this member was valid, but its added unclassified history blocks activation.
insert into public.wallet_ledger(wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type)
select id,user_id,'CREDIT','MINING_REWARD',1,'engine-unclassified-label','owner-only-unclassified-negative-fixture'
from public.wallet_accounts where user_id=(select label_id from engine_ctx) and currency='KRW';
set local role service_role;
select throws_ok($$select app_private.activate_default_funding_engine(label_credit,label_allocation) from engine_ctx$$,
 '55000','FUNDING_SOURCE_HISTORY_UNSUPPORTED','real original with unknown wallet history fails closed');
update engine_ctx set second_job=app_private.prepare_default_funding_job(activation);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select second_job from engine_ctx);
set local role service_role;
select id from public.claim_system_jobs('engine-worker',100,300);
reset role;
update engine_ctx set source_count=(select count(*) from public.money_source_movements),ledger_count=(select count(*) from public.ledger_transactions);
-- A late actual wallet write fault must roll back earned, state, journal and all
-- subsequent source/event/audit/job changes inside the real producer invocation.
create function pg_temp.reject_funded_wallet_fixture() returns trigger language plpgsql as $$
begin
 if new.reference_type='mining_reward_credit' then raise exception using errcode='P0001',message='OWNER_FIXTURE_LATE_WALLET_FAILURE'; end if;
 return new;
end;
$$;
revoke all on function pg_temp.reject_funded_wallet_fixture() from public,anon,authenticated,service_role;
create trigger engine_fixture_reject_wallet before insert on public.wallet_ledger for each row execute function pg_temp.reject_funded_wallet_fixture();
set local role service_role;
select throws_ok($$select app_private.process_default_funding_job(second_job,'engine-worker',1) from engine_ctx$$,
 'P0001','OWNER_FIXTURE_LATE_WALLET_FAILURE','late canonical posting error rolls back the actual producer');
select is((select count(*) from public.money_source_movements),(select source_count from engine_ctx),'failed producer adds no source movement');
select is((select count(*) from public.ledger_transactions),(select ledger_count from engine_ctx),'failed producer rolls back the preceding journal');
select is((select count(*)::integer from app_private.funding_earned_receipts),1,'failed producer adds no earned original');
select is((select revision::integer from app_private.funding_engine_state where user_id=(select member_id from engine_ctx)),1,'failed producer preserves cursor/used/carry state');
select is((select status::text from public.system_jobs where id=(select second_job from engine_ctx)),'RUNNING','failed producer does not complete the job');
reset role;
drop trigger engine_fixture_reject_wallet on public.wallet_ledger;
-- Negative service path: deliberately sabotage only the job-success projection
-- after the actual producer posts. Deferred verification must reject and roll
-- back the otherwise valid earned/state/credit, not leave money with RUNNING job.
create function pg_temp.sabotage_funding_job_completion_fixture() returns trigger language plpgsql as $$
begin
 if new.id=(select second_job from engine_ctx) and new.status='SUCCEEDED' then
   new.status:='RUNNING'; new.completed_at:=null;
 end if;
 return new;
end;
$$;
revoke all on function pg_temp.sabotage_funding_job_completion_fixture() from public,anon,authenticated,service_role;
create trigger engine_fixture_sabotage_completion before update on public.system_jobs
for each row execute function pg_temp.sabotage_funding_job_completion_fixture();
create function pg_temp.force_funding_completion_check_fixture(p_job uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform app_private.process_default_funding_job(p_job,'engine-worker',1);
 set constraints all immediate;
end;
$$;
revoke all on function pg_temp.force_funding_completion_check_fixture(uuid) from public,anon,authenticated;
grant execute on function pg_temp.force_funding_completion_check_fixture(uuid) to service_role;
set local role service_role;
select throws_ok($$select pg_temp.force_funding_completion_check_fixture(second_job) from engine_ctx$$,
 '55000','FUNDING_ACCEPTED_JOB_COMPLETION_MISSING','deferred proof rejects a valid posting whose job success is absent');
select is((select count(*)::integer from app_private.funding_earned_receipts),1,'missing completion rolls back earned original and monetary effects');
select is((select count(*) from public.ledger_transactions),(select ledger_count from engine_ctx),'missing completion rolls back the posted journal');
select is((select status::text from public.system_jobs where id=(select second_job from engine_ctx)),'RUNNING','missing completion preserves the original live job');
reset role;
drop trigger engine_fixture_sabotage_completion on public.system_jobs;
set local role service_role;
update engine_ctx set second_earned=app_private.process_default_funding_job(second_job,'engine-worker',1);
set constraints all immediate;
set constraints all deferred;
select is((select revision::integer from app_private.funding_engine_state where user_id=(select member_id from engine_ctx)),2,'same valid fenced job succeeds after rollback recovery');
select ok((select first.settled_to=second.settled_from from app_private.funding_earned_receipts first
 join app_private.funding_earned_receipts second on first.next_state_id=second.previous_state_id
 join engine_ctx c on first.id=c.earned and second.id=c.second_earned),'successive accepted intervals are gapless and nonoverlapping');
select is((select count(*)::integer from public.mining_reward_credits where user_id=(select member_id from engine_ctx)),2,'two accepted positive intervals produce only two credits');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from engine_ctx)),'COMPLETE','recovery preserves full verified coverage');
-- An actual new principal credit after accepted accrual is an input transition,
-- not permission for this bounded first implementation to extend stale inputs.
update engine_ctx set third_job=app_private.prepare_default_funding_job(activation);
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',100000,'engine-later-request'),
 admin_id,100000,'engine-later-credit','actual unsupported principal transition probe',gen_random_uuid()) from engine_ctx;
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select third_job from engine_ctx);
set local role service_role;
select id from public.claim_system_jobs('engine-worker',100,300);
select throws_ok($$select app_private.process_default_funding_job(third_job,'engine-worker',1) from engine_ctx$$,
 '55000','FUNDING_PRINCIPAL_CHANGES_UNSUPPORTED','actual later credit cannot accrue against the old principal original');
select is((select count(*)::integer from app_private.funding_earned_receipts),2,'unsupported transition produces no additional earned original');
reset role;
select ok(not exists(select 1 from public.system_jobs where job_type='FUNDING_MINING_TICK_V1' and available_at<>'infinity'::timestamptz
 and id not in(select job from engine_ctx union all select second_job from engine_ctx union all select third_job from engine_ctx)), 'only owner-released rollback fixture jobs were made due');
select ok(not exists(select 1 from public.outbox_events where event_type in('FUNDING_ACTIVATED.v1','FUNDING_JOB_PREPARED.v1','FUNDING_EARNED_ACCEPTED.v1')
 and available_at<>'infinity'::timestamptz),'foundation does not release engine events to runtime consumers');
-- New economic immutability guards preserve allowed owner DELETE behavior for
-- unrelated rows; they must not silently cancel every unbound DELETE.
insert into public.system_jobs(job_type,idempotency_key,payload,available_at)
values('ENGINE_UNBOUND_TEST','engine-unbound-delete-job','{}','infinity');
with removed as(delete from public.system_jobs where idempotency_key='engine-unbound-delete-job' returning id)
select is(count(*)::integer,1,'unbound job owner DELETE is not silently suppressed') from removed;
insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,payload,correlation_id,request_id,idempotency_key,available_at)
values('ENGINE_UNBOUND_TEST.v1',1,'engine_unbound_test',gen_random_uuid(),'{}',gen_random_uuid(),gen_random_uuid(),'engine-unbound-delete-event','infinity');
with removed as(delete from public.outbox_events where idempotency_key='engine-unbound-delete-event' returning id)
select is(count(*)::integer,1,'unbound outbox owner DELETE is not silently suppressed') from removed;
select * from finish();
rollback;
