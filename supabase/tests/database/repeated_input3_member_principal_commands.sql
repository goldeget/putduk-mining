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

-- The canonical77 prefix above is unchanged. This test creates no synthetic
-- principal REQUESTED row: consent uses actual authenticated SQL/JWT, and the
-- existing service hold command creates its owned request and native originals.
-- Mature destination and withdrawal-policy content remain explicit owner-only
-- local fixtures; they do not prove production bank verification or new policy.
create temporary table member_principal_ctx(bank_id uuid,policy_id uuid,record jsonb,key text,confirmation uuid,
 withdrawal uuid,trace uuid,old_state uuid,anchor timestamptz,cycle_end timestamptz,
 original_count bigint,journal_count bigint,source_count bigint,portion_count bigint,earned_count bigint,
 principal_before numeric,state_before uuid,ordinary uuid,ordinary_key text);
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,
 fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10634001,true,1,0,'{}',clock_timestamp(),admin_id,false from prospective_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
 display_hint,verification_status,verified_at,protection_until)
select member_id,'KRW_BANK',decode(repeat('ae',32),'hex'),encode(extensions.digest(member_id::text,'sha256'),'hex'),
 'Local owner-only mature destination fixture','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day'
 from prospective_ctx;
insert into member_principal_ctx(bank_id,policy_id,old_state,anchor,cycle_end)
select d.id,p.id,s.id,w.cycle_started_at,w.cycle_end from prospective_ctx c
 join public.withdrawal_destinations d on d.user_id=c.member_id
 join public.withdrawal_policies p on p.version=10634001
 join app_private.funding_engine_state s on s.user_id=c.member_id
 join app_private.funding_cycle_windows w on w.id=s.cycle_id;
grant select,update on member_principal_ctx to service_role,authenticated;
select ok(not has_table_privilege('service_role','app_private.withdrawal_principal_confirmation_originals','INSERT')
 and not has_table_privilege('authenticated','app_private.withdrawal_principal_confirmation_originals','SELECT'),
 'member consent originals have no raw writer or member relation grant');
select ok(has_function_privilege('authenticated','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)','EXECUTE')
 and not has_function_privilege('service_role','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)','EXECUTE'),
 'signed member overload cannot be invoked with the server service key');
select ok(not has_function_privilege('authenticated','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid)','EXECUTE')
 and has_function_privilege('service_role','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid)','EXECUTE'),
 'existing seven-argument service preparation remains separate');
select ok(not has_function_privilege('authenticated','app_private.request_member_confirmed_principal_hold(text)','EXECUTE')
 and not has_function_privilege('service_role','app_private.verify_member_principal_confirmation_commit()','EXECUTE'),
 'financial dispatch is service-only and integrity definer trigger-only');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef
 and(p.oid='public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)'::regprocedure
 or p.oid='app_private.verify_member_principal_confirmation_commit()'::regprocedure)),2::bigint,
 'exactly two closed definers are added by this candidate');
-- Owner-only transport wrapper establishes the test JWT/actual SQL role;
-- the persisted positive producer remains the authenticated canonical RPC.
create function pg_temp.try_member_principal_confirmation(p_changed_subject uuid default null) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='134_AUTH_TRANSPORT_FIXTURE_OWNER_ONLY';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from pg_temp.prospective_ctx))::text,true);
 execute 'set local role authenticated';
 perform public.prepare_withdrawal_logical_request((select member_id from pg_temp.prospective_ctx),'KRW_BANK',300000,
  (select policy_id from pg_temp.member_principal_ctx),10634001,null,(select bank_id from pg_temp.member_principal_ctx),
  '{"version":1,"source":"PRINCIPAL","confirmed":true}');
 if p_changed_subject is not null then
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_changed_subject)::text,true);end if;
 set constraints all immediate;
end;
$$;
revoke all on function pg_temp.try_member_principal_confirmation(uuid) from public,anon,authenticated,service_role;
create function pg_temp.member_principal_event_fault() returns trigger language plpgsql as $$
begin if new.event_type='WITHDRAWAL_PRINCIPAL_CONFIRMED.v1' then return null;end if;return new;end;
$$;
update member_principal_ctx set original_count=(select count(*) from app_private.withdrawal_principal_confirmation_originals),
 journal_count=(select count(*) from public.ledger_transactions),source_count=(select count(*) from public.money_source_movements);
select throws_ok($$select pg_temp.try_member_principal_confirmation((select other_id from prospective_ctx))$$,
 '42501','WITHDRAWAL_PRINCIPAL_MEMBER_COMMIT_SUBJECT_FORBIDDEN','actual authenticated commit rejects a subject changed after confirmation returns');
select is((select count(*) from app_private.withdrawal_principal_confirmation_originals),(select original_count from member_principal_ctx),
 'wrong deferred subject leaves no consent original');
create trigger member_principal_event_fault before insert on public.outbox_events for each row execute function pg_temp.member_principal_event_fault();
select throws_ok($$select pg_temp.try_member_principal_confirmation()$$,'55000','FUNDING_ENGINE_ORIGINAL_SEAL_MISMATCH',
 'genuine member confirmation cannot commit without its actual sealed event');
drop trigger member_principal_event_fault on public.outbox_events;
select is((select count(*) from app_private.withdrawal_principal_confirmation_originals),(select original_count from member_principal_ctx),
 'suppressed event removes the entire immutable member confirmation');
