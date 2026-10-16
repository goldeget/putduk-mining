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
reset role;
-- Actual scheduled catalog publication uses DB time. This short wait never
-- backdates a receipt; no test-only runtime clock is available to this producer.
select pg_sleep(greatest(0,extract(epoch from((select publish_at from prospective_ctx)-clock_timestamp())))+0.001);
set constraints all immediate;
set constraints all deferred;
select lives_ok($$select app_private.assert_published_product_catalog(catalog) from prospective_ctx$$,
 'actual operator lifecycle produced independently sealed neutral catalog');
update prospective_ctx set first_credit_at=(select effective_at from public.money_source_movements where user_id=member_id and source_bucket='PRINCIPAL');
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',draft_catalog,
 repeat('0',64),0,'[]','prospective-draft-reject') from prospective_ctx$$,
 '55000','PRODUCT_CATALOG_PUBLICATION_REQUIRED','DRAFT does not become a mining input');
update prospective_ctx set first=public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',0,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','5000')),'prospective-first-selection');
-- Actual HTTP commit context: canonical definer has returned to authenticated.
-- Do not hide deferred private-validation access failures behind RESET ROLE.
select lives_ok($$set constraints all immediate$$,
 'actual authenticated member commit completes deferred private integrity proof');
set constraints all deferred;
reset role;
set constraints all immediate;
set constraints all deferred;
update prospective_ctx set activation=(select id from app_private.funding_engine_activations where user_id=member_id),
 cycle=(select cycle_id from app_private.funding_engine_state where user_id=member_id);
select ok((select a.runtime_version=2 and a.allocation_original_id is null and a.effective_at=c.first_credit_at
 from app_private.funding_engine_activations a join prospective_ctx c on a.id=c.activation),
 'first actual principal credit anchors ZERO allocation, no invented product assignment');
select ok((select w.cycle_started_at=c.first_credit_at and w.cycle_end=w.cycle_started_at+w.cycle_days*interval '24 hours'
 from app_private.funding_cycle_windows w join prospective_ctx c on w.id=c.cycle),
 'post-deposit selection preserves authoritative original cycle anchor');
select is((select inputs->>'allocation_bps' from app_private.funding_condition_originals
 where user_id=(select member_id from prospective_ctx) and revision=0),'0','initial immutable condition has zero allocation');
select is((select inputs->>'allocation_bps' from app_private.funding_condition_originals
 where id=(select(first->>'transitionId')::uuid from prospective_ctx)),'5000','first member selection is explicit partial allocation');
select ok((select amount_atomic=0 and calculation->>'baseNum'='0'
 and(calculation->>'conditionalRetentionNum')::numeric>0 and calculation->>'qualifiedRetentionNum'='0'
 from app_private.funding_earned_receipts where cause_allocation_id=(select(first->>'allocationId')::uuid from prospective_ctx)),
 'before first selection BASE is zero and actual maintenance remains conditional');
select ok((select job_id is null and worker_id is null and attempt_number is null and fence_expires_at is null
 from app_private.funding_earned_receipts where cause_allocation_id=(select(first->>'allocationId')::uuid from prospective_ctx)),
 'foreground acceptance never fabricates a worker job or lease');
select is((select count(*)::integer from public.mining_reward_credits where user_id=(select member_id from prospective_ctx)),0,
 'unqualified pre-selection maintenance creates no wallet reward');
select is((select count(*)::integer from public.system_jobs where job_type='FUNDING_MINING_TICK_V1'),0,
 'allocation connection does not schedule automatic funded jobs');
select is((select eligible_principal_atomic from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 '1000000000000','assignment never changes principal amount');
update prospective_ctx set before_state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=member_id),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),earned_count=(select count(*) from app_private.funding_earned_receipts),
 condition_count=(select count(*) from app_private.funding_condition_originals);
set local role authenticated;
select is((select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',0,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','5000')),'prospective-first-selection') from prospective_ctx),
 (select first from prospective_ctx),'lost member response replays exact accepted transition receipt');
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',0,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','6000')),'prospective-first-selection') from prospective_ctx$$,
 '22023','IDEMPOTENCY_PAYLOAD_MISMATCH','same key cannot change allocation input');
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',0,
 '[]','prospective-stale-revision') from prospective_ctx$$,'40001','ALLOCATION_REVISION_CHANGED','stale version cannot overwrite accepted allocation');
reset role;
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select before_state from prospective_ctx),'replay/conflict preserves exact cursor budgets carry and condition');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count from prospective_ctx),'replay creates no second earned original');
select is((select count(*) from app_private.funding_condition_originals),(select condition_count from prospective_ctx),'replay creates no second condition');

