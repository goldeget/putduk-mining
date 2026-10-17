-- Root-only rollback test: canonical77 credit prefix + original-bound HOLD/CANCEL connection.
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


reset role;
set constraints all immediate;
set constraints all deferred;

-- New131 authority tests follow the unchanged accepted77 canonical prefix.
-- Initiating REQUESTED principal rows below are POSTGRES-OWNER-ONLY fixtures.
-- They do not prove member consent or deliver a public principal command.
-- All tested typing/HOLD/source/portion/commit operations execute as service.
create temporary table typed_ctx(unactivated_id uuid,bank_id uuid,request_id uuid,trace_id uuid,intent_id uuid,hold_id uuid,
 other_request uuid,large_request uuid,mining_request uuid,
 state_before jsonb,anchor_before timestamptz,end_before timestamptz,
 intent_count bigint,journal_count bigint,wallet_count bigint,source_count bigint,earned_count bigint,
 condition_count bigint,capacity_count bigint,clock_count bigint,audit_count bigint,event_count bigint,admission_count bigint);
insert into typed_ctx(unactivated_id) values(gen_random_uuid());
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select unactivated_id,'authenticated','authenticated',unactivated_id::text||'@typed-unactivated.putduk.test','',
 clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp(),'','','','' from typed_ctx;
select public.bootstrap_user(unactivated_id) from typed_ctx;
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,
 fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10631001,true,1,0,'{}',clock_timestamp(),admin_id,false from prospective_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
 display_hint,verification_status,verified_at,protection_until)
select person,'KRW_BANK',decode(repeat('ae',32),'hex'),encode(extensions.digest(person::text,'sha256'),'hex'),
 'Owner-only typed principal intent fixture','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day'
 from prospective_ctx cross join typed_ctx cross join lateral unnest(array[member_id,unactivated_id]) person;
update typed_ctx set bank_id=(select id from public.withdrawal_destinations where user_id=(select member_id from prospective_ctx)),
 trace_id=gen_random_uuid(),state_before=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 anchor_before=(select c.cycle_started_at from app_private.funding_cycle_windows c join app_private.funding_engine_state s on s.cycle_id=c.id
  where s.user_id=(select member_id from prospective_ctx)),
 end_before=(select c.cycle_end from app_private.funding_cycle_windows c join app_private.funding_engine_state s on s.cycle_id=c.id
  where s.user_id=(select member_id from prospective_ctx));