select is((select count(*) from public.withdrawal_logical_requests where schema_version=3),0::bigint,
 'failed member confirmation leaves no pending version3 logical key');
select is((select count(*) from public.ledger_transactions),(select journal_count from member_principal_ctx),
 'member authority failures create zero financial journals');
select is((select count(*) from public.money_source_movements),(select source_count from member_principal_ctx),
 'member authority failures create zero principal or mining source entries');

select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":true}')$$,'42501','WITHDRAWAL_PRINCIPAL_MEMBER_AUTH_REQUIRED',
 'authenticated SQL without a real member subject cannot create consent');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from prospective_ctx))::text,true);
set local role authenticated;
select throws_ok($$select public.prepare_withdrawal_logical_request((select other_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":true}')$$,'42501','WITHDRAWAL_PRINCIPAL_MEMBER_AUTH_REQUIRED',
 'caller-supplied owner cannot replace the signed member');
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":false}')$$,'22023','WITHDRAWAL_PRINCIPAL_EXPLICIT_CONFIRMATION_REQUIRED',
 'false confirmation is never inferred from a destination or session');
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"MINING_REWARD","confirmed":true}')$$,'22023','WITHDRAWAL_PRINCIPAL_EXPLICIT_CONFIRMATION_REQUIRED',
 'principal overload refuses a different source discriminator');
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,null,
 '{"version":1,"source":"PRINCIPAL","confirmed":true}')$$,'22023','WITHDRAWAL_PRINCIPAL_EXPLICIT_CONFIRMATION_REQUIRED',
 'confirmation binds an existing destination instead of raw unverified material');
update member_principal_ctx set record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),
 'KRW_BANK',300000,policy_id,10634001,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}');
select lives_ok($$set constraints all immediate$$,'actual authenticated commit proves closed member consent and both seals');
set constraints all deferred;
select is((select record->>'v' from member_principal_ctx),'3','principal recovery has explicit version3 record');
select is((select record#>>'{source,kind}' from member_principal_ctx),'PRINCIPAL','immutable source is explicit principal only');
select is((select record->>'amountKrw' from member_principal_ctx),'300000','consent binds exact amount without any reward input');
select is((select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 policy_id,10634001,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}') from member_principal_ctx),
 (select record from member_principal_ctx),'same pending confirmation returns its immutable original key');
set local timezone='Asia/Seoul';
select is((select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 policy_id,10634001,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}') from member_principal_ctx),
 (select record from member_principal_ctx),'same immutable member confirmation replays exactly across session TimeZone');
set local timezone='UTC';
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300001,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":true}')$$,'55000','WITHDRAWAL_LOGICAL_PENDING',
 'changed amount cannot reuse consent or allocate another pending key');
reset role;
update member_principal_ctx set key=record->>'key',confirmation=(record#>>'{source,confirmationId}')::uuid;
select ok((select o.user_id=c.member_id and o.confirmed_at=l.created_at and o.confirmed_at=a.created_at
 and o.confirmed_at=e.occurred_at and o.confirmed_at=e.created_at and o.request_id=a.request_id
 and o.request_id=e.request_id and o.request_id=e.correlation_id
 from member_principal_ctx x join prospective_ctx c on true
 join app_private.withdrawal_principal_confirmation_originals o on o.id=x.confirmation
 join public.withdrawal_logical_requests l on l.idempotency_key=o.logical_key
 join public.audit_logs a on a.id=o.audit_id join public.outbox_events e on e.id=o.source_event_id),
 'one post-admission confirmation clock and signed owner bind logical/audit/event originals');
update member_principal_ctx set original_count=(select count(*) from app_private.withdrawal_principal_confirmation_originals),
 journal_count=(select count(*) from public.ledger_transactions),source_count=(select count(*) from public.money_source_movements),
 portion_count=(select count(*) from app_private.funding_portion_clock_receipts),earned_count=(select count(*) from app_private.funding_earned_receipts);
select is((select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select old_state from member_principal_ctx),'member consent is not a financial or engine cutover');
create function pg_temp.try_changed_principal_confirmation() returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare owner_id uuid;v_catalog_id uuid;catalog_digest text;previous_revision bigint;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='134_STALE_CONDITION_FIXTURE_OWNER_ONLY';end if;
 select member_id,catalog into owner_id,v_catalog_id from pg_temp.prospective_ctx;
 select r.snapshot_digest into catalog_digest from app_private.product_catalog_receipts r where r.catalog_id=v_catalog_id and r.state='PUBLISHED';
 select a.revision into previous_revision from app_private.funding_allocation_originals a where a.user_id=owner_id order by a.revision desc limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 execute 'set local role authenticated';
 perform public.confirm_funding_allocation('CONFIRM',v_catalog_id,catalog_digest,previous_revision,'[]','134-stale-consent-clear');
 set constraints all immediate;set constraints all deferred;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 execute 'set local role service_role';
 perform public.hold_withdrawal_logical_request(owner_id,(select key from pg_temp.member_principal_ctx),'KRW_BANK',
  (select bank_id from pg_temp.member_principal_ctx),300000);
end;
$$;
revoke all on function pg_temp.try_changed_principal_confirmation() from public,anon,authenticated,service_role;
select throws_ok($$select pg_temp.try_changed_principal_confirmation()$$,'55000','WITHDRAWAL_PRINCIPAL_CONDITIONS_CHANGED',
 'actual member allocation revision after consent requires new confirmation before principal finance');
select is((select count(*) from public.withdrawal_requests where idempotency_key=(select key from member_principal_ctx)),0::bigint,
 'stale confirmed condition creates no principal financial request');
select is((select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select old_state from member_principal_ctx),'stale-confirmation subtransaction preserves the original accepted state');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":true}')$$,'42501','permission denied for function prepare_withdrawal_logical_request',
 'service cannot masquerade as the signed member confirmation producer');
select throws_ok($$select public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',300000,
 (select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx))$$,
 '55000','WITHDRAWAL_LOGICAL_PENDING','ordinary preparation cannot adopt a principal pending request');