-- Give the actually accepted partial allocation a small real elapsed interval;
-- the receipt timestamps, not this wait duration, determine exact earnings.
select pg_sleep(0.01);
set local role authenticated;
update prospective_ctx set second=public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',1,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','10000')),'prospective-second-selection');
select lives_ok($$set constraints all immediate$$,'actual authenticated positive BASE posting commits all deferred integrity');
set constraints all deferred;
reset role;
set constraints all immediate;
set constraints all deferred;
select ok((select e.amount_atomic>0 and e.job_id is null and e.calculation->>'qualifiedRetentionNum'='0'
 from app_private.funding_earned_receipts e where cause_allocation_id=(select(second->>'allocationId')::uuid from prospective_ctx)),
 'subsequent change accepts old partial BASE into actual wallet while keeping maintenance conditional');
-- The forward producer adds four explicit capacity provenance fields. Keep
-- the independent earlier interval reference for EVERY money/used/carry field,
-- and derive those four new fields independently from immutable approved input.
select ok((select e.calculation-array['baseCapacityNum','baseCapacityDen','retentionCapacityNum','retentionCapacityDen']
 =app_private.funding_exact_condition_interval(a.principal_atomic,
 (c.inputs->>'base_bps')::integer,(c.inputs->>'retention_bps')::integer,5000,
 (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::bigint,
 (extract(epoch from e.settled_to-e.settled_from)*1000000)::bigint,
 s.base_used_num,s.base_used_den,s.retention_used_num,s.retention_used_den,s.carry_num,s.carry_den,false)
 and e.calculation->>'baseCapacityNum'=(app_private.funding_exact_ratio(a.principal_atomic::numeric*(c.inputs->>'base_bps')::integer,10000))[1]::text
 and e.calculation->>'baseCapacityDen'=(app_private.funding_exact_ratio(a.principal_atomic::numeric*(c.inputs->>'base_bps')::integer,10000))[2]::text
 and e.calculation->>'retentionCapacityNum'=(app_private.funding_exact_ratio(a.principal_atomic::numeric*(c.inputs->>'retention_bps')::integer,10000))[1]::text
 and e.calculation->>'retentionCapacityDen'=(app_private.funding_exact_ratio(a.principal_atomic::numeric*(c.inputs->>'retention_bps')::integer,10000))[2]::text
 from app_private.funding_earned_receipts e join app_private.funding_engine_state_receipts s on s.id=e.previous_state_id
 join app_private.funding_engine_activations a on a.id=e.activation_id
 join app_private.funding_condition_originals c on c.id=e.condition_id join app_private.funding_cycle_windows w on w.id=e.cycle_id
 where e.cause_allocation_id=(select(second->>'allocationId')::uuid from prospective_ctx)),
 'actual prospective posting equals exact old-condition reference with authoritative elapsed microseconds');
select ok((select count(*)=2 and sum(case side when 'DEBIT' then amount_atomic else -amount_atomic end)=0
 from public.ledger_entries where transaction_id=(select ledger_transaction_id from public.mining_reward_credits
 where user_id=(select member_id from prospective_ctx))),'foreground mining posting uses one balanced canonical journal');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','foreground acceptance preserves verified source coverage');
select is((select eligible_principal_atomic from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 '1000000000000','mining credit stays separate from principal eligibility');
select ok(not exists(select 1 from public.outbox_events where event_type in('FUNDING_CONDITION_CHANGED.v1','FUNDING_EARNED_ACCEPTED.v1','MINING_REWARD_CREDITED.v1')
 and actor_user_id=(select member_id from prospective_ctx) and available_at<>'infinity'::timestamptz),
 'condition and money events remain dormant pending reviewed runtime consumers');

-- Capture a real state before a late canonical posting fault.
update prospective_ctx set before_state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=member_id),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),earned_count=(select count(*) from app_private.funding_earned_receipts),
 condition_count=(select count(*) from app_private.funding_condition_originals);
create function pg_temp.reject_prospective_wallet() returns trigger language plpgsql as $$
begin if new.reference_type='mining_reward_credit' then raise exception using errcode='P0001',message='PROSPECTIVE_LATE_WALLET_FAILURE'; end if; return new; end$$;
create trigger prospective_wallet_fault before insert on public.wallet_ledger for each row execute function pg_temp.reject_prospective_wallet();
select pg_sleep(0.01);
set local role authenticated;
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',2,
 '[]','prospective-clear-selection') from prospective_ctx$$,'P0001','PROSPECTIVE_LATE_WALLET_FAILURE',
 'late wallet fault rolls back allocation original state earned source and preceding journal');
reset role;
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select before_state from prospective_ctx),'late posting failure preserves exact current financial state');
select is((select count(*) from public.ledger_transactions),(select journal_count from prospective_ctx),'late fault rolls back journal');
select is((select count(*) from public.wallet_ledger),(select wallet_count from prospective_ctx),'late fault creates no projection');
select is((select count(*) from public.money_source_movements),(select source_count from prospective_ctx),'late fault creates no source movement');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count from prospective_ctx),'late fault creates no earned original');
select is((select count(*) from app_private.funding_condition_originals),(select condition_count from prospective_ctx),'late fault creates no successor condition');
select is((select count(*)::integer from app_private.idempotency_keys where scope='funding.allocation' and idempotency_key='prospective-clear-selection'),0,
 'failed selection leaves no false successful receipt');
