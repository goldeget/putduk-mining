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

-- Arithmetic qualification is not an injected settlement clock or monetary
-- command input. The live positive completion below uses actual DB time only.
select is(app_private.funding_exact_condition_interval(100000,1500,1500,0,2592000000000,2592000000000,
 0,1,0,1,0,1,true)->>'amountAtomic','15000','full-cycle pure maintenance is allocation-independent');
select is(app_private.funding_exact_condition_interval(100000,1500,1500,5000,2592000000000,2592000000000,
 0,1,0,1,0,1,true)->>'amountAtomic','22500','partial BASE plus independent whole-cycle maintenance exact vector');
select ok(not has_function_privilege('authenticated','app_private.read_funding_runtime_server_display(uuid)','EXECUTE')
 and not has_function_privilege('anon','app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamptz)','EXECUTE'),
 'private read executors cannot become client economics/source APIs');
select ok((select not prosecdef from pg_proc where oid='public.read_own_mining_server_display(uuid)'::regprocedure),
 'canonical public display remains fixed-path invoker');
create temporary table runtime_ctx(display jsonb,job uuid,stale_job uuid,earned uuid,accepted timestamptz,state jsonb,
 journal_count bigint,wallet_count bigint,source_count bigint,earned_count bigint,qualified_count bigint);
insert into runtime_ctx(stale_job) select job_id from app_private.funding_engine_jobs where expected_state_id=(select id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx));
grant select,update on runtime_ctx to service_role,authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select throws_ok($$select public.read_own_mining_server_display(member_id) from prospective_ctx$$,
 '42501',null,'member cannot call server-only display or its private source executor');