select throws_ok($$update public.withdrawal_logical_requests set amount_krw=300001
 where idempotency_key=(select key from member_principal_ctx)$$,'55000','WITHDRAWAL_PRINCIPAL_CONFIRMATION_IMMUTABLE',
 'service cannot rewrite consent amount through the mutable logical store');
select throws_ok($$update public.outbox_events set payload=payload||'{"forged":true}'
 where id=(select source_event_id from app_private.withdrawal_principal_confirmation_originals
 where id=(select confirmation from member_principal_ctx))$$,'55000','WITHDRAWAL_PRINCIPAL_CONFIRMATION_IMMUTABLE',
 'semantic consent outbox proof is immutable while lease columns remain operational');
reset role;
create function pg_temp.member_principal_completion_fault() returns trigger language plpgsql as $$
begin return null;end;
$$;
create function pg_temp.try_member_principal_hold() returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform public.hold_withdrawal_logical_request((select member_id from pg_temp.prospective_ctx),(select key from pg_temp.member_principal_ctx),
  'KRW_BANK',(select bank_id from pg_temp.member_principal_ctx),300000);
 set constraints all immediate;
end;
$$;
grant execute on function pg_temp.try_member_principal_hold() to service_role;
create trigger member_principal_completion_fault before insert on app_private.funding_principal_boundary_completions
 for each row execute function pg_temp.member_principal_completion_fault();
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select pg_temp.try_member_principal_hold()$$,'55000','WITHDRAWAL_PRINCIPAL_TYPED_COMPLETION_REQUIRED',
 'member-confirmed finance cannot commit a successor without actual completed principal boundary');
select is((select count(*) from public.ledger_transactions),(select journal_count from member_principal_ctx),
 'missing completed successor rolls back financial and mining journals together');
select is((select count(*) from public.money_source_movements),(select source_count from member_principal_ctx),
 'missing completed successor rolls back principal and mining source together');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select portion_count from member_principal_ctx),
 'failed principal finance preserves original eligibility history');
select is((select count(*) from public.withdrawal_requests where idempotency_key=(select key from member_principal_ctx)),0::bigint,
 'failed real command leaves no synthetic or financial request behind');
reset role;
drop trigger member_principal_completion_fault on app_private.funding_principal_boundary_completions;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;

update member_principal_ctx set withdrawal=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),
 key,'KRW_BANK',bank_id,300000);
select lives_ok($$set constraints all immediate$$,'actual service commit completes genuine member consent through native principal finance and runtime');
set constraints all deferred;
select is((select status::text from public.withdrawal_requests where id=(select withdrawal from member_principal_ctx)),
 'HELD','existing canonical logical hold produced real principal REQUESTED and HOLD originals');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','genuine member principal request remains fully classified after completion');
select is((select sum(allocation_micro_krw)::bigint from public.funding_principal_recovery_allocations
 where hold_ledger_transaction_id=(select hold_ledger_transaction_id from public.withdrawal_requests
 where id=(select withdrawal from member_principal_ctx))),300000000000::bigint,
 'native newest-lot principal reservation conserves the exact confirmed amount');
select is((select count(*) from public.mining_reward_withdrawal_reservations
 where hold_ledger_transaction_id=(select hold_ledger_transaction_id from public.withdrawal_requests
 where id=(select withdrawal from member_principal_ctx))),0::bigint,
 'principal confirmation never consumes a mining reward original');
select is((select count(*) from app_private.withdrawal_principal_confirmation_originals),
 (select original_count from member_principal_ctx),'financial execution does not recreate member consent');
select ok((select w.cycle_started_at=x.anchor and w.cycle_end=x.cycle_end
 from member_principal_ctx x join app_private.funding_engine_state s on s.user_id=(select member_id from prospective_ctx)
 join app_private.funding_cycle_windows w on w.id=s.cycle_id),'principal finance preserves original cycle anchor and end');
select is((select c.inputs->>'input_contract_version' from app_private.funding_engine_state s
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 '3','completed genuine principal hold receives current sealed input3 rather than a frontend estimate');
reset role;
update member_principal_ctx set journal_count=(select count(*) from public.ledger_transactions),
 source_count=(select count(*) from public.money_source_movements),portion_count=(select count(*) from app_private.funding_portion_clock_receipts),
 earned_count=(select count(*) from app_private.funding_earned_receipts);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.hold_withdrawal_logical_request((select member_id from prospective_ctx),(select key from member_principal_ctx),
 'KRW_BANK',(select bank_id from member_principal_ctx),300000),(select withdrawal from member_principal_ctx),
 'same canonical logical key recovers real principal hold without new gates or money');
