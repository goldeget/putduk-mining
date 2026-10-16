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
 '10699800-0000-4000-8000-000000000001','10699800-0000-4000-8000-000000000002',
 '10699800-0000-4000-8000-000000000003','10699800-0000-4000-8000-000000000004',
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),clock_timestamp()+interval '1 second');
alter table prospective_ctx add column product_second uuid default gen_random_uuid(), add column product_third uuid default gen_random_uuid();
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
insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
select product_second,catalog,(select id from public.asset_worlds order by id limit 1),'SLOT_SECOND','slot-second','GOLD',
 '로컬 둘째 시험 상품','Second local test','합성 fixture',2 from prospective_ctx;
insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
select product_third,catalog,(select id from public.asset_worlds order by id limit 1),'SLOT_THIRD','slot-third','GOLD',
 '로컬 셋째 시험 상품','Third local test','합성 fixture',3 from prospective_ctx;
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
-- Schedule only after fixture setup. The previous setup-time +1s deadline could
-- expire before PREVIEW on a loaded runner; retain the real future-time guard,
-- identical lifecycle receipts and the real wait below (no clock substitution).
update prospective_ctx set publish_at=clock_timestamp()+interval '15 seconds';
update prospective_ctx set review=pg_temp.prospective_catalog_command('PREVIEW','prospective-preview');
update prospective_ctx set review=pg_temp.prospective_catalog_command('APPROVE','prospective-approve');
update prospective_ctx set publication=pg_temp.prospective_catalog_command('PUBLISH','prospective-publish');
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',10000001,'slot-actual-deposit'),
 admin_id,10000001,'slot-actual-credit','actual local approved principal',gen_random_uuid()) from prospective_ctx;
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


-- Synthetic local reference only. Catalog publishing, deposit, member consent,
-- principal HOLD and source/condition/ledger acceptance use canonical commands.
create temporary table slot_ctx(allocation jsonb,original_id uuid,original_products jsonb,original_digest text,
 old_condition uuid,old_input jsonb,old_digest text,cycle_id uuid,anchor timestamptz,cycle_end timestamptz,
 bank_id uuid,policy_id uuid,record jsonb,key text,first_withdrawal uuid,second_withdrawal uuid,bootstrap_withdrawal uuid,
 first_condition uuid,zero_condition uuid,journals bigint,sources bigint,clocks bigint,receipts bigint,state jsonb);
insert into slot_ctx(cycle_id,anchor,cycle_end)
 select w.id,w.cycle_started_at,w.cycle_end from app_private.funding_engine_state s
 join app_private.funding_cycle_windows w on w.id=s.cycle_id where s.user_id=(select member_id from prospective_ctx);
grant select,update on slot_ctx to authenticated,service_role;
-- Test-only owner wrappers invoke closed historical verifiers through their
-- actual service-role executor context; product helper ACLs are not widened.
create function pg_temp.slot_archive(p_condition uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin perform app_private.assert_input3_condition_snapshot(p_condition);end;
$$;
create function pg_temp.slot_capacities(p_boundary uuid,p_inputs jsonb) returns numeric[] language plpgsql security definer set search_path=pg_catalog as $$
begin return app_private.principal_boundary_expected_capacities(p_boundary,p_inputs);end;
$$;
revoke all on function pg_temp.slot_archive(uuid),pg_temp.slot_capacities(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function pg_temp.slot_archive(uuid),pg_temp.slot_capacities(uuid,jsonb) to service_role;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
update slot_ctx set allocation=public.confirm_funding_allocation('CONFIRM',(select catalog from prospective_ctx),
 (select publication->>'snapshotDigest' from prospective_ctx),0,
 jsonb_build_array(jsonb_build_object('productId',(select product_third from prospective_ctx),'allocationBps','2000'),
 jsonb_build_object('productId',(select product from prospective_ctx),'allocationBps','3000'),
 jsonb_build_object('productId',(select product_second from prospective_ctx),'allocationBps','5000')),'slot-declared-original');
select lives_ok($$set constraints all immediate$$,'actual member command seals three ordered slots');
set constraints all deferred;
reset role;
update slot_ctx set original_id=(allocation->>'allocationId')::uuid;
update slot_ctx set original_products=(select products from app_private.funding_allocation_originals where id=original_id),
 original_digest=(select input_digest from app_private.funding_allocation_originals where id=original_id),
 old_condition=(select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx));
update slot_ctx set old_input=(select inputs from app_private.funding_condition_originals where id=old_condition),
 old_digest=(select input_digest from app_private.funding_condition_originals where id=old_condition);
select is((select old_input->>'allocation_bps' from slot_ctx),'10000','original complete declaration uses100% without duplicated global capacity');
select ok((select not(inputs ? 'slot_projection') from app_private.funding_condition_originals where id=(select old_condition from slot_ctx)),
 'legacy JSON shape and sealed input are unchanged by receipt mechanism');

insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,
 fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10699801,true,1,0,'{}',clock_timestamp(),admin_id,false from prospective_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
 display_hint,verification_status,verified_at,protection_until)
