begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Exact SQL/reference vectors: no monetary amount enters a command argument.
select is(app_private.funding_exact_condition_interval(100000,1500,1500,0,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'baseNum','0','ZERO allocation has no BASE before selection');
select is(app_private.funding_exact_condition_interval(100000,1500,1500,0,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'conditionalRetentionNum','1273','ZERO allocation preserves exact principal maintenance numerator');
select is(app_private.funding_exact_condition_interval(100000,1500,1500,0,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'conditionalRetentionDen','100','ZERO maintenance remains 12.73 conditional KRW');
select is(app_private.funding_exact_condition_interval(100000,1500,1500,5000,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'baseNum','1273','partial allocation gives exact 1273/200 BASE');
select is(app_private.funding_exact_condition_interval(100000,1500,1500,5000,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'carryDen','200','partial allocation does not discard 73/200 carry');
select is(app_private.funding_exact_condition_interval(100000,1500,1500,0,2592000000000,2199744000,
 0,1,0,1,0,1,false)->>'amountAtomic','0','unqualified maintenance is never wallet money');
select throws_ok($$select app_private.funding_exact_condition_interval(100000,1500,1500,10001,2592000000000,1,
 0,1,0,1,0,1,false)$$,'22023','FUNDING_DEFAULT_INTERVAL_INVALID','allocation cannot exceed approved global100%');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='app_private.funding_condition_originals'::regclass),
 'prospective condition authority forces RLS');
select ok(not has_table_privilege('service_role','app_private.funding_condition_originals','INSERT')
 and not has_table_privilege('authenticated','app_private.funding_condition_originals','SELECT'),
 'private foreground conditions cannot be planted by member or service');
select ok(not has_function_privilege('authenticated','app_private.apply_funding_allocation_boundary(uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.apply_funding_allocation_boundary(uuid)','EXECUTE'),
 'only canonical hardened member writer can reach private foreground seam');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[] from pg_proc
 where oid='app_private.apply_funding_allocation_boundary(uuid)'::regprocedure),'private seam is fixed-path invoker');

select ok((select prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=pg_catalog']::text[]
 from pg_proc where oid='app_private.verify_funding_integrity_at_commit()'::regprocedure)
 and not has_function_privilege('authenticated','app_private.verify_funding_integrity_at_commit()','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_funding_integrity_at_commit()','EXECUTE')
 and not has_table_privilege('authenticated','app_private.funding_condition_originals','SELECT'),
 'closed owner integrity trigger does not restore callable private reads or relation grants');

select ok((select prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=pg_catalog']::text[]
 from pg_proc where oid='app_private.verify_balanced_ledger_at_commit()'::regprocedure)
 and not has_function_privilege('authenticated','app_private.verify_balanced_ledger_at_commit()','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_balanced_ledger_at_commit()','EXECUTE')
 and not has_table_privilege('authenticated','public.ledger_entries','SELECT')
 and not has_table_privilege('authenticated','public.ledger_accounts','SELECT'),
 'closed ledger commit executor restores no callable function or raw ledger reads');

create temporary table prospective_ctx(
 admin_id uuid, member_id uuid, other_id uuid, session_id uuid, catalog uuid, product uuid, draft_catalog uuid,
 publish_at timestamptz, review jsonb, publication jsonb, first jsonb, second jsonb, cleared jsonb,
 activation uuid, cycle uuid, before_state jsonb, journal_count bigint, wallet_count bigint, source_count bigint,
 earned_count bigint, condition_count bigint, first_credit_at timestamptz
);
insert into prospective_ctx(admin_id,member_id,other_id,session_id,catalog,product,draft_catalog,publish_at) values(
 '10626100-0000-4000-8000-000000000001','10626100-0000-4000-8000-000000000002',
 '10626100-0000-4000-8000-000000000003','10626100-0000-4000-8000-000000000004',
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),clock_timestamp()+interval '1 second');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@funding-prospective.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from prospective_ctx cross join lateral unnest(array[admin_id,member_id,other_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from prospective_ctx;
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
select session_id,admin_id,'prospective-auth-session','prospective-fingerprint',
 clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours' from prospective_ctx;
select public.bootstrap_user(member_id) from prospective_ctx;
select public.bootstrap_user(other_id) from prospective_ctx;

-- Only DRAFT source content is a clearly local fixture. Publication and neutral
-- rule/availability originals below come from the actual operator command with
-- real step-up consumption, receipts/audit/event. This is not a live catalog claim.
insert into public.product_catalog_versions(id,version,status,snapshot_date,methodology,source_references,content_digest,proposed_by)
select catalog,(select max(version)+1 from public.product_catalog_versions),'DRAFT',current_date,
 'Local prospective engine regression source','[{"name":"Local test reference","url":"https://putduk.test/prospective-reference"}]',
 app_private.funding_engine_digest(jsonb_build_object('test_catalog',catalog)),'LOCAL_TEST_SOURCE_ONLY' from prospective_ctx;
insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
select product,catalog,(select id from public.asset_worlds order by id limit 1),'PROSPECTIVE_REF','prospective-ref','GOLD',
 '로컬 시험 상품','Local test product','실제 운영 상품이 아닌 로컬 검증 자료',1 from prospective_ctx;
insert into public.product_catalog_versions(id,version,status,snapshot_date,methodology,source_references,content_digest,proposed_by)
select draft_catalog,(select max(version)+1 from public.product_catalog_versions),'DRAFT',current_date,'Unpublished local negative fixture',
 '[{"name":"Local test reference","url":"https://putduk.test/unpublished"}]',
 app_private.funding_engine_digest(jsonb_build_object('test_catalog',draft_catalog)),'LOCAL_TEST_SOURCE_ONLY' from prospective_ctx;
create function pg_temp.prospective_catalog_command(p_operation text,p_key text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare context record; token text:='prospective-catalog-proof:'||p_key; result jsonb;
begin
 select * into context from pg_temp.prospective_ctx;
 perform public.issue_admin_step_up(context.session_id,context.admin_id,'PRODUCT_CATALOG',token,600);
 result:=public.manage_product_catalog(p_operation,context.catalog,(context.review->>'revisionId')::uuid,
  coalesce(context.review->>'snapshotDigest',(public.read_product_catalog_review_state(context.catalog,context.admin_id,
    context.session_id,'prospective-auth-session','aal2')->'selected'->>'sourceDigest')),
  context.publish_at,context.admin_id,context.session_id,'prospective-auth-session','aal2',token,
  'Reviewed local prospective reference operation',p_key);
 return result;
end;
$$;
do $$begin execute format('grant usage on schema %I to service_role,authenticated',
 (select nspname from pg_namespace where oid=pg_my_temp_schema())); end$$;
grant select,update on prospective_ctx to service_role,authenticated;
grant execute on function pg_temp.prospective_catalog_command(text,text) to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update prospective_ctx set review=pg_temp.prospective_catalog_command('PREVIEW','prospective-preview');
update prospective_ctx set review=pg_temp.prospective_catalog_command('APPROVE','prospective-approve');
update prospective_ctx set publication=pg_temp.prospective_catalog_command('PUBLISH','prospective-publish');
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',1000000000000,'prospective-real-deposit'),
 admin_id,1000000000000,'prospective-real-credit','actual local approved principal',gen_random_uuid()) from prospective_ctx;
select lives_ok($$set constraints all immediate$$,'actual service deposit and catalog facts commit after canonical definers return');
set constraints all deferred;
reset role;
-- Actual scheduled catalog publication uses DB time. This short wait never
-- backdates a receipt; no test-only runtime clock is available to this producer.
select pg_sleep(greatest(0,extract(epoch from((select publish_at from prospective_ctx)-clock_timestamp())))+0.001);
set constraints all immediate;
set constraints all deferred;
select lives_ok($$select app_private.assert_published_product_catalog(catalog) from prospective_ctx$$,
 'actual operator lifecycle produced independently sealed neutral catalog');
update prospective_ctx set first_credit_at=(select effective_at from public.money_source_movements where user_id=member_id and source_bucket='PRINCIPAL');

-- Actual paid default source cutover. DRAFT test reference content is synthetic;
-- catalog publication, policy chain, deposits, allocation and earned posting use
-- actual canonical commands/receipts. No reward/clock/assignment is fabricated.
create temporary table credit_ctx(request_id uuid,other_request uuid,source_id uuid,boundary uuid,completion uuid,
 activation uuid,anchor timestamptz,cycle_end timestamptz,previous_state uuid,state jsonb,allocation jsonb,
 caps jsonb,earned uuid,job uuid,wallet_count bigint,journal_count bigint,source_count bigint,earned_count bigint,
 completion_count bigint,display jsonb,usdt_id uuid);
insert into credit_ctx(request_id,activation,anchor,cycle_end)
 select d.id,a.id,a.effective_at,w.cycle_end from prospective_ctx c join public.deposit_requests d on d.user_id=c.member_id
 join app_private.funding_engine_activations a on a.user_id=c.member_id
 join app_private.funding_cycle_windows w on w.id=a.first_cycle_id;
grant select,update on credit_ctx to service_role,authenticated;
select ok((select activation is not null from credit_ctx),'canonical actual service credit created a sealed runtime activation');
select is((select input_original->>'input_contract_version' from app_private.funding_engine_activations where id=(select activation from credit_ctx)),
 '2','activation derives verified aggregate original contract2');
select is((select effective_at from app_private.funding_engine_activations where id=(select activation from credit_ctx)),
 (select reviewed_at from public.deposit_requests where id=(select request_id from credit_ctx)),'first real activation uses the locked actual credit clock');
select is((select inputs->>'allocation_bps' from app_private.funding_condition_originals where user_id=(select member_id from prospective_ctx)),
 '0','actual funded activation starts ZERO without a fabricated product assignment');
select is((select count(*) from app_private.funding_allocation_originals where user_id=(select member_id from prospective_ctx)),
 0::bigint,'activation inserts no allocation original');
select ok((select c.runtime_outcome='ACCEPTED' and c.reason_code is null from app_private.funding_credit_boundary_completions c
 join app_private.funding_credit_boundary_preparations b on b.id=c.boundary_id where b.command_original_id=(select request_id from credit_ctx)),
 'actual financial/source/condition/state originals share accepted completion');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in(
 'app_private.funding_credit_boundary_preparations'::regclass,'app_private.funding_credit_boundary_completions'::regclass,
 'app_private.funding_effective_capacity_receipts'::regclass)),'new private originals force RLS');