select is((select count(*) from public.ledger_transactions),(select journal_count from member_principal_ctx),'replay adds zero journals');
select is((select count(*) from public.money_source_movements),(select source_count from member_principal_ctx),'replay adds zero source facts');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select portion_count from member_principal_ctx),'replay adds zero age facts');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count from member_principal_ctx),'replay adds zero earning originals');
select lives_ok($$select public.release_withdrawal_hold((select withdrawal from member_principal_ctx),
 (select admin_id from prospective_ctx),'member principal approved pause cancellation','134-member-principal-cancel','CANCELLED')$$,
 'canonical CANCEL resumes the genuine member principal reservation through the same closed originals');
select lives_ok($$set constraints all immediate$$,'actual service CANCEL commit preserves member confirmation and full runtime proof');
set constraints all deferred;
select ok(not exists(select 1 from app_private.funding_portion_clock_state c where c.user_id=(select member_id from prospective_ctx)
 and c.status='HELD'),'native cancellation leaves no held leaf portion');
select ok(not exists(select 1 from public.funding_principal_recovery_releases r
 join app_private.funding_portion_transitions t on t.kind='RELEASE' and t.original_id=r.id
 join app_private.funding_portion_clock_receipts n on n.transition_id=t.id
 join app_private.funding_portion_clock_receipts previous on previous.id=n.previous_clock_id
 where r.release_ledger_transaction_id=(select release_ledger_transaction_id from public.withdrawal_requests
 where id=(select withdrawal from member_principal_ctx))
 and(n.accumulated_eligible_microseconds<>previous.accumulated_eligible_microseconds or n.resumed_at<>t.effective_at)),
 'member principal CANCEL preserves accumulated age and excludes the entire held interval');
select is((select count(*) from app_private.withdrawal_principal_confirmation_originals),
 (select original_count from member_principal_ctx),'CANCEL neither resets nor rewrites the original signed member consent');
select lives_ok($$select public.resolve_withdrawal_logical_request((select member_id from prospective_ctx),'CONFIRM',
 (select key from member_principal_ctx),(select withdrawal from member_principal_ctx))$$,
 'canonical recovery acknowledges the completed original rather than discarding its key');
select lives_ok($$set constraints all immediate$$,'actual service recovery still verifies completed member originals');
set constraints all deferred;
reset role;
update member_principal_ctx set principal_before=(select eligible_principal_atomic::numeric from public.money_source_summaries
 where user_id=(select member_id from prospective_ctx)),state_before=(select id from app_private.funding_engine_state
 where user_id=(select member_id from prospective_ctx)),portion_count=(select count(*) from app_private.funding_portion_clock_receipts);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update member_principal_ctx set record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),
 'KRW_BANK',1,policy_id,10634001,null,bank_id);
select is((select record->>'v' from member_principal_ctx),'2','ordinary seven-argument command keeps the original version2 record');
select ok(not((select record from member_principal_ctx)?'source'),'ordinary preparation never inherits the principal source envelope');
update member_principal_ctx set ordinary_key=record->>'key';
update member_principal_ctx set ordinary=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),
 ordinary_key,'KRW_BANK',bank_id,1);
select lives_ok($$set constraints all immediate$$,'existing ordinary MINING_REWARD hold still commits after genuine principal HOLD and CANCEL');
set constraints all deferred;
select is((select eligible_principal_atomic::numeric from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 (select principal_before from member_principal_ctx),'ordinary mining withdrawal preserves principal eligibility exactly');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select portion_count from member_principal_ctx),
 'ordinary mining hold does not pause or reset principal age');
select is((select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select state_before from member_principal_ctx),'ordinary mining hold does not fabricate a new principal runtime condition');
select is((select sum(amount_atomic)::bigint from public.mining_reward_withdrawal_reservations
 where hold_ledger_transaction_id=(select hold_ledger_transaction_id from public.withdrawal_requests
 where id=(select ordinary from member_principal_ctx))),1::bigint,'ordinary path reserves actual verified mining originals only');
reset role;
select ok(not has_function_privilege('service_role',
 'app_private.verify_principal_history_portion_fact(app_private.funding_portion_transitions,uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.assert_principal_input_snapshot(uuid)','EXECUTE'),
 'genuine service replay does not grant archived private proof readers');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[] from pg_proc
 where oid='app_private.assert_member_principal_hold_completion(uuid)'::regprocedure),
 'service financial completion dispatch remains a fixed-path invoker with no new definer');
--135 narrow candidate proof. The preceding144 assertions are frozen134v3
-- canonical member consent -> HOLD -> CANCEL -> ordinary MINING_REWARD.
-- No positive principal REQUESTED row is planted by owner/service fixtures.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.resolve_withdrawal_logical_request((select member_id from prospective_ctx),'CONFIRM',
 (select ordinary_key from member_principal_ctx),(select ordinary from member_principal_ctx))$$,
 'ordinary original is acknowledged before a separately confirmed principal request');
select lives_ok($$select public.release_withdrawal_hold((select ordinary from member_principal_ctx),
 (select admin_id from prospective_ctx),'restore actual ordinary mining reservation','135-ordinary-cancel','CANCELLED')$$,
 'ordinary mining CANCEL restores its own verified mining source without principal mutation');
select lives_ok($$set constraints all immediate$$,'actual service ordinary recovery/CANCEL commits before repeat principal tests');
set constraints all deferred;
reset role;
create temporary table repeat_principal_ctx(record jsonb,key text,withdrawal uuid,second_record jsonb,second_key text,second_withdrawal uuid,
 old_state uuid,old_state_json jsonb,old_condition uuid,old_boundary uuid,old_input jsonb,old_caps numeric[],
 principal_before numeric,held_before numeric,journal_count bigint,source_count bigint,age_count bigint,intent_count bigint,
 confirmation_count bigint,earned_count bigint,job uuid,boundary uuid);