select member_id,'KRW_BANK',decode(repeat('ae',32),'hex'),encode(extensions.digest(member_id::text,'sha256'),'hex'),
 'Synthetic local destination fixture','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day' from prospective_ctx;
update slot_ctx set bank_id=(select id from public.withdrawal_destinations where user_id=(select member_id from prospective_ctx)),
 policy_id=(select id from public.withdrawal_policies where version=10699801);

-- Controlled legacy compatibility simulation only. The first allocation above
-- is genuine input2; a real principal HOLD then RELEASE produces genuine input3.
-- Disable exactly the two new receipt triggers during that canonical bootstrap,
-- not any existing source/ledger/seal/integrity guard. This is not an actual
-- historical database cutover test. One KRW is restored before the target flow.
alter table app_private.funding_condition_originals disable trigger funding_slot_condition_capture;
alter table app_private.funding_condition_originals disable trigger funding_slot_condition_complete;
select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
update slot_ctx set record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',1,
 policy_id,10699801,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}');
set constraints all immediate;
set constraints all deferred;
reset role;
update slot_ctx set key=record->>'key';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update slot_ctx set bootstrap_withdrawal=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),key,'KRW_BANK',bank_id,1);
set constraints all immediate;
set constraints all deferred;
select public.release_withdrawal_hold(bootstrap_withdrawal,(select admin_id from prospective_ctx),
 'synthetic local legacy input3 bootstrap','slot-bootstrap-cancel','CANCELLED') from slot_ctx;
select public.resolve_withdrawal_logical_request((select member_id from prospective_ctx),'CONFIRM',key,bootstrap_withdrawal) from slot_ctx;
set constraints all immediate;
set constraints all deferred;
reset role;
alter table app_private.funding_condition_originals enable trigger funding_slot_condition_capture;
alter table app_private.funding_condition_originals enable trigger funding_slot_condition_complete;
update slot_ctx set old_condition=(select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx));
update slot_ctx set old_input=(select inputs from app_private.funding_condition_originals where id=old_condition),
 old_digest=(select input_digest from app_private.funding_condition_originals where id=old_condition);
select is((select old_input->>'input_contract_version' from slot_ctx),'3','controlled legacy fixture is actual canonical input3');
select is((select count(*) from app_private.funding_slot_condition_receipts where condition_id=(select old_condition from slot_ctx)),
 0::bigint,'controlled legacy input3 condition has no new receipt');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select pg_temp.slot_archive(old_condition) from slot_ctx$$,
 'controlled canonical legacy input3 with unchanged sealed shape remains replayable');
reset role;
create temporary table slot_original_lots as select id,to_jsonb(l) snapshot from public.funding_principal_lots l where user_id=(select member_id from prospective_ctx);
create temporary table slot_original_portions as select id,to_jsonb(p) snapshot from app_private.funding_principal_portions p where user_id=(select member_id from prospective_ctx);
create temporary table slot_original_clocks as select id,to_jsonb(c) snapshot from app_private.funding_portion_clock_receipts c where user_id=(select member_id from prospective_ctx);

select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
update slot_ctx set record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',9800001,
 policy_id,10699801,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}');
