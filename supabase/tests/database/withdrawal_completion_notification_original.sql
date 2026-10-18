-- Successor196 derived native regression: exact original129 fixture plus additive tests.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Actual rollback-only ordinary mining and qualified START command lifecycle.
-- The mining CREDIT is the existing owner-only sealed-credit test fixture;
-- all holds, sends, releases and finalizations invoke the canonical commands.
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
  from pg_proc where oid='app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests)'::regprocedure),
  'coverage adapter keeps invoker authority and a fixed path');
select ok(not has_function_privilege('anon',
  'app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests)','EXECUTE')
  and not has_function_privilege('authenticated',
  'app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests)','EXECUTE')
  and has_function_privilege('service_role',
  'app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests)','EXECUTE'),
  'source coverage remains private and service-readable');
-- Rollback-only fixture from the current two existing money SQL regression suites.
-- Mining credit is an owner-only existing verification fixture; actual withdrawal commands create all holds/terminals.
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
create function pg_temp.plant_verified_mining_reward(
  p_user_id uuid,
  p_movement_id uuid,
  p_amount bigint,
  p_effective_at timestamptz,
  p_recorded_at timestamptz,
  p_key text
) returns void
language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_credit uuid := gen_random_uuid();
  v_journal uuid := gen_random_uuid();
  v_wallet uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_wallet_account uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'VERIFIED_MINING_FIXTURE_OWNER_ONLY';
  end if;
  select account.id into v_wallet_account
  from public.wallet_accounts as account
  where account.user_id = p_user_id and account.currency = 'KRW' and account.closed_at is null;
  insert into public.ledger_transactions(
    id, category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, posted_at
  ) values (
    v_journal, 'MINING_REWARD', 'KRW', p_key || ':ledger', 'mining_reward_credit', v_credit,
    p_user_id, v_request, v_correlation, 'verified mining reward credit', p_effective_at
  );
  insert into public.ledger_entries(transaction_id, account_id, sequence, side, amount_atomic)
  values
    (v_journal, (select id from public.ledger_accounts where code = 'PUTDUK:MINING_REWARD_EXPENSE:KRW'),
      0, 'DEBIT', p_amount),
    (v_journal, (select id from public.ledger_accounts
      where code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'),
      1, 'CREDIT', p_amount);
  insert into public.wallet_ledger(
    id, wallet_account_id, user_id, direction, entry_type, amount_atomic,
    idempotency_key, reference_type, reference_id
  ) values (
    v_wallet, v_wallet_account, p_user_id, 'CREDIT', 'MINING_REWARD', p_amount,
    p_key || ':wallet', 'mining_reward_credit', v_credit
  );
  insert into public.outbox_events(
    id, event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    v_event, 'MINING_REWARD_CREDITED.v1', 1, 'mining_reward_credit', v_credit, p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', p_amount,
      'currency', 'KRW',
      'ledger_transaction_id', v_journal,
      'wallet_ledger_id', v_wallet
    ),
    v_correlation, v_request, p_key || ':event'
  );
  insert into public.mining_reward_credits(
    id, user_id, amount_atomic, ledger_transaction_id, wallet_ledger_id,
    source_event_id, effective_at
  ) values (
    v_credit, p_user_id, p_amount, v_journal, v_wallet, v_event, p_effective_at
  );
  insert into public.money_source_movements(
    id, user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at, recorded_at
  ) values (
    p_movement_id, p_user_id, 'MINING_REWARD', 'CREDIT', 'MINING_REWARD', p_amount,
    v_journal, v_wallet, v_event, p_effective_at, p_recorded_at
  );
end;
$$;

revoke all on function pg_temp.plant_verified_mining_reward(uuid,uuid,bigint,timestamptz,timestamptz,text)
  from public, anon, authenticated, service_role;

alter table guard_ctx add column mining_withdrawal uuid, add column mining_release uuid;
grant select,update on guard_ctx to service_role;
select pg_temp.plant_verified_mining_reward(principal_id,gen_random_uuid(),3000,
  statement_timestamp(),statement_timestamp(),'coverage-probe-verified-mining') from guard_ctx;
set local role service_role;
with converted as (select * from public.convert_trial_welcome_reward((select bank_owner from guard_ctx),
  'coverage-probe-start-bank-conversion',gen_random_uuid(),1,'coverage-probe-risk'))