drop trigger prospective_wallet_fault on public.wallet_ledger;
set local role authenticated;
update prospective_ctx set cleared=public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',2,'[]','prospective-clear-selection');
select lives_ok($$set constraints all immediate$$,'actual authenticated clear commits old-condition posting and exact successor');
set constraints all deferred;
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select inputs->>'allocation_bps' from app_private.funding_condition_originals
 where id=(select(cleared->>'transitionId')::uuid from prospective_ctx)),'0','explicit clear is a prospective zero allocation revision');
select is((select cycle_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select cycle from prospective_ctx),'all allocation changes preserve cycle identity');

-- A test-only exact-key BEFORE INSERT fault suppresses only this operation's
-- completion. Deferred proof must reject, even though the member function
-- returned its provisional result; immutable existing receipts stay untouched.
create function pg_temp.suppress_allocation_completion() returns trigger language plpgsql as $$
begin
 if new.scope='funding.allocation' and new.idempotency_key='prospective-missing-completion' then return null; end if;
 return new;
end;
$$;
create trigger prospective_completion_fault before insert on app_private.idempotency_keys
 for each row execute function pg_temp.suppress_allocation_completion();
create function pg_temp.missing_allocation_completion() returns void language plpgsql security definer set search_path=pg_catalog as $$
declare context record;
begin
 select * into context from pg_temp.prospective_ctx;
 perform public.confirm_funding_allocation('CONFIRM',context.catalog,context.publication->>'snapshotDigest',3,'[]','prospective-missing-completion');
 set constraints all immediate;
end;
$$;
grant execute on function pg_temp.missing_allocation_completion() to authenticated;
set local role authenticated;
select throws_ok($$select pg_temp.missing_allocation_completion()$$,'55000','FUNDING_ALLOCATION_COMMAND_COMPLETION_MISSING',
 'condition/earning facts cannot commit without canonical member command completion');
reset role;
select is((select count(*)::integer from app_private.funding_allocation_originals where user_id=(select member_id from prospective_ctx)),3,
 'missing completion proof rolled back attempted original');
drop trigger prospective_completion_fault on app_private.idempotency_keys;
-- A provisional member result cannot be committed under another auth subject.
create function pg_temp.wrong_allocation_commit_subject() returns void language plpgsql security definer set search_path=pg_catalog as $$
declare context record;
begin
 select * into context from pg_temp.prospective_ctx;
 perform public.confirm_funding_allocation('CONFIRM',context.catalog,context.publication->>'snapshotDigest',3,'[]','prospective-wrong-commit-subject');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',context.other_id,'role','authenticated')::text,true);
 set constraints all immediate;
end;
$$;
grant execute on function pg_temp.wrong_allocation_commit_subject() to authenticated;
set local role authenticated;
select throws_ok($$select pg_temp.wrong_allocation_commit_subject()$$,'42501','FUNDING_COMMIT_SUBJECT_FORBIDDEN',
 'actual authenticated deferred commit binds the immutable original to its owner auth subject');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select app_private.apply_funding_allocation_boundary((first->>'allocationId')::uuid) from prospective_ctx$$,
 '42501',null,'worker role cannot impersonate a foreground member transition');
select lives_ok($$select app_private.prepare_default_funding_job(activation) from prospective_ctx$$,
 'bounded V2 adapter prepares the current condition original without making it due');
select lives_ok($$set constraints all immediate$$,'actual service preparation commits its job originals before switching auth subjects');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',0,
 '[]','prospective-unfunded-owner') from prospective_ctx$$,'55000','FUNDING_FRESH_PRINCIPAL_REQUIRED',
 'another member cannot use this owner principal or original');
reset role;
-- Explicit owner-created temporary fault helpers create no wallet/source movement.
-- They exercise real deferred validation after a member definer returns, and
-- their failed subtransactions leave no journal or broad member write grant.
-- The deliberately unfunded other member still needs an empty canonical
-- liability account so the cross-owner check reaches deferred authorization.
select app_private.ensure_withdrawal_hold_accounts(other_id) from prospective_ctx;
create function pg_temp.bad_member_ledger_commit(p_cross_owner boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare context record; journal_id uuid:=gen_random_uuid(); member_id uuid; liability_owner uuid;
begin
 select * into context from pg_temp.prospective_ctx;
 member_id:=auth.uid();
 if member_id is distinct from context.member_id then raise exception using errcode='42501',message='TEST_SUBJECT_REQUIRED'; end if;
 liability_owner:=case when p_cross_owner then context.other_id else member_id end;
 insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,
  member_user_id,request_id,correlation_id,description,metadata)
 values(journal_id,'ADMIN_ADJUSTMENT','KRW','local-commit-negative:'||journal_id::text,'LOCAL_TEST_FAULT',journal_id,
  member_id,gen_random_uuid(),gen_random_uuid(),'Local rollback-only deferred integrity fault','{"fixture":"OWNER_ONLY_NO_MONEY_POSTING"}');
 insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic) values
 (journal_id,(select id from public.ledger_accounts where code='PUTDUK:MINING_REWARD_EXPENSE:KRW'),0,'DEBIT',10),
 (journal_id,(select id from public.ledger_accounts where code='USER:'||upper(liability_owner::text)||':KRW:LIABILITY'),1,'CREDIT',
   case when p_cross_owner then 10 else 9 end);