select lives_ok($$set constraints all immediate$$,'signed member consent commits under its authenticated subject before service HOLD');
set constraints all deferred;
reset role;
update slot_ctx set key=record->>'key',journals=(select count(*) from public.ledger_transactions),
 sources=(select count(*) from public.money_source_movements),clocks=(select count(*) from app_private.funding_portion_clock_receipts),
 receipts=(select count(*) from app_private.funding_slot_condition_receipts),
 state=(select to_jsonb(s) from app_private.funding_engine_state s where s.user_id=(select member_id from prospective_ctx));
create function pg_temp.slot_receipt_late_fault() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001',message='SLOT_RECEIPT_LATE_FAULT';end;
$$;
create trigger slot_receipt_late_fault before insert on app_private.funding_slot_condition_receipts
 for each row execute function pg_temp.slot_receipt_late_fault();
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.hold_withdrawal_logical_request((select member_id from prospective_ctx),key,'KRW_BANK',bank_id,9800001) from slot_ctx$$,
 'P0001','SLOT_RECEIPT_LATE_FAULT','late projection fault rolls old earning and financial HOLD back atomically');
reset role;
select is((select count(*) from public.ledger_transactions),(select journals from slot_ctx),'late slot fault leaves no mining/principal header');
select is((select count(*) from public.money_source_movements),(select sources from slot_ctx),'late slot fault leaves no source movement');
select is((select count(*) from app_private.funding_portion_clock_receipts),(select clocks from slot_ctx),'late slot fault preserves portion clocks');
select is((select count(*) from app_private.funding_slot_condition_receipts),(select receipts from slot_ctx),'late slot fault leaves no projection receipt');
select is((select to_jsonb(s) from app_private.funding_engine_state s where s.user_id=(select member_id from prospective_ctx)),
 (select state from slot_ctx),'late slot fault preserves exact state and carry');
drop trigger slot_receipt_late_fault on app_private.funding_slot_condition_receipts;

set local role service_role;
update slot_ctx set first_withdrawal=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),key,'KRW_BANK',bank_id,9800001);
select lives_ok($$set constraints all immediate$$,'actual principal HOLD accepts a three to one slot downgrade');
set constraints all deferred;
reset role;
update slot_ctx set first_condition=(select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx));
select is((select inputs->>'principal_atomic' from app_private.funding_condition_originals where id=(select first_condition from slot_ctx)),
 '200000','HOLD source leaves exactly approved L1 principal');
select is((select inputs->>'slots' from app_private.funding_condition_originals where id=(select first_condition from slot_ctx)),
 '1','new sealed condition carries approved one slot');
select is((select inputs->>'allocation_bps' from app_private.funding_condition_originals where id=(select first_condition from slot_ctx)),
 '2000','only first original ordinal remains active with no redistributed weight');
