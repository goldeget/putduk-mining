begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
do $$ begin
  if not exists (select 1 from pg_extension where extname='dblink') then
    create extension dblink with schema extensions;
  end if;
end; $$;
create temporary table withdrawal_duplicate_result (session_name text primary key, request_id uuid);
create temporary table withdrawal_lock_result (
  action text primary key, waiting_on_member boolean, holder_locks_rows boolean, journal_id uuid
);

-- Only the project's disposable, freshly reset local/CI database. The remote
-- fixture commits for independent sessions; append-only financial history is
-- never deleted. The principal request is an owner-only fixture, not a newly
-- enabled generic principal recovery command.
do $probe$
declare
  v_schema text; v_host text; v_conn text; v_result text; v_action text;
  v_pid integer; v_waiting boolean; v_busy integer; v_tick integer;
  v_pids integer[]:=array[]::integer[]; v_blocked integer;
  v_request uuid; v_journal uuid;
  v_names text[] := array['withdrawal_lock_setup','withdrawal_lock_holder','withdrawal_lock_command','withdrawal_duplicate_a','withdrawal_duplicate_b'];
  v_name text;
begin
  select namespace.nspname into v_schema from pg_extension extension
  join pg_namespace namespace on namespace.oid=extension.extnamespace where extension.extname='dblink';
  foreach v_host in array array['supabase_db_putduk-mining-clean','supabase_db_putduk-mining'] loop
    v_conn:=format('host=%s dbname=postgres user=postgres password=postgres connect_timeout=2',v_host);
    begin
      execute format('select %I.dblink_connect(%L,%L)',v_schema,'withdrawal_lock_setup',v_conn);
      exit;
    exception when others then v_conn:=null;
    end;
  end loop;
  if v_conn is null then raise exception 'PUTDUK_LOCAL_DB_HOST_UNRESOLVED'; end if;
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_setup',$fixture$
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

create function pg_temp.plant_verified_mining_reward(
  p_user_id uuid,
  p_movement_id uuid,
  p_amount bigint,
  p_effective_at timestamptz,
  p_recorded_at timestamptz,
  p_key text
) returns void
language plpgsql
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