end;
$$;
revoke all on function pg_temp.bad_member_ledger_commit(boolean) from public,anon,authenticated,service_role;
grant execute on function pg_temp.bad_member_ledger_commit(boolean) to authenticated;
-- The outer invoker forces commit only after the inner owner writer returned.
create function pg_temp.assert_bad_member_ledger_commit(p_cross_owner boolean) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform pg_temp.bad_member_ledger_commit(p_cross_owner);
 set constraints all immediate;
end;
$$;
grant execute on function pg_temp.assert_bad_member_ledger_commit(boolean) to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select throws_ok($$select pg_temp.assert_bad_member_ledger_commit(false)$$,'23514','UNBALANCED_LEDGER_TRANSACTION',
 'actual authenticated commit still rejects unbalanced journal after definer returns');
select throws_ok($$select pg_temp.assert_bad_member_ledger_commit(true)$$,'42501','LEDGER_COMMIT_SUBJECT_FORBIDDEN',
 'balanced journal cannot conceal another member liability in authenticated commit');
reset role;

-- Portion tests retain the preceding actual catalog/member-allocation path.
-- Owner-only synthetic held request for reservation/terminal regression tests.
-- This is not an enabled source-confirmation command or historical backfill.
-- Tests separately invoke the existing service-only reservation writer, and
-- never claim that generic member withdrawal may create this fixture.
create function pg_temp.seed_reserved_test_hold(
  p_owner uuid, p_destination uuid, p_amount bigint, p_key text
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $reserved_test_fixture$
declare
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_wallet uuid;
  v_request uuid;
  v_command_request uuid := gen_random_uuid();
  v_journal uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'HISTORICAL_FIXTURE_OWNER_ONLY';
  end if;
  if p_amount is null or p_amount <= 0 or char_length(p_key) not between 8 and 200 then
    raise exception 'INVALID_HISTORICAL_FIXTURE';
  end if;
  if exists (select 1 from public.withdrawal_requests
    where user_id = p_owner and idempotency_key = p_key) then
    raise exception 'HISTORICAL_FIXTURE_ALREADY_EXISTS';
  end if;
  select * into v_destination from public.withdrawal_destinations
  where id = p_destination and user_id = p_owner and verification_status = 'VERIFIED';
  select * into v_policy from public.withdrawal_policies
  where currency = 'KRW' and destination_type = v_destination.destination_type
    and is_enabled and effective_at <= statement_timestamp()
    and (expires_at is null or expires_at > statement_timestamp())
  order by version desc limit 1;
  select id into v_wallet from public.wallet_accounts
  where user_id = p_owner and currency = 'KRW' and closed_at is null;
  if v_destination.id is null or v_policy.id is null or v_wallet is null
    or app_private.available_krw_balance(v_wallet) < p_amount + v_policy.fee_atomic then
    raise exception 'HISTORICAL_FIXTURE_RECEIPT_UNAVAILABLE';
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, withdrawal_destination_id,
    user_id, currency, amount_atomic, fee_atomic, destination_type,
    destination_snapshot, status, idempotency_key
  ) values (
    v_wallet, v_policy.id, v_destination.id, p_owner, 'KRW', p_amount,
    v_policy.fee_atomic, v_destination.destination_type,
    jsonb_build_object('destination_id', v_destination.id,
      'display', v_destination.display_hint, 'verified_at', v_destination.verified_at),
    'REQUESTED', p_key
  ) returning id into v_request;
  v_journal := app_private.post_withdrawal_hold(
    p_owner, v_request, p_amount + v_policy.fee_atomic, p_key, v_command_request
  );
  update public.withdrawal_requests set status = 'HELD',
    hold_ledger_transaction_id = v_journal, hold_posted_at = statement_timestamp()
  where id = v_request;
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1', 1, 'withdrawal_request', v_request, p_owner,
    jsonb_build_object('user_id', p_owner, 'amount_atomic', p_amount::text,
      'fee_atomic', v_policy.fee_atomic::text, 'currency', 'KRW',
      'destination_type', v_destination.destination_type,
      'hold_ledger_transaction_id', v_journal, 'welcome_reward', false),
    gen_random_uuid(), v_command_request, p_key || ':event'
  );
  insert into public.transaction_receipts (
    receipt_number, user_id, transaction_type, source_type, source_id,
    amount_atomic, currency, status, requested_at, status_timeline
  ) values (
    'PDK-WD-' || upper(replace(v_request::text, '-', '')), p_owner, 'WITHDRAWAL',
    'withdrawal_request', v_request, p_amount, 'KRW', 'HELD', statement_timestamp(),
    jsonb_build_array(
      jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'HELD', 'at', statement_timestamp()))
  );
  return v_request;