insert into repeat_principal_ctx(old_state,old_state_json,old_condition,old_boundary,old_input,old_caps,principal_before,held_before)
select s.id,to_jsonb(s),c.id,c.cause_principal_boundary_id,c.inputs,app_private.funding_state_effective_capacities(s.id),
 (c.inputs->>'principal_atomic')::numeric,(c.inputs->>'held_principal_atomic')::numeric
 from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id
 where s.user_id=(select member_id from prospective_ctx);
grant select,update on repeat_principal_ctx to service_role,authenticated;
select ok((select old_input->>'input_contract_version'='3' and old_boundary is not null and held_before=0 from repeat_principal_ctx),
 'repeat begins from genuine completed CANCEL input3 with historical independent ages');
select ok(not has_function_privilege('service_role','app_private.read_principal_input3_prefinance_current_inputs(uuid,uuid,timestamptz,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.read_principal_input3_prefinance_current_inputs(uuid,uuid,timestamptz,uuid,uuid)','EXECUTE'),
 'closed own-request reader grants neither service nor member direct execution');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[] from pg_proc
 where oid='app_private.read_principal_input3_prefinance_current_inputs(uuid,uuid,timestamptz,uuid,uuid)'::regprocedure),
 'new current-input reader is a fixed-path invoker, not a new economic definer');
-- A controlled real worker advancement proves current-state revision may move
-- without rewriting the completed condition or immutable portion originals.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update repeat_principal_ctx set job=app_private.prepare_default_funding_job((select activation_id
 from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)));
select lives_ok($$set constraints all immediate$$,'actual service seals a controlled input3 job before repeat intent');
set constraints all deferred;
reset role;
select ok((select available_at='infinity'::timestamptz from public.system_jobs where id=(select job from repeat_principal_ctx)),
 'manual reference job remains dormant until explicit owner-only local fixture admission');
update public.system_jobs set available_at=clock_timestamp() where id=(select job from repeat_principal_ctx);
set local role service_role;
select id from public.claim_system_jobs('135-repeat-reference-worker',100,300);
select lives_ok($$select public.complete_system_job(job,'135-repeat-reference-worker') from repeat_principal_ctx$$,
 'existing canonical worker advances used/carry from genuine accepted input3');
select lives_ok($$set constraints all immediate$$,'actual service worker commits success before subsequent principal request');
set constraints all deferred;
select ok((select s.id<>r.old_state and s.condition_id=r.old_condition from repeat_principal_ctx r
 join app_private.funding_engine_state s on s.user_id=(select member_id from prospective_ctx)),
 'worker advancement preserves exact archived condition while changing current accepted state');
reset role;
update repeat_principal_ctx set old_state=(select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 old_state_json=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 old_caps=app_private.funding_state_effective_capacities((select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx))),
 journal_count=(select count(*) from public.ledger_transactions),source_count=(select count(*) from public.money_source_movements),
 age_count=(select count(*) from app_private.funding_portion_clock_receipts),intent_count=(select count(*) from app_private.funding_principal_recovery_intent_originals),
 confirmation_count=(select count(*) from app_private.withdrawal_principal_confirmation_originals),earned_count=(select count(*) from app_private.funding_earned_receipts);
-- Explicit owner-only NEGATIVE request fixture. It supplies no positive consent
-- or source authority and is wholly rolled back by each failing pgTAP attempt.
create function pg_temp.repeat_negative_request(p_case text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select member_id from pg_temp.prospective_ctx);request_id uuid;trace uuid:=gen_random_uuid();amount bigint:=300000;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='135_NEGATIVE_FIXTURE_OWNER_ONLY';end if;
 if p_case not in('EXTRA_PENDING','WRONG_SUBJECT','CAPTURE_ONLY') then
  raise exception using errcode='22023',message='135_NEGATIVE_CASE_INVALID';end if;
 insert into public.withdrawal_requests(wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,currency,
  amount_atomic,fee_atomic,destination_type,destination_snapshot,status,idempotency_key)
 select w.id,x.policy_id,x.bank_id,owner_id,'KRW',amount,0,'KRW_BANK',
  jsonb_build_object('destination_id',d.id,'display',d.display_hint,'verified_at',d.verified_at),'REQUESTED',
  '135-negative-only:'||gen_random_uuid()::text from pg_temp.member_principal_ctx x
 join public.withdrawal_destinations d on d.id=x.bank_id join public.wallet_accounts w on w.user_id=owner_id and w.currency='KRW'
 returning withdrawal_requests.id into request_id;
 if p_case='EXTRA_PENDING' then
  insert into public.withdrawal_requests(wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,currency,
   amount_atomic,fee_atomic,destination_type,destination_snapshot,status,idempotency_key)
  select wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,currency,1,0,destination_type,destination_snapshot,
   'REQUESTED','135-extra-negative-only:'||gen_random_uuid()::text from public.withdrawal_requests where id=request_id;
 end if;
 perform set_config('request.jwt.claims',case when p_case='WRONG_SUBJECT' then
  jsonb_build_object('role','service_role','sub',(select other_id from pg_temp.prospective_ctx))::text else '{"role":"service_role"}' end,true);
 execute 'set local role service_role';
 perform app_private.prepare_principal_recovery_intent(request_id,trace);
 set constraints all immediate;
 return request_id;