$fixture$);
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_setup',$setup$
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
      confirmation_token,recovery_token,email_change,email_change_token_new)
    values
      ('10621100-0000-4000-8000-000000000001','authenticated','authenticated',
       'withdrawal-lock-member@putduk.test','',statement_timestamp(),'{}','{}',
       statement_timestamp(),statement_timestamp(),'','','',''),
      ('10621100-0000-4000-8000-000000000002','authenticated','authenticated',
       'withdrawal-lock-admin@putduk.test','',statement_timestamp(),'{}','{}',
       statement_timestamp(),statement_timestamp(),'','','',''),
      ('10621100-0000-4000-8000-000000000003','authenticated','authenticated',
       'withdrawal-duplicate-member@putduk.test','',statement_timestamp(),'{}','{}',
       statement_timestamp(),statement_timestamp(),'','','','');
    insert into public.user_roles(user_id,role,granted_by) values
      ('10621100-0000-4000-8000-000000000002','ADMIN','10621100-0000-4000-8000-000000000002');
    do $seed$
    declare v_member uuid:='10621100-0000-4000-8000-000000000001';
      v_admin uuid:='10621100-0000-4000-8000-000000000002'; v_bank uuid; v_request uuid; v_hold uuid;
    begin
      perform public.bootstrap_user(v_member);
      insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,
        minimum_amount_atomic,fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
      values('KRW','KRW_BANK',10621101,true,1,0,'{}',statement_timestamp()-interval '1 hour',v_admin,false);
      insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
        display_hint,verification_status,verified_at,protection_until)
      values(v_member,'KRW_BANK',decode(repeat('ab',32),'hex'),
        encode(extensions.digest(v_member::text,'sha256'),'hex'),'동시성 시험 계좌','VERIFIED',
        statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day') returning id into v_bank;
      perform public.approve_deposit_request(
        public.create_deposit_request(v_member,'KRW',10000,'withdrawal-lock-deposit-request'),
        v_admin,10000,'withdrawal-lock-deposit-approval','actual local test deposit',gen_random_uuid());
      v_request:=pg_temp.seed_reserved_test_hold(v_member,v_bank,3000,'withdrawal-lock-finalize-hold');
      select hold_ledger_transaction_id into v_hold from public.withdrawal_requests where id=v_request;
      execute 'set local role service_role';
      perform app_private.apply_principal_recovery_newest_first(v_member,v_hold);
      perform public.record_krw_external_send(v_request,'WITHDRAWAL-LOCK-3000',3000,v_admin,
        statement_timestamp(),'withdrawal-lock-send');
      execute 'reset role';
      v_request:=pg_temp.seed_reserved_test_hold(v_member,v_bank,2000,'withdrawal-lock-release-hold');
      select hold_ledger_transaction_id into v_hold from public.withdrawal_requests where id=v_request;
      execute 'set local role service_role';
      perform app_private.apply_principal_recovery_newest_first(v_member,v_hold);
      execute 'reset role';
      v_member:='10621100-0000-4000-8000-000000000003';
      perform public.bootstrap_user(v_member);
      insert into public.ledger_accounts(code,currency,account_class,normal_side,owner_user_id)
      values('USER:'||upper(v_member::text)||':KRW:LIABILITY','KRW','LIABILITY','CREDIT',v_member)
      on conflict(code) do nothing;
      insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
        display_hint,verification_status,verified_at,protection_until)
      values(v_member,'KRW_BANK',decode(repeat('ab',32),'hex'),
        encode(extensions.digest(v_member::text,'sha256'),'hex'),'동시성 수익 시험 계좌','VERIFIED',
        statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day');
      -- Synthetic authoritative CREDIT fixture, as in the mining reservation
      -- suite; this is never evidence that a production earned producer runs.
      perform pg_temp.plant_verified_mining_reward(v_member,gen_random_uuid(),4000,
        statement_timestamp()-interval '1 hour',statement_timestamp(),
        'withdrawal-duplicate-credit-fixture');
    end;
    $seed$;
  $setup$);
  execute format('select %I.dblink_disconnect(%L)',v_schema,'withdrawal_lock_setup');
  execute format('select %I.dblink_connect(%L,%L)',v_schema,'withdrawal_lock_holder',v_conn);
  execute format('select %I.dblink_connect(%L,%L)',v_schema,'withdrawal_lock_command',v_conn);
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_command','set statement_timeout=15000');
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_command','set lock_timeout=10000');
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_command','set role service_role');
  execute format('select result from %I.dblink(%L,%L) as t(result text)',v_schema,
    'withdrawal_lock_command','select pg_backend_pid()::text') into v_result;
  v_pid:=v_result::integer;
  foreach v_action in array array['finalize','release'] loop
    select id into v_request from public.withdrawal_requests
      where user_id='10621100-0000-4000-8000-000000000001'
        and idempotency_key='withdrawal-lock-'||v_action||'-hold';
    execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_holder','begin');
    execute format('select result from %I.dblink(%L,%L) as t(result text)',v_schema,
      'withdrawal_lock_holder',$member_lock$
      select 'locked' from (select pg_advisory_xact_lock(hashtextextended(
        'putduk-funding-recovery:10621100-0000-4000-8000-000000000001',0))) held
    $member_lock$) into v_result;
    if v_action='finalize' then
      v_result:=format('select public.finalize_withdrawal_ledger(%L::uuid,%L::uuid,%L)::text',
        v_request,'10621100-0000-4000-8000-000000000002','withdrawal-lock-finalize-terminal');
    else
      v_result:=format('select public.release_withdrawal_hold(%L::uuid,%L::uuid,%L,%L,%L)::text',
        v_request,'10621100-0000-4000-8000-000000000002','reviewed cancellation',
        'withdrawal-lock-release-terminal','CANCELLED');
    end if;
    execute format('select %I.dblink_send_query(%L,%L)',v_schema,'withdrawal_lock_command',v_result);
    v_waiting:=false;
    for v_tick in 1..100 loop
      select exists(select 1 from pg_locks where pid=v_pid and locktype='advisory' and not granted)
        into v_waiting;
      exit when v_waiting;
      perform pg_sleep(0.05);
    end loop;
    if not v_waiting then raise exception 'WITHDRAWAL_MEMBER_CONTENTION_MISSING: %',v_action; end if;
    -- This NOWAIT check fails against the former order: terminal command held
    -- request/wallet rows before waiting for the member advisory boundary.
    execute format('select result from %I.dblink(%L,%L) as t(result text)',v_schema,
      'withdrawal_lock_holder',format(
        'select id::text from public.withdrawal_requests where id=%L::uuid for update nowait',v_request)) into v_result;
    if v_result is distinct from v_request::text then raise exception 'WITHDRAWAL_REQUEST_NOT_LOCKABLE'; end if;
    execute format('select result from %I.dblink(%L,%L) as t(result text)',v_schema,
      'withdrawal_lock_holder',$wallet_lock$
      select id::text from public.wallet_accounts
      where user_id='10621100-0000-4000-8000-000000000001' and currency='KRW' for update nowait
    $wallet_lock$) into v_result;
    if v_result is null then raise exception 'WITHDRAWAL_WALLET_NOT_LOCKABLE'; end if;
    execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_holder','commit');
    for v_tick in 1..200 loop
      execute format('select %I.dblink_is_busy(%L)',v_schema,'withdrawal_lock_command') into v_busy;
      exit when v_busy=0;
      perform pg_sleep(0.05);
    end loop;
    if v_busy<>0 then raise exception 'WITHDRAWAL_TERMINAL_TIMEOUT'; end if;
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',v_schema,
      'withdrawal_lock_command') into v_result;
    v_journal:=v_result::uuid;
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',v_schema,
      'withdrawal_lock_command') into v_result;
    insert into withdrawal_lock_result values(v_action,v_waiting,true,v_journal);
  end loop;
  execute format('select %I.dblink_disconnect(%L)',v_schema,'withdrawal_lock_command');
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_holder','begin');
  execute format('select result from %I.dblink(%L,%L) as t(result text)',v_schema,
    'withdrawal_lock_holder',$duplicate_lock$
    select 'locked' from (select pg_advisory_xact_lock(hashtextextended(
      'putduk-funding-recovery:10621100-0000-4000-8000-000000000003',0))) held
  $duplicate_lock$) into v_result;
  foreach v_name in array array['withdrawal_duplicate_a','withdrawal_duplicate_b'] loop
    execute format('select %I.dblink_connect(%L,%L)',v_schema,v_name,v_conn);
    execute format('select %I.dblink_exec(%L,%L)',v_schema,v_name,'set statement_timeout=15000');
    execute format('select %I.dblink_exec(%L,%L)',v_schema,v_name,'set lock_timeout=10000');
    execute format('select %I.dblink_exec(%L,%L)',v_schema,v_name,'set role service_role');
    execute format('select result from %I.dblink(%L,%L) as t(result text)',v_schema,v_name,
      'select pg_backend_pid()::text') into v_result;
    v_pids:=array_append(v_pids,v_result::integer);
    execute format('select %I.dblink_send_query(%L,%L)',v_schema,v_name,$duplicate_command$
      select public.request_krw_withdrawal('10621100-0000-4000-8000-000000000003',
        (select id from public.withdrawal_destinations
          where user_id='10621100-0000-4000-8000-000000000003' and destination_type='KRW_BANK'),
        3000,'withdrawal-duplicate-ordinary-key')::text
    $duplicate_command$);
  end loop;
  for v_tick in 1..100 loop
    select count(distinct pid)::integer into v_blocked from pg_locks
      where pid=any(v_pids) and locktype='advisory' and not granted;
    exit when v_blocked=2;
    perform pg_sleep(0.05);
  end loop;
  if v_blocked<>2 then raise exception 'WITHDRAWAL_DUPLICATE_CONTENTION_MISSING'; end if;
  execute format('select %I.dblink_exec(%L,%L)',v_schema,'withdrawal_lock_holder','commit');
  for v_tick in 1..200 loop
    v_busy:=0;
    foreach v_name in array array['withdrawal_duplicate_a','withdrawal_duplicate_b'] loop
      execute format('select %I.dblink_is_busy(%L)',v_schema,v_name) into v_result;
      v_busy:=v_busy+v_result::integer;
    end loop;
    exit when v_busy=0;
    perform pg_sleep(0.05);
  end loop;
  if v_busy<>0 then raise exception 'WITHDRAWAL_DUPLICATE_COMMAND_TIMEOUT'; end if;
  foreach v_name in array array['withdrawal_duplicate_a','withdrawal_duplicate_b'] loop
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',v_schema,v_name) into v_result;
    insert into withdrawal_duplicate_result values(v_name,v_result::uuid);
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',v_schema,v_name) into v_result;
    execute format('select %I.dblink_disconnect(%L)',v_schema,v_name);
  end loop;
  execute format('select %I.dblink_disconnect(%L)',v_schema,'withdrawal_lock_holder');
