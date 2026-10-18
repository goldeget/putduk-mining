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


-- New133 regressions use the identical actual canonical77 deposit/catalog/
-- allocation/manual-worker prefix. Initiating principal request alone remains
-- explicitly owner-only synthetic; this is NOT member consent/API delivery.
create temporary table principal_runtime_ctx(boundary uuid,release_boundary uuid,hold_clock uuid,release_clock uuid,
 old_state uuid,hold_state uuid,job uuid,principal_before bigint,journal_before bigint,wallet_before bigint,
 source_before bigint,earned_before bigint,condition_before bigint,capacity_before bigint,portion_before bigint,
 prep_before bigint,completion_before bigint,admission_before bigint,intent_before bigint,audit_before bigint,event_before bigint);
insert into principal_runtime_ctx(old_state,principal_before) select s.id,(c.inputs->>'principal_atomic')::bigint
 from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id
 where s.user_id=(select member_id from prospective_ctx);
grant select,update on principal_runtime_ctx to service_role;
create function pg_temp.principal_ephemeral_hold(p_subject uuid default null) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare request_id uuid;result uuid;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='133_INITIATING_FIXTURE_OWNER_ONLY';end if;
 request_id:=pg_temp.synthetic_principal_request((select member_id from pg_temp.prospective_ctx),300000,'133-ephemeral-'||gen_random_uuid()::text);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 execute 'set local role service_role';
 result:=pg_temp.complete_typed_fixture_hold(request_id,gen_random_uuid(),true,p_subject);
 execute 'reset role';return result;
end;
$$;
revoke all on function pg_temp.principal_ephemeral_hold(uuid) from public,anon,authenticated,service_role;

create function pg_temp.principal_capture_only_commit() returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare request_id uuid;trace uuid:=gen_random_uuid();
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='133_INITIATING_FIXTURE_OWNER_ONLY';end if;
 request_id:=pg_temp.synthetic_principal_request((select member_id from pg_temp.prospective_ctx),300000,'133-capture-only-'||gen_random_uuid()::text);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
 perform app_private.prepare_principal_recovery_intent(request_id,trace);
 perform 1 from app_private.capture_funding_withdrawal_clock_admission(request_id,'HOLD',trace);
 set constraints all immediate;
 execute 'reset role';
end;
$$;
revoke all on function pg_temp.principal_capture_only_commit() from public,anon,authenticated,service_role;

create function pg_temp.principal_wallet_fault() returns trigger language plpgsql as $$
begin if new.entry_type='MINING_REWARD' and new.idempotency_key like 'funding:principal:%' then
 raise exception using errcode='23514',message='133_PREFINANCE_WALLET_FAULT';end if;return new;end;
$$;
create function pg_temp.principal_condition_fault() returns trigger language plpgsql as $$
begin if new.cause_principal_boundary_id is not null then raise exception using errcode='23514',message='133_POSTFINANCE_CONDITION_FAULT';end if;return new;end;
$$;
create function pg_temp.principal_completion_fault() returns trigger language plpgsql as $$
begin return null;end;
$$;
update principal_runtime_ctx set journal_before=(select count(*) from public.ledger_transactions),
 wallet_before=(select count(*) from public.wallet_ledger),source_before=(select count(*) from public.money_source_movements),
 earned_before=(select count(*) from app_private.funding_earned_receipts),condition_before=(select count(*) from app_private.funding_condition_originals),
 capacity_before=(select count(*) from app_private.funding_effective_capacity_receipts),portion_before=(select count(*) from app_private.funding_portion_clock_receipts),
 prep_before=(select count(*) from app_private.funding_principal_boundary_preparations),completion_before=(select count(*) from app_private.funding_principal_boundary_completions),
 admission_before=(select count(*) from app_private.funding_withdrawal_clock_admissions),intent_before=(select count(*) from app_private.funding_principal_recovery_intent_originals),
 audit_before=(select count(*) from public.audit_logs),event_before=(select count(*) from public.outbox_events);
select ok(not has_table_privilege('service_role','app_private.funding_principal_boundary_preparations','INSERT')
 and not has_table_privilege('service_role','app_private.funding_principal_boundary_completions','INSERT'),
 'raw service cannot manufacture a principal cause/completion original');