select ok(not has_table_privilege('service_role','app_private.funding_credit_boundary_completions','INSERT')
 and not has_table_privilege('authenticated','app_private.funding_effective_capacity_receipts','SELECT'),
 'service cannot plant completion/capacity originals and members cannot read private inputs');
select ok((select bool_and(prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=pg_catalog']::text[])
 from pg_proc where oid in('app_private.begin_funding_credit_boundary(uuid,text)'::regprocedure,
 'app_private.finish_funding_credit_boundary(uuid)'::regprocedure,'app_private.carry_forward_funding_capacity(uuid,uuid,uuid)'::regprocedure,
 'app_private.verify_credit_boundary_commit()'::regprocedure)),'four closed executors have exact owner and fixed paths');
select ok(not has_function_privilege('authenticated','app_private.begin_funding_credit_boundary(uuid,text)','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_credit_boundary_commit()','EXECUTE'),
 'private original preparation is not a member monetary command or callable integrity trigger');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update credit_ctx set other_request=public.create_deposit_request((select other_id from prospective_ctx),'KRW',50000,'credit-below-minimum-request');
select public.approve_deposit_request(other_request,(select admin_id from prospective_ctx),50000,
 'credit-below-minimum-approve','actual below minimum deposit approval',gen_random_uuid()) from credit_ctx;
select lives_ok($$set constraints all immediate$$,'actual below-minimum financial source commits as real service');
set constraints all deferred;
select is((select runtime_outcome from app_private.funding_credit_boundary_completions c
 join app_private.funding_credit_boundary_preparations b on b.id=c.boundary_id where b.command_original_id=(select other_request from credit_ctx)),
 'INACTIVE','below minimum deposits remain financially credited with inactive runtime');
select is((select count(*) from app_private.funding_engine_activations where user_id=(select other_id from prospective_ctx)),
 0::bigint,'below minimum creates no premature anchor');
update credit_ctx set other_request=public.create_deposit_request((select other_id from prospective_ctx),'KRW',50000,'credit-cross-minimum-request');
select public.approve_deposit_request(other_request,(select admin_id from prospective_ctx),50000,
 'credit-cross-minimum-approve','actual minimum crossing deposit approval',gen_random_uuid()) from credit_ctx;
select lives_ok($$set constraints all immediate$$,'actual aggregate minimum-crossing source and ZERO activation commit');
set constraints all deferred;
select is((select principal_atomic from app_private.funding_engine_activations where user_id=(select other_id from prospective_ctx)),
 100000::bigint,'two genuine50k credits derive100k activation principal');
select is((select a.effective_at from app_private.funding_engine_activations a where user_id=(select other_id from prospective_ctx)),
 (select reviewed_at from public.deposit_requests where id=(select other_request from credit_ctx)),
 'minimum crossing anchor is the second receipt instant, not the first deposit or caller time');
select is((select count(*) from app_private.funding_portion_clock_state where user_id=(select other_id from prospective_ctx)),
 2::bigint,'minimum crossing initializes both genuine independent lot clocks');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
update credit_ctx set allocation=public.confirm_funding_allocation('CONFIRM',(select catalog from prospective_ctx),
 (select publication->>'snapshotDigest' from prospective_ctx),0,
 jsonb_build_array(jsonb_build_object('productId',(select product from prospective_ctx),'allocationBps','5000')),'credit-actual-half-allocation');
select lives_ok($$set constraints all immediate$$,'actual authenticated first allocation after credit commits under member context');
set constraints all deferred;
select throws_ok($$select app_private.begin_funding_credit_boundary(request_id,'KRW_DEPOSIT') from credit_ctx$$,
 '42501',null,'member cannot use a private deposit cutover to mint caller-supplied mining');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update credit_ctx set previous_state=(select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx));