exception when others then
  foreach v_name in array v_names loop
    begin execute format('select %I.dblink_disconnect(%L)',v_schema,v_name);
    exception when others then null; end;
  end loop;
  raise;
end;
$probe$;
select ok((select count(*)=2 and bool_and(waiting_on_member and holder_locks_rows)
  from withdrawal_lock_result),'finalize and release wait on member lock before holding request or wallet rows');
select ok((select count(*)=2 and bool_and(journal_id is not null) from withdrawal_lock_result),
  'both actual terminal commands complete after the earlier member transaction releases');
select is((select count(*)::integer from public.ledger_transactions where idempotency_key in
  ('withdrawal-lock-finalize-terminal:finalize','withdrawal-lock-release-terminal:release')),2,
  'two terminal commands post exactly their two original journals');
select ok((select count(*)=2 and bool_and(entries=2 and balance=0) from (
  select result.action,count(*) entries,sum(case when entry.side='DEBIT'
    then entry.amount_atomic else -entry.amount_atomic end) balance
  from withdrawal_lock_result result join public.ledger_entries entry on entry.transaction_id=result.journal_id
  group by result.action
) journal),'both terminal journals remain balanced');
select ok((select coverage='COMPLETE' and eligible_principal_atomic='7000'
  and held_principal_atomic='0' and recovered_principal_atomic='3000'
  from public.money_source_summaries where user_id='10621100-0000-4000-8000-000000000001'),
  'terminal concurrency leaves available, held and recovered principal reconciled');