select ok(not has_function_privilege('service_role','app_private.begin_principal_runtime_boundary(uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.read_principal_boundary_current_inputs(uuid,uuid,timestamptz,uuid,uuid)','EXECUTE'),
 'only closed130 callback can reach prefinance arithmetic and exact-own-request exclusion');
select ok(has_function_privilege('service_role','app_private.finish_principal_runtime_boundary(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.finish_principal_runtime_boundary(uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_principal_boundary_commit()','EXECUTE'),
 'postfinance executor is service-only and deferred definer is trigger-only');
select ok(to_regprocedure('public.begin_principal_runtime_boundary(uuid)') is null
 and not has_function_privilege('service_role','public.record_mining_settlement(uuid,uuid,timestamptz,timestamptz,bigint,public.currency_code,jsonb,text)','EXECUTE'),
 'no public principal alias or caller-amount legacy settlement is introduced');
select throws_ok($$select pg_temp.principal_capture_only_commit()$$,'55000','FUNDING_WITHDRAWAL_CLOCK_JOURNAL_MISSING',
 'real admission and prefinance mining cannot commit without the actual principal finance original');
select is((select count(*) from app_private.funding_principal_boundary_preparations),(select prep_before from principal_runtime_ctx),
 'capture-only deferred denial removes the genuine preparation and mining acceptance');
create trigger principal_wallet_fault before insert on public.wallet_ledger for each row execute function pg_temp.principal_wallet_fault();
select throws_ok($$select pg_temp.principal_ephemeral_hold()$$,'23514','133_PREFINANCE_WALLET_FAULT',
 'real callback mining journal rolls back if prefinance wallet projection fails');
drop trigger principal_wallet_fault on public.wallet_ledger;
select is((select count(*) from public.ledger_transactions),(select journal_before from principal_runtime_ctx),'prefinance projection failure leaves no journal');
select is((select count(*) from app_private.funding_principal_boundary_preparations),(select prep_before from principal_runtime_ctx),'prefinance projection failure leaves no preparation');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_before from principal_runtime_ctx),'prefinance failure leaves no earned original');
select is((select count(*) from app_private.funding_withdrawal_clock_admissions),(select admission_before from principal_runtime_ctx),'prefinance failure leaves no admitted financial clock');
create trigger principal_condition_fault before insert on app_private.funding_condition_originals for each row execute function pg_temp.principal_condition_fault();
select throws_ok($$select pg_temp.principal_ephemeral_hold()$$,'23514','133_POSTFINANCE_CONDITION_FAULT',
 'real native principal journal/source/portion split rolls back when prospective condition fails');
drop trigger principal_condition_fault on app_private.funding_condition_originals;
select is((select count(*) from public.money_source_movements),(select source_before from principal_runtime_ctx),'late condition failure leaves no principal or mining source');
select is((select count(*) from public.wallet_ledger),(select wallet_before from principal_runtime_ctx),'late condition failure preserves wallet projection');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select portion_before from principal_runtime_ctx),'late condition failure preserves original portion clocks');
select is((select count(*) from app_private.funding_effective_capacity_receipts),(select capacity_before from principal_runtime_ctx),'late condition failure leaves no capacity receipt');
create trigger principal_completion_fault before insert on app_private.funding_principal_boundary_completions for each row execute function pg_temp.principal_completion_fault();
select throws_ok($$select pg_temp.principal_ephemeral_hold()$$,'55000','PRINCIPAL_RECOVERY_INTENT_STATE_ADVANCED',
 'capture/earning/native finance/state without actual completion cannot commit');
drop trigger principal_completion_fault on app_private.funding_principal_boundary_completions;
select is((select count(*) from app_private.funding_condition_originals),(select condition_before from principal_runtime_ctx),'deferred completion failure rolls back accepted condition');
select is((select count(*) from public.audit_logs),(select audit_before from principal_runtime_ctx),'deferred failure rolls back every audit seal');
select is((select count(*) from public.outbox_events),(select event_before from principal_runtime_ctx),'deferred failure rolls back every event seal');
select is((select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select old_state from principal_runtime_ctx),'all negative real commands preserve current state');
select throws_ok($$select pg_temp.principal_ephemeral_hold((select other_id from prospective_ctx))$$,
 '42501','PRINCIPAL_RECOVERY_INTENT_COMMIT_CONTEXT_FORBIDDEN',
 'actual service deferred commit rejects a subject changed after the closed producer returns');
