begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- These are real conversion/deposit/withdrawal command receipts in one
-- rollback-only test transaction. No verified mining producer is synthesized.
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
  from pg_proc where oid = 'app_private.request_withdrawal_with_hold(uuid,uuid,bigint,text,text,uuid)'::regprocedure),
  'final private writer retains invoker authority and fixed path');
select ok(not has_function_privilege('anon', 'app_private.request_withdrawal_with_hold(uuid,uuid,bigint,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.request_withdrawal_with_hold(uuid,uuid,bigint,text,text,uuid)', 'EXECUTE'),
  'public and member clients cannot invoke the private writer');
select ok(has_function_privilege('service_role', 'public.request_krw_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.request_usdt_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.create_welcome_reward_withdrawal_request(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'canonical service-only entrypoints keep their execute privileges');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname='request_withdrawal_with_hold'),1,
  'private writer is replaced without an overload');

create temporary table guard_ctx (
  principal_id uuid, bank_owner uuid, usdt_owner uuid, admin_id uuid, label_owner uuid,
  program_id uuid, bank_conversion uuid, usdt_conversion uuid, pending_conversion uuid,
  bank_policy uuid, usdt_policy uuid, principal_bank uuid, principal_usdt uuid,
  bank_destination uuid, usdt_destination uuid, label_destination uuid, bank_withdrawal uuid, usdt_withdrawal uuid,
  send_id uuid, finalize_id uuid, release_id uuid, logical jsonb
);
insert into guard_ctx(principal_id,bank_owner,usdt_owner,admin_id,label_owner) values (
  '10410000-0000-4000-8000-000000000101',
  '10410000-0000-4000-8000-000000000102',
  '10410000-0000-4000-8000-000000000103',
  '10410000-0000-4000-8000-000000000104',
  '10410000-0000-4000-8000-000000000105'
);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@source-guard.putduk.test','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from guard_ctx cross join lateral unnest(array[principal_id,bank_owner,usdt_owner,admin_id,label_owner]) person;
insert into public.user_roles(user_id,role,granted_by)
select admin_id,'ADMIN',admin_id from guard_ctx;
select public.bootstrap_user(person) from guard_ctx
cross join lateral unnest(array[principal_id,bank_owner,usdt_owner,label_owner]) person;
grant select,update on guard_ctx to service_role;
set local role service_role;
select public.approve_deposit_request(
  public.create_deposit_request(principal_id,'KRW',100000,'guard-real-principal-request'),
  admin_id,100000,'guard-real-principal-credit','actual local test deposit confirmation',gen_random_uuid()
) from guard_ctx;
reset role;

insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,
  minimum_amount_atomic,fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW',method,version,true,1,0,'{}',statement_timestamp()-interval '1 hour',admin_id,true
from guard_ctx cross join (values ('KRW_BANK',1041001),('USDT_ADDRESS',1041002)) p(method,version);
update guard_ctx set bank_policy=(select id from public.withdrawal_policies where version=1041001),
  usdt_policy=(select id from public.withdrawal_policies where version=1041002);
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,
  value_fingerprint,display_hint,verification_status,verified_at,protection_until)
select person,method,decode(repeat('cd',32),'hex'),
  encode(extensions.digest(person::text||method,'sha256'),'hex'),'원본 시험 목적지',
  'VERIFIED',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day'
from guard_ctx cross join lateral (values
  (principal_id,'KRW_BANK'),(principal_id,'USDT_ADDRESS'),
  (bank_owner,'KRW_BANK'),(usdt_owner,'USDT_ADDRESS'),(label_owner,'KRW_BANK')) d(person,method);
update guard_ctx set
  principal_bank=(select id from public.withdrawal_destinations where user_id=principal_id and destination_type='KRW_BANK'),
  principal_usdt=(select id from public.withdrawal_destinations where user_id=principal_id and destination_type='USDT_ADDRESS'),
  bank_destination=(select id from public.withdrawal_destinations where user_id=bank_owner),
  usdt_destination=(select id from public.withdrawal_destinations where user_id=usdt_owner),
  label_destination=(select id from public.withdrawal_destinations where user_id=label_owner);