end;
$reserved_test_fixture$;
revoke all on function pg_temp.seed_reserved_test_hold(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;


select is(app_private.funding_portion_eligible_age(20*86400000000::bigint,null,'2026-10-26T00:00:00Z',false),
 20*86400000000::bigint,'held 300k preserves 20 eligible days while its 3-day hold adds zero');
select is(app_private.funding_portion_eligible_age(20*86400000000::bigint,'2026-10-23T00:00:00Z','2026-10-26T00:00:00Z',true),
 23*86400000000::bigint,'unheld 700k reaches 23 days independently of held sibling');
select is(app_private.funding_portion_eligible_age(20*86400000000::bigint,'2026-10-26T00:00:00Z','2026-10-27T00:00:00Z',true),
 21*86400000000::bigint,'release resumes prospectively at 20 days without retroactive held interval');
select throws_ok($$select app_private.funding_portion_eligible_age(0,'2026-10-27T00:00:00Z','2026-10-26T00:00:00Z',true)$$,
 '22023','FUNDING_PORTION_CLOCK_INVALID','backwards eligibility clock is rejected');
select throws_ok($$select app_private.funding_portion_eligible_age(0,'2026-10-27T00:00:00Z','2026-10-27T00:00:00Z',false)$$,
 '22023','FUNDING_PORTION_CLOCK_INVALID','HELD cannot retain a running resumed clock');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='app_private.funding_portion_clock_receipts'::regclass)
 and not has_table_privilege('authenticated','app_private.funding_portion_clock_receipts','INSERT')
 and not has_function_privilege('authenticated','app_private.apply_funding_portion_hold(uuid)','EXECUTE'),
 'portion age authority is private force-RLS append-only');
select is((select count(*)::integer from app_private.funding_principal_portions where user_id=(select member_id from prospective_ctx)),1,
 'actual V2 activation introduces one root from its actual credit');
select ok((select c.status='AVAILABLE' and c.accumulated_eligible_microseconds=0 and c.resumed_at=l.effective_at
 and p.amount_micro_krw=l.amount_micro_krw and p.parent_portion_id is null
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 join public.funding_principal_lots l on l.id=p.lot_id where c.user_id=(select member_id from prospective_ctx)),
 'initial portion preserves immutable principal lot amount and original anchor');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select app_private.assert_funding_portion_executor(member_id) from prospective_ctx$$,
 '42501','FUNDING_MEMBER_WRITER_REQUIRED','postgres without authenticated member context does not gain adapter authority through NULL');

create temporary table portion_ctx(bank_id uuid, first_request uuid, first_hold uuid, first_allocation uuid, first_transition uuid,
 first_held_portion uuid, first_age bigint, first_release uuid, release_transition uuid,
 second_request uuid, second_hold uuid, second_allocation uuid, second_transition uuid,
 third_request uuid, third_hold uuid, third_allocation uuid, expected_tie_portion uuid,
 fourth_request uuid,fourth_hold uuid,fourth_allocation uuid,fourth_transition uuid,
 new_lot uuid,new_root uuid,cross_request uuid,cross_hold uuid);
insert into portion_ctx default values;
grant select,update on portion_ctx to service_role;
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,
 fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10627001,true,1,0,'{}',clock_timestamp(),admin_id,false from prospective_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
 display_hint,verification_status,verified_at,protection_until)
select member_id,'KRW_BANK',decode(repeat('ac',32),'hex'),encode(extensions.digest(member_id::text,'sha256'),'hex'),
 '소스 검증 전용 원금 회수 fixture','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day' from prospective_ctx;
update portion_ctx set bank_id=(select id from public.withdrawal_destinations where user_id=(select member_id from prospective_ctx));
-- Explicit postgres-only synthetic original; ordinary member withdrawal remains
-- VERIFIED MINING_REWARD only. Actual reservation/lifecycle writers below are
-- exercised, but this is not a delivered principal confirmation UI/API claim.
update portion_ctx set first_request=pg_temp.seed_reserved_test_hold((select member_id from prospective_ctx),bank_id,300000,'portion-first-held');
update portion_ctx set first_hold=(select hold_ledger_transaction_id from public.withdrawal_requests where id=first_request);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select app_private.apply_principal_recovery_newest_first((select member_id from prospective_ctx),first_hold) from portion_ctx;
update portion_ctx set first_allocation=(select id from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=first_hold);
update portion_ctx set first_transition=app_private.apply_funding_portion_hold(first_allocation);
reset role;
set constraints all immediate;
set constraints all deferred;
update portion_ctx set first_held_portion=(select portion_id from app_private.funding_portion_clock_state where status='HELD'),
 first_age=(select accumulated_eligible_microseconds from app_private.funding_portion_clock_state where status='HELD');