select is((select count(*) from app_private.funding_withdrawal_clock_admissions),(select admission_before from principal_runtime_ctx),
 'wrong deferred subject rolls back sealed admission and every connected economic effect');
update typed_ctx set request_id=pg_temp.synthetic_principal_request((select member_id from prospective_ctx),300000,'133-real-first-hold');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update typed_ctx set intent_id=pg_temp.complete_typed_fixture_hold(request_id,trace_id,true);
select lives_ok($$set constraints all immediate$$,'actual service deferred commit accepts callback+finance+input3+state as one transaction');
set constraints all deferred;
update typed_ctx set hold_id=(select hold_ledger_transaction_id from public.withdrawal_requests where id=request_id);
update principal_runtime_ctx set hold_clock=(select a.id from app_private.funding_withdrawal_clock_admissions a
 where a.withdrawal_id=(select request_id from typed_ctx) and a.phase='HOLD');
update principal_runtime_ctx set boundary=(select b.id from app_private.funding_principal_boundary_preparations b where b.clock_admission_id=hold_clock),
 hold_state=(select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx));
select is((select runtime_outcome from app_private.funding_principal_boundary_completions where boundary_id=(select boundary from principal_runtime_ctx)),
 'ACCEPTED','genuine first-cycle completed HOLD accepts a sealed prospective input3');
select ok((select b.previous_state_id=r.old_state and b.effective_at=a.effective_at and b.recorded_at=a.effective_at
 and e.settled_to=a.effective_at and e.recorded_at=a.effective_at and c.effective_at=a.effective_at and c.recorded_at=a.effective_at
 and s.cursor_at=a.effective_at and s.recorded_at=a.effective_at and k.effective_at=a.effective_at and k.recorded_at=a.effective_at
 from principal_runtime_ctx r join app_private.funding_principal_boundary_preparations b on b.id=r.boundary
 join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id
 join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
 join app_private.funding_principal_boundary_completions k on k.boundary_id=b.id
 join app_private.funding_condition_originals c on c.id=k.condition_id
 join app_private.funding_engine_state_receipts s on s.id=k.accepted_state_id),
 'one130 admitted instant binds old earning/new native source/condition/state/completion without retimestamping');
select is((select (inputs->>'principal_atomic')::bigint from app_private.funding_condition_originals where id=
 (select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx))),
 (select principal_before-300000 from principal_runtime_ctx),'next input uses exact remaining principal after native hold');
select is((select sum(allocation_micro_krw)::bigint from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=(select hold_id from typed_ctx)),
 300000000000::bigint,'native newest-lot principal allocations conserve reserved amount exactly once');

select ok((select cap.base_capacity_num*expected_base[2]=expected_base[1]*cap.base_capacity_den
 and cap.retention_capacity_num*expected_ret[2]=expected_ret[1]*cap.retention_capacity_den
 from principal_runtime_ctx r join app_private.funding_principal_boundary_preparations b on b.id=r.boundary
 join app_private.funding_engine_state_receipts old_state on old_state.id=b.previous_state_id
 join app_private.funding_condition_originals old_condition on old_condition.id=old_state.condition_id
 join app_private.funding_principal_boundary_completions done on done.boundary_id=b.id
 join app_private.funding_effective_capacity_receipts cap on cap.state_id=done.accepted_state_id
 join app_private.funding_cycle_windows w on w.id=old_state.cycle_id
 join public.withdrawal_requests request on request.id=(select request_id from typed_ctx)
 cross join lateral(select app_private.funding_state_effective_capacities(old_state.id) old_cap,
 (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::numeric span,
 (extract(epoch from w.cycle_end-b.effective_at)*1000000)::numeric remaining,
 ((old_condition.inputs->>'principal_atomic')::numeric-request.amount_atomic) next_principal) raw
 cross join lateral(select value tier from app_private.economy_policy_published policy,
 jsonb_array_elements(policy.config->'tiers') where policy.publication_id=(old_condition.inputs->>'policy_publication_id')::uuid
 and(value->>'minimumPrincipalKrw')::numeric<=raw.next_principal
 and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::numeric>=raw.next_principal)) rule
 cross join lateral(select app_private.funding_exact_ratio(raw.old_cap[1]*10000*raw.span+
 ((raw.next_principal-(old_condition.inputs->>'principal_atomic')::numeric)*(old_condition.inputs->>'base_bps')::numeric)*raw.remaining*raw.old_cap[2],
 raw.old_cap[2]*10000*raw.span) expected_base,
 app_private.funding_exact_ratio(raw.old_cap[3]*10000*raw.span+
 (raw.next_principal*(rule.tier->>'retentionBonusBps')::numeric-
 (old_condition.inputs->>'principal_atomic')::numeric*(old_condition.inputs->>'retention_bps')::numeric)*raw.remaining*raw.old_cap[4],
 raw.old_cap[4]*10000*raw.span) expected_ret) math),
 'HOLD capacities equal independent principal/rule remaining-window rational equation; allocation never enters either capacity');