update credit_ctx set request_id=public.create_deposit_request((select member_id from prospective_ctx),'KRW',100000,'credit-additional-request');
select public.approve_deposit_request(request_id,(select admin_id from prospective_ctx),100000,
 'credit-additional-approve','actual subsequent paid principal approval',gen_random_uuid()) from credit_ctx;
select lives_ok($$set constraints all immediate$$,'actual additional deposit and old-interval mining post commit as real service');
set constraints all deferred;
update credit_ctx set boundary=(select id from app_private.funding_credit_boundary_preparations where command_original_id=request_id);
update credit_ctx set earned=(select id from app_private.funding_earned_receipts where cause_credit_boundary_id=boundary);
select ok((select amount_atomic>0 and calculation->>'qualifiedRetentionNum'='0' from app_private.funding_earned_receipts where id=(select earned from credit_ctx)),
 'actual elapsed old BASE posts whole KRW while independent maintenance remains conditional');
select is((select principal_atomic from app_private.funding_engine_activations where id=(select activation from credit_ctx)),
 1000000000000::bigint,'immutable first activation snapshot is not rewritten by later deposit');
select is((select c.inputs->>'principal_atomic' from app_private.funding_engine_state s join app_private.funding_condition_originals c
 on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 '1000000100000','new condition derives both actual verified principal originals');
select is((select cycle_started_at from app_private.funding_cycle_windows where id=(select cycle_id from app_private.funding_engine_state
 where user_id=(select member_id from prospective_ctx))),(select anchor from credit_ctx),'new credit does not reset anchor');
select is((select w.cycle_end from app_private.funding_cycle_windows w join app_private.funding_engine_state s on s.cycle_id=w.id
 where s.user_id=(select member_id from prospective_ctx)),(select cycle_end from credit_ctx),'new credit does not extend current cycle');
select ok((select c.allocation_original_id is null and c.current_allocation_original_id=(select(allocation->>'allocationId')::uuid from credit_ctx)
 and c.cause_credit_boundary_id=(select boundary from credit_ctx) from app_private.funding_engine_state s
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 'credit cause and still-confirmed allocation are distinct immutable references');
select ok((select n.base_capacity_num*n.base_capacity_den>0 and n.base_capacity_num/n.base_capacity_den
 <(c.inputs->>'principal_atomic')::numeric*(c.inputs->>'base_bps')::numeric/10000
 from app_private.funding_effective_capacity_receipts n join app_private.funding_engine_state s on s.id=n.state_id
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 'late credit capacity is forward remaining-window delta, not a whole-cycle top-up');
select is((select s.carry_num::text||'/'||s.carry_den::text from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select (calculation->>'carryNum')||'/'||(calculation->>'carryDen') from app_private.funding_earned_receipts where id=(select earned from credit_ctx)),
 'accepted credit boundary preserves exact old interval carry');
select is((select count(*) from app_private.funding_portion_clock_state where user_id=(select member_id from prospective_ctx)),
 2::bigint,'additional credit introduces only its genuine independent portion clock');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','actual principal plus mining journals/source remain completely classified');
update credit_ctx set display=public.read_own_mining_server_display((select member_id from prospective_ctx)),
 source_count=(select count(*) from public.money_source_movements),wallet_count=(select count(*) from public.wallet_ledger),
 state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx));
select is((select display->>'eligible_principal_micro_krw' from credit_ctx),'1000000100000000000','server DTO reflects accepted current principal, not stale activation amount');
select is((select display#>>'{funded_runtime,status}' from credit_ctx),'ACTIVE','verified current allocation proves active accrual without a legacy session');
select is((select display#>'{funded_runtime,speed,effective_global_multiplier}' from credit_ctx),
 '{"numerator":"1","denominator":"2"}'::jsonb,'actual current-source reader keeps half allocation exact and intrinsic speed neutral');
set local time zone 'Asia/Seoul';
select lives_ok($$select public.approve_deposit_request(request_id,(select admin_id from prospective_ctx),100000,
 'credit-additional-approve','actual subsequent paid principal approval',gen_random_uuid()) from credit_ctx$$,
 'actual same-key deposit replay works under a different TimeZone');
set local time zone 'UTC';
select is((select count(*) from public.money_source_movements),(select source_count from credit_ctx),'deposit replay creates no principal or mining source');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from credit_ctx),'deposit replay preserves exact accepted cursor/used/carry');
select throws_ok($$select public.approve_deposit_request(request_id,(select admin_id from prospective_ctx),100001,
 'credit-additional-approve','actual subsequent paid principal approval',gen_random_uuid()) from credit_ctx$$,
 '22023','IDEMPOTENCY_PAYLOAD_MISMATCH','different amount with same financial key cannot create new engine effects');
select throws_ok($$delete from app_private.idempotency_keys where scope='deposit.approve' and idempotency_key='credit-additional-approve'$$,
 '42501','permission denied for table idempotency_keys','actual service cannot DELETE completed financial keys by existing ACL');
reset role;
-- Trusted postgres fixture proves the immutable-original trigger separately;
-- production service keeps its narrower DELETE denial and receives no grant.
select throws_ok($$delete from app_private.idempotency_keys where scope='deposit.approve' and idempotency_key='credit-additional-approve'$$,
 '55000','FUNDING_CREDIT_COMMAND_COMPLETION_IMMUTABLE','trusted owner deletion of a bound completed financial receipt is rejected');
set local role service_role;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
update credit_ctx set allocation=public.confirm_funding_allocation('CONFIRM',(select catalog from prospective_ctx),
 (select publication->>'snapshotDigest' from prospective_ctx),1,'[]','credit-after-clear');
select lives_ok($$set constraints all immediate$$,'actual clear after credit boundary commits despite independent condition revision');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,stop_reason}'),
 'NO_ACTIVE_ALLOCATION','actual clear stops BASE while preserving independent conditional maintenance');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