select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',3,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','10000')),'runtime-neutral-full') from prospective_ctx;
reset role;
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update runtime_ctx set accepted=(select cursor_at from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),earned_count=(select count(*) from app_private.funding_earned_receipts);
update runtime_ctx set display=public.read_own_mining_server_display((select member_id from prospective_ctx));
select is((select display#>>'{funded_runtime,runtime_version}' from runtime_ctx),'2','actual canonical reader returns accepted V2 funded proof');
select is((select display#>>'{funded_runtime,allocation_bps}' from runtime_ctx),'10000','DTO reflects confirmed full allocation original');
select is((select display#>>'{funded_runtime,committed_reward_total_atomic}' from runtime_ctx),
 (select sum(amount_atomic)::text from app_private.funding_earned_receipts where user_id=(select member_id from prospective_ctx)),
 'confirmed total comes from accepted originals and remains separate from wallet balance');
select ok((select display#>>'{funded_runtime,conditional_maintenance,qualification}'='UNCONFIRMED'
 and(display#>>'{funded_runtime,conditional_maintenance,numerator}')::numeric>0 from runtime_ctx),
 'actual read exposes exact conditional maintenance separately, not a wallet credit');
select ok((select(display#>>'{funded_runtime,reward_carry,numerator}')::numeric<(display#>>'{funded_runtime,reward_carry,denominator}')::numeric
 and display#>>'{funded_runtime,reward_carry,unit}'='KRW' from runtime_ctx),'DTO retains sub-whole exact KRW carry');
select is((select(display#>>'{funded_runtime,accepted_cursor_at}')::timestamptz from runtime_ctx),
 (select accepted from runtime_ctx),'DTO accepted cursor is immutable receipt boundary, not read clock');
select ok((select display#>>'{funded_runtime,accepted_cursor_at}' ~ '[.][0-9]{6}Z$'
 and(display#>>'{funded_runtime,evaluated_at}')::timestamptz>=accepted from runtime_ctx),
 'authoritative timestamps retain exact UTC microseconds and accepted-before-read order');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from runtime_ctx),'read-only preview does not advance accepted state');
select is((select count(*) from public.wallet_ledger),(select wallet_count from runtime_ctx),'preview posts no wallet projection');
select is((select count(*) from public.ledger_transactions),(select journal_count from runtime_ctx),'preview posts no journal');
select is((select count(*) from public.money_source_movements),(select source_count from runtime_ctx),'preview creates no source');
set local time zone 'Asia/Seoul';
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,accepted_cursor_at}'),
 (select display#>>'{funded_runtime,accepted_cursor_at}' from runtime_ctx),'UTC receipt timestamp is stable across session TimeZone');
set local time zone 'UTC';
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','service_role')::text,true) from prospective_ctx;
set local role service_role;
select throws_ok($$select public.read_own_mining_server_display(member_id) from prospective_ctx$$,
 '42501','MINING_DISPLAY_SUBJECT_FORBIDDEN','reader does not accept another subject when service identity is present');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update runtime_ctx set job=app_private.prepare_default_funding_job((select activation from prospective_ctx));
select ok((select available_at='infinity'::timestamptz from public.system_jobs where id=(select job from runtime_ctx)),
 'V2 consumer connection keeps every new job dormant');
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select stale_job from runtime_ctx);
set local role service_role;
select id from public.claim_system_jobs('runtime-neutral-worker',100,300);
select throws_ok($$select public.complete_system_job(stale_job,'runtime-neutral-worker') from runtime_ctx$$,
 '55000','FUNDING_JOB_STATE_STALE','old condition job cannot accept a new selection state');
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from runtime_ctx);
set local role service_role;
select id from public.claim_system_jobs('runtime-neutral-worker',100,300);
select throws_ok($$select public.complete_system_job(job,'foreign-runtime-worker') from runtime_ctx$$,
 '55000','FUNDING_JOB_FENCE_NOT_OWNED','actual V2 completion retains current worker fence');
reset role;
create function pg_temp.runtime_wallet_fault() returns trigger language plpgsql as $$
begin if new.entry_type='MINING_REWARD' then raise exception using errcode='P0001',message='RUNTIME_LATE_WALLET_FAULT'; end if; return new; end;
$$;
create trigger runtime_wallet_fault before insert on public.wallet_ledger for each row execute function pg_temp.runtime_wallet_fault();
set local role service_role;
update runtime_ctx set state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements),earned_count=(select count(*) from app_private.funding_earned_receipts);
select throws_ok($$select public.complete_system_job(job,'runtime-neutral-worker') from runtime_ctx$$,
 'P0001','RUNTIME_LATE_WALLET_FAULT','actual V2 posting rolls back late wallet failure atomically');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from runtime_ctx),'late fault preserves exact cursor/used/carry/condition');
select is((select count(*) from public.ledger_transactions),(select journal_count from runtime_ctx),'late fault rolls back journal');
select is((select count(*) from public.money_source_movements),(select source_count from runtime_ctx),'late fault rolls back source');
select is((select count(*) from app_private.funding_earned_receipts),(select earned_count from runtime_ctx),'late fault rolls back earned original');
select is((select status::text from public.system_jobs where id=(select job from runtime_ctx)),'RUNNING','late failure does not falsely complete its job');
reset role;
drop trigger runtime_wallet_fault on public.wallet_ledger;
set local role service_role;
select lives_ok($$select public.complete_system_job(job,'runtime-neutral-worker') from runtime_ctx$$,
 'canonical actual V2 completion accepts the sealed current condition');
-- Crucial commit-context regression: completeness runs as the real service role,
-- not postgres after RESET ROLE. Publication/source reads stay narrow/private.
set constraints all immediate;
set constraints all deferred;
update runtime_ctx set earned=(select id from app_private.funding_earned_receipts where job_id=job);
select ok((select e.runtime_version=2 and e.condition_id=s.condition_id and e.amount_atomic>0
 and e.calculation->>'qualifiedRetentionNum'='0' from app_private.funding_earned_receipts e
 join app_private.funding_engine_state s on s.id=e.next_state_id where e.id=(select earned from runtime_ctx)),
 'V2 earning posts actual elapsed BASE, preserves condition and keeps maintenance conditional');
select is((select input_digest from app_private.funding_earned_receipts where id=(select earned from runtime_ctx)),
 (select app_private.funding_engine_digest(app_private.funding_earned_snapshot(e)) from app_private.funding_earned_receipts e
  where e.id=(select earned from runtime_ctx)),
 'earning digest includes final V2 runtime and accepted condition before insertion');
select ok((select sum(case side when 'DEBIT' then amount_atomic else -amount_atomic end)=0 and count(*)=2
 from public.ledger_entries where transaction_id=(select ledger_transaction_id from public.mining_reward_credits
 where funding_earned_receipt_id=(select earned from runtime_ctx))),'V2 journal is exactly balanced with fee zero');
select ok((select status='SUCCEEDED' and completed_at is not null from public.system_jobs where id=(select job from runtime_ctx)),
 'actual V2 earning and durable job success are atomic');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','actual V2 source stays complete after foreground and background postings');
update runtime_ctx set state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 journal_count=(select count(*) from public.ledger_transactions),wallet_count=(select count(*) from public.wallet_ledger),
 source_count=(select count(*) from public.money_source_movements);
select lives_ok($$select public.complete_system_job(job,'runtime-neutral-worker') from runtime_ctx$$,
 'same canonical completion key replays accepted V2 original');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from runtime_ctx),'replay preserves exact financial state');
select is((select count(*) from public.wallet_ledger),(select wallet_count from runtime_ctx),'replay produces no duplicate wallet money');
select is((select count(*) from public.money_source_movements),(select source_count from runtime_ctx),'replay produces no duplicate source');
select throws_ok($$insert into app_private.funding_retention_qualifications(user_id,cycle_id,earned_receipt_id,
 qualified_num,qualified_den,principal_input_digest,qualified_at)
 select e.user_id,e.cycle_id,e.id,1,1,a.input_digest,e.settled_to from app_private.funding_earned_receipts e
 join app_private.funding_engine_activations a on a.id=e.activation_id where e.id=(select earned from runtime_ctx)$$,
 '55000','FUNDING_RETENTION_ORIGINAL_MISMATCH','current job cannot forge a cycle-end maintenance qualification');
reset role;

-- Narrow additive reader/status proof. All catalog, deposits, selections and
-- foreground/job postings above use the existing canonical actual commands.
-- No caller clock/reward, guessed allocation or worker heartbeat is introduced.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update runtime_ctx set display=public.read_own_mining_server_display((select member_id from prospective_ctx));
select is((select display#>>'{funded_runtime,schema_version}' from runtime_ctx),'2','reader emits versioned authoritative status proof');
select is((select display#>>'{funded_runtime,status}' from runtime_ctx),'ACTIVE','actual full neutral accepted condition permits BASE accrual');
select ok((select display#>'{funded_runtime,stop_reason}'='null'::jsonb from runtime_ctx),'permitted BASE accrual has no fabricated stop reason');
select is((select display->>'speed_multiplier_bps' from runtime_ctx),'10000','intrinsic neutral speed is not an allocation fraction');
select is((select display#>>'{funded_runtime,speed,product_multiplier_bps}' from runtime_ctx),'10000','product speed derives neutral approved original');
select is((select display#>>'{funded_runtime,speed,user_multiplier_bps}' from runtime_ctx),'10000','user speed derives neutral approved original');
select is((select display#>'{funded_runtime,speed,effective_global_multiplier}' from runtime_ctx),
 '{"numerator":"1","denominator":"1"}'::jsonb,'full neutral allocation has exact global speed one');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',4,
 jsonb_build_array(jsonb_build_object('productId',product,'allocationBps','5000')),'status-neutral-partial') from prospective_ctx;
select lives_ok($$set constraints all immediate$$,'actual authenticated partial selection commits its original and earning');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update runtime_ctx set display=public.read_own_mining_server_display((select member_id from prospective_ctx));
select is((select display#>>'{funded_runtime,allocation_bps}' from runtime_ctx),'5000','half allocation is separately reported');
select is((select display->>'speed_multiplier_bps' from runtime_ctx),'10000','half allocation does not mislabel neutral intrinsic speed as0.50');
select is((select display#>'{funded_runtime,speed,effective_global_multiplier}' from runtime_ctx),
 '{"numerator":"1","denominator":"2"}'::jsonb,'half allocation has exact global effective ratio one half');
select is((select display#>>'{funded_runtime,status}' from runtime_ctx),'ACTIVE','positive half allocation still permits BASE accrual');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select public.confirm_funding_allocation('CONFIRM',catalog,publication->>'snapshotDigest',5,
 '[]','status-neutral-clear') from prospective_ctx;
select lives_ok($$set constraints all immediate$$,'actual authenticated clear commits before server stop display');
set constraints all deferred;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update runtime_ctx set display=public.read_own_mining_server_display((select member_id from prospective_ctx)),
 state=(select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 wallet_count=(select count(*) from public.wallet_ledger);
select is((select display#>>'{funded_runtime,status}' from runtime_ctx),'STOPPED','actual clear stops BASE accrual');
select is((select display#>>'{funded_runtime,stop_reason}' from runtime_ctx),'NO_ACTIVE_ALLOCATION','stop reason derives confirmed explicit clear');
select is((select display#>'{funded_runtime,speed,effective_global_multiplier}' from runtime_ctx),
 '{"numerator":"0","denominator":"1"}'::jsonb,'zero allocation effective speed is exact zero, separate from neutral factors');
select ok((select(display#>>'{funded_runtime,conditional_maintenance,numerator}')::numeric>0
 and display#>>'{funded_runtime,conditional_maintenance,qualification}'='UNCONFIRMED' from runtime_ctx),
 'BASE stop does not remove independent conditional maintenance or pay it');
select public.read_own_mining_server_display(member_id) from prospective_ctx;
select is((select count(*) from public.wallet_ledger),(select wallet_count from runtime_ctx),'status reads post no wallet credit');
select is((select to_jsonb(s) from app_private.funding_engine_state s where user_id=(select member_id from prospective_ctx)),
 (select state from runtime_ctx),'status reads do not advance accepted cursor/carry/used capacity');
reset role;
select finish();
rollback;