select ok(not exists(select 1 from public.mining_reward_withdrawal_reservations where hold_ledger_transaction_id=(select hold_id from typed_ctx)),
 'explicit server principal type is never inferred from mining reservation');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),'COMPLETE',
 'real finance preserves full truthful source coverage');
select is((select c.cycle_started_at from app_private.funding_cycle_windows c join app_private.funding_engine_state s on s.cycle_id=c.id
 where s.user_id=(select member_id from prospective_ctx)),(select anchor_before from typed_ctx),'HOLD preserves original anchor');
select is((select c.cycle_end from app_private.funding_cycle_windows c join app_private.funding_engine_state s on s.cycle_id=c.id
 where s.user_id=(select member_id from prospective_ctx)),(select end_before from typed_ctx),'HOLD preserves original cycle end');
select ok((select s.base_used_num::text=e.calculation->>'baseUsedNum' and s.retention_used_num::text=e.calculation->>'retentionUsedNum'
 and s.carry_num::text=e.calculation->>'carryNum' and s.carry_den::text=e.calculation->>'carryDen'
 from app_private.funding_engine_state s join app_private.funding_earned_receipts e on e.id=s.earned_receipt_id
 where s.id=(select hold_state from principal_runtime_ctx)), 'old exact used/carry is preserved at prospective HOLD boundary');
select is((select e.calculation->>'qualifiedRetentionNum' from app_private.funding_earned_receipts e where e.cause_principal_boundary_id=(select boundary from principal_runtime_ctx)),
 '0','HOLD boundary never pays unapproved held-cycle-end maintenance');
select ok((public.read_own_mining_server_display((select member_id from prospective_ctx))->'funded_runtime'->>'status')='ACTIVE',
 'strict server DTO can prove current accepted paid runtime without a legacy session');
update principal_runtime_ctx set job=app_private.prepare_default_funding_job((select activation_id from app_private.funding_engine_state
 where user_id=(select member_id from prospective_ctx)));