update credit_ctx set allocation=public.confirm_funding_allocation('CONFIRM',(select catalog from prospective_ctx),
 (select publication->>'snapshotDigest' from prospective_ctx),2,
 jsonb_build_array(jsonb_build_object('productId',(select product from prospective_ctx),'allocationBps','5000')),'credit-after-resume');
select lives_ok($$set constraints all immediate$$,'actual selection resumes prospectively after credit and clear, with no anchor reset');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update credit_ctx set job=app_private.prepare_default_funding_job(activation);
select lives_ok($$set constraints all immediate$$,'actual service preparation commits current-source job originals');
set constraints all deferred;
select ok((select available_at='infinity'::timestamptz from public.system_jobs where id=(select job from credit_ctx)),
 'current-source worker connection does not enable automatic jobs');
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from credit_ctx);
set local role service_role;
select id from public.claim_system_jobs('credit-current-worker',100,300);
select throws_ok($$select public.complete_system_job(job,'foreign-credit-worker') from credit_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','current-source completion still enforces real worker fence');
select lives_ok($$select public.complete_system_job(job,'credit-current-worker') from credit_ctx$$,
 'actual canonical worker completes current aggregate principal using forward capacity');
select lives_ok($$set constraints all immediate$$,'actual worker durable success and capacity/source receipts commit as service');
set constraints all deferred;
select ok((select j.status='SUCCEEDED' and s.base_capacity_num is not null from public.system_jobs j
 join app_private.funding_earned_receipts e on e.job_id=j.id
 join app_private.funding_effective_capacity_receipts s on s.state_id=e.next_state_id where j.id=(select job from credit_ctx)),
 'actual worker success preserves exact effective capacity alongside the accepted state');
reset role;

-- Late financial projection fault occurs after old interval earning/posting.
-- All originals and money must roll back together; no fake completed receipt.
create function pg_temp.credit_deposit_wallet_fault() returns trigger language plpgsql as $$
begin if new.entry_type='DEPOSIT' then raise exception using errcode='P0001',message='CREDIT_LATE_DEPOSIT_FAULT'; end if; return new; end;
$$;
create trigger credit_deposit_wallet_fault before insert on public.wallet_ledger for each row execute function pg_temp.credit_deposit_wallet_fault();
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update credit_ctx set request_id=public.create_deposit_request((select member_id from prospective_ctx),'KRW',1,'credit-rollback-request'),
 state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),earned_count=(select count(*) from app_private.funding_earned_receipts),
 completion_count=(select count(*) from app_private.funding_credit_boundary_completions);