select is((select count(*)::integer from app_private.funding_principal_portions where user_id=(select member_id from prospective_ctx)),3,
 'first partial hold keeps original root and creates exactly two immutable children');
select ok((select count(*)=2 and sum(p.amount_micro_krw)=1000000000000000000::numeric
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 where c.status in('AVAILABLE','HELD') and c.user_id=(select member_id from prospective_ctx)),
 'split conserves exact original principal without double-counting SPLIT parent');
select ok((select count(distinct accumulated_eligible_microseconds)=1
 from app_private.funding_portion_clock_receipts where transition_id=(select first_transition from portion_ctx)),
 'split children and parent preserve the same already accumulated eligible age');
select pg_sleep(0.02);
set local role service_role;
select public.release_withdrawal_hold(first_request,(select admin_id from prospective_ctx),'cancel portion fixture before send','portion-first-release','CANCELLED') from portion_ctx;
update portion_ctx set first_release=(select id from public.funding_principal_recovery_releases where hold_ledger_transaction_id=first_hold);
update portion_ctx set release_transition=app_private.apply_funding_portion_disposition('RELEASE',first_release);
reset role;
set constraints all immediate;
set constraints all deferred;
select ok((select c.status='AVAILABLE' and c.accumulated_eligible_microseconds=p.first_age and c.resumed_at=r.effective_at
 from app_private.funding_portion_clock_state c join portion_ctx p on p.first_held_portion=c.portion_id
 join public.funding_principal_recovery_releases r on r.id=p.first_release),
 'actual cancellation resumes only held child, preserves age, excludes its hold interval');
select ok((select min(age)<max(age) from(
 select app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,clock_timestamp(),true) age
 from app_private.funding_portion_clock_state c where c.user_id=(select member_id from prospective_ctx) and c.status='AVAILABLE') ages),
 'same original lot now contains distinct eligible ages without a whole-lot reset');
set local role service_role;
select is(app_private.apply_funding_portion_disposition('RELEASE',(select first_release from portion_ctx)),
 (select release_transition from portion_ctx),'same original release replay preserves its exact transition');
reset role;

-- A second genuine original must choose the younger resumed portion first.
update portion_ctx set second_request=pg_temp.seed_reserved_test_hold((select member_id from prospective_ctx),bank_id,100000,'portion-second-held');
update portion_ctx set second_hold=(select hold_ledger_transaction_id from public.withdrawal_requests where id=second_request);
set local role service_role;
select app_private.apply_principal_recovery_newest_first((select member_id from prospective_ctx),second_hold) from portion_ctx;
update portion_ctx set second_allocation=(select id from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=second_hold);
reset role;
create function pg_temp.choose_oldest_portion_wrongly() returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare original public.funding_principal_recovery_allocations%rowtype; old_clock record;
 transition_id uuid; eligible_age bigint; held_child uuid:=gen_random_uuid(); available_child uuid:=gen_random_uuid();
begin
 select * into original from public.funding_principal_recovery_allocations where id=(select second_allocation from pg_temp.portion_ctx);
 transition_id:=app_private.begin_funding_portion_transition('HOLD',original.id);
 select c.*,p.amount_micro_krw,p.lot_id,
 app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,original.effective_at,true) age
 into old_clock from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 where p.lot_id=original.lot_id and c.status='AVAILABLE' order by age desc,p.id desc limit 1;
 eligible_age:=old_clock.age;
 insert into app_private.funding_portion_clock_receipts(user_id,portion_id,revision,previous_clock_id,transition_id,status,
 effective_at,accumulated_eligible_microseconds,hold_allocation_id)
 values(original.user_id,old_clock.portion_id,old_clock.revision+1,old_clock.id,transition_id,'SPLIT',original.effective_at,eligible_age,original.id);
 insert into app_private.funding_principal_portions(id,user_id,lot_id,parent_portion_id,amount_micro_krw,introduced_by_transition_id) values
 (held_child,original.user_id,original.lot_id,old_clock.portion_id,original.allocation_micro_krw,transition_id),
 (available_child,original.user_id,original.lot_id,old_clock.portion_id,old_clock.amount_micro_krw-original.allocation_micro_krw,transition_id);
 insert into app_private.funding_portion_clock_receipts(user_id,portion_id,revision,transition_id,status,effective_at,
 accumulated_eligible_microseconds,resumed_at,hold_allocation_id) values
 (original.user_id,held_child,0,transition_id,'HELD',original.effective_at,eligible_age,null,original.id),
 (original.user_id,available_child,0,transition_id,'AVAILABLE',original.effective_at,eligible_age,original.effective_at,null);
 set constraints all immediate;