select is((select projection#>>'{0,productId}' from app_private.funding_slot_condition_receipts where condition_id=(select first_condition from slot_ctx)),
 (select product_third::text from prospective_ctx),'stable original ordinal wins over catalog display order');
select is((select projection#>>'{1,state}' from app_private.funding_slot_condition_receipts where condition_id=(select first_condition from slot_ctx)),
 'PAUSED','second original is preserved paused');
select is((select projection#>>'{2,pauseReason}' from app_private.funding_slot_condition_receipts where condition_id=(select first_condition from slot_ctx)),
 'SLOT_LIMIT_REDUCED','last original preserves explicit slot pause reason');
select is((select paused_allocation_bps from app_private.funding_slot_condition_receipts where condition_id=(select first_condition from slot_ctx)),
 8000,'paused weight is preserved and never reassigned');
select is((select products from app_private.funding_allocation_originals where id=(select original_id from slot_ctx)),
 (select original_products from slot_ctx),'complete original products and rules unchanged');
select is((select input_digest from app_private.funding_allocation_originals where id=(select original_id from slot_ctx)),
 (select original_digest from slot_ctx),'original allocation seal bytes unchanged');
select is((select inputs from app_private.funding_condition_originals where id=(select old_condition from slot_ctx)),
 (select old_input from slot_ctx),'previous sealed condition JSON bytes unchanged');
select is((select input_digest from app_private.funding_condition_originals where id=(select old_condition from slot_ctx)),
 (select old_digest from slot_ctx),'previous condition digest unchanged');
select is((select cycle_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select cycle_id from slot_ctx),'slot downgrade keeps exact global cycle');
select is((select s.carry_num::text from app_private.funding_engine_state s where s.user_id=(select member_id from prospective_ctx)),
 (select e.calculation->>'carryNum' from app_private.funding_earned_receipts e join app_private.funding_principal_boundary_preparations p on p.id=e.cause_principal_boundary_id
 join app_private.funding_withdrawal_clock_admissions a on a.id=p.clock_admission_id where a.withdrawal_id=(select first_withdrawal from slot_ctx) and a.phase='HOLD'),
 'exact old interval carry survives the new condition');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select pg_temp.slot_capacities(p.id,c.inputs-'tier_activated')
 from app_private.funding_principal_boundary_preparations p join app_private.funding_principal_boundary_completions b on b.boundary_id=p.id
 join app_private.funding_condition_originals c on c.id=b.condition_id where c.id=(select first_condition from slot_ctx)$$,
 '55000','FUNDING_PRINCIPAL_NEXT_CONDITION_UNRESOLVED','forged missing Tier activation cannot bypass SQL NULL guard');
select throws_ok($$select pg_temp.slot_capacities(p.id,jsonb_set(c.inputs,'{tier_activated}','"invalid"'))
 from app_private.funding_principal_boundary_preparations p join app_private.funding_principal_boundary_completions b on b.boundary_id=p.id
 join app_private.funding_condition_originals c on c.id=b.condition_id where c.id=(select first_condition from slot_ctx)$$,
 '55000','FUNDING_PRINCIPAL_NEXT_CONDITION_UNRESOLVED','malformed Tier activation remains rejected');
reset role;
update slot_ctx set receipts=(select count(*) from app_private.funding_slot_condition_receipts),journals=(select count(*) from public.ledger_transactions);
set local role service_role;
select is((select public.hold_withdrawal_logical_request((select member_id from prospective_ctx),key,'KRW_BANK',bank_id,9800001) from slot_ctx),
 (select first_withdrawal from slot_ctx),'same principal command replays original request');
select lives_ok($$set constraints all immediate$$,'replayed command retains original completion proof');
set constraints all deferred;
reset role;
select is((select count(*) from app_private.funding_slot_condition_receipts),(select receipts from slot_ctx),'replay creates no duplicate projection');
select is((select count(*) from public.ledger_transactions),(select journals from slot_ctx),'replay creates no extra ledger headers');
set local role service_role;
select public.resolve_withdrawal_logical_request((select member_id from prospective_ctx),'CONFIRM',key,first_withdrawal) from slot_ctx;
set constraints all immediate;
set constraints all deferred;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) from prospective_ctx;
set local role authenticated;
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',(select catalog from prospective_ctx),
 (select publication->>'snapshotDigest' from prospective_ctx),1,
 jsonb_build_array(jsonb_build_object('productId',(select product from prospective_ctx),'allocationBps','5000'),
 jsonb_build_object('productId',(select product_second from prospective_ctx),'allocationBps','5000')),'slot-new-overlimit')$$,
 '55000','ALLOCATION_SLOT_LIMIT_EXCEEDED','new over-slot declaration still rejected under downgraded Tier');
update slot_ctx set record=public.prepare_withdrawal_logical_request((select member_id from prospective_ctx),'KRW_BANK',100001,
 policy_id,10699801,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}');
select lives_ok($$set constraints all immediate$$,'second signed member consent commits before service role changes');
set constraints all deferred;
reset role;
update slot_ctx set key=record->>'key';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update slot_ctx set second_withdrawal=public.hold_withdrawal_logical_request((select member_id from prospective_ctx),key,'KRW_BANK',bank_id,100001);
select lives_ok($$set constraints all immediate$$,'actual next HOLD accepts one to zero slots below minimum');
set constraints all deferred;
reset role;
update slot_ctx set zero_condition=(select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx));
select is((select inputs->>'principal_atomic' from app_private.funding_condition_originals where id=(select zero_condition from slot_ctx)),
 '99999','zero-slot condition reflects exact source eligible principal');
select is((select inputs->>'slots' from app_private.funding_condition_originals where id=(select zero_condition from slot_ctx)),
 '0','no eligible Tier has zero slots');