select throws_ok($$select public.approve_deposit_request(request_id,(select admin_id from prospective_ctx),1,
 'credit-rollback-approve','actual rollback-only deposit fault',gen_random_uuid()) from credit_ctx$$,
 'P0001','CREDIT_LATE_DEPOSIT_FAULT','late deposit failure rolls back earlier mining and later financial effects atomically');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from credit_ctx),'late failure preserves accepted state/used/carry/condition');
select is((select count(*) from public.ledger_transactions),(select journal_count from credit_ctx),'late failure rolls back mining and deposit journals');
select is((select count(*) from public.wallet_ledger),(select wallet_count from credit_ctx),'late failure rolls back every wallet projection');
select is((select count(*) from public.money_source_movements),(select source_count from credit_ctx),'late failure rolls back every principal/mining source');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count from credit_ctx),'late failure rolls back earned original');
select is((select count(*) from app_private.funding_credit_boundary_completions),(select completion_count from credit_ctx),'late failure leaves no false boundary completion');
reset role;
drop trigger credit_deposit_wallet_fault on public.wallet_ledger;

-- Exact original-key local sabotage suppresses only the completion INSERT.
-- Forcing constraints AFTER the real canonical call returns must reject the
-- entire transaction, proving financial success cannot outrun engine proof.
create function pg_temp.credit_completion_sabotage() returns trigger language plpgsql as $$
begin
 if new.boundary_id=(select b.id from app_private.funding_credit_boundary_preparations b
  where b.command_original_id=(select request_id from pg_temp.credit_ctx)) then return null; end if;
 return new;
end;
$$;
create trigger credit_completion_sabotage before insert on app_private.funding_credit_boundary_completions
 for each row execute function pg_temp.credit_completion_sabotage();
create function pg_temp.approve_credit_with_actual_commit() returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform public.approve_deposit_request((select request_id from pg_temp.credit_ctx),
 (select admin_id from pg_temp.prospective_ctx),1,'credit-completion-sabotage-key',
 'actual missing completion integrity fault',gen_random_uuid());
 set constraints all immediate;
end;
$$;
grant execute on function pg_temp.approve_credit_with_actual_commit() to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select pg_temp.approve_credit_with_actual_commit()$$,
 '55000','FUNDING_CREDIT_BOUNDARY_COMPLETION_MISSING','actual service commit rejects a suppressed completion original');
select is((select count(*) from public.money_source_movements),(select source_count from credit_ctx),
 'missing completion rolls back principal and mining source together');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from credit_ctx),'missing completion leaves previous immutable accepted state unchanged');
reset role;
drop trigger credit_completion_sabotage on app_private.funding_credit_boundary_completions;

-- Qualified converted USDT principal uses the same source cutover, never an
-- invented user USDT wallet. Only operator-received KRW is the old command input.
insert into public.usdt_manual_deposits(user_id,network,tx_hash,sent_usdt_amount,deposit_address_snapshot,network_snapshot,idempotency_key)
select member_id,'TRC20','credit-source-usdt-fixture',1,'LOCAL_TEST_ADDRESS_ONLY','TRC20','credit-usdt-submission-fixture' from prospective_ctx;
update credit_ctx set usdt_id=(select id from public.usdt_manual_deposits where idempotency_key='credit-usdt-submission-fixture');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.confirm_usdt_manual_deposit(usdt_id,1000,(select admin_id from prospective_ctx),
 'actual converted local USDT principal receipt','credit-usdt-confirmation') from credit_ctx$$,
 'actual canonical USDT-to-KRW confirmation applies exact current-source boundary');
select lives_ok($$set constraints all immediate$$,'actual converted USDT source/engine commits after closed executor returns');
set constraints all deferred;
select is((select runtime_outcome from app_private.funding_credit_boundary_completions c
 join app_private.funding_credit_boundary_preparations b on b.id=c.boundary_id where b.command_original_id=(select usdt_id from credit_ctx)),
 'ACCEPTED','USDT conversion original is classified and accepted without double credit');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','actual mixed KRW/converted-USDT plus mining source stays complete');

-- Actual canonical control command and lazy first-cycle monetary integration.
create temporary table global_ctx(pause_audit uuid,resume_audit uuid,pause_at timestamptz,resume_at timestamptz,
 before_state jsonb,before_caps jsonb,before_control jsonb,job uuid,earned uuid,original_count bigint,
 source_count bigint,wallet_count bigint,journal_count bigint,evaluated_at timestamptz,calculation jsonb);
insert into global_ctx default values;
grant select,update on global_ctx to service_role;
create function pg_temp.funding_global_command(p_key text,p_paused boolean,p_expected uuid default null,p_actor uuid default null)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare result uuid;
begin
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values(coalesce(p_actor,(select admin_id from pg_temp.prospective_ctx)),'ADMIN',
 case when p_paused then 'SAFE_MODE_ENABLED' else 'SAFE_MODE_DISABLED' end,'SAFE_MODE','GLOBAL',
 'Verified local global control operation',gen_random_uuid(),jsonb_build_object('command_version',1,
 'idempotency_key',p_key,'expected_request_id',p_expected,'component','GLOBAL','is_paused',p_paused,'review_at',null))
 returning id into result;
 return result;
end;
$$;
grant execute on function pg_temp.funding_global_command(text,boolean,uuid,uuid) to service_role;
select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='app_private.funding_global_control_originals'::regclass),'GLOBAL originals force RLS');
select ok(not has_table_privilege('service_role','app_private.funding_global_control_originals','INSERT')
 and not has_table_privilege('authenticated','app_private.funding_global_control_originals','SELECT'),
 'neither service nor member can plant a control original or read private control receipts');