grant select,update on typed_ctx to service_role,authenticated;
create function pg_temp.synthetic_principal_request(p_owner uuid,p_amount bigint,p_key text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare id uuid; wallet uuid;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='TYPED_PRINCIPAL_INITIATING_FIXTURE_OWNER_ONLY'; end if;
 select w.id into wallet from public.wallet_accounts w where w.user_id=p_owner and w.currency='KRW';
 insert into public.withdrawal_requests(wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,
  currency,amount_atomic,fee_atomic,destination_type,destination_snapshot,status,idempotency_key)
 select wallet,p.id,d.id,p_owner,'KRW',p_amount,0,'KRW_BANK',
  jsonb_build_object('destination_id',d.id,'display',d.display_hint,'verified_at',d.verified_at),'REQUESTED',p_key
 from public.withdrawal_policies p cross join public.withdrawal_destinations d
 where p.version=10631001 and d.user_id=p_owner returning withdrawal_requests.id into id;
 return id;
end;
$$;
revoke all on function pg_temp.synthetic_principal_request(uuid,bigint,text) from public,anon,authenticated,service_role;

create function pg_temp.try_typed_intent_commit(p_withdrawal uuid,p_trace uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin perform app_private.prepare_principal_recovery_intent(p_withdrawal,p_trace);set constraints all immediate;end;
$$;
create function pg_temp.complete_typed_fixture_hold(p_withdrawal uuid,p_trace uuid,p_principal boolean,p_commit_subject uuid default null) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare request public.withdrawal_requests%rowtype; hold_id uuid; at timestamptz; intent uuid;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='TYPED_HOLD_FIXTURE_SERVICE_REQUIRED'; end if;
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal;
 intent:=app_private.prepare_principal_recovery_intent(p_withdrawal,p_trace);
 hold_id:=app_private.post_withdrawal_hold(request.user_id,request.id,request.amount_atomic,request.idempotency_key,p_trace);
 select t.posted_at into at from public.ledger_transactions t where t.id=hold_id;
 update public.withdrawal_requests set status='HELD',hold_ledger_transaction_id=hold_id,hold_posted_at=at where id=request.id;
 insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at)
 values('WITHDRAWAL_REQUESTED.v1',1,'withdrawal_request',request.id,request.user_id,
  jsonb_build_object('user_id',request.user_id,'amount_atomic',request.amount_atomic::text,'fee_atomic','0','currency','KRW',
   'destination_type','KRW_BANK','hold_ledger_transaction_id',hold_id,'welcome_reward',false),
  p_trace,p_trace,request.idempotency_key||':event',at,at);
 insert into public.transaction_receipts(receipt_number,user_id,transaction_type,source_type,source_id,amount_atomic,
  currency,status,requested_at,status_timeline)
 values('PDK-WD-'||upper(replace(request.id::text,'-','')),request.user_id,'WITHDRAWAL','withdrawal_request',request.id,
  request.amount_atomic,'KRW','HELD',at,jsonb_build_array(jsonb_build_object('status','HELD','at',at)));
 if p_principal then perform app_private.apply_principal_recovery_newest_first(request.user_id,hold_id);
 else perform app_private.reserve_verified_mining_reward_newest_first(request.user_id,hold_id);end if;
 if p_commit_subject is not null then
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',p_commit_subject)::text,true);end if;
 set constraints all immediate;set constraints all deferred;return intent;
end;
$$;
grant execute on function pg_temp.try_typed_intent_commit(uuid,uuid),pg_temp.complete_typed_fixture_hold(uuid,uuid,boolean,uuid) to service_role;

-- Each negative initiating request lives only in this pgTAP subtransaction.
-- A failing real producer rolls it back; no actual financial original is deleted.
create function pg_temp.ephemeral_typed_attempt(p_case text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select member_id from pg_temp.prospective_ctx);amount bigint:=300000;
 request_id uuid;trace uuid:=gen_random_uuid();result uuid;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='TYPED_NEGATIVE_INITIATING_FIXTURE_OWNER_ONLY'; end if;
 if p_case='NO_RUNTIME' then owner_id:=(select unactivated_id from pg_temp.typed_ctx);amount:=1;
 elsif p_case='INSUFFICIENT' then amount:=2000000000000;
 elsif p_case='WRONG_SOURCE' then amount:=1;
 elsif p_case not in('WRONG_SUBJECT','WRONG_COMMIT_SUBJECT','EXTRA_PENDING') then
  raise exception using errcode='22023',message='TYPED_NEGATIVE_FIXTURE_CASE_INVALID'; end if;
 request_id:=pg_temp.synthetic_principal_request(owner_id,amount,'typed-ephemeral-'||p_case||':'||gen_random_uuid()::text);
 if p_case='EXTRA_PENDING' then
  perform pg_temp.synthetic_principal_request(owner_id,1,'typed-ephemeral-other:'||gen_random_uuid()::text);end if;
 perform set_config('request.jwt.claims',case when p_case='WRONG_SUBJECT' then
  jsonb_build_object('role','service_role','sub',(select other_id from pg_temp.prospective_ctx))::text
  else '{"role":"service_role"}' end,true);
 execute 'set local role service_role';
 if p_case='WRONG_SOURCE' then result:=pg_temp.complete_typed_fixture_hold(request_id,trace,false);
 elsif p_case='WRONG_COMMIT_SUBJECT' then result:=pg_temp.complete_typed_fixture_hold(request_id,trace,true,(select other_id from pg_temp.prospective_ctx));
 else result:=app_private.prepare_principal_recovery_intent(request_id,trace);end if;
 execute 'reset role';return result;
end;
$$;
revoke all on function pg_temp.ephemeral_typed_attempt(text) from public,anon,authenticated,service_role;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='app_private.funding_principal_recovery_intent_originals'::regclass),'typed originals force RLS');
select ok(not has_table_privilege('service_role','app_private.funding_principal_recovery_intent_originals','INSERT')
 and not has_table_privilege('service_role','app_private.funding_principal_recovery_intent_originals','UPDATE')
 and not has_table_privilege('service_role','app_private.funding_principal_recovery_intent_originals','DELETE'),
 'service may call the closed producer but cannot plant or rewrite typed originals');
select ok(not has_table_privilege('authenticated','app_private.funding_principal_recovery_intent_originals','SELECT'),
 'member does not acquire private financial provenance reads');