end;
$$;
revoke all on function pg_temp.repeat_negative_request(text) from public,anon,authenticated,service_role;
select throws_ok($$select pg_temp.repeat_negative_request('EXTRA_PENDING')$$,'55000','PRINCIPAL_RECOVERY_INTENT_SOURCE_UNRESOLVED',
 'input3 exact own-request exclusion cannot excuse a second unrelated REQUESTED original');
select throws_ok($$select pg_temp.repeat_negative_request('WRONG_SUBJECT')$$,'42501','PRINCIPAL_RECOVERY_INTENT_SUBJECT_FORBIDDEN',
 'repeated input3 type remains bound to actual service subject');
select throws_ok($$select pg_temp.repeat_negative_request('CAPTURE_ONLY')$$,'55000','PRINCIPAL_RECOVERY_INTENT_HOLD_COMPLETION_REQUIRED',
 'input3 capture-only cannot survive actual service deferred completion without native finance');
select is((select count(*) from app_private.funding_principal_recovery_intent_originals),(select intent_count from repeat_principal_ctx),
 'all failing repeated type attempts remove their private original');
select is((select count(*) from public.ledger_transactions),(select journal_count from repeat_principal_ctx),
 'all failing repeated type attempts add no financial journal');
select is((select count(*) from public.money_source_movements),(select source_count from repeat_principal_ctx),
 'all failing repeated type attempts add no source movement');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select age_count from repeat_principal_ctx),
 'all failing repeated type attempts preserve every original age clock');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select old_state_json from repeat_principal_ctx),'all failing repeated type attempts preserve state/cursor/used/carry');
select is((select count(*) from public.withdrawal_requests where idempotency_key like '135-%negative-only:%'),0::bigint,
 'negative fixtures leave no unclassified financial request');
-- Genuine authenticated member confirmation after previous HOLD+CANCEL and
-- controlled worker advancement. This is separate from trusted-service type.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from prospective_ctx))::text,true);
set local role authenticated;
update repeat_principal_ctx set record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),
 'KRW_BANK',300000,(select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":true}');
select lives_ok($$set constraints all immediate$$,'actual member commits a new explicit principal confirmation bound to input3');
set constraints all deferred;
reset role;
update repeat_principal_ctx set key=record->>'key';
create temporary table repeat_before_portions as
 select p.id as portion_id,p.lot_id,p.amount_micro_krw,c.id as clock_id,c.status,c.accumulated_eligible_microseconds,c.resumed_at
 from app_private.funding_principal_portions p join app_private.funding_portion_clock_state c on c.portion_id=p.id
 where p.user_id=(select member_id from prospective_ctx);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update repeat_principal_ctx set withdrawal=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),
 key,'KRW_BANK',(select bank_id from member_principal_ctx),300000);
select lives_ok($$set constraints all immediate$$,'actual service commits repeated member-confirmed input3 HOLD with complete native/runtime proof');
set constraints all deferred;
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','repeated principal HOLD has truthful public COMPLETE after native finance');
select is((select i.source_inputs from app_private.funding_principal_recovery_intent_originals i
 where i.withdrawal_id=(select withdrawal from repeat_principal_ctx)),(select old_input from repeat_principal_ctx),
 'repeated typed original retains exact old input3 rather than reconstructing a new history');
select is((select b.old_input_original from app_private.funding_principal_boundary_preparations b
 join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id
 where a.withdrawal_id=(select withdrawal from repeat_principal_ctx) and a.phase='HOLD'),
 (select old_input from repeat_principal_ctx),'pre-finance callback settles the same exact accepted old input3');