end;
$$;
grant execute on function pg_temp.choose_oldest_portion_wrongly() to service_role;
set local role service_role;
select throws_ok($$select pg_temp.choose_oldest_portion_wrongly()$$,'55000','FUNDING_PORTION_SHORTEST_AGE_ORDER_REQUIRED',
 'actual source-bound amount with wrong same-lot age choice is rejected at deferred commit proof');
set constraints all deferred;
update portion_ctx set second_transition=app_private.apply_funding_portion_hold(second_allocation);
reset role;
set constraints all immediate;
set constraints all deferred;
select ok((select p.parent_portion_id=c.first_held_portion and p.amount_micro_krw=100000000000::bigint
 from app_private.funding_principal_portions p join app_private.funding_portion_clock_state s on s.portion_id=p.id
 cross join portion_ctx c where s.status='HELD' and s.hold_allocation_id=c.second_allocation),
 'repeated partial hold chooses shortest eligible age inside the same lot');
select ok((select a.accumulated_eligible_microseconds=p.accumulated_eligible_microseconds
 from app_private.funding_portion_clock_receipts a join app_private.funding_portion_clock_receipts p on p.id=a.previous_clock_id
 where a.transition_id=(select release_transition from portion_ctx)),
 'release never manufactures an age increase');
set local role service_role;
select public.record_krw_external_send(second_request,'portion-local-bank-reference',100000,
 (select admin_id from prospective_ctx),clock_timestamp(),'portion-second-external') from portion_ctx;
select public.finalize_withdrawal_ledger(second_request,(select admin_id from prospective_ctx),'portion-second-finalize') from portion_ctx;
select app_private.apply_funding_portion_disposition('FINALIZE',second_request) from portion_ctx;
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select sum(p.amount_micro_krw)::bigint from app_private.funding_portion_clock_state s
 join app_private.funding_principal_portions p on p.id=s.portion_id where s.status='RECOVERED'),100000000000::bigint,
 'actual receipt-bound finalize recovers exactly held portion once');
select ok((select sum(p.amount_micro_krw)=999999900000000000::numeric from app_private.funding_portion_clock_state s
 join app_private.funding_principal_portions p on p.id=s.portion_id where s.status='AVAILABLE'),
 'finalize leaves the other immutable portions and accumulated ages intact');
select ok((select coverage='COMPLETE' and eligible_principal_atomic='999999900000'
 from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'portion clocks preserve canonical principal/source available and recovered parity');
-- Actual receipt-bound zero-duration HOLD/RELEASE in one owner-controlled
-- fixture statement yields two available siblings with precisely equal age.
-- Revision order, rather than timestamp inequality, must replay their clocks.
do $$
declare context record; withdrawal uuid; hold_id uuid; allocation_id uuid; release_id uuid;
begin
 select p.*,c.member_id,c.admin_id into context from portion_ctx p cross join prospective_ctx c;
 withdrawal:=pg_temp.seed_reserved_test_hold(context.member_id,context.bank_id,100000,'portion-tie-held');
 update portion_ctx set third_request=withdrawal;
 select hold_ledger_transaction_id into hold_id from public.withdrawal_requests where id=withdrawal;
 execute 'set local role service_role';
 perform app_private.apply_principal_recovery_newest_first(context.member_id,hold_id);
 select id into allocation_id from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=hold_id;
 perform app_private.apply_funding_portion_hold(allocation_id);
 perform public.release_withdrawal_hold(withdrawal,context.admin_id,'cancel equal-age fixture before send','portion-tie-release','CANCELLED');
 select id into release_id from public.funding_principal_recovery_releases where hold_ledger_transaction_id=hold_id;
 perform app_private.apply_funding_portion_disposition('RELEASE',release_id);
 execute 'reset role';
end;
$$;
set constraints all immediate;
set constraints all deferred;
with instant as materialized(select clock_timestamp() as at)
select ok((select count(*)=2 and min(age)=max(age) from(
 select app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,instant.at,true) age
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id cross join instant
 where c.status='AVAILABLE' and p.amount_micro_krw=100000000000::bigint) equal_age),
 'actual equal-instant hold/release preserves two sibling portions with equal eligible age');
with instant as materialized(select clock_timestamp() as at)
update portion_ctx set expected_tie_portion=(select p.id from app_private.funding_portion_clock_state c
 join app_private.funding_principal_portions p on p.id=c.portion_id cross join instant where c.status='AVAILABLE'
 order by app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,instant.at,true),p.id limit 1);