select ok((select prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=pg_catalog']::text[]
 from pg_proc where oid='app_private.prepare_principal_recovery_intent(uuid,uuid)'::regprocedure)
 and has_function_privilege('service_role','app_private.prepare_principal_recovery_intent(uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.prepare_principal_recovery_intent(uuid,uuid)','EXECUTE'),
 'new producer is the exact fixed-path service-only definer');
select ok((select prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=pg_catalog']::text[]
 from pg_proc where oid='app_private.verify_principal_recovery_intent_commit()'::regprocedure)
 and not has_function_privilege('service_role','app_private.verify_principal_recovery_intent_commit()','EXECUTE')
 and not has_function_privilege('authenticated','app_private.verify_principal_recovery_intent_commit()','EXECUTE'),
 'commit executor stays trigger-only with no callable read authority');
select ok(to_regprocedure('public.prepare_principal_recovery_intent(uuid,uuid)') is null,
 'foundation creates no public principal command alias');
select ok(not has_function_privilege('service_role','app_private.principal_intent_prefinance_coverage_verified(uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.read_principal_intent_current_inputs(uuid,uuid,timestamp with time zone,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.read_principal_intent_current_inputs(uuid,uuid,timestamp with time zone,uuid)','EXECUTE'),
 'bounded prefinance coverage and copied input readers remain owner-only INVOKER, never generic service exemptions');
select ok(not has_function_privilege('service_role','app_private.assert_principal_prefinance_portion_transition(app_private.funding_portion_transitions,uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_principal_prefinance_portion_fact(app_private.funding_portion_transitions,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.verify_principal_prefinance_portion_fact(app_private.funding_portion_transitions,uuid)','EXECUTE'),
 'bounded historical portion proof stays owner-only INVOKER and gives service no skip authority');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role authenticated;
select throws_ok($$select app_private.prepare_principal_recovery_intent(gen_random_uuid(),gen_random_uuid())$$,
 '42501',null,'forged service JWT under member SQL cannot call principal producer');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select app_private.prepare_principal_recovery_intent(gen_random_uuid(),gen_random_uuid())$$,
 '42501','PRINCIPAL_RECOVERY_INTENT_SERVICE_ROLE_REQUIRED','new private producer requires actual service JWT as well as SQL role');
select throws_ok($$insert into app_private.funding_principal_recovery_intent_originals default values$$,
 '42501',null,'raw service INSERT is denied before any manufactured fields can become evidence');
reset role;
select throws_ok($$select pg_temp.ephemeral_typed_attempt('WRONG_SUBJECT')$$,
 '42501','PRINCIPAL_RECOVERY_INTENT_SUBJECT_FORBIDDEN','nonempty service subject must match actual request owner');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select app_private.prepare_principal_recovery_intent(null,gen_random_uuid())$$,
 '22023','PRINCIPAL_RECOVERY_INTENT_INVALID','producer requires actual request and trace originals');
select throws_ok($$select app_private.prepare_principal_recovery_intent(gen_random_uuid(),gen_random_uuid())$$,
 '55000','WITHDRAWAL_NOT_FOUND','missing request cannot manufacture principal intent');
reset role;
select throws_ok($$select pg_temp.ephemeral_typed_attempt('NO_RUNTIME')$$,
 '55000','PRINCIPAL_RECOVERY_INTENT_CURRENT_RUNTIME_REQUIRED','member without accepted runtime cannot fabricate current state');
select throws_ok($$select pg_temp.ephemeral_typed_attempt('INSUFFICIENT')$$,
 '55000','PRINCIPAL_RECOVERY_INTENT_INSUFFICIENT_PRINCIPAL','principal shortfall never substitutes mining or bonus');
select throws_ok($$select pg_temp.ephemeral_typed_attempt('EXTRA_PENDING')$$,
 '55000','FUNDING_SOURCE_BOUNDARY_ADAPTER_REQUIRED','single current prefinance original cannot excuse any other unclassified pending request');
select ok(not exists(select 1 from app_private.funding_engine_activations where user_id=(select unactivated_id from typed_ctx)),
 'missing-runtime negative uses a genuinely unactivated member, unlike canonical minimum-crossing subject');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','ephemeral negative requests leave canonical source fully classified before ordinary public withdrawal');