select lives_ok($$set constraints all immediate$$,'actual service input3 manual-job preparation commits');
set constraints all deferred;
select ok((select available_at='infinity'::timestamptz from public.system_jobs where id=(select job from principal_runtime_ctx)),
 'input3 connection leaves automatic scheduling dormant');
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from principal_runtime_ctx);
set local role service_role;
select id from public.claim_system_jobs('133-principal-worker',100,300);
select throws_ok($$select public.complete_system_job(job,'133-foreign-worker') from principal_runtime_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','input3 worker retains exact live fence ownership');
select lives_ok($$select public.complete_system_job(job,'133-principal-worker') from principal_runtime_ctx$$,
 'canonical complete_system_job accepts current input3 with exact forward capacities');
select lives_ok($$set constraints all immediate$$,'input3 worker and actual SUCCEEDED attempt commit as service');
set constraints all deferred;
select ok((select j.status='SUCCEEDED' and s.condition_id=c.condition_id from public.system_jobs j
 join app_private.funding_earned_receipts e on e.job_id=j.id join app_private.funding_engine_state_receipts s on s.id=e.next_state_id
 join app_private.funding_principal_boundary_completions c on c.boundary_id=(select boundary from principal_runtime_ctx)
 where j.id=(select job from principal_runtime_ctx)), 'manual worker preserves accepted principal condition');
select lives_ok($$select public.release_withdrawal_hold(request_id,(select admin_id from prospective_ctx),'133 exact principal cancellation',
 '133-first-cancel','CANCELLED') from typed_ctx$$,'actual canonical CANCEL settles old eligible interval and resumes reserved portions prospectively');
select lives_ok($$set constraints all immediate$$,'actual service deferred CANCEL completion proves one atomic source/condition/state cutover');
set constraints all deferred;
update principal_runtime_ctx set release_clock=(select a.id from app_private.funding_withdrawal_clock_admissions a
 where a.withdrawal_id=(select request_id from typed_ctx) and a.phase='RELEASE');
update principal_runtime_ctx set release_boundary=(select b.id from app_private.funding_principal_boundary_preparations b where b.clock_admission_id=release_clock);
select is((select runtime_outcome from app_private.funding_principal_boundary_completions where boundary_id=(select release_boundary from principal_runtime_ctx)),
 'ACCEPTED','genuine first-cycle CANCEL accepts prospective resumed principal input3');
select is((select (inputs->>'principal_atomic')::bigint from app_private.funding_condition_originals where id=
 (select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx))),
 (select principal_before from principal_runtime_ctx),'CANCEL restores available principal without backdating capacity or age');

select ok((select cap.base_capacity_num*expected_base[2]=expected_base[1]*cap.base_capacity_den
 and cap.retention_capacity_num*expected_ret[2]=expected_ret[1]*cap.retention_capacity_den
 from principal_runtime_ctx r join app_private.funding_principal_boundary_preparations b on b.id=r.release_boundary
 join app_private.funding_engine_state_receipts old_state on old_state.id=b.previous_state_id
 join app_private.funding_condition_originals old_condition on old_condition.id=old_state.condition_id
 join app_private.funding_principal_boundary_completions done on done.boundary_id=b.id
 join app_private.funding_effective_capacity_receipts cap on cap.state_id=done.accepted_state_id
 join app_private.funding_cycle_windows w on w.id=old_state.cycle_id
 join public.withdrawal_requests request on request.id=(select request_id from typed_ctx)
 cross join lateral(select app_private.funding_state_effective_capacities(old_state.id) old_cap,
 (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::numeric span,
 (extract(epoch from w.cycle_end-b.effective_at)*1000000)::numeric remaining,
 ((old_condition.inputs->>'principal_atomic')::numeric+request.amount_atomic) next_principal) raw
 cross join lateral(select value tier from app_private.economy_policy_published policy,
 jsonb_array_elements(policy.config->'tiers') where policy.publication_id=(old_condition.inputs->>'policy_publication_id')::uuid
 and(value->>'minimumPrincipalKrw')::numeric<=raw.next_principal
 and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::numeric>=raw.next_principal)) rule
 cross join lateral(select app_private.funding_exact_ratio(raw.old_cap[1]*10000*raw.span+
 ((raw.next_principal-(old_condition.inputs->>'principal_atomic')::numeric)*(old_condition.inputs->>'base_bps')::numeric)*raw.remaining*raw.old_cap[2],
 raw.old_cap[2]*10000*raw.span) expected_base,
 app_private.funding_exact_ratio(raw.old_cap[3]*10000*raw.span+
 (raw.next_principal*(rule.tier->>'retentionBonusBps')::numeric-
 (old_condition.inputs->>'principal_atomic')::numeric*(old_condition.inputs->>'retention_bps')::numeric)*raw.remaining*raw.old_cap[4],
 raw.old_cap[4]*10000*raw.span) expected_ret) math),
 'CANCEL capacities equal independent principal/rule remaining-window rational equation; allocation never enters either capacity');
select ok(not exists(select 1 from app_private.funding_portion_clock_state c where c.user_id=(select member_id from prospective_ctx) and c.status='HELD'),
 'all genuine released leaf portions resume AVAILABLE');