update portion_ctx set fourth_request=pg_temp.seed_reserved_test_hold((select member_id from prospective_ctx),bank_id,100000,'portion-fourth-held');
update portion_ctx set fourth_hold=(select hold_ledger_transaction_id from public.withdrawal_requests where id=fourth_request);
set local role service_role;
select app_private.apply_principal_recovery_newest_first((select member_id from prospective_ctx),fourth_hold) from portion_ctx;
update portion_ctx set fourth_allocation=(select id from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=fourth_hold);
update portion_ctx set fourth_transition=app_private.apply_funding_portion_hold(fourth_allocation);
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select portion_id from app_private.funding_portion_clock_state where hold_allocation_id=(select fourth_allocation from portion_ctx) and status='HELD'),
 (select expected_tie_portion from portion_ctx),'equal eligible ages resolve by immutable portion UUID ascending');
set local role service_role;
select throws_ok($$update public.outbox_events set payload=payload||'{"amount_atomic":"999999"}'
 where id=(select source_event_id from app_private.funding_portion_transitions where id=(select fourth_transition from portion_ctx))$$,
 '55000','FUNDING_OPERATIONAL_ORIGINAL_IMMUTABLE','portion source seal payload is immutable after consumption');
reset role;
set local role service_role;
select throws_ok($$update app_private.funding_portion_clock_receipts set accumulated_eligible_microseconds=0$$,
 '42501',null,'clock originals cannot be reset or edited by worker role');
select throws_ok($$select app_private.apply_funding_portion_hold(gen_random_uuid())$$,
 '25000','FUNDING_PORTION_FRESH_SNAPSHOT_REQUIRED','an unbound hold cannot guess a source owner');
reset role;
-- Actual new principal credit has its own receipt/lot/age; the engine's
-- multi-source capacity/condition adapter is still unsupported and must not
-- silently reuse the old state. Portion capture itself posts no reward money.
set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',200000,'portion-new-principal-request'),
 admin_id,200000,'portion-new-principal-credit','actual new local principal receipt',gen_random_uuid()) from prospective_ctx;
update portion_ctx set new_lot=(select l.id from public.funding_principal_lots l where l.user_id=(select member_id from prospective_ctx)
 and l.amount_atomic=200000);
update portion_ctx set new_root=app_private.initialize_funding_portion_clock(new_lot);
reset role;
set constraints all immediate;
set constraints all deferred;
select ok((select c.status='AVAILABLE' and c.accumulated_eligible_microseconds=0 and c.resumed_at=l.effective_at
 and p.amount_micro_krw=200000000000::bigint from app_private.funding_portion_clock_state c
 join app_private.funding_principal_portions p on p.id=c.portion_id join public.funding_principal_lots l on l.id=p.lot_id
 where p.id=(select new_root from portion_ctx)),
 'genuine new deposit preserves a separate new original age, not a restored older portion');
update portion_ctx set cross_request=pg_temp.seed_reserved_test_hold((select member_id from prospective_ctx),bank_id,250000,'portion-newest-cross-lot-held');
update portion_ctx set cross_hold=(select hold_ledger_transaction_id from public.withdrawal_requests where id=cross_request);
set local role service_role;
select app_private.apply_principal_recovery_newest_first((select member_id from prospective_ctx),cross_hold) from portion_ctx;
do $$declare allocation_id uuid; begin
 for allocation_id in select id from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=(select cross_hold from portion_ctx) order by ordinal loop
  perform app_private.apply_funding_portion_hold(allocation_id);
 end loop;
end; $$;
set constraints all immediate;
set constraints all deferred;
select ok((select a.lot_id=p.new_lot and a.ordinal=0 and a.allocation_micro_krw=200000000000::bigint
 from public.funding_principal_recovery_allocations a cross join portion_ctx p
 where a.hold_ledger_transaction_id=p.cross_hold and a.ordinal=0),
 'cross-lot hold uses newest genuine deposit lot first, independently of within-lot age order');
select ok((select count(*)=2 and sum(allocation_micro_krw)=250000000000::numeric
 from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=(select cross_hold from portion_ctx)),
 'newest-first cross-lot allocation conserves exactly the actual original hold amount');
select ok((select sum(p.amount_micro_krw)=250000000000::numeric
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 join public.funding_principal_recovery_allocations a on a.id=c.hold_allocation_id
 where c.status='HELD' and a.hold_ledger_transaction_id=(select cross_hold from portion_ctx)),
 'source-bound portion clocks exactly match actual cross-lot hold allocations');
select throws_ok($$select public.read_own_mining_server_display(member_id) from prospective_ctx$$,
 '55000','FUNDING_CREDIT_INPUT_UNRESOLVED','sealed unresolved hold/source history cannot return a stale active amount');
reset role;
select ok(not exists(select 1 from public.system_jobs where job_type='FUNDING_MINING_TICK_V1' and available_at<>'infinity'::timestamptz),
 'portion adapter does not enable scheduling or qualify/pay held-end maintenance');
select finish();
rollback;