select is((select c.inputs->>'principal_atomic' from app_private.funding_engine_state s
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 (select (principal_before-300000)::text from repeat_principal_ctx),'prospective condition uses native remaining principal only');
select is((select c.inputs->>'held_principal_atomic' from app_private.funding_engine_state s
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 '300000','prospective input3 independently records exactly held principal');
select ok((select a.effective_at=r.hold_posted_at and a.effective_at=b.effective_at and a.effective_at=k.effective_at
 and a.effective_at=e.settled_to and a.effective_at=s.cursor_at and a.effective_at=c.effective_at
 from repeat_principal_ctx x join public.withdrawal_requests r on r.id=x.withdrawal
 join app_private.funding_withdrawal_clock_admissions a on a.withdrawal_id=r.id and a.phase='HOLD'
 join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
 join app_private.funding_principal_boundary_completions k on k.boundary_id=b.id
 join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
 join app_private.funding_engine_state_receipts s on s.id=k.accepted_state_id
 join app_private.funding_condition_originals c on c.id=k.condition_id),
 'one admitted130 financial clock binds repeat old earning/native source/new condition/state/completion');
reset role;
-- Independent expected take by lot, age and immutable UUID, using original
-- before-HOLD clocks and the actual admitted instant. No current projection or
-- producer result supplies the ranking or the requested amount.
select ok(not exists(
 with expected as (
  select p.portion_id,least(p.amount_micro_krw,greatest(0,a.allocation_micro_krw-
   coalesce(sum(p.amount_micro_krw) over(partition by a.id order by age,p.portion_id rows between unbounded preceding and 1 preceding),0))) taken
  from repeat_before_portions p join public.funding_principal_recovery_allocations a on a.lot_id=p.lot_id
  join public.withdrawal_requests request on request.hold_ledger_transaction_id=a.hold_ledger_transaction_id
  cross join lateral(select p.accumulated_eligible_microseconds+
   (app_private.funding_global_eligible_interval(p.resumed_at,a.effective_at)->>'eligible_microseconds')::bigint as age) ages
  where request.id=(select withdrawal from repeat_principal_ctx) and p.status='AVAILABLE'
 ), actual as (
  select case when n.previous_clock_id is null then child.parent_portion_id else child.id end portion_id,
   sum(child.amount_micro_krw) taken from app_private.funding_portion_clock_receipts n
  join app_private.funding_principal_portions child on child.id=n.portion_id
  join app_private.funding_portion_transitions t on t.id=n.transition_id and t.kind='HOLD'
  join public.funding_principal_recovery_allocations a on a.id=t.original_id
  join public.withdrawal_requests request on request.hold_ledger_transaction_id=a.hold_ledger_transaction_id
  where request.id=(select withdrawal from repeat_principal_ctx) and n.status='HELD'
  group by case when n.previous_clock_id is null then child.parent_portion_id else child.id end
 ) select 1 from expected full join actual using(portion_id) where coalesce(expected.taken,0) is distinct from coalesce(actual.taken,0)),
 'repeat native HOLD chooses shortest eligible age then immutable UUID within newest native lots');
select ok(not exists(select 1 from app_private.funding_portion_clock_receipts n
 join app_private.funding_portion_transitions t on t.id=n.transition_id and t.kind='HOLD'
 join public.funding_principal_recovery_allocations a on a.id=t.original_id
 join public.withdrawal_requests r on r.hold_ledger_transaction_id=a.hold_ledger_transaction_id
 join repeat_before_portions p on p.clock_id=n.previous_clock_id
 where r.id=(select withdrawal from repeat_principal_ctx)
 and n.accumulated_eligible_microseconds is distinct from p.accumulated_eligible_microseconds+
 (app_private.funding_global_eligible_interval(p.resumed_at,a.effective_at)->>'eligible_microseconds')::bigint),
 'repeat HOLD preserves each independently accumulated eligible age, including split parents');
select ok((select w.cycle_started_at=x.anchor and w.cycle_end=x.cycle_end from member_principal_ctx x
 join app_private.funding_engine_state s on s.user_id=(select member_id from prospective_ctx)
 join app_private.funding_cycle_windows w on w.id=s.cycle_id),'repeat HOLD preserves the original global cycle anchor/end');
update repeat_principal_ctx set boundary=(select b.id from app_private.funding_principal_boundary_preparations b
 join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id
 where a.withdrawal_id=(select withdrawal from repeat_principal_ctx) and a.phase='HOLD');
select ok((select cap.base_capacity_num*expected_base[2]=expected_base[1]*cap.base_capacity_den
 and cap.retention_capacity_num*expected_ret[2]=expected_ret[1]*cap.retention_capacity_den
 from repeat_principal_ctx r join app_private.funding_principal_boundary_preparations b on b.id=r.boundary
 join app_private.funding_engine_state_receipts old_state on old_state.id=b.previous_state_id
 join app_private.funding_condition_originals old_condition on old_condition.id=old_state.condition_id
 join app_private.funding_principal_boundary_completions done on done.boundary_id=b.id
 join app_private.funding_effective_capacity_receipts cap on cap.state_id=done.accepted_state_id
 join app_private.funding_cycle_windows w on w.id=old_state.cycle_id
 join public.withdrawal_requests request on request.id=r.withdrawal
 cross join lateral(select r.old_caps old_cap,
 (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::numeric span,
 (extract(epoch from w.cycle_end-b.effective_at)*1000000)::numeric remaining,
 ((old_condition.inputs->>'principal_atomic')::numeric-300000) next_principal) raw
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
 'repeated input3 capacity uses independent old cap plus approved principal/rule remaining-window difference; allocation does not reduce capacity');
select ok((select s.base_used_num::text=e.calculation->>'baseUsedNum' and s.base_used_den::text=e.calculation->>'baseUsedDen'
 and s.retention_used_num::text=e.calculation->>'retentionUsedNum' and s.retention_used_den::text=e.calculation->>'retentionUsedDen'
 and s.carry_num::text=e.calculation->>'carryNum' and s.carry_den::text=e.calculation->>'carryDen'
 from repeat_principal_ctx r join app_private.funding_principal_boundary_completions k on k.boundary_id=r.boundary
 join app_private.funding_engine_state_receipts s on s.id=k.accepted_state_id
 join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=r.boundary),
 'repeated HOLD preserves exact settled used/carry, never zeroes them at the condition boundary');
select is((select count(*) from public.mining_reward_withdrawal_reservations x join public.withdrawal_requests r
 on r.hold_ledger_transaction_id=x.hold_ledger_transaction_id where r.id=(select withdrawal from repeat_principal_ctx)),0::bigint,
 'repeated explicit principal never debits or reserves a MINING_REWARD original');
update repeat_principal_ctx set journal_count=(select count(*) from public.ledger_transactions),
 source_count=(select count(*) from public.money_source_movements),age_count=(select count(*) from app_private.funding_portion_clock_receipts),
 earned_count=(select count(*) from app_private.funding_earned_receipts);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
set local timezone='Asia/Seoul';
select is(public.hold_withdrawal_logical_request((select member_id from prospective_ctx),(select key from repeat_principal_ctx),
 'KRW_BANK',(select bank_id from member_principal_ctx),300000),(select withdrawal from repeat_principal_ctx),
 'genuine repeated input3 financial original replays exactly across TimeZone without fresh source interpretation');
set local timezone='UTC';
select lives_ok($$set constraints all immediate$$,'actual service repeated original replay passes all immutable completion proofs');
set constraints all deferred;
select is((select count(*) from public.ledger_transactions),(select journal_count from repeat_principal_ctx),'repeat replay adds zero journals');
select is((select count(*) from public.money_source_movements),(select source_count from repeat_principal_ctx),'repeat replay adds zero source originals');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select age_count from repeat_principal_ctx),'repeat replay adds zero eligibility clocks');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count from repeat_principal_ctx),'repeat replay adds zero earned originals');
select lives_ok($$select public.resolve_withdrawal_logical_request((select member_id from prospective_ctx),'CONFIRM',
 (select key from repeat_principal_ctx),(select withdrawal from repeat_principal_ctx))$$,
 'first repeated HOLD is acknowledged before independently confirming another principal portion');