select is((select inputs->>'allocation_bps' from app_private.funding_condition_originals where id=(select zero_condition from slot_ctx)),
 '0','every preserved declaration pauses and BASE future accrual is zero');
select is((select inputs->>'retention_bps' from app_private.funding_condition_originals where id=(select zero_condition from slot_ctx)),
 '0','below minimum does not invent retention');
select ok((select bool_and(to_jsonb(l)=x.snapshot) from slot_original_lots x join public.funding_principal_lots l using(id)),
 'both slot downgrades preserve exact original lot records and age origins');
select ok((select bool_and(to_jsonb(p)=x.snapshot) from slot_original_portions x join app_private.funding_principal_portions p using(id)),
 'both slot downgrades preserve original principal portion records');
select ok((select bool_and(to_jsonb(c)=x.snapshot) from slot_original_clocks x join app_private.funding_portion_clock_receipts c using(id)),
 'both slot downgrades preserve exact original accumulated age and clock records');
select ok((select bool_and(c.effective_at=a.effective_at) from app_private.funding_condition_originals c
 join app_private.funding_principal_boundary_preparations p on p.id=c.cause_principal_boundary_id
 join app_private.funding_withdrawal_clock_admissions a on a.id=p.clock_admission_id
 where c.id in((select first_condition from slot_ctx),(select zero_condition from slot_ctx))),
 'accepted slot changes start at their exact admitted HOLD clock and never backdate');
select ok((select bool_and(x.value->>'state'='PAUSED') from app_private.funding_slot_condition_receipts r,
 jsonb_array_elements(r.projection) x(value) where r.condition_id=(select zero_condition from slot_ctx)),
 'all original ordinals persist paused in zero slot state');
set local role service_role;
select lives_ok($$select pg_temp.slot_archive(first_condition) from slot_ctx$$,
 'past one-slot archive still verifies after later zero-slot revision');
select lives_ok($$select pg_temp.slot_archive(zero_condition) from slot_ctx$$,
 'zero-slot archive verifies exact source bounded originals');
reset role;
select ok((select r.condition_revision=(select c.revision from app_private.funding_condition_originals c where c.id=r.condition_id)
 and r.previous_condition_id=(select first_condition from slot_ctx) from app_private.funding_slot_condition_receipts r where r.condition_id=(select zero_condition from slot_ctx)),
 'receipt uses exact immutable condition ID and revision rather than effective-time ordering');
set local role service_role;
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))->>'tier_activated'),
 'false','backend DTO truthfully reports below-minimum Tier inactive');
select is((public.read_own_mining_server_display((select member_id from prospective_ctx))#>>'{funded_runtime,status}'),
 'STOPPED','actual backend remains stopped at zero slots');
reset role;

-- Full original proof still includes paused suffix; service cannot rewrite the
-- projection, original metadata, condition, or insert replacement receipts.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$insert into app_private.funding_slot_condition_receipts default values$$,'42501',null,
 'service cannot manufacture a projection receipt');
select throws_ok($$update app_private.funding_slot_condition_receipts set active_allocation_bps=10000$$,'42501',null,
 'service cannot rewrite a paused projection');
select throws_ok($$select app_private.funding_slot_projection((select original_id from slot_ctx),(select other_id from prospective_ctx),1)$$,
 '55000','FUNDING_SLOT_ORIGINAL_REQUIRED','wrong owner cannot use preserved original');
reset role;
select throws_ok($$update app_private.funding_slot_condition_receipts set approved_slots=128$$,
 '55000',null,'owner update still hits immutable receipt protection');