select is((select coverage from public.money_source_summaries where user_id=(select principal_id from guard_ctx)),
  'COMPLETE','real deposit CREDIT coverage alone is complete but not a mining/lifecycle producer');
select is((select eligible_principal_atomic from public.money_source_summaries where user_id=(select principal_id from guard_ctx)),
  '100000','actual principal receipt amount is known before rejected general hold');
create temporary table guard_before as select
  (select count(*) from public.withdrawal_requests) requests,
  (select count(*) from public.ledger_transactions) journals,
  (select count(*) from public.wallet_ledger) wallets,
  (select count(*) from public.outbox_events) events,
  (select count(*) from public.transaction_receipts) receipts,
  (select count(*) from public.money_source_movements) sources;
set local role service_role;
select throws_ok($$select public.request_krw_withdrawal(principal_id,principal_bank,1000,'guard-general-bank') from guard_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','funded principal cannot be silently spent as mining reward');
select throws_ok($$select public.request_usdt_withdrawal(principal_id,principal_usdt,1000,'guard-general-usdt') from guard_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','manual USDT general withdrawal also requires verified source lifecycle');
select throws_ok($$select app_private.request_withdrawal_with_hold(principal_id,principal_bank,1000,'KRW_BANK','guard-private-general',null) from guard_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','final private writer prevents general-wrapper bypass');
update guard_ctx set logical=public.prepare_withdrawal_logical_request(principal_id,'KRW_BANK',1000,bank_policy,1041001,null,principal_bank);
select throws_ok($$select public.hold_withdrawal_logical_request(principal_id,logical->>'key','KRW_BANK',principal_bank,1000) from guard_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','prepared logical intent cannot bypass source closure');
reset role;
select is((select state from public.withdrawal_logical_requests where user_id=(select principal_id from guard_ctx)),
  'DESTINATION_REGISTERED','rejected hold leaves the original prepared intent intact');
select ok((select requests=(select count(*) from public.withdrawal_requests)
  and journals=(select count(*) from public.ledger_transactions)
  and wallets=(select count(*) from public.wallet_ledger)
  and events=(select count(*) from public.outbox_events)
  and receipts=(select count(*) from public.transaction_receipts)
  and sources=(select count(*) from public.money_source_movements) from guard_before),
  'all rejected general paths have no request/journal/wallet/event/receipt/source effects');

-- An explicitly unclassified historical label is not a verified reward source.
insert into public.wallet_ledger(wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
select id,user_id,'CREDIT','MINING_REWARD',2000,'guard-unclassified-mining-label','test',user_id
from public.wallet_accounts where user_id=(select label_owner from guard_ctx) and currency='KRW';
select is((select coverage from public.money_source_summaries where user_id=(select label_owner from guard_ctx)),
  'UNRESOLVED','a wallet MINING_REWARD label does not manufacture verified source coverage');
select throws_ok($$select public.request_krw_withdrawal(label_owner,label_destination,1000,'guard-unclassified-label') from guard_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','unresolved labeled reward remains closed before destination or money writes');

-- Disabled trial-program/completion/KYC rows are test inputs. The conversion
-- and qualified withdrawal themselves are the actual existing commands.
with program as (
  insert into public.trial_programs(name,version,is_enabled,duration_seconds,target_reward_krw,
    first_result_target_seconds,first_world_id,completion_copy,effective_at)
  select 'guard-qualified-start',1,false,3600,9000,60,id,'체험 완료',statement_timestamp()-interval '2 hours'
  from public.asset_worlds where code='KOREA' returning id
) update guard_ctx set program_id=program.id from program;
insert into public.trial_accounts(user_id,trial_program_id,trial_program_version,world_id,status,
  started_at,expires_at,last_settled_at,quota_consumed_bps,reward_atomic,target_reward_krw)
select person,program_id,1,program.first_world_id,'COMPLETED',statement_timestamp()-interval '1 hour',
  statement_timestamp(),statement_timestamp(),10000,9000,9000
from guard_ctx join public.trial_programs program on program.id=program_id
cross join lateral unnest(array[bank_owner,usdt_owner,principal_id]) person;
insert into public.trial_completions(trial_account_id,user_id,reason,final_quota_bps,final_reward_atomic,completed_at)
select id,user_id,'QUOTA',10000,9000,statement_timestamp() from public.trial_accounts
where user_id in ((select bank_owner from guard_ctx),(select usdt_owner from guard_ctx));
insert into public.kyc_cases(user_id,status,risk_level,decided_at,reviewed_by)
select person,'APPROVED','LOW',statement_timestamp(),admin_id from guard_ctx
cross join lateral unnest(array[bank_owner,usdt_owner]) person;
-- Negative input only: a pending, unqualified original has no journal/wallet/source.
with pending as (
  insert into public.trial_reward_conversions(trial_account_id,user_id,status,
    eligible_amount_atomic,cap_amount_atomic,funding_required,rule_version,
    risk_model_version,idempotency_key)
  select id,user_id,'PENDING_QUALIFICATION',5000,5000,false,1,
    'guard-pending-risk','guard-pending-conversion'
  from public.trial_accounts where user_id=(select principal_id from guard_ctx)
  returning id
) update guard_ctx set pending_conversion=pending.id from pending;
set local role service_role;
with converted as (select * from public.convert_trial_welcome_reward((select bank_owner from guard_ctx),
  'guard-start-bank-conversion',gen_random_uuid(),1,'guard-approved-risk'))
update guard_ctx set bank_conversion=converted.conversion_id from converted;
with converted as (select * from public.convert_trial_welcome_reward((select usdt_owner from guard_ctx),
  'guard-start-usdt-conversion',gen_random_uuid(),1,'guard-approved-risk'))
update guard_ctx set usdt_conversion=converted.conversion_id from converted;
select throws_ok($$select public.create_welcome_reward_withdrawal_request(principal_id,bank_conversion,bank_policy,principal_bank,'guard-cross-owner-start',gen_random_uuid()) from guard_ctx$$,
  '55000','WELCOME_REWARD_NOT_WITHDRAWABLE','non-NULL conversion still requires the original qualified owner');
select throws_ok($$select app_private.request_withdrawal_with_hold(principal_id,principal_bank,5000,'KRW_BANK','guard-private-other-owner',bank_conversion) from guard_ctx$$,
  '55000','WELCOME_REWARD_NOT_WITHDRAWABLE','private START cannot use another owner conversion to consume principal');
select throws_ok($$select app_private.request_withdrawal_with_hold(principal_id,principal_bank,5000,'KRW_BANK','guard-private-pending',pending_conversion) from guard_ctx$$,
  '55000','WELCOME_REWARD_NOT_WITHDRAWABLE','private START requires CONVERTED original plus qualified captured receipts');
select throws_ok($$select app_private.request_withdrawal_with_hold(bank_owner,bank_destination,1000,'KRW_BANK','guard-private-wrong-amount',bank_conversion) from guard_ctx$$,
  '55000','WELCOME_REWARD_NOT_WITHDRAWABLE','private START amount must match the original conversion rather than total KRW');
select throws_ok($$select app_private.request_withdrawal_with_hold(principal_id,principal_bank,5000,'KRW_BANK','guard-private-unknown',gen_random_uuid()) from guard_ctx$$,
  '55000','WELCOME_REWARD_NOT_WITHDRAWABLE','an unproved conversion identifier cannot bypass general source closure');
select throws_ok($$select app_private.request_withdrawal_with_hold(bank_owner,principal_bank,5000,'KRW_BANK','guard-private-other-destination',bank_conversion) from guard_ctx$$,
  '55000','VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED','a proved own START still cannot use another owner destination');
select is((select count(*)::integer from public.withdrawal_requests),0,
  'unqualified private START attempts have no hold request effect');
select throws_ok($$select public.request_krw_withdrawal(bank_owner,bank_destination,1000,'guard-bonus-general') from guard_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','real START BONUS cannot be spent through general mining withdrawal');
update guard_ctx set bank_withdrawal=public.create_welcome_reward_withdrawal_request(
  bank_owner,bank_conversion,bank_policy,bank_destination,'guard-start-bank-withdrawal',gen_random_uuid());
update guard_ctx set usdt_withdrawal=public.create_welcome_reward_withdrawal_request(
  usdt_owner,usdt_conversion,usdt_policy,usdt_destination,'guard-start-usdt-withdrawal',gen_random_uuid());
select is(public.create_welcome_reward_withdrawal_request((select bank_owner from guard_ctx),
  (select bank_conversion from guard_ctx),(select bank_policy from guard_ctx),(select bank_destination from guard_ctx),
  'guard-start-bank-withdrawal',gen_random_uuid()),(select bank_withdrawal from guard_ctx),
  'same-key START response loss returns the original hold');
select throws_ok($$select public.create_welcome_reward_withdrawal_request(bank_owner,bank_conversion,bank_policy,bank_destination,'guard-start-new-key',gen_random_uuid()) from guard_ctx$$,
  '23505','WELCOME_REWARD_WITHDRAWAL_EXISTS','a second key cannot duplicate one START conversion');
reset role;
select ok((select count(*)=2 and bool_and(amount_atomic=5000 and fee_atomic=0 and status='HELD')
  from public.withdrawal_requests where id in ((select bank_withdrawal from guard_ctx),(select usdt_withdrawal from guard_ctx))),
  'actual qualified START holds preserve both methods, 5000 cap and zero fee');
select is((select count(*)::integer from public.deposit_requests where user_id in
  ((select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),0,'START holds require no funding');
select ok((select count(*)=2 and bool_and(source_bucket='BONUS' and origin_code='WELCOME_REWARD' and amount_atomic=5000)
  from public.money_source_movements where user_id in ((select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),
  'actual conversion source receipts remain BONUS rather than principal or mining');
select is((select count(*)::integer from public.money_source_movements where movement_kind<>'CREDIT'),0,
  'safety closure does not pretend to implement reserve/release/finalize source movements');

set local role service_role;
update guard_ctx set send_id=public.record_krw_external_send(bank_withdrawal,'guard-actual-bank-receipt',5000,
  admin_id,statement_timestamp(),'guard-bank-send');
select throws_ok($$select public.release_withdrawal_hold(bank_withdrawal,admin_id,'reject after actual external send','guard-late-release','CANCELLED') from guard_ctx$$,
  '55000','WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND','external send keeps release forbidden');
update guard_ctx set finalize_id=public.finalize_withdrawal_ledger(bank_withdrawal,admin_id,'guard-bank-finalize');
select is(public.finalize_withdrawal_ledger((select bank_withdrawal from guard_ctx),(select admin_id from guard_ctx),
  'guard-bank-finalize'),(select finalize_id from guard_ctx),'finalize retry returns the original journal without another send');
update guard_ctx set release_id=public.release_withdrawal_hold(usdt_withdrawal,admin_id,
  'cancel before manual external send','guard-usdt-release','CANCELLED');
select is(public.release_withdrawal_hold((select usdt_withdrawal from guard_ctx),(select admin_id from guard_ctx),
  'cancel before manual external send','guard-usdt-release','CANCELLED'),(select release_id from guard_ctx),
  'unsent START release retry returns the original reversal');
reset role;
select is((select count(*)::integer from public.withdrawal_external_sends where withdrawal_id=(select bank_withdrawal from guard_ctx)),
  1,'START finalize never duplicates the external send');
select is((select count(*)::integer from public.wallet_ledger where user_id=(select bank_owner from guard_ctx) and direction='DEBIT'),
  1,'START finalize debits the wallet only once');
select is((select count(*)::integer from public.wallet_ledger where user_id=(select usdt_owner from guard_ctx)),
  1,'START release has no second wallet CREDIT');
select is((select coverage from public.money_source_summaries where user_id=(select bank_owner from guard_ctx)),
  'UNRESOLVED','START lifecycle stays visibly unconnected to future source lifecycle');
select is((select count(*)::integer from public.wallet_accounts where currency='USDT'),0,
  'manual USDT withdrawal never creates a user USDT wallet');
set constraints all immediate;
select * from finish();
rollback;