select ok((select count(*)=2 and count(distinct request_id)=1 from withdrawal_duplicate_result),
  'two actual same-key ordinary mining commands recover one request after member serialization');
select is((select count(*)::integer from public.withdrawal_requests
  where user_id='10621100-0000-4000-8000-000000000003'
    and idempotency_key='withdrawal-duplicate-ordinary-key'),1,'concurrent ordinary request has one identity');
select is((select count(*)::integer from public.ledger_transactions
  where idempotency_key='withdrawal-duplicate-ordinary-key:hold'),1,'concurrent ordinary request has one hold journal');
select is((select count(*)::integer from public.outbox_events
  where idempotency_key='withdrawal-duplicate-ordinary-key:event'),1,'concurrent ordinary request has one request event');
select is((select count(*)::integer from public.mining_reward_withdrawal_reservations reservation
  join public.withdrawal_requests request on request.hold_ledger_transaction_id=reservation.hold_ledger_transaction_id
  where request.idempotency_key='withdrawal-duplicate-ordinary-key'),1,
  'concurrent ordinary request reserves its mining source exactly once');
select is((select count(*)::integer from public.funding_principal_recovery_allocations
  where user_id='10621100-0000-4000-8000-000000000003'),0,
  'concurrent ordinary mining never reserves principal');
select * from finish();
rollback;
