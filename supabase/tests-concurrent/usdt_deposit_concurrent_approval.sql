begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 공유 pgTAP suite가 끝난 뒤 새로 reset한 일회용 DB에서만 실행한다.
-- 제3 연결이 입금을 잠근 동안 두 service_role 연결의 실제 lock 대기를 확인한다.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    create extension dblink with schema extensions;
  end if;
end;
$$;
create temporary table usdt_conc_context (host text, blocked_sessions integer);
create temporary table usdt_conc_outcome (session_name text primary key, receipt text);

do $test$
declare
  v_schema text;
  v_host text;
  v_conn text;
  v_name text;
  v_sql text;
  v_result text;
  v_pid_a integer;
  v_pid_b integer;
  v_blocked integer := 0;
  v_busy integer;
  v_ticks integer;
begin
  select namespace.nspname into v_schema from pg_extension as extension
  join pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'dblink';
  foreach v_host in array array['supabase_db_putduk-mining-clean', 'supabase_db_putduk-mining']
  loop
    v_conn := format('host=%s dbname=postgres user=postgres password=postgres connect_timeout=2', v_host);
    begin
      execute format('select %I.dblink_connect(%L, %L)', v_schema, 'usdt_conc_setup', v_conn);
      insert into usdt_conc_context (host) values (v_host);
      exit;
    exception when others then
      null;
    end;
  end loop;
  if not exists (select 1 from usdt_conc_context) then
    raise exception 'PUTDUK_LOCAL_DB_HOST_UNRESOLVED';
  end if;

  execute format('select %I.dblink_exec(%L, %L)', v_schema, 'usdt_conc_setup', $setup$
    do $body$
    begin
      insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) select id, 'authenticated', 'authenticated', email, '', statement_timestamp(),
        '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
      from (values
        ('0d440000-0000-4000-8000-0000000000a1'::uuid, 'usdt-concurrent-admin-a@putduk.test'),
        ('0d440000-0000-4000-8000-0000000000a2'::uuid, 'usdt-concurrent-admin-b@putduk.test'),
        ('0d440000-0000-4000-8000-000000000101'::uuid, 'usdt-concurrent-member@putduk.test')
      ) as people(id, email);
      insert into public.user_roles (user_id, role, granted_by) values
        ('0d440000-0000-4000-8000-0000000000a1', 'ADMIN', '0d440000-0000-4000-8000-0000000000a1'),
        ('0d440000-0000-4000-8000-0000000000a2', 'ADMIN', '0d440000-0000-4000-8000-0000000000a2');
      perform public.bootstrap_user('0d440000-0000-4000-8000-000000000101');
      insert into public.usdt_manual_deposits (
        id, user_id, network, tx_hash, sent_usdt_amount, deposit_address_snapshot,
        network_snapshot, idempotency_key
      ) values (
        '0d440000-0000-4000-8000-00000000d001', '0d440000-0000-4000-8000-000000000101',
        'TRC20', 'usdt-concurrent-transfer-v1', 10.000001, 'fixture-deposit-address',
        'TRC20', 'usdt-concurrent-request-v1'
      );
    end;
    $body$;
  $setup$);
  execute format('select %I.dblink_disconnect(%L)', v_schema, 'usdt_conc_setup');

  execute format('select %I.dblink_connect(%L, %L)', v_schema, 'usdt_conc_holder', v_conn);
  execute format('select %I.dblink_exec(%L, %L)', v_schema, 'usdt_conc_holder', 'begin');
  execute format('select result from %I.dblink(%L, %L) as t(result text)',
    v_schema, 'usdt_conc_holder', $lock$
      select id::text from public.usdt_manual_deposits
      where id = '0d440000-0000-4000-8000-00000000d001' for update
    $lock$) into v_result;
  if v_result is distinct from '0d440000-0000-4000-8000-00000000d001' then
    raise exception 'USDT_CONCURRENT_FIXTURE_NOT_LOCKED';
  end if;
  foreach v_name in array array['a', 'b']
  loop
    execute format('select %I.dblink_connect(%L, %L)', v_schema, 'usdt_conc_' || v_name, v_conn);
    execute format('select %I.dblink_exec(%L, %L)', v_schema, 'usdt_conc_' || v_name,
      'set statement_timeout = 15000');
    execute format('select %I.dblink_exec(%L, %L)', v_schema, 'usdt_conc_' || v_name,
      'set lock_timeout = 10000');
    execute format('select %I.dblink_exec(%L, %L)', v_schema, 'usdt_conc_' || v_name,
      'set role service_role');
    execute format('select result from %I.dblink(%L, %L) as t(result text)',
      v_schema, 'usdt_conc_' || v_name, 'select pg_backend_pid()::text') into v_result;
    if v_name = 'a' then v_pid_a := v_result::integer; else v_pid_b := v_result::integer; end if;
    v_sql := format('select public.confirm_usdt_manual_deposit(%L::uuid, 12345, %L::uuid, %L, %L)::text',
      '0d440000-0000-4000-8000-00000000d001',
      case v_name when 'a' then '0d440000-0000-4000-8000-0000000000a1'
        else '0d440000-0000-4000-8000-0000000000a2' end,
      'concurrent verified transfer receipt', 'usdt-concurrent-approval-' || v_name);
    execute format('select %I.dblink_send_query(%L, %L)', v_schema, 'usdt_conc_' || v_name, v_sql);
  end loop;
  for v_ticks in 1..100 loop
    select count(distinct pid)::integer into v_blocked from pg_locks
    where pid = any (array[v_pid_a, v_pid_b]) and not granted;
    exit when v_blocked = 2;
    perform pg_sleep(0.05);
  end loop;
  update usdt_conc_context set blocked_sessions = v_blocked;
  if v_blocked <> 2 then raise exception 'USDT_CONCURRENT_LOCK_CONTENTION_MISSING'; end if;
  execute format('select %I.dblink_exec(%L, %L)', v_schema, 'usdt_conc_holder', 'commit');
  execute format('select %I.dblink_disconnect(%L)', v_schema, 'usdt_conc_holder');

  for v_ticks in 1..200 loop
    v_busy := 0;
    foreach v_name in array array['a', 'b'] loop
      execute format('select %I.dblink_is_busy(%L)', v_schema, 'usdt_conc_' || v_name) into v_result;
      v_busy := v_busy + v_result::integer;
    end loop;
    exit when v_busy = 0;
    perform pg_sleep(0.05);
  end loop;
  if v_busy <> 0 then raise exception 'USDT_CONCURRENT_APPROVAL_TIMEOUT'; end if;
  foreach v_name in array array['a', 'b'] loop
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',
      v_schema, 'usdt_conc_' || v_name) into v_result;
    insert into usdt_conc_outcome values (v_name, v_result);
    -- 비동기 결과의 끝을 소비한 뒤 해당 테스트 연결만 닫는다.
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',
      v_schema, 'usdt_conc_' || v_name) into v_result;
    execute format('select %I.dblink_disconnect(%L)', v_schema, 'usdt_conc_' || v_name);
  end loop;