select ok((select count(*)=2 and bool_and(prosecdef and proowner='postgres'::regrole
 and proconfig @> array['search_path=pg_catalog']::text[]) from pg_proc where oid in(
 'app_private.capture_funding_global_control_original()'::regprocedure,
 'app_private.verify_funding_global_control_commit()'::regprocedure)),
 'only two exact owner-trigger executors are added, with fixed paths');
select ok(not has_function_privilege('service_role','app_private.capture_funding_global_control_original()','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_funding_global_control_commit()','EXECUTE'),
 'the service cannot invoke a control producer or integrity trigger directly');

update global_ctx set before_state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 before_caps=(select to_jsonb(c) from app_private.funding_effective_capacity_receipts c where c.state_id=
 (select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx))),
 source_count=(select count(*) from public.money_source_movements),wallet_count=(select count(*) from public.wallet_ledger),
 journal_count=(select count(*) from public.ledger_transactions);
update global_ctx set job=app_private.prepare_default_funding_job((select activation from credit_ctx));
select lives_ok($$set constraints all immediate$$,'real service prepares the current original-bound job before pause');
set constraints all deferred;
reset role;
-- Owner fixture makes only this already sealed job available; scheduling is not enabled.
update public.system_jobs set available_at=clock_timestamp() where id=(select job from global_ctx);
set local role service_role;
select public.claim_system_jobs('global-control-worker',5,120);
update global_ctx set pause_audit=pg_temp.funding_global_command('global-actual-pause',true);
select lives_ok($$set constraints all immediate$$,'actual GLOBAL command and private originals commit as real service');
set constraints all deferred;
update global_ctx set pause_at=(select effective_at from app_private.funding_global_control_originals where audit_id=pause_audit);
select ok((select o.is_paused and o.baseline_known and o.revision=1 and o.previous_original_id is null
 and o.effective_at=c.starts_at and o.effective_at=a.created_at and o.effective_at=e.occurred_at
 and o.effective_at=e.created_at and o.effective_at=k.completed_at
 from app_private.funding_global_control_originals o join public.safe_mode_controls c on c.id=o.control_id
 join public.audit_logs a on a.id=o.audit_id join public.outbox_events e on e.id=o.source_event_id
 join app_private.idempotency_keys k on k.id=o.command_key_id where o.audit_id=(select pause_audit from global_ctx)),
 'one locked GLOBAL clock binds state, immutable audit, event and completed key');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select before_state from global_ctx),'GLOBAL control command itself never settles or resets member monetary state');
select ok((select source_count=(select count(*) from public.money_source_movements)
 and wallet_count=(select count(*) from public.wallet_ledger) and journal_count=(select count(*) from public.ledger_transactions)
 from global_ctx),'GLOBAL command creates no source, wallet or journal money');
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,stop_reason}'),
 'SAFE_MODE','strict server DTO reports actual GLOBAL stop independently of allocation');
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,status}'),
 'STOPPED','GLOBAL paused funded runtime cannot claim ACTIVE');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select is((select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',2,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','5000')),'credit-after-resume') from prospective_ctx),
 (select allocation from credit_ctx),'completed allocation key remains recoverable while GLOBAL is paused');
select lives_ok($$set constraints all immediate$$,'paused completed-key recovery commits as real authenticated without reapplying selection');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_sleep(0.02);
update global_ctx set evaluated_at=clock_timestamp();
select is((app_private.funding_global_eligible_interval((select pause_at from global_ctx),(select evaluated_at from global_ctx))->>'eligible_microseconds'),
 '0','the actual paused interval adds zero eligible elapsed time');
select throws_ok($$select public.complete_system_job(job,'global-control-worker') from global_ctx$$,
 '55000','SAFE_MODE_ACTIVE','GLOBAL execution stop prevents posting an old pending mining job');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select before_state from global_ctx),'blocked execution preserves all used, carry, cursor and original anchor');
select ok((select source_count=(select count(*) from public.money_source_movements)
 and wallet_count=(select count(*) from public.wallet_ledger) and journal_count=(select count(*) from public.ledger_transactions)
 from global_ctx),'blocked pending job produces no partial journal, projection or source');
select throws_ok($$select pg_temp.funding_global_command('global-viewer-forbidden',false,
 (select request_id from public.safe_mode_controls where component='GLOBAL'),(select other_id from prospective_ctx))$$,
 '42501','OPERATOR_ROLE_REQUIRED','a real service command still requires an assigned operator subject');
select throws_ok($$select pg_temp.funding_global_command('global-stale-version',false,gen_random_uuid())$$,
 '40001','SAFE_MODE_STATE_CHANGED','stale GLOBAL command cannot overwrite current original');
select throws_ok($$select pg_temp.funding_global_command('global-actual-pause',false)$$,
 '22023','IDEMPOTENCY_PAYLOAD_MISMATCH','same logical key with a different pause is rejected');
update global_ctx set resume_audit=pg_temp.funding_global_command('global-actual-resume',false,
 (select request_id from public.safe_mode_controls where component='GLOBAL'));
select lives_ok($$set constraints all immediate$$,'actual GLOBAL resume commits its canonical chain as real service');
set constraints all deferred;
update global_ctx set resume_at=(select effective_at from app_private.funding_global_control_originals where audit_id=resume_audit);
select ok((select o.revision=2 and not o.is_paused and o.previous_original_id=p.id and o.effective_at>=p.effective_at
 from app_private.funding_global_control_originals o join app_private.funding_global_control_originals p on p.id=o.previous_original_id
 where o.audit_id=(select resume_audit from global_ctx)),'resume appends a monotone immutable control original');