select ok(app_private.available_krw_balance((select id from public.wallet_accounts where user_id=(select member_id from prospective_ctx) and currency='KRW'))>=1
 and app_private.verified_mining_reward_remaining_atomic((select member_id from prospective_ctx))>=1,
 'ordinary withdrawal has independently genuine available wallet and verified mining money');
update typed_ctx set intent_count=(select count(*) from app_private.funding_principal_recovery_intent_originals),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),earned_count=(select count(*) from app_private.funding_earned_receipts),
 condition_count=(select count(*) from app_private.funding_condition_originals),capacity_count=(select count(*) from app_private.funding_effective_capacity_receipts),
 clock_count=(select count(*) from app_private.funding_portion_clock_receipts),audit_count=(select count(*) from public.audit_logs),
 event_count=(select count(*) from public.outbox_events),admission_count=(select count(*) from app_private.funding_withdrawal_clock_admissions);
-- A genuine ordinary command remains MINING_REWARD-only and never calls type.
update typed_ctx set mining_request=public.request_krw_withdrawal((select member_id from prospective_ctx),bank_id,1,'typed-ordinary-mining');
select lives_ok($$set constraints all immediate$$,'ordinary mining request commits unchanged actual service flow');
set constraints all deferred;
select is((select count(*) from app_private.funding_principal_recovery_intent_originals),(select intent_count from typed_ctx),
 'ordinary public mining request does not acquire principal type');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select clock_count from typed_ctx),
 'ordinary public mining does not pause principal retention clocks');
select public.release_withdrawal_hold(mining_request,(select admin_id from prospective_ctx),'cancel ordinary typed-boundary test',
 'typed-ordinary-mining-cancel','CANCELLED') from typed_ctx;
select lives_ok($$set constraints all immediate$$,'ordinary cancel preserves immutable mining reservation and disposition originals');
set constraints all deferred;
reset role;
-- Wrong-type request is created inside the failing owner's statement, then
-- typing, genuine mining money and actual deferred commit run as service.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update typed_ctx set journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),admission_count=(select count(*) from app_private.funding_withdrawal_clock_admissions),
 audit_count=(select count(*) from public.audit_logs),event_count=(select count(*) from public.outbox_events);
reset role;
select throws_ok($$select pg_temp.ephemeral_typed_attempt('WRONG_SOURCE')$$,
 '55000','PRINCIPAL_RECOVERY_INTENT_SOURCE_REQUIRED','real mining originals cannot satisfy a server principal discriminator');
select is((select count(*) from app_private.funding_principal_recovery_intent_originals),(select intent_count from typed_ctx),
 'wrong source rolls back typed fact');
select is((select count(*) from public.ledger_transactions),(select journal_count from typed_ctx),'wrong type rolls back actual journal');
select is((select count(*) from public.wallet_ledger),(select wallet_count from typed_ctx),'wrong type preserves wallet projection');
select is((select count(*) from public.money_source_movements),(select source_count from typed_ctx),'wrong type rolls back all sources');
select is((select count(*) from app_private.funding_withdrawal_clock_admissions),(select admission_count from typed_ctx),
 'wrong type rolls back closed130 admission as well as money');
select throws_ok($$select pg_temp.ephemeral_typed_attempt('WRONG_COMMIT_SUBJECT')$$,
 '42501','PRINCIPAL_RECOVERY_INTENT_COMMIT_CONTEXT_FORBIDDEN','actual service deferred commit independently enforces typed owner subject after producer returned');
select is((select count(*) from public.ledger_transactions),(select journal_count from typed_ctx),
 'wrong deferred subject rolls back genuine principal journal');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select clock_count from typed_ctx),
 'wrong deferred subject rolls back genuine native split and retention clocks');
select is((select count(*) from app_private.funding_principal_recovery_intent_originals),(select intent_count from typed_ctx),
 'wrong deferred subject leaves no false completed type');

update typed_ctx set request_id=pg_temp.synthetic_principal_request((select member_id from prospective_ctx),300000,'typed-principal-first-hold');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'UNRESOLVED','public source coverage stays truthful while the exact current prefinance request has no monetary completion');
select throws_ok($$select app_private.assert_funding_portion_transition(t) from app_private.funding_portion_transitions t
 where t.user_id=(select member_id from prospective_ctx) order by t.revision limit 1$$,
 '55000','FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED','original native and deferred portion verification still rejects incomplete public source coverage');