end;
$test$;

select is((select blocked_sessions from usdt_conc_context), 2,
  'both independent service-role sessions were waiting on the same locked deposit');
select ok(
  (select receipt from usdt_conc_outcome where session_name = 'a') is not null
  and (select receipt from usdt_conc_outcome where session_name = 'a')
    = (select receipt from usdt_conc_outcome where session_name = 'b'),
  'both operators return the same real journal receipt after the lock is released'
);
select is((select count(*)::integer from public.ledger_transactions
  where reference_type = 'usdt_manual_deposit'
    and reference_id = '0d440000-0000-4000-8000-00000000d001'), 1,
  'the simultaneous approvals post exactly one journal');
select ok(
  (select count(*) = 2
    and sum(entry.amount_atomic) filter (where entry.side = 'DEBIT') = 12345::numeric
    and sum(entry.amount_atomic) filter (where entry.side = 'CREDIT') = 12345::numeric
    from public.ledger_entries as entry join public.usdt_manual_deposits as deposit
      on deposit.ledger_transaction_id = entry.transaction_id
    where deposit.id = '0d440000-0000-4000-8000-00000000d001'),
  'the sole journal has two balanced entries for the exact approved KRW amount'
);
select is((select count(*)::integer from public.wallet_ledger
  where reference_type = 'usdt_manual_deposit'
    and reference_id = '0d440000-0000-4000-8000-00000000d001'), 1,
  'the simultaneous approvals credit the real KRW wallet only once');
select is((select sum(amount_atomic)::text from public.wallet_ledger
  where user_id = '0d440000-0000-4000-8000-000000000101'), '12345',
  'the full fresh member projection contains only the approved amount');
select is((select count(*)::integer from public.audit_logs
  where action = 'usdt_manual_deposit.confirm' and target_id = '0d440000-0000-4000-8000-00000000d001'),
  1, 'the real approval actor is audited once');
select is((select count(*)::integer from public.outbox_events
  where aggregate_type = 'usdt_manual_deposit' and aggregate_id = '0d440000-0000-4000-8000-00000000d001'
    and event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'), 1,
  'the simultaneous approvals emit one unchanged v1 downstream event');
select is((select count(*)::integer from app_private.idempotency_keys
  where scope = 'usdt_manual_deposit.confirm' and actor_id is null and status = 'COMPLETED'
    and idempotency_key in ('usdt-concurrent-approval-a', 'usdt-concurrent-approval-b')
    and response_payload->>'ledger_transaction_id' = (select receipt from usdt_conc_outcome limit 1)),
  2, 'both request keys complete against the same original receipt');
select ok((select status = 'CONFIRMED' and credited_krw = 12345
  and confirmed_by in ('0d440000-0000-4000-8000-0000000000a1'::uuid,
    '0d440000-0000-4000-8000-0000000000a2'::uuid)
  and wallet_ledger_id is not null from public.usdt_manual_deposits
  where id = '0d440000-0000-4000-8000-00000000d001'),
  'the deposit keeps the original real operator and both receipt links');
select is((select count(*)::integer from public.wallet_accounts
  where user_id = '0d440000-0000-4000-8000-000000000101' and currency = 'USDT'),
  0, 'concurrent manual deposits never create a user USDT wallet');

-- 별도 연결에서 커밋한 시험 기록은 일회용 DB에 남긴다. 감사·원장은 삭제하지 않는다.
select * from finish();
rollback;