set local time zone 'Asia/Seoul';
select is(pg_temp.funding_global_command('global-actual-pause',true),null::uuid,
 'old same-key pause receipt replays across session TimeZone without reapplying old pause');
set local time zone 'UTC';
select ok((select not is_paused from public.safe_mode_controls where component='GLOBAL')
 and(select count(*)=2 from app_private.funding_global_control_originals),'past receipt replay leaves current resume and original count unchanged');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select before_state from global_ctx),'resume preserves accepted state and does not backfill or reset carry');
select is((select to_jsonb(c) from app_private.funding_effective_capacity_receipts c where c.state_id=
 (select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx))),
 (select before_caps from global_ctx),'pause/resume preserve exact remaining-window capacity receipt');
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,status}'),
 'ACTIVE','clear GLOBAL resumes permitted BASE prospectively without replacing allocation');
select lives_ok($$select public.complete_system_job(job,'global-control-worker') from global_ctx$$,
 'actual still-owned job completes after GLOBAL clear with exact pause attribution');
select lives_ok($$set constraints all immediate$$,'actual service job, control originals, journal and source commit together');
set constraints all deferred;
update global_ctx set earned=(select id from app_private.funding_earned_receipts where job_id=job);
select is((select e.calculation->>'globalEligibleMicroseconds' from app_private.funding_earned_receipts e where e.id=(select earned from global_ctx)),
 (select((extract(epoch from(e.settled_to-e.settled_from-(g.resume_at-g.pause_at)))*1000000)::bigint)::text
 from app_private.funding_earned_receipts e cross join global_ctx g where e.id=g.earned),
 'authoritative full cursor interval excludes exactly the sealed actual hold duration, with no catch-up');
select ok((select e.calculation->>'globalControlContractVersion'='1'
 and e.calculation->'globalControlOriginalIds'=jsonb_build_array(p.id,r.id)
 from app_private.funding_earned_receipts e cross join global_ctx g
 join app_private.funding_global_control_originals p on p.audit_id=g.pause_audit
 join app_private.funding_global_control_originals r on r.audit_id=g.resume_audit where e.id=g.earned),
 'earned snapshot seals the exact two control originals rather than an inferred current flag');