select lives_ok($$set constraints all immediate$$,'actual service acknowledgement retains the first still-HELD originals');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from prospective_ctx))::text,true);
set local role authenticated;
update repeat_principal_ctx set second_record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),
 'KRW_BANK',100000,(select policy_id from member_principal_ctx),10634001,null,(select bank_id from member_principal_ctx),
 '{"version":1,"source":"PRINCIPAL","confirmed":true}');
select lives_ok($$set constraints all immediate$$,'actual member separately confirms another available portion while previous principal remains HELD');
set constraints all deferred;
reset role;
update repeat_principal_ctx set second_key=second_record->>'key';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update repeat_principal_ctx set second_withdrawal=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),
 second_key,'KRW_BANK',(select bank_id from member_principal_ctx),100000);
select lives_ok($$set constraints all immediate$$,'actual service commits a second independently confirmed input3 HOLD while earlier portion stays HELD');
set constraints all deferred;
select is((select held_principal_atomic from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 '400000','native source records both held amounts exactly, with no whole-lot pause');
select is((select c.inputs->>'held_principal_atomic' from app_private.funding_engine_state s
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 '400000','second condition binds actual summed held source and independent portion clocks');
select lives_ok($$select public.release_withdrawal_hold((select second_withdrawal from repeat_principal_ctx),
 (select admin_id from prospective_ctx),'cancel only second actual portion','135-second-principal-cancel','CANCELLED')$$,
 'native CANCEL restores only its authoritative second receipt-bound portion');
select lives_ok($$set constraints all immediate$$,'actual service second CANCEL commits full source/cause/age proof while first reservation remains');
set constraints all deferred;
select is((select held_principal_atomic from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 '300000','second CANCEL leaves the first genuine reserved principal untouched');
select ok(not exists(select 1 from app_private.funding_portion_clock_receipts n
 join app_private.funding_portion_transitions t on t.id=n.transition_id and t.kind='RELEASE'
 join public.funding_principal_recovery_releases release on release.id=t.original_id
 join app_private.funding_portion_clock_receipts previous on previous.id=n.previous_clock_id
 join public.withdrawal_requests request on request.release_ledger_transaction_id=release.release_ledger_transaction_id
 where request.id=(select second_withdrawal from repeat_principal_ctx)
 and(n.accumulated_eligible_microseconds is distinct from previous.accumulated_eligible_microseconds
  or n.resumed_at is distinct from release.effective_at)),
 'second CANCEL resumes original portion age prospectively and excludes held duration without retroactive benefit');
select lives_ok($$select public.release_withdrawal_hold((select withdrawal from repeat_principal_ctx),
 (select admin_id from prospective_ctx),'cancel first actual repeated portion','135-first-principal-cancel','CANCELLED')$$,
 'native CANCEL later restores its own first independently aged reservation');
select lives_ok($$set constraints all immediate$$,'actual service final repeated CANCEL commits all immutable completed causes');
set constraints all deferred;
select is((select held_principal_atomic from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 '0','both completed CANCEL receipts restore the exact two reservations once');
select is((select eligible_principal_atomic::numeric from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 (select principal_before from repeat_principal_ctx),'repeated HOLD/CANCEL conserves total eligible principal without repair/backfill');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','all genuine repeated native originals remain truthfully COMPLETE');
select is((select c.inputs->>'principal_atomic' from app_private.funding_engine_state s
 join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=(select member_id from prospective_ctx)),
 (select principal_before::text from repeat_principal_ctx),'final current input3 matches exact restored principal');
select is((select count(*) from app_private.withdrawal_principal_confirmation_originals),
 (select confirmation_count+2 from repeat_principal_ctx),'two independent member originals remain immutable through all later service finance');
reset role;
select ok(not exists(select 1 from app_private.funding_portion_clock_state c where c.user_id=(select member_id from prospective_ctx) and c.status='HELD'),
 'final principal leaf projection has no accidental whole-lot hold');
select ok((select w.cycle_started_at=x.anchor and w.cycle_end=x.cycle_end from member_principal_ctx x
 join app_private.funding_engine_state s on s.user_id=(select member_id from prospective_ctx)
 join app_private.funding_cycle_windows w on w.id=s.cycle_id),'all repeated boundaries retain the original cycle anchor/end');
select ok(not exists(select 1 from public.system_jobs j join app_private.funding_engine_jobs f on f.job_id=j.id
 where f.user_id=(select member_id from prospective_ctx) and j.status in('PENDING','FAILED') and j.available_at<>'infinity'::timestamptz),
 'no repeat principal command connects automatic funding scheduling');

select * from finish();
rollback;