select throws_ok($$select pg_temp.try_typed_intent_commit(request_id,trace_id) from typed_ctx$$,
 '55000','PRINCIPAL_RECOVERY_INTENT_HOLD_COMPLETION_REQUIRED','capture-only server type cannot commit without real130 finance/source completion');
select is((select count(*) from app_private.funding_principal_recovery_intent_originals),(select intent_count from typed_ctx),
 'missing actual finance rolls back typed fact');
select is((select count(*) from public.audit_logs),(select audit_count from typed_ctx),'missing completion rolls back audit seal');
select is((select count(*) from public.outbox_events),(select event_count from typed_ctx),'missing completion rolls back dormant outbox seal');
select is((select count(*) from public.ledger_transactions),(select journal_count from typed_ctx),'capture-only rejection posts no journal');
select is((select count(*) from public.money_source_movements),(select source_count from typed_ctx),'capture-only rejection creates no money source');

update typed_ctx set intent_id=pg_temp.complete_typed_fixture_hold(request_id,trace_id,true);
select lives_ok($$set constraints all immediate$$,'typed principal original plus native finance/portion history passes actual service commit');
set constraints all deferred;
update typed_ctx set hold_id=(select hold_ledger_transaction_id from public.withdrawal_requests where id=request_id);
select is((select count(*) from app_private.funding_principal_recovery_intent_originals),(select intent_count+1 from typed_ctx),
 'actual principal command stores exactly one server typed original');
select is((select intent_kind from app_private.funding_principal_recovery_intent_originals where id=(select intent_id from typed_ctx)),
 'SERVER_PRINCIPAL_RECOVERY','type identifies server command without guessing future native allocations');
select is((select a.after_state->>'member_confirmation' from public.audit_logs a
 join app_private.funding_principal_recovery_intent_originals i on i.audit_id=a.id where i.id=(select intent_id from typed_ctx)),
 'NOT_PROVEN','owner-only initiating fixture never claims member confirmation');
select ok((select i.prepared_at<=a.effective_at and i.journal_request_id=a.journal_request_id and i.amount_atomic=a.amount_atomic
 from app_private.funding_principal_recovery_intent_originals i join app_private.funding_withdrawal_clock_admissions a
 on a.withdrawal_id=i.withdrawal_id and a.phase='HOLD' where i.id=(select intent_id from typed_ctx)),
 'non-economic preparation precedes the sole130 financial clock and binds exact trace and amount');
select is((select sum(allocation_micro_krw)::bigint from public.funding_principal_recovery_allocations
 where hold_ledger_transaction_id=(select hold_id from typed_ctx)),300000000000::bigint,
 'native principal reservation conserves exact source amount without new wallet debit');
select ok((select to_jsonb(old) @> t.state_before
 and st.previous_state_id=old.id and st.cursor_at=a.effective_at
 and done.accepted_state_id=st.id and done.runtime_outcome='ACCEPTED'
 from typed_ctx t join app_private.funding_engine_state_receipts old on old.id=(t.state_before->>'id')::uuid
 join app_private.funding_withdrawal_clock_admissions a on a.withdrawal_id=t.request_id and a.phase='HOLD'
 join app_private.funding_principal_boundary_preparations p on p.clock_admission_id=a.id
 join app_private.funding_principal_boundary_completions done on done.boundary_id=p.id
 join app_private.funding_engine_state st on st.user_id=old.user_id),
 'native HOLD preserves the complete immutable prior state and advances exactly to its admitted clock');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count+1 from typed_ctx),
 'native HOLD records exactly one source-bound old-interval earning');
select is((select count(*) from app_private.funding_condition_originals),(select condition_count+1 from typed_ctx),
 'native HOLD accepts exactly one genuine successor condition');
select is((select count(*) from app_private.funding_effective_capacity_receipts),(select capacity_count+1 from typed_ctx),
 'native HOLD appends exactly one prospective remaining-window capacity');
select is((select c.cycle_started_at from app_private.funding_cycle_windows c join app_private.funding_engine_state s on s.cycle_id=c.id
 where s.user_id=(select member_id from prospective_ctx)),(select anchor_before from typed_ctx),'principal type preserves original cycle anchor');