select ok((select e.calculation-array['globalControlContractVersion','globalEligibleMicroseconds','globalControlOriginalIds']
 =app_private.funding_exact_forward_interval((c.inputs->>'principal_atomic')::bigint,
 (c.inputs->>'base_bps')::integer,(c.inputs->>'retention_bps')::integer,
 (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::bigint,
 (extract(epoch from(e.settled_to-e.settled_from-(g.resume_at-g.pause_at)))*1000000)::bigint,
 (c.inputs->>'allocation_bps')::numeric,10000,cap.base_capacity_num,cap.base_capacity_den,cap.retention_capacity_num,cap.retention_capacity_den,
 s.base_used_num,s.base_used_den,s.retention_used_num,s.retention_used_den,s.carry_num,s.carry_den,0,1)
 from app_private.funding_earned_receipts e join app_private.funding_engine_state_receipts s on s.id=e.previous_state_id
 join app_private.funding_condition_originals c on c.id=s.condition_id join app_private.funding_cycle_windows w on w.id=s.cycle_id
 join app_private.funding_effective_capacity_receipts cap on cap.state_id=s.id cross join global_ctx g where e.id=g.earned),
 'actual mining amount, BASE used, independent conditional maintenance and carry match exact reference excluding only actual pause time');
select ok((select s.cycle_id::text=g.before_state->>'cycle_id' and s.cursor_at=e.settled_to
 and s.carry_num::text=e.calculation->>'carryNum' and s.carry_den::text=e.calculation->>'carryDen'
 and e.calculation->>'qualifiedRetentionNum'='0'
 from app_private.funding_engine_state s join app_private.funding_earned_receipts e on e.id=s.earned_receipt_id cross join global_ctx g
 where s.user_id=(select member_id from prospective_ctx) and e.id=g.earned),
 'lazy settlement preserves original cycle, advances full cursor and carries exact fractions without paying conditional maintenance');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','global attribution preserves balanced genuine mining and principal provenance');
select throws_ok($$update app_private.idempotency_keys set response_payload='{}' where
 id=(select command_key_id from app_private.funding_global_control_originals where audit_id=(select pause_audit from global_ctx))$$,
 '55000','FUNDING_GLOBAL_CONTROL_COMPLETION_IMMUTABLE','actual service cannot rewrite a bound GLOBAL completion');
reset role;
select throws_ok($$update app_private.funding_global_control_originals set is_paused=false where audit_id=(select pause_audit from global_ctx)$$,
 '55000','funding_global_control_originals is append-only','even owner fixtures cannot rewrite immutable eligibility history');
select throws_ok($$update public.outbox_events set payload=payload||'{"is_paused":false}'::jsonb where
 id=(select source_event_id from app_private.funding_global_control_originals where audit_id=(select pause_audit from global_ctx))$$,
 '55000','FUNDING_GLOBAL_CONTROL_EVENT_IMMUTABLE','a bound control event cannot be rewritten as the opposite state');
create function pg_temp.raw_global_control_unknown() returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
 update public.safe_mode_controls set reason='Unclassified owner-only negative fixture' where component='GLOBAL';
 perform app_private.funding_global_eligible_interval((select cursor_at from app_private.funding_engine_state
 where user_id=(select member_id from pg_temp.prospective_ctx)),clock_timestamp());
end;
$$;
select throws_ok($$select pg_temp.raw_global_control_unknown()$$,'55000','FUNDING_GLOBAL_CONTROL_HISTORY_UNKNOWN',
 'unsealed mutable control changes stay UNKNOWN and never grant running permission');
create function pg_temp.fail_global_event() returns trigger language plpgsql as $$
begin
 if new.idempotency_key='safe-mode:global-outbox-rollback' then
  raise exception using errcode='P0001',message='GLOBAL_CONTROL_TEST_EVENT_FAILURE'; end if;
 return new;
end;
$$;
create trigger global_control_test_event_failure before insert on public.outbox_events for each row execute function pg_temp.fail_global_event();
update global_ctx set before_control=(select to_jsonb(c) from public.safe_mode_controls c where c.component='GLOBAL'),
 original_count=(select count(*) from app_private.funding_global_control_originals);
set local role service_role;
select throws_ok($$select pg_temp.funding_global_command('global-outbox-rollback',true,
 (select request_id from public.safe_mode_controls where component='GLOBAL'))$$,
 'P0001','GLOBAL_CONTROL_TEST_EVENT_FAILURE','late canonical event failure rolls back control, audit, key and eligibility original');
select is((select to_jsonb(c) from public.safe_mode_controls c where c.component='GLOBAL'),
 (select before_control from global_ctx),'late failure preserves exact current control version and server clock');
select ok((select count(*) from app_private.funding_global_control_originals)=(select original_count from global_ctx)
 and not exists(select 1 from app_private.idempotency_keys where scope='safe_mode.control' and idempotency_key='global-outbox-rollback')
 and not exists(select 1 from public.audit_logs where metadata->>'idempotency_key'='global-outbox-rollback'),
 'late failure leaves no orphan GLOBAL original, completed key or accepted audit');
reset role;
create function pg_temp.suppress_global_original() returns trigger language plpgsql as $$
begin
 if exists(select 1 from public.audit_logs a where a.id=new.audit_id
  and a.metadata->>'idempotency_key'='global-missing-original') then return null; end if;
 return new;
end;
$$;
create trigger global_control_test_missing_original before insert on app_private.funding_global_control_originals
 for each row execute function pg_temp.suppress_global_original();
set local role service_role;
select throws_ok($$select pg_temp.funding_global_command('global-missing-original',true,
 (select request_id from public.safe_mode_controls where component='GLOBAL'))$$,
 '55000','FUNDING_GLOBAL_CONTROL_ORIGINAL_MISMATCH','actual canonical command cannot succeed without its private eligibility original');
select is((select to_jsonb(c) from public.safe_mode_controls c where c.component='GLOBAL'),
 (select before_control from global_ctx),'missing eligibility original rolls back exact mutable control version');
select ok((select count(*) from app_private.funding_global_control_originals)=(select original_count from global_ctx)
 and not exists(select 1 from app_private.idempotency_keys where scope='safe_mode.control' and idempotency_key='global-missing-original')
 and not exists(select 1 from public.audit_logs where metadata->>'idempotency_key'='global-missing-original'),
 'missing eligibility original leaves no accepted audit, original or completed key');
select throws_ok($$insert into app_private.funding_global_control_originals default values$$,
 '42501','permission denied for table funding_global_control_originals','actual service has no direct fact INSERT authority');
reset role;

-- Trusted owner-only forged negative fixture, not a catalog/control producer.
-- Correct structural FKs and digest still cannot substitute for a real command.
create function pg_temp.forged_global_original_commit() returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare original app_private.funding_global_control_originals%rowtype;
 previous app_private.funding_global_control_originals%rowtype; audit_id uuid; event_id uuid; key_id uuid;
begin
 select o.* into previous from app_private.funding_global_control_originals o order by o.revision desc limit 1;
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values((select admin_id from pg_temp.prospective_ctx),'ADMIN','FORGED_GLOBAL_NEGATIVE','OWNER_NEGATIVE_FIXTURE',
 gen_random_uuid()::text,'Explicit owner-only forged deferred-integrity fixture',gen_random_uuid(),'{}') returning id into audit_id;
 insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,payload,correlation_id,request_id,idempotency_key)
 values('TEST_GLOBAL_NEGATIVE.v1',1,'owner_negative_fixture',gen_random_uuid(),'{}',gen_random_uuid(),gen_random_uuid(),
 'global-forged-event-negative') returning id into event_id;
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status)
 values('global.owner-negative',null,'global-forged-key-negative',repeat('a',64),'PROCESSING') returning id into key_id;
 original.id:=gen_random_uuid(); original.revision:=previous.revision+1; original.previous_original_id:=previous.id;
 original.control_id:=previous.control_id; original.is_paused:=false; original.baseline_known:=previous.baseline_known;
 original.effective_at:=clock_timestamp(); original.recorded_at:=original.effective_at;
 original.audit_id:=audit_id; original.source_event_id:=event_id; original.command_key_id:=key_id;
 original.input_digest:=app_private.funding_engine_digest(app_private.funding_global_control_snapshot(original));
 insert into app_private.funding_global_control_originals select original.*;
 set constraints all immediate;
end;
$$;
select throws_ok($$select pg_temp.forged_global_original_commit()$$,'55000','FUNDING_GLOBAL_CONTROL_ORIGINAL_MISMATCH',
 'actual deferred original validator rejects structurally complete owner-forged command provenance');
select ok((select count(*) from app_private.funding_global_control_originals)=(select original_count from global_ctx)
 and not exists(select 1 from public.outbox_events where idempotency_key='global-forged-event-negative')
 and not exists(select 1 from app_private.idempotency_keys where idempotency_key='global-forged-key-negative'),
 'deferred forged-original rejection rolls back all negative-fixture originals');
select finish();
rollback;
