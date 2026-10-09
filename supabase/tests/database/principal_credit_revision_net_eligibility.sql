begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

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

create temporary table principal_credit_ctx (
  member_id uuid,admin_id uuid,bank_id uuid,hold_id uuid,new_deposit_id uuid,
  original_revisions jsonb
);
insert into principal_credit_ctx(member_id,admin_id) values(
  '10621400-0000-4000-8000-000000000001','10621400-0000-4000-8000-000000000002');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@principal-net.putduk.test','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from principal_credit_ctx cross join lateral unnest(array[member_id,admin_id]) person;
insert into public.user_roles(user_id,role,granted_by)
select admin_id,'ADMIN',admin_id from principal_credit_ctx;
select public.bootstrap_user(member_id) from principal_credit_ctx;
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,
  minimum_amount_atomic,fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10621401,true,1,0,'{}',statement_timestamp()-interval '1 hour',admin_id,false
from principal_credit_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
  display_hint,verification_status,verified_at,protection_until)
select member_id,'KRW_BANK',decode(repeat('ab',32),'hex'),
  encode(extensions.digest(member_id::text,'sha256'),'hex'),'원금 net 시험 계좌','VERIFIED',
  statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day' from principal_credit_ctx;
update principal_credit_ctx set bank_id=destination.id from public.withdrawal_destinations destination
where destination.user_id=principal_credit_ctx.member_id;
grant select,update on principal_credit_ctx to service_role;
set local role service_role;
select public.approve_deposit_request(
  public.create_deposit_request(member_id,'KRW',10000,'principal-net-old-request'),
  admin_id,10000,'principal-net-old-credit','actual initial local deposit',gen_random_uuid()
) from principal_credit_ctx;
reset role;
-- Existing original held-request fixture only. Ordinary withdrawal is mining-only;
-- this test invokes the actual service reservation writer for the original hold.
update principal_credit_ctx set hold_id=pg_temp.seed_reserved_test_hold(
  member_id,bank_id,6000,'principal-net-original-hold');
set local role service_role;
select app_private.apply_principal_recovery_newest_first(member_id,
  (select hold_ledger_transaction_id from public.withdrawal_requests where id=hold_id))
from principal_credit_ctx;
reset role;
select is(app_private.funding_principal_mining_eligible_micro(
  (select member_id from principal_credit_ctx),statement_timestamp()),4000000000::bigint,
  'the actual original reservation excludes6000 before a genuine later deposit');
update principal_credit_ctx set original_revisions=(select jsonb_agg(to_jsonb(revision) order by revision.id)
  from public.funding_principal_revisions revision where revision.user_id=member_id);

set local role service_role;
update principal_credit_ctx set new_deposit_id=public.create_deposit_request(
  member_id,'KRW',5000,'principal-net-new-request');
select public.approve_deposit_request(new_deposit_id,admin_id,5000,'principal-net-new-credit',
  'actual genuine deposit after original principal hold',gen_random_uuid()) from principal_credit_ctx;
select lives_ok($$set constraints all immediate$$,
  'genuine deposit completes its balanced source and principal revision originals');
reset role;
select is((select revision.eligible_principal_micro_krw_after
  from public.funding_principal_revisions revision join public.deposit_requests deposit
    on deposit.ledger_transaction_id=revision.ledger_transaction_id
  where deposit.id=(select new_deposit_id from principal_credit_ctx)),9000000000::bigint,
  'fresh INCREASE snapshot is net9000 rather than gross15000');
select is((select revision.delta_micro_krw from public.funding_principal_revisions revision
  join public.deposit_requests deposit on deposit.ledger_transaction_id=revision.ledger_transaction_id
  where deposit.id=(select new_deposit_id from principal_credit_ctx)),5000000000::bigint,
  'fresh INCREASE preserves its actual5000 original delta');
select ok((select summary.coverage='COMPLETE' and summary.eligible_principal_atomic='9000'
  and summary.held_principal_atomic='6000' and summary.recovered_principal_atomic='0'
  and summary.recorded_krw_principal_deposits_atomic='15000'
  from public.money_source_summaries summary where summary.user_id=(select member_id from principal_credit_ctx)),
  'source summary keeps current available, original held and cumulative principal distinct');
select is(app_private.read_funding_principal_foundation(
  (select member_id from principal_credit_ctx))->>'eligible_principal_micro_krw','9000000000',
  'funding reader agrees with the corrected fresh revision');
select is((select jsonb_agg(to_jsonb(revision) order by revision.id)
  from public.funding_principal_revisions revision where revision.user_id=(select member_id from principal_credit_ctx)
    and revision.ledger_transaction_id not in (select ledger_transaction_id from public.deposit_requests
      where id=(select new_deposit_id from principal_credit_ctx))),
  (select original_revisions from principal_credit_ctx),'all original immutable revisions remain byte-equivalent');
select is((select count(*)::integer from public.funding_principal_revisions
  where user_id=(select member_id from principal_credit_ctx)),3,
  'one old credit, one original hold decrease and one new credit have three originals');
select is((select count(*)::integer from public.ledger_entries entry join public.deposit_requests deposit
  on deposit.ledger_transaction_id=entry.transaction_id where deposit.id=(select new_deposit_id from principal_credit_ctx)),2,
  'net snapshot correction adds no extra money posting');
select * from finish();
rollback;
