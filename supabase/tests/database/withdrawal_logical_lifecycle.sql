begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.withdrawal_logical_requests'::regclass), 'logical requests enforce RLS');
select ok(not has_table_privilege('anon', 'public.withdrawal_logical_requests', 'SELECT'), 'anonymous cannot read intent records');
select ok(not has_table_privilege('authenticated', 'public.withdrawal_logical_requests', 'SELECT'), 'members cannot directly read another owner or safe fingerprints');
select ok(not has_table_privilege('authenticated', 'public.withdrawal_logical_requests', 'INSERT,UPDATE,DELETE'), 'members cannot directly write lifecycle');
select ok(has_table_privilege('service_role', 'public.withdrawal_logical_requests', 'SELECT,INSERT,UPDATE'), 'server can manage lifecycle');
select ok(not has_table_privilege('service_role', 'public.withdrawal_logical_requests', 'DELETE'), 'server cannot delete recovery records');
select ok(not exists (
  select 1 from pg_proc where proname in ('withdrawal_logical_record','prepare_withdrawal_logical_request','bind_withdrawal_logical_destination','hold_withdrawal_logical_request','resolve_withdrawal_logical_request')
    and (prosecdef or not ('search_path=pg_catalog' = any(proconfig))
      or has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))
), 'all lifecycle RPCs are invoker, fixed path and service-only');
select is((select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'withdrawal_logical_requests'
  and column_name in ('account_number','account_holder','address','encrypted_value','private_key','secret')), 0, 'no raw/cipher destination column on lifecycle table');

create temporary table logical_ctx(owner_id uuid, other_id uuid, operator_id uuid, policy_id uuid, logical jsonb, destination_id uuid, withdrawal_id uuid, later_key text);
insert into logical_ctx values ('cc100000-0000-4000-8000-000000000001','cc100000-0000-4000-8000-000000000002','cc100000-0000-4000-8000-000000000003',null,null,null,null,null);
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select id,'authenticated','authenticated',id::text || '@logical.putduk.test','',statement_timestamp(),'{}','{}',statement_timestamp(), statement_timestamp(), '', '', '', ''
from logical_ctx cross join lateral unnest(array[owner_id,other_id,operator_id]) as id;
insert into public.user_roles(user_id,role,granted_by) select operator_id,'ADMIN',operator_id from logical_ctx;
select public.bootstrap_user((select owner_id from logical_ctx));
select public.bootstrap_user((select other_id from logical_ctx));
select public.approve_deposit_request(
  public.create_deposit_request((select owner_id from logical_ctx),'KRW',100000,'logical-fixture-deposit'),
  (select operator_id from logical_ctx),100000,'logical-fixture-deposit-ledger','local pgTAP verified funding',gen_random_uuid()
);
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,fee_atomic,destination_config,effective_at,approved_by)
select 'KRW','KRW_BANK',189001,true,1,0,'{"allowed_bank_codes":["KB"]}',statement_timestamp()-interval '1 minute',operator_id from logical_ctx returning id;
update logical_ctx set policy_id = (select id from public.withdrawal_policies where destination_type='KRW_BANK' and version=189001);
update logical_ctx set logical = public.prepare_withdrawal_logical_request(owner_id,'KRW_BANK',1000,policy_id,189001,repeat('a',64),null);

select is((select logical->>'state' from logical_ctx),'PREPARED','prepare contains no money effect');
select is((select count(*)::integer from public.withdrawal_requests where user_id=(select owner_id from logical_ctx)),0,'prepare creates no withdrawal');
select is((select public.prepare_withdrawal_logical_request(owner_id,'KRW_BANK',1000,policy_id,189001,repeat('a',64),null)->>'key' = logical->>'key' from logical_ctx),true,'a second tab preparing same material receives the same random key');
select throws_ok($$select public.prepare_withdrawal_logical_request(owner_id,'KRW_BANK',2000,policy_id,189001,repeat('a',64),null) from logical_ctx$$,'55000','WITHDRAWAL_LOGICAL_PENDING','different material cannot silently replace pending intent');

update logical_ctx set logical = public.bind_withdrawal_logical_destination(owner_id,logical->>'key','KRW_BANK',repeat('a',64),decode(repeat('ab',32),'hex'),'KB ****7890','step-up-fixture',gen_random_uuid());
update logical_ctx set destination_id=(logical->>'destinationId')::uuid;
select is((select logical->>'state' from logical_ctx),'DESTINATION_REGISTERED','registration binds original logical record');
select is((select logical->>'destinationIdentity' from logical_ctx),repeat('a',64),'registration retains canonical identity');
create temporary table logical_destination_snapshot as select id, protection_until, replaced_at from public.withdrawal_destinations where id=(select destination_id from logical_ctx);
select is((select public.bind_withdrawal_logical_destination(owner_id,logical->>'key','KRW_BANK',repeat('a',64),decode(repeat('ab',32),'hex'),'KB ****7890','step-up-fixture',gen_random_uuid())->>'destinationId' from logical_ctx),(select destination_id::text from logical_ctx),'registration response loss returns the original destination');
select is((select count(*)::integer from public.withdrawal_destinations where user_id=(select owner_id from logical_ctx)),1,'registration replay creates exactly one destination');
select is((select count(*)::integer from public.withdrawal_destination_history where destination_id=(select destination_id from logical_ctx)),1,'registration replay creates exactly one history event');
select is((select protection_until from public.withdrawal_destinations where id=(select destination_id from logical_ctx)),(select protection_until from logical_destination_snapshot),'registration replay never restarts protection');
select is((select public.prepare_withdrawal_logical_request(owner_id,'KRW_BANK',1000,policy_id,189001,null,destination_id)->>'key' from logical_ctx),(select logical->>'key' from logical_ctx),'new-to-registered preparation preserves original key');