select ok(not exists(select 1 from public.funding_principal_recovery_releases r
 join app_private.funding_portion_transitions t on t.kind='RELEASE' and t.original_id=r.id
 join app_private.funding_portion_clock_receipts n on n.transition_id=t.id
 join app_private.funding_portion_clock_receipts p on p.id=n.previous_clock_id
 where r.release_ledger_transaction_id=(select release_ledger_transaction_id from public.withdrawal_requests where id=(select request_id from typed_ctx))
 and(n.accumulated_eligible_microseconds<>p.accumulated_eligible_microseconds or n.resumed_at<>t.effective_at)),
 'CANCEL excludes every held interval and preserves original accumulated eligible age');

update typed_ctx set state_before=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx));
update typed_ctx set mining_request=public.request_krw_withdrawal((select member_id from prospective_ctx),bank_id,1,'133-generic-mining-only');
select lives_ok($$set constraints all immediate$$,'ordinary public MINING_REWARD hold still commits beside accepted input3');
set constraints all deferred;
select ok(exists(select 1 from public.mining_reward_withdrawal_reservations r join public.withdrawal_requests w
 on w.hold_ledger_transaction_id=r.hold_ledger_transaction_id where w.id=(select mining_request from typed_ctx))
 and not exists(select 1 from public.funding_principal_recovery_allocations a join public.withdrawal_requests w
 on w.hold_ledger_transaction_id=a.hold_ledger_transaction_id where w.id=(select mining_request from typed_ctx)),
 'ordinary public withdrawal retains verified MINING_REWARD-only source and never guesses principal intent');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state_before from typed_ctx),'ordinary MINING_REWARD hold preserves principal eligible state and capacities');
select public.release_withdrawal_hold(mining_request,(select admin_id from prospective_ctx),'133 ordinary mining cancellation',
 '133-generic-mining-cancel','CANCELLED') from typed_ctx;
select lives_ok($$set constraints all immediate$$,'ordinary MINING_REWARD release remains a native reservation disposition');
set constraints all deferred;
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state_before from typed_ctx),'ordinary mining CANCEL preserves paid principal engine state');

update principal_runtime_ctx set journal_before=(select count(*) from public.ledger_transactions),source_before=(select count(*) from public.money_source_movements),
 earned_before=(select count(*) from app_private.funding_earned_receipts),portion_before=(select count(*) from app_private.funding_portion_clock_receipts);
set local time zone 'Asia/Seoul';
select is((select app_private.prepare_principal_recovery_intent(request_id,trace_id) from typed_ctx),(select intent_id from typed_ctx),
 'archived HOLD type replays after real CANCEL and later worker state across TimeZone');
select lives_ok($$select app_private.finish_principal_runtime_boundary(hold_clock) from principal_runtime_ctx$$,
 'completed archived HOLD earning/input3/state proof replays after CANCEL without current-input guessing');
select lives_ok($$select app_private.finish_principal_runtime_boundary(release_clock) from principal_runtime_ctx$$,
 'completed CANCEL cause replays immutably across TimeZone');
set local time zone 'UTC';
select is((select count(*) from public.ledger_transactions),(select journal_before from principal_runtime_ctx),'cause replay creates no finance or mining journal');
select is((select count(*) from public.money_source_movements),(select source_before from principal_runtime_ctx),'cause replay creates no money source');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_before from principal_runtime_ctx),'cause replay accepts no second earning');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select portion_before from principal_runtime_ctx),'cause replay never pauses/resumes an original portion twice');
select throws_ok($$insert into app_private.funding_principal_boundary_completions default values$$,'42501',null,'raw service cannot insert false ACTIVE completion');
select throws_ok($$update app_private.funding_principal_boundary_preparations set phase=phase where id=(select boundary from principal_runtime_ctx)$$,
 '42501',null,'service cannot change immutable cause');
reset role;
select throws_ok($$delete from app_private.funding_principal_boundary_completions where boundary_id=(select boundary from principal_runtime_ctx)$$,
 '55000','funding_principal_boundary_completions is append-only','trusted owner fixture cannot delete immutable completion');
set constraints all immediate;
select * from finish();
rollback;
