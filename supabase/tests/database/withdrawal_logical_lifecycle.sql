begin;

-- BEGIN TEST-ONLY HISTORICAL HOLD FIXTURE
-- Test-only original receipt fixture. Never installed by a migration.
-- pg_temp plus postgres-only execution isolates it from service/public callers.
-- Call inside the owning test transaction; rollback/session end removes it.
-- It represents a source-less historical hold, NOT VERIFIED MINING_REWARD.
create function pg_temp.seed_historical_held_withdrawal(
  p_owner uuid, p_destination uuid, p_amount bigint, p_key text
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $historical_fixture$
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
$historical_fixture$;
revoke all on function pg_temp.seed_historical_held_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
-- END TEST-ONLY HISTORICAL HOLD FIXTURE

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
select throws_ok($$select public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000) from logical_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','principal-only logical request cannot create a new general hold');
select is((select state from public.withdrawal_logical_requests where idempotency_key=(select logical->>'key' from logical_ctx)),'DESTINATION_REGISTERED','rejected source gate leaves intent at its original state');
select is((select count(*)::integer from public.withdrawal_requests where user_id=(select owner_id from logical_ctx)),0,'rejected new logical hold creates no request');
-- Simulate an already committed historical original; no source is fabricated.
update logical_ctx set withdrawal_id=pg_temp.seed_historical_held_withdrawal(owner_id,destination_id,1000,logical->>'key');
update logical_ctx set withdrawal_id=public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000);
-- Hold retry returns its committed ID; RECOVER durably binds the historical outcome.
update logical_ctx set logical=public.resolve_withdrawal_logical_request(owner_id,'RECOVER',logical->>'key');
select is((select state from public.withdrawal_logical_requests where idempotency_key=(select logical->>'key' from logical_ctx)),'OUTCOME_UNCERTAIN','historical hold recovery records durable outcome uncertainty');
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
select throws_ok($$select public.hold_withdrawal_logical_request(owner_id,later_key,'KRW_BANK',destination_id,1000) from logical_ctx$$,
  '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE','a new later intent remains closed without verified source lifecycle');
-- A second distinct original historical receipt proves recovery is not permanently deduplicated.
select pg_temp.seed_historical_held_withdrawal(owner_id,destination_id,1000,later_key) from logical_ctx;
select lives_ok($$select public.hold_withdrawal_logical_request(owner_id,later_key,'KRW_BANK',destination_id,1000) from logical_ctx$$,'a distinct already committed historical hold remains recoverable');
select is((select count(*)::integer from public.withdrawal_requests where user_id=(select owner_id from logical_ctx)),2,'two distinct historical original intents are not permanently deduplicated');
select is((select public.hold_withdrawal_logical_request(owner_id,logical->>'key','KRW_BANK',destination_id,1000) from logical_ctx),(select withdrawal_id from logical_ctx),'late old tab replays old result even after newer intent');

update logical_ctx set logical = public.prepare_withdrawal_logical_request(other_id,'KRW_BANK',1000,policy_id,189001,repeat('b',64),null);
update public.withdrawal_logical_requests set created_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where idempotency_key=(select logical->>'key' from logical_ctx);
select throws_ok($$select public.bind_withdrawal_logical_destination(other_id,logical->>'key','KRW_BANK',repeat('b',64),decode(repeat('ab',32),'hex'),'KB ****7890','step-up-fixture',gen_random_uuid()) from logical_ctx$$,'55000','WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED','expired uncommitted intent fails closed before registration');
select is((select public.resolve_withdrawal_logical_request(other_id,'CANCEL',logical->>'key')->>'state' from logical_ctx),'CANCELLED','explicit TTL cancellation proves no money first');
select lives_ok($$select public.prepare_withdrawal_logical_request(other_id,'KRW_BANK',1000,policy_id,189001,repeat('b',64),null) from logical_ctx$$,'fresh request allowed only after safe cancellation');

select * from finish();
rollback;