select throws_ok($$select public.hold_withdrawal_logical_request(other_id,logical->>'key','KRW_BANK',destination_id,1000) from logical_ctx$$,'42501','WITHDRAWAL_LOGICAL_MISMATCH','cross-owner hold denied');
select throws_ok($$select public.hold_withdrawal_logical_request(owner_id,gen_random_uuid()::text,'KRW_BANK',destination_id,1000) from logical_ctx$$,'42501','WITHDRAWAL_LOGICAL_MISMATCH','unprepared new key cannot invoke member hold');
select throws_ok($$select public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,2000) from logical_ctx$$,'42501','WITHDRAWAL_LOGICAL_MISMATCH','amount is immutable after prepare');
update logical_ctx set withdrawal_id=public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000);
select is((select state from public.withdrawal_logical_requests where idempotency_key=(select logical->>'key' from logical_ctx)),'OUTCOME_UNCERTAIN','hold and durable recovery state commit together');
select is((select public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000) from logical_ctx),(select withdrawal_id from logical_ctx),'hold response loss replays exact withdrawal id');
select is((select count(*)::integer from public.withdrawal_requests where user_id=(select owner_id from logical_ctx) and idempotency_key=(select logical->>'key' from logical_ctx)),1,'one request for original key');
select is((select count(*)::integer from public.ledger_transactions where idempotency_key=(select logical->>'key' || ':hold' from logical_ctx)),1,'one balanced hold for original key');
select is((select count(*)::integer from public.outbox_events where idempotency_key=(select logical->>'key' || ':event' from logical_ctx) and aggregate_id=(select withdrawal_id from logical_ctx)),1,'one requested outbox for original key');
select is((select count(*)::integer from public.transaction_receipts where source_type='withdrawal_request' and source_id=(select withdrawal_id from logical_ctx)),1,'one receipt for original key');
select is((select sum(case side when 'DEBIT' then amount_atomic else -amount_atomic end) from public.ledger_entries where transaction_id=(select hold_ledger_transaction_id from public.withdrawal_requests where id=(select withdrawal_id from logical_ctx))),0::numeric,'hold entries remain balanced');
select is((select public.resolve_withdrawal_logical_request(owner_id,'CANCEL',logical->>'key')->>'state' from logical_ctx),'OUTCOME_UNCERTAIN','cancel cannot discard a committed hold');
select is((select public.resolve_withdrawal_logical_request(owner_id,'REJECT',logical->>'key')->>'state' from logical_ctx),'OUTCOME_UNCERTAIN','definitive rejection races must reconcile existing money first');
select is((select public.resolve_withdrawal_logical_request(other_id)->>'key' from logical_ctx),null,'recovery never returns another owner');
select throws_ok($$select public.resolve_withdrawal_logical_request(owner_id,'CONFIRM',logical->>'key',gen_random_uuid()) from logical_ctx$$,'42501','WITHDRAWAL_LOGICAL_CONFIRMATION_REQUIRED','acknowledgement requires exact money id');

update public.withdrawal_logical_requests set created_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where idempotency_key=(select logical->>'key' from logical_ctx);
select is((select public.resolve_withdrawal_logical_request(owner_id)->>'key' from logical_ctx),(select logical->>'key' from logical_ctx),'expired committed intent remains recoverable');
select is((select public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000) from logical_ctx),(select withdrawal_id from logical_ctx),'expiry does not rotate or duplicate committed key');
select is((select public.resolve_withdrawal_logical_request(owner_id,'CONFIRM',logical->>'key',withdrawal_id)->>'state' from logical_ctx),'CONFIRMED','explicit exact acknowledgement concludes logical request');
update logical_ctx set later_key=public.prepare_withdrawal_logical_request(owner_id,'KRW_BANK',1000,policy_id,189001,null,destination_id)->>'key';
select isnt((select later_key from logical_ctx),(select logical->>'key' from logical_ctx),'later legitimate identical intent gets a different random key');
select lives_ok($$select public.hold_withdrawal_logical_request(owner_id,later_key,'KRW_BANK',destination_id,1000) from logical_ctx$$,'later legitimate identical hold succeeds');
select is((select count(*)::integer from public.withdrawal_requests where user_id=(select owner_id from logical_ctx)),2,'two distinct confirmed intents are not permanently deduplicated');
select is((select public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000) from logical_ctx),(select withdrawal_id from logical_ctx),'late old tab replays old result even after newer intent');

update logical_ctx set logical = public.prepare_withdrawal_logical_request(other_id,'KRW_BANK',1000,policy_id,189001,repeat('b',64),null);
update public.withdrawal_logical_requests set created_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where idempotency_key=(select logical->>'key' from logical_ctx);
select throws_ok($$select public.bind_withdrawal_logical_destination(other_id,logical->>'key','KRW_BANK',repeat('b',64),decode(repeat('ab',32),'hex'),'KB ****7890','step-up-fixture',gen_random_uuid()) from logical_ctx$$,'55000','WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED','expired uncommitted intent fails closed before registration');
select is((select public.resolve_withdrawal_logical_request(other_id,'CANCEL',logical->>'key')->>'state' from logical_ctx),'CANCELLED','explicit TTL cancellation proves no money first');
select lives_ok($$select public.prepare_withdrawal_logical_request(other_id,'KRW_BANK',1000,policy_id,189001,repeat('b',64),null) from logical_ctx$$,'fresh request allowed only after safe cancellation');

select * from finish();
rollback;