update guard_ctx set bank_conversion=converted.conversion_id from converted;
with converted as (select * from public.convert_trial_welcome_reward((select usdt_owner from guard_ctx),
  'coverage-probe-start-usdt-conversion',gen_random_uuid(),1,'coverage-probe-risk'))
update guard_ctx set usdt_conversion=converted.conversion_id from converted;
reset role;

select ok((select count(*)=3 and bool_and(coverage='COMPLETE' and schema_version=2)
  from public.money_source_summaries where user_id in
  ((select principal_id from guard_ctx),(select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),
  'all verified sources have complete coverage before withdrawals');
create temporary table coverage_principal_before as select
  (select jsonb_agg(to_jsonb(lot) order by lot.id) from public.funding_principal_lots lot
    where lot.user_id=(select principal_id from guard_ctx)) lots,
  (select jsonb_agg(to_jsonb(revision) order by revision.id) from public.funding_principal_revisions revision
    where revision.user_id=(select principal_id from guard_ctx)) revisions;
set local role service_role;
update guard_ctx set mining_withdrawal=public.request_krw_withdrawal(principal_id,principal_bank,1000,'coverage-probe-mining-finalize');
update guard_ctx set mining_release=public.request_krw_withdrawal(principal_id,principal_bank,1000,'coverage-probe-mining-release');
update guard_ctx set bank_withdrawal=public.create_welcome_reward_withdrawal_request(
  bank_owner,bank_conversion,bank_policy,bank_destination,'coverage-probe-start-bank-withdrawal',gen_random_uuid());
update guard_ctx set usdt_withdrawal=public.create_welcome_reward_withdrawal_request(
  usdt_owner,usdt_conversion,usdt_policy,usdt_destination,'coverage-probe-start-usdt-withdrawal',gen_random_uuid());
reset role;

select ok((select count(*)=4 and bool_and(app_private.non_principal_withdrawal_coverage_verified(request))
  from public.withdrawal_requests request where id in
  ((select mining_withdrawal from guard_ctx),(select mining_release from guard_ctx),
   (select bank_withdrawal from guard_ctx),(select usdt_withdrawal from guard_ctx))),
  'actual mining reservations and qualified START originals prove all four holds');
select ok((select count(*)=3 and bool_and(coverage='COMPLETE'
    and unclassified_wallet_entries='0' and unconnected_withdrawals='0'
    and unclassified_journals='0' and invalid_source_receipts='0'
    and held_principal_atomic='0' and recovered_principal_atomic='0')
  from public.money_source_summaries where user_id in
  ((select principal_id from guard_ctx),(select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),
  'nonprincipal holds keep complete source coverage without reserving principal');
select is((select eligible_principal_atomic from public.money_source_summaries
  where user_id=(select principal_id from guard_ctx)),'100000',
  'ordinary mining hold preserves all available principal');
select is(app_private.verified_principal_remaining_atomic((select principal_id from guard_ctx)),100000::bigint,
  'principal recovery reader is not frozen by a mining-only hold');
select is(app_private.read_funding_principal_foundation((select principal_id from guard_ctx))->>'eligible_principal_micro_krw',
  '100000000000','funding entitlement remains based on unchanged 100000 KRW principal');
select is(app_private.verified_mining_reward_remaining_atomic((select principal_id from guard_ctx)),1000::bigint,
  'only mining rewards are reserved by ordinary holds');
select is((select count(*)::integer from public.wallet_ledger where direction='DEBIT' and user_id in
  ((select principal_id from guard_ctx),(select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),0,
  'HOLD never posts a wallet debit');
select is((select count(*)::integer from public.money_source_movements where movement_kind<>'CREDIT' and user_id in
  ((select principal_id from guard_ctx),(select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),0,
  'coverage does not invent a RESERVE source movement for mining or START');
select ok((select count(*)=2 and bool_and(eligible_principal_atomic='0' and recorded_bonus_atomic='5000')
  from public.money_source_summaries where user_id in
  ((select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),
  'qualified START stays BONUS and works without a principal deposit');
create temporary table coverage_read_before as select
  (select count(*) from public.ledger_transactions) journals,
  (select count(*) from public.ledger_entries) entries,
  (select count(*) from public.wallet_ledger) wallets,
  (select count(*) from public.money_source_movements) sources,
  (select count(*) from public.outbox_events) events;
select count(*) from public.money_source_summaries;
select app_private.non_principal_withdrawal_coverage_verified(request)
from public.withdrawal_requests request where user_id=(select principal_id from guard_ctx);
select ok((select journals=(select count(*) from public.ledger_transactions)
  and entries=(select count(*) from public.ledger_entries)
  and wallets=(select count(*) from public.wallet_ledger)
  and sources=(select count(*) from public.money_source_movements)
  and events=(select count(*) from public.outbox_events) from coverage_read_before),
  'coverage reads create no ledger, wallet, source or outbox side effects');

-- Composite variants test receipt binding without editing any original.
select ok((select not app_private.non_principal_withdrawal_coverage_verified(
  jsonb_populate_record(request,jsonb_build_object('amount_atomic',999)))
  from public.withdrawal_requests request where id=(select mining_withdrawal from guard_ctx)),
  'same owner and wallet cannot classify a different hold amount');
select ok((select not app_private.non_principal_withdrawal_coverage_verified(
  jsonb_populate_record(request,jsonb_build_object('hold_ledger_transaction_id',(select hold_ledger_transaction_id from public.withdrawal_requests where id=(select mining_release from guard_ctx)))))
  from public.withdrawal_requests request where id=(select mining_withdrawal from guard_ctx)),
  'an unrelated hold reference never substitutes for this request original');
select ok((select not app_private.non_principal_withdrawal_coverage_verified(
  jsonb_populate_record(request,jsonb_build_object('welcome_reward_conversion_id',null)))
  from public.withdrawal_requests request where id=(select bank_withdrawal from guard_ctx)),
  'qualified START cannot be relabeled as a mining reservation');
select ok((select not app_private.non_principal_withdrawal_coverage_verified(
  jsonb_populate_record(request,jsonb_build_object('welcome_reward_conversion_id',(select bank_conversion from guard_ctx))))
  from public.withdrawal_requests request where id=(select usdt_withdrawal from guard_ctx)),
  'a different owner qualified conversion never proves this START hold');
select ok((select not app_private.withdrawal_coverage_entries_verified(
  hold_ledger_transaction_id,user_id,amount_atomic,'FINALIZE')
  from public.withdrawal_requests where id=(select mining_withdrawal from guard_ctx)),
  'balanced HOLD entries are not misclassified as a payout journal');
set local role service_role;
select public.record_krw_external_send(mining_withdrawal,'coverage-probe-mining-bank-receipt',1000,
  admin_id,statement_timestamp(),'coverage-probe-mining-send') from guard_ctx;
select is((select coverage from public.money_source_summaries where user_id=(select principal_id from guard_ctx)),
  'COMPLETE','actual external-send state retains its proven mining source before finalize');
select public.finalize_withdrawal_ledger(mining_withdrawal,admin_id,'coverage-probe-mining-finalized') from guard_ctx;
select public.release_withdrawal_hold(mining_release,admin_id,'cancel probe before send','coverage-probe-mining-released','CANCELLED') from guard_ctx;
select public.record_krw_external_send(bank_withdrawal,'coverage-probe-start-bank-receipt',5000,
  admin_id,statement_timestamp(),'coverage-probe-start-bank-send') from guard_ctx;
select public.finalize_withdrawal_ledger(bank_withdrawal,admin_id,'coverage-probe-start-bank-finalized') from guard_ctx;
select public.release_withdrawal_hold(usdt_withdrawal,admin_id,'cancel probe before send','coverage-probe-start-usdt-released','REJECTED') from guard_ctx;
reset role;

select ok((select count(*)=4 and bool_and(app_private.non_principal_withdrawal_coverage_verified(request))
  from public.withdrawal_requests request where id in
  ((select mining_withdrawal from guard_ctx),(select mining_release from guard_ctx),
   (select bank_withdrawal from guard_ctx),(select usdt_withdrawal from guard_ctx))),
  'actual mining/START finalize and cancel/reject receipts retain truthful coverage');
select ok((select count(*)=3 and bool_and(coverage='COMPLETE'
    and unclassified_wallet_entries='0' and unconnected_withdrawals='0'
    and unclassified_journals='0' and invalid_source_receipts='0'
    and held_principal_atomic='0' and recovered_principal_atomic='0')
  from public.money_source_summaries where user_id in
  ((select principal_id from guard_ctx),(select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),
  'all terminal nonprincipal receipts are covered without principal recovery');
select is((select eligible_principal_atomic from public.money_source_summaries
  where user_id=(select principal_id from guard_ctx)),'100000',
  'mining finalize/release preserves available principal');
select is(app_private.read_funding_principal_foundation((select principal_id from guard_ctx))->>'eligible_principal_micro_krw',
  '100000000000','terminal mining withdrawals preserve funded entitlement eligibility');
select ok((select lots is not distinct from (select jsonb_agg(to_jsonb(lot) order by lot.id)
    from public.funding_principal_lots lot where lot.user_id=(select principal_id from guard_ctx))
  and revisions is not distinct from (select jsonb_agg(to_jsonb(revision) order by revision.id)
    from public.funding_principal_revisions revision where revision.user_id=(select principal_id from guard_ctx))
  from coverage_principal_before),
  'nonprincipal lifecycle never changes principal lots or immutable revision history');
select is(app_private.verified_mining_reward_remaining_atomic((select principal_id from guard_ctx)),2000::bigint,
  'cancel restores the original mining reservation while finalize consumes its own reward once');
select is((select count(*)::integer from public.wallet_ledger where user_id=(select principal_id from guard_ctx) and direction='DEBIT'),1,
  'mining finalize posts exactly one debit and mining release posts none');
select is((select count(*)::integer from public.wallet_ledger where user_id=(select bank_owner from guard_ctx) and direction='DEBIT'),1,
  'START finalize is covered by its actual single debit');
select is((select count(*)::integer from public.wallet_ledger where user_id=(select usdt_owner from guard_ctx)),1,
  'START rejection has only its original bonus credit and no synthetic refund');
select is((select count(*)::integer from public.money_source_movements where user_id in
  ((select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),2,
  'START source coverage uses the qualified originals without invented terminal movement rows');
select ok((select count(*)=2 and bool_and(recorded_bonus_atomic='5000' and eligible_principal_atomic='0')
  from public.money_source_summaries where user_id in
  ((select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),
  'START finalize/reject preserves cumulative bonus evidence and zero principal');
set local role service_role;
select is(public.finalize_withdrawal_ledger((select mining_withdrawal from guard_ctx),(select admin_id from guard_ctx),
  'coverage-probe-mining-finalized'),(select finalize_ledger_transaction_id from public.withdrawal_requests
    where id=(select mining_withdrawal from guard_ctx)), 'mining finalize retry returns its immutable original');
select is(public.finalize_withdrawal_ledger((select bank_withdrawal from guard_ctx),(select admin_id from guard_ctx),
  'coverage-probe-start-bank-finalized'),(select finalize_ledger_transaction_id from public.withdrawal_requests
    where id=(select bank_withdrawal from guard_ctx)), 'START finalize retry returns its immutable original');
select is(public.release_withdrawal_hold((select usdt_withdrawal from guard_ctx),(select admin_id from guard_ctx),
  'cancel probe before send','coverage-probe-start-usdt-released','REJECTED'),
  (select release_ledger_transaction_id from public.withdrawal_requests where id=(select usdt_withdrawal from guard_ctx)),
  'START release retry returns its immutable original');
reset role;
select is((select count(*)::integer from public.wallet_ledger where direction='DEBIT' and user_id in
  ((select principal_id from guard_ctx),(select bank_owner from guard_ctx),(select usdt_owner from guard_ctx))),2,
  'all terminal retries preserve exactly two genuine finalized wallet debits');


-- Successor196 additional cases: original129 assertions remain below unchanged.
-- Synthetic preconditions are rollback-only, not elapsed-time/production proofs.
alter table guard_ctx add column reward_usdt_withdrawal uuid, add column start_usdt_owner uuid,
 add column start_usdt_destination uuid, add column start_usdt_conversion uuid, add column start_usdt_withdrawal uuid;
update guard_ctx set start_usdt_owner='d1960000-0000-4000-8000-000000000001';
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select start_usdt_owner,'authenticated','authenticated','successor196-start@putduk.test','',statement_timestamp(),
 '{}','{}',statement_timestamp(),statement_timestamp(),'','','','' from guard_ctx;
select public.bootstrap_user(start_usdt_owner) from guard_ctx;
insert into public.kyc_cases(user_id,status,risk_level,decided_at,reviewed_by)
 select start_usdt_owner,'APPROVED','LOW',statement_timestamp(),admin_id from guard_ctx;
insert into public.trial_accounts(user_id,trial_program_id,trial_program_version,world_id,status,
 started_at,expires_at,last_settled_at,quota_consumed_bps,reward_atomic,target_reward_krw)
select c.start_usdt_owner,a.trial_program_id,a.trial_program_version,a.world_id,a.status,
 a.started_at,a.expires_at,a.last_settled_at,a.quota_consumed_bps,a.reward_atomic,a.target_reward_krw
from guard_ctx c join public.trial_accounts a on a.user_id=c.bank_owner;
insert into public.trial_completions(trial_account_id,user_id,reason,final_quota_bps,final_reward_atomic,completed_at)
select id,user_id,'QUOTA',10000,9000,statement_timestamp() from public.trial_accounts
 where user_id=(select start_usdt_owner from guard_ctx);
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,display_hint,
 verification_status,verified_at,protection_until)
select start_usdt_owner,'USDT_ADDRESS',decode(repeat('ef',32),'hex'),
 encode(extensions.digest(start_usdt_owner::text||'USDT_ADDRESS','sha256'),'hex'),'후속 격리 시험',
 'VERIFIED',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day' from guard_ctx;
update guard_ctx set start_usdt_destination=(select id from public.withdrawal_destinations where user_id=start_usdt_owner);
insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,
 metadata,actor_user_id,request_id)
select d.id,d.user_id,d.destination_type,'REGISTERED',d.display_hint,d.value_fingerprint,
 '{"network":"TRC20"}',c.admin_id,gen_random_uuid()
from public.withdrawal_destinations d cross join guard_ctx c
where d.id in(c.usdt_destination,c.start_usdt_destination);
select pg_temp.plant_verified_mining_reward(usdt_owner,gen_random_uuid(),3000,
 statement_timestamp(),statement_timestamp(),'successor196-synthetic-mining-credit') from guard_ctx;
grant select,update on guard_ctx to service_role;
set local role service_role;
with converted as (select * from public.convert_trial_welcome_reward((select start_usdt_owner from guard_ctx),
 'successor196-start-usdt-conversion',gen_random_uuid(),1,'coverage-probe-risk'))
update guard_ctx set start_usdt_conversion=converted.conversion_id from converted;
update guard_ctx set reward_usdt_withdrawal=public.request_usdt_withdrawal(usdt_owner,usdt_destination,1000,
 'successor196-reward-usdt-request');
update guard_ctx set start_usdt_withdrawal=public.create_welcome_reward_withdrawal_request(start_usdt_owner,
 start_usdt_conversion,usdt_policy,start_usdt_destination,'successor196-start-usdt-request',gen_random_uuid());
select public.record_usdt_external_send(r.id,'TRC20','successor196-synthetic-tx-'||r.id::text,1.25::numeric,
 jsonb_build_object('version',1,'basis','OPERATOR_MANUAL_FULL_PAYOUT','withdrawalId',r.id::text,
 'requestedKrwAmount',r.amount_atomic::text,'actualUsdtAmount','1.25','network','TRC20','feeKrw','0','fullPayoutConfirmed',true),
 c.admin_id,statement_timestamp(),'successor196-send-'||r.id::text)
from guard_ctx c join public.withdrawal_requests r on r.id in(c.reward_usdt_withdrawal,c.start_usdt_withdrawal);
select public.finalize_withdrawal_ledger(r.id,c.admin_id,'successor196-finalize-'||r.id::text)
from guard_ctx c join public.withdrawal_requests r on r.id in(c.reward_usdt_withdrawal,c.start_usdt_withdrawal);
reset role;
select is((select count(*)::integer from public.withdrawal_requests r cross join guard_ctx c
 where r.id in(c.mining_withdrawal,c.bank_withdrawal,c.reward_usdt_withdrawal,c.start_usdt_withdrawal)
 and app_private.non_principal_withdrawal_coverage_verified(r)),4,
 'four actual KRW/USDT reward/START commands retain exact existing source coverage');
select is((select count(*)::integer from app_private.funding_withdrawal_clock_admissions a cross join guard_ctx c
 where a.phase='FINALIZE' and a.withdrawal_id in(c.mining_withdrawal,c.bank_withdrawal,c.reward_usdt_withdrawal,c.start_usdt_withdrawal)),0,
 'ordinary completion creates no typed-principal clock or backfill');
create temporary table notification196_events as select e.id,e.aggregate_id,r.user_id
 from public.outbox_events e join public.withdrawal_requests r on r.id=e.aggregate_id cross join guard_ctx c
 where e.event_type='WITHDRAWAL_COMPLETED.v1'
 and r.id in(c.mining_withdrawal,c.bank_withdrawal,c.reward_usdt_withdrawal,c.start_usdt_withdrawal);
select is((select count(*)::integer from notification196_events),4,'exactly four canonical completion envelopes exist');
grant select on notification196_events to service_role;
create function pg_temp.read_notification196(p_event uuid,p_mission boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_mission then return app_private.read_nonmoney_mission_original(p_event);end if;
 return app_private.read_domain_notification_original(p_event);
end;$$;
revoke all on function pg_temp.read_notification196(uuid,boolean) from public,anon,authenticated;
grant execute on function pg_temp.read_notification196(uuid,boolean) to service_role;
do $$ begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end;$$;
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[] from pg_proc
 where oid='app_private.read_nonprincipal_withdrawal_notification_original(uuid)'::regprocedure),
 'ordinary original reader stays invoker and fixed-path');
select ok(not has_function_privilege('anon','app_private.read_nonprincipal_withdrawal_notification_original(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.read_nonprincipal_withdrawal_notification_original(uuid)','EXECUTE')
 and not has_function_privilege('service_role','app_private.read_nonprincipal_withdrawal_notification_original(uuid)','EXECUTE'),
 'raw ordinary reader has no client or service direct grant');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok((select bool_and((pg_temp.read_notification196(e.id)->>'member_id')::uuid=e.user_id)
 from notification196_events e),'every ordinary notification derives its actual owner from persisted originals');
select throws_ok(format('select pg_temp.read_notification196(%L::uuid,true)',e.id),
 '55000','NONMONEY_WITHDRAWAL_CLOCK_ORIGINAL_REQUIRED',
 'ordinary notification never grants typed-principal mission eligibility') from notification196_events e;
reset role;
-- Preference suppression uses the original notification contract; no device send.
update public.notification_preferences set wallet_enabled=false where user_id=(select bank_owner from guard_ctx);
update public.notification_preferences set wallet_enabled=true where user_id in
 ((select principal_id from guard_ctx),(select usdt_owner from guard_ctx),(select start_usdt_owner from guard_ctx));
-- Test-only enabled executor proves ordinary completions skip mission evaluation.
insert into app_private.nonmoney_executor_configuration(singleton,project_identity,local_qa_enabled)
 values(true,'putduk-mining-local-recovery-20261009-fi',true);
create temporary table notification196_money_before as select jsonb_build_object(
 'journals',(select jsonb_agg(to_jsonb(x) order by x.id) from public.ledger_transactions x),
 'entries',(select jsonb_agg(to_jsonb(x) order by x.id) from public.ledger_entries x),
 'wallet',(select jsonb_agg(to_jsonb(x) order by x.id) from public.wallet_ledger x),
 'sources',(select jsonb_agg(to_jsonb(x) order by x.id) from public.money_source_movements x),
 'sends',(select jsonb_agg(to_jsonb(x) order by x.id) from public.withdrawal_external_sends x),
 'requests',(select jsonb_agg(to_jsonb(x) order by x.id) from public.withdrawal_requests x)) snapshot;
update public.outbox_events set status='PROCESSING',lease_owner='successor196-worker',
 lease_expires_at=clock_timestamp()+interval '10 minutes' where id in(select id from notification196_events);
set local role service_role;
select lives_ok(format('select public.complete_outbox_event(%L::uuid,%L)',e.id,'successor196-worker'),
 'ordinary completion commits sealed notification and ACK with QA evaluator enabled') from notification196_events e;
reset role;
select is((select count(*)::integer from app_private.domain_notification_originals o join notification196_events e on e.id=o.source_event_id),4,
 'all four completions have exactly one sealed notification outcome');
select is((select count(*)::integer from app_private.domain_notification_originals o join notification196_events e on e.id=o.source_event_id
 where o.outcome='SUPPRESSED_PREFERENCE'),1,'disabled wallet preference yields one sealed suppression');
select is((select count(*)::integer from app_private.domain_notification_originals o join notification196_events e on e.id=o.source_event_id
 where o.outcome='PERSISTED'),3,'three enabled active owners receive one in-app completion notification each');
select is((select count(*)::integer from public.event_consumer_deliveries d join notification196_events e on e.id=d.event_id
 where d.consumer_name='nonmoney_mission_original.v1' and d.status='SUCCEEDED'),4,
 'ordinary completion preserves the original exact consumer receipt namespace');
select is((select count(*)::integer from public.member_event_awards where source_event_id in(select id from notification196_events)),0,
 'completion notification creates no new automatic mission awards');
update public.outbox_events set status='PROCESSING',lease_owner='successor196-worker',
 lease_expires_at=clock_timestamp()+interval '10 minutes' where id in(select id from notification196_events);
set local role service_role;
select lives_ok(format('select public.complete_outbox_event(%L::uuid,%L)',e.id,'successor196-worker'),
 'reclaimed duplicate verifies and retains the same notification and ACK') from notification196_events e;
-- Deferred closed notification assertions run under the actual service context.
set constraints all immediate;
reset role;
select is((select count(*)::integer from public.notifications n join notification196_events e on e.id=n.source_event_id),3,
 'duplicate delivery never adds a second member notification');
select is((select count(*)::integer from public.event_consumer_deliveries d join notification196_events e on e.id=d.event_id),4,
 'duplicate delivery never adds a second completion ACK');
select ok((select snapshot is not distinct from jsonb_build_object(
 'journals',(select jsonb_agg(to_jsonb(x) order by x.id) from public.ledger_transactions x),
 'entries',(select jsonb_agg(to_jsonb(x) order by x.id) from public.ledger_entries x),
 'wallet',(select jsonb_agg(to_jsonb(x) order by x.id) from public.wallet_ledger x),
 'sources',(select jsonb_agg(to_jsonb(x) order by x.id) from public.money_source_movements x),
 'sends',(select jsonb_agg(to_jsonb(x) order by x.id) from public.withdrawal_external_sends x),
 'requests',(select jsonb_agg(to_jsonb(x) order by x.id) from public.withdrawal_requests x))
 from notification196_money_before),'notification and duplicate ACK preserve all six financial table snapshots');
create function pg_temp.notification196_bad_envelope(p_case text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare selected uuid; request_original public.withdrawal_requests%rowtype; audit_original public.audit_logs%rowtype;
begin
 select e.id into selected from pg_temp.notification196_events e
 where e.aggregate_id=(select mining_withdrawal from pg_temp.guard_ctx);
 if p_case='extra' then update public.outbox_events set payload=payload||'{"unreviewed":true}' where id=selected;
 elsif p_case='clock' then update public.outbox_events set occurred_at=occurred_at+interval '1 microsecond' where id=selected;
 elsif p_case='owner' then update public.outbox_events set actor_user_id=(select usdt_owner from pg_temp.guard_ctx) where id=selected;
 elsif p_case='amount' then update public.outbox_events set payload=jsonb_set(payload,'{amount_atomic}','"1001"') where id=selected;
 elsif p_case='receipt_null' then
  update public.transaction_receipts set completed_at=null
  where source_type='withdrawal_request' and source_id=(select aggregate_id from public.outbox_events where id=selected);
 elsif p_case='receipt_missing' then
  delete from public.transaction_receipts where source_type='withdrawal_request'
   and source_id=(select aggregate_id from public.outbox_events where id=selected);
 elsif p_case='audit_duplicate' then
  select * into request_original from public.withdrawal_requests where id=(select aggregate_id from public.outbox_events where id=selected);
  select * into audit_original from public.audit_logs where action='finalize_withdrawal_ledger'
   and target_type='withdrawal_request' and target_id=request_original.id::text
   and metadata->>'result_id'=request_original.finalize_ledger_transaction_id::text;
  insert into public.audit_logs select (jsonb_populate_record(null::public.audit_logs,
   to_jsonb(audit_original)||jsonb_build_object('id',gen_random_uuid(),'metadata',audit_original.metadata-'currency'))).*;
  -- The extra partial audit deliberately leaves the existing exact valid audit intact.
  if app_private.non_principal_withdrawal_coverage_verified(request_original) is not true then
   raise exception 'TEST_AMBIGUOUS_AUDIT_PRECONDITION_INVALID';
  end if;
 else raise exception 'TEST_CASE_INVALID';end if;
 perform app_private.read_domain_notification_original(selected);
end;$$;
revoke all on function pg_temp.notification196_bad_envelope(text) from public,anon,authenticated;
grant execute on function pg_temp.notification196_bad_envelope(text) to service_role;
set local role service_role;
select throws_ok(format('select pg_temp.notification196_bad_envelope(%L)',x),
 '55000',null,'malformed original completion '||x||' is rejected without permanent repair')
 from unnest(array['extra','clock','owner','amount']) x;
select throws_ok($$select pg_temp.notification196_bad_envelope('receipt_null')$$,
 '55000','NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_RECEIPT_REQUIRED','NULL terminal receipt clock never becomes a proved completion');
select throws_ok($$select pg_temp.notification196_bad_envelope('receipt_missing')$$,
 '55000','NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_SOURCE_REQUIRED','missing original receipt cannot borrow a sealed notification');
select throws_ok($$select pg_temp.notification196_bad_envelope('audit_duplicate')$$,
 '55000','NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_AUDIT_REQUIRED','extra partial audit is rejected even while existing exact source coverage remains true');
select throws_ok(format('select public.complete_outbox_event(%L::uuid,%L)',(select id from notification196_events limit 1),'wrong-worker'),
 '55000','OUTBOX_LEASE_NOT_OWNED','a closed ordinary completion cannot bypass the owned lease');
reset role;
select set_config('request.jwt.claims','{}',true);
-- Restore the original deferred construction mode before original129 builds its
-- next balanced journal across two statements. Its final IMMEDIATE check is unchanged.
set constraints all deferred;

-- Unclassified historical labels and withdrawals remain unresolved; no guessing.
insert into public.wallet_ledger(wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
select id,user_id,'CREDIT','MINING_REWARD',2000,'coverage-probe-unclassified-label','test',user_id
from public.wallet_accounts where user_id=(select label_owner from guard_ctx) and currency='KRW';
insert into public.withdrawal_requests(wallet_account_id,user_id,currency,amount_atomic,fee_atomic,
  withdrawal_policy_id,withdrawal_destination_id,destination_type,destination_snapshot,status,idempotency_key)
select id,user_id,'KRW',1000,0,(select bank_policy from guard_ctx),(select label_destination from guard_ctx),
  'KRW_BANK','{}','REQUESTED','coverage-probe-unclassified-request'
from public.wallet_accounts where user_id=(select label_owner from guard_ctx) and currency='KRW';
select ok((select coverage='UNRESOLVED' and unclassified_wallet_entries='1' and unconnected_withdrawals='1'
  and eligible_principal_atomic is null and held_principal_atomic is null and recovered_principal_atomic is null
  from public.money_source_summaries where user_id=(select label_owner from guard_ctx)),
  'a wallet label and unproved withdrawal never gain coverage from the new adapter');

insert into public.ledger_transactions(category,currency,idempotency_key,reference_type,reference_id,
  member_user_id,request_id,correlation_id,description)
select 'DEPOSIT','KRW','coverage-probe-unclassified-journal','unclassified_history',principal_id,
  principal_id,gen_random_uuid(),gen_random_uuid(),'unclassified historical journal' from guard_ctx;
insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic)
select journal.id,account.id,entry.sequence,entry.side::public.ledger_side,1
from public.ledger_transactions journal cross join guard_ctx
cross join (values (0,'DEBIT','PUTDUK:OPERATING_CASH:KRW'),
  (1,'CREDIT','USER:'||upper((select principal_id from guard_ctx)::text)||':KRW:LIABILITY')) entry(sequence,side,code)
join public.ledger_accounts account on account.code=entry.code
where journal.idempotency_key='coverage-probe-unclassified-journal';
select ok((select coverage='UNRESOLVED' and unclassified_journals='1'
  and unconnected_withdrawals='0' and eligible_principal_atomic is null
  and held_principal_atomic is null and recovered_principal_atomic is null
  from public.money_source_summaries where user_id=(select principal_id from guard_ctx)),
  'an unrelated balanced journal remains unresolved even with fully proved withdrawals');
set constraints all immediate;
select * from finish();
rollback;