-- Test-only owner corruption rolls back within throws_ok's subtransaction,
-- including trigger state; no product permission is widened.
create function pg_temp.slot_bad_receipt(p_mode text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 alter table app_private.funding_slot_condition_receipts disable trigger funding_slot_receipt_append_only;
 if p_mode='MISSING' then delete from app_private.funding_slot_condition_receipts where condition_id=(select zero_condition from pg_temp.slot_ctx);
 else update app_private.funding_slot_condition_receipts set approved_slots=1 where condition_id=(select zero_condition from pg_temp.slot_ctx);end if;
 perform app_private.assert_funding_slot_condition_receipt((select zero_condition from pg_temp.slot_ctx),true);
 raise exception using errcode='P0001',message='TEST_EXPECTED_REJECTION_MISSING';
end;
$$;
revoke all on function pg_temp.slot_bad_receipt(text) from public,anon,authenticated,service_role;
grant execute on function pg_temp.slot_bad_receipt(text) to service_role;
set local role service_role;
select throws_ok($$select pg_temp.slot_bad_receipt('MISSING')$$,'55000','FUNDING_SLOT_RECEIPT_REQUIRED',
 'required current-condition receipt absence rejects');
select throws_ok($$select pg_temp.slot_bad_receipt('TAMPERED')$$,'55000','FUNDING_SLOT_RECEIPT_MISMATCH',
 'tampered exact condition revision receipt rejects');
reset role;
select is((select tgenabled::text from pg_trigger where tgrelid='app_private.funding_slot_condition_receipts'::regclass
 and tgname='funding_slot_receipt_append_only'),'O','negative fixture restores immutable trigger automatically');
select is((select approved_slots from app_private.funding_slot_condition_receipts where condition_id=(select zero_condition from slot_ctx)),
 0,'negative fixture restores original receipt bytes');

-- Slot recovery requires a separate captured policy. Financial CANCEL is still
-- completed; it must not silently restore paused products or mint catch-up.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.release_withdrawal_hold(second_withdrawal,(select admin_id from prospective_ctx),
 'local unapproved slot recovery remains unresolved','slot-uncertain-recovery','CANCELLED') from slot_ctx$$,
 'canonical financial CANCEL remains possible when slot recovery policy is unknown');
select lives_ok($$set constraints all immediate$$,'CANCEL source and unresolved runtime commit atomically');
set constraints all deferred;
reset role;
select is((select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select zero_condition from slot_ctx),'unapproved recovery never replaces zero-slot accepted condition');
select is((select c.reason_code from app_private.funding_principal_boundary_completions c
 join app_private.funding_principal_boundary_preparations p on p.id=c.boundary_id
 join app_private.funding_withdrawal_clock_admissions a on a.id=p.clock_admission_id
 where a.withdrawal_id=(select second_withdrawal from slot_ctx) and a.phase='RELEASE'),
 'FUNDING_SLOT_RECOVERY_POLICY_REQUIRED','unsupported increase is explicit and never paid silently');
set local role service_role;
select lives_ok($$select pg_temp.slot_archive(first_condition) from slot_ctx$$,
 'later financial source recovery cannot alter archived one-slot proof');
reset role;
select is((select coverage from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 'COMPLETE','native financial source conservation remains truthful despite runtime policy block');
select is((select eligible_principal_atomic::bigint from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 200000::bigint,'financial release restores exact principal without slot auto-resume');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',100000,'slot-after-release-credit'),
 admin_id,100000,'slot-after-release-credit-approve','synthetic local recovery proof',gen_random_uuid()) from prospective_ctx$$,
 'genuine extra credit remains financially possible when slot recovery is unsupported');
select lives_ok($$set constraints all immediate$$,'extra credit commits finance and unresolved runtime together');
set constraints all deferred;
reset role;
select is((select eligible_principal_atomic::bigint from public.money_source_summaries where user_id=(select member_id from prospective_ctx)),
 300000::bigint,'extra credit preserves exact approved principal despite runtime policy block');
select is((select condition_id from app_private.funding_engine_state where user_id=(select member_id from prospective_ctx)),
 (select zero_condition from slot_ctx),'extra credit does not silently restore paused slots');
select ok((select b.runtime_outcome='UNRESOLVED' and b.reason_code is not null from app_private.funding_credit_boundary_completions b
 join app_private.funding_credit_boundary_preparations p on p.id=b.boundary_id join public.deposit_requests d on d.id=p.command_original_id
 where d.idempotency_key='slot-after-release-credit'),'extra credit records its explicit unresolved runtime outcome');
select is((select count(*) from app_private.funding_earned_receipts e
 join app_private.funding_credit_boundary_preparations p on p.id=e.cause_credit_boundary_id join public.deposit_requests d on d.id=p.command_original_id
 where d.idempotency_key='slot-after-release-credit'),0::bigint,
 'unsupported recovery creates no earning receipt and no BASE catch-up');
set constraints all immediate;
select * from finish();
rollback;