select is((select c.cycle_end from app_private.funding_cycle_windows c join app_private.funding_engine_state s on s.cycle_id=c.id
 where s.user_id=(select member_id from prospective_ctx)),(select end_before from typed_ctx),'principal type preserves original cycle end');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','actual balanced principal reservation retains truthful source coverage');
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,status}'),
 'ACTIVE','only the actual completed native HOLD source boundary proves current paid runtime');
select throws_ok($$select app_private.prepare_principal_recovery_intent(request_id,gen_random_uuid()) from typed_ctx$$,
 '22023','IDEMPOTENCY_KEY_REUSED','different logical trace cannot replay the typed original');
update typed_ctx set intent_count=(select count(*) from app_private.funding_principal_recovery_intent_originals),
 journal_count=(select count(*) from public.ledger_transactions),clock_count=(select count(*) from app_private.funding_portion_clock_receipts),
 source_count=(select count(*) from public.money_source_movements);
set local time zone 'Asia/Seoul';
select is((select app_private.prepare_principal_recovery_intent(request_id,trace_id) from typed_ctx),(select intent_id from typed_ctx),
 'immutable principal intent replays across TimeZone without current unsupported input revalidation');
set local time zone 'UTC';
select is((select count(*) from public.ledger_transactions),(select journal_count from typed_ctx),'typed replay posts no journal');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select clock_count from typed_ctx),'typed replay does not pause clocks twice');
select is((select count(*) from public.money_source_movements),(select source_count from typed_ctx),'typed replay creates no source movement');
select throws_ok($$update app_private.funding_principal_recovery_intent_originals set intent_kind=intent_kind where id=(select intent_id from typed_ctx)$$,
 '42501',null,'service UPDATE cannot change durable type');
select throws_ok($$delete from app_private.funding_principal_recovery_intent_originals where id=(select intent_id from typed_ctx)$$,
 '42501',null,'service DELETE cannot erase durable type');
select throws_ok($$update public.outbox_events set payload=payload||'{"forged":true}'::jsonb where id=(select source_event_id
 from app_private.funding_principal_recovery_intent_originals where id=(select intent_id from typed_ctx))$$,
 '55000','PRINCIPAL_RECOVERY_INTENT_ORIGINAL_IMMUTABLE','service-writable event metadata cannot rewrite authority');
select lives_ok($$update public.outbox_events set attempt_count=attempt_count+1 where id=(select source_event_id
 from app_private.funding_principal_recovery_intent_originals where id=(select intent_id from typed_ctx))$$,
 'ordinary outbox lease processing fields remain mutable');
select public.release_withdrawal_hold(request_id,(select admin_id from prospective_ctx),'actual typed principal cancellation',
 'typed-principal-first-cancel','CANCELLED') from typed_ctx;
select lives_ok($$set constraints all immediate$$,'actual canonical cancellation preserves completed typedHOLD and130 release clocks');
set constraints all deferred;
select is((select app_private.prepare_principal_recovery_intent(request_id,trace_id) from typed_ctx),(select intent_id from typed_ctx),
 'typedHOLD remains recoverable after genuine cancellation and prospective portion resume');
select ok((select to_jsonb(old) @> t.state_before
 and st.cursor_at=a.effective_at and done.accepted_state_id=st.id
 and done.runtime_outcome='ACCEPTED' and done.reason_code is null
 and st.previous_state_id=p.previous_state_id
 from typed_ctx t join app_private.funding_engine_state_receipts old on old.id=(t.state_before->>'id')::uuid
 join app_private.funding_withdrawal_clock_admissions a on a.withdrawal_id=t.request_id and a.phase='RELEASE'
 join app_private.funding_principal_boundary_preparations p on p.clock_admission_id=a.id
 join app_private.funding_principal_boundary_completions done on done.boundary_id=p.id
 join app_private.funding_engine_state st on st.user_id=old.user_id),
 'CANCEL preserves the immutable prehold state and advances only through its completed release original');
reset role;
select throws_ok($$delete from app_private.funding_principal_recovery_intent_originals where id=(select intent_id from typed_ctx)$$,
 '55000','funding_principal_recovery_intent_originals is append-only','trusted owner fixture also cannot rewrite durable type');
select throws_ok($$update public.audit_logs set reason='forged source' where id=(select audit_id from app_private.funding_principal_recovery_intent_originals
 where id=(select intent_id from typed_ctx))$$,'55000','audit_logs is append-only','trusted owner cannot mutate immutable type seal');
set constraints all immediate;
select * from finish();
rollback;
