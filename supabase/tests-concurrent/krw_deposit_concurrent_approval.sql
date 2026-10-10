begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- 한 연결의 pgTAP 트랜잭션은 동시에 두 승인을 열 수 없다.
-- 아래는 서로 다른 dblink 세션 두 개가 같은 원화 입금을 동시에 승인한다.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    create extension dblink with schema extensions;
  end if;
end;
$$;

create temporary table krw_conc_host (host text);

create temporary table krw_conc_deposit (deposit_id uuid);

create temporary table krw_conc_outcome (
  session_name text primary key,
  detail text not null
);

-- 이 세션의 서버 주소만 쓴다. 과거 컨테이너 이름 목록은 쓰지 않는다.
\ir resolve_disposable_dblink_host.inc

insert into krw_conc_host (host)
select pg_temp.putduk_disposable_dblink_host('LOCAL_DB_HOST_UNRESOLVED');

do $$
declare
  v_schema text;
  v_conn text;
  v_deposit_id uuid;
begin
  select namespace.nspname into v_schema
  from pg_extension as extension
  join pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'dblink';

  select 'host=' || host || ' dbname=postgres user=postgres password=postgres'
    into v_conn
  from krw_conc_host;

  execute format(
    'select %I.dblink_connect(%L, %L)',
    v_schema,
    'krw_conc_setup',
    v_conn
  );

  execute format(
    'select %I.dblink_exec(%L, %L)',
    v_schema,
    'krw_conc_setup',
    $setup$
      insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values
        (
          '0d210000-0000-4000-8000-0000000000a1',
          'authenticated', 'authenticated', 'krw-concurrent-admin-a@putduk.test',
          '', statement_timestamp(), '{}'::jsonb, '{}'::jsonb,
          statement_timestamp(), statement_timestamp(), '', '', '', ''
        ),
        (
          '0d210000-0000-4000-8000-0000000000a2',
          'authenticated', 'authenticated', 'krw-concurrent-admin-b@putduk.test',
          '', statement_timestamp(), '{}'::jsonb, '{}'::jsonb,
          statement_timestamp(), statement_timestamp(), '', '', '', ''
        ),
        (
          '0d210000-0000-4000-8000-000000000101',
          'authenticated', 'authenticated', 'krw-concurrent-member@putduk.test',
          '', statement_timestamp(), '{}'::jsonb, '{}'::jsonb,
          statement_timestamp(), statement_timestamp(), '', '', '', ''
        )
      on conflict (id) do nothing
    $setup$
  );

  execute format(
    'select %I.dblink_exec(%L, %L)',
    v_schema,
    'krw_conc_setup',
    $roles$
      insert into public.user_roles (user_id, role, granted_by)
      values
        (
          '0d210000-0000-4000-8000-0000000000a1',
          'ADMIN',
          '0d210000-0000-4000-8000-0000000000a1'
        ),
        (
          '0d210000-0000-4000-8000-0000000000a2',
          'ADMIN',
          '0d210000-0000-4000-8000-0000000000a2'
        )
      on conflict do nothing
    $roles$
  );

  execute format(
    'select deposit_id from %I.dblink(%L, %L) as t(deposit_id uuid)',
    v_schema,
    'krw_conc_setup',
    $deposit$
      select public.create_deposit_request(
        '0d210000-0000-4000-8000-000000000101',
        'KRW',
        80000,
        'krw-concurrent-request-v1'
      )
    $deposit$
  ) into v_deposit_id;

  if v_deposit_id is null then
    raise exception 'CONCURRENT_DEPOSIT_NOT_CREATED';
  end if;

  insert into krw_conc_deposit (deposit_id) values (v_deposit_id);
  execute format(
    'select %I.dblink_disconnect(%L)',
    v_schema,
    'krw_conc_setup'
  );
end;
$$;

do $$
declare
  v_schema text;
  v_conn text;
  v_deposit_id uuid;
  v_sql text;
  v_session text;
  v_ticks integer := 0;
  v_busy integer;
  v_result text;
  v_name text;
begin
  select namespace.nspname into v_schema
  from pg_extension as extension
  join pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'dblink';

  select 'host=' || host || ' dbname=postgres user=postgres password=postgres'
    into v_conn
  from krw_conc_host;
  select deposit_id into v_deposit_id from krw_conc_deposit;

  foreach v_session in array array['krw_conc_a', 'krw_conc_b']
  loop
    execute format(
      'select %I.dblink_connect(%L, %L)',
      v_schema,
      v_session,
      v_conn
    );
    execute format(
      'select %I.dblink_exec(%L, %L)',
      v_schema,
      v_session,
      'set statement_timeout = 15000'
    );
    execute format(
      'select %I.dblink_exec(%L, %L)',
      v_schema,
      v_session,
      'set lock_timeout = 10000'
    );
  end loop;

  foreach v_session in array array['a', 'b']
  loop
    v_sql := format(
      'select public.approve_deposit_request(%L::uuid, %L::uuid, 80000, %L, %L, %L::uuid)::text',
      v_deposit_id,
      case v_session
        when 'a' then '0d210000-0000-4000-8000-0000000000a1'
        else '0d210000-0000-4000-8000-0000000000a2'
      end,
      'krw-concurrent-ledger-' || v_session,
      'concurrent matching transfer',
      case v_session
        when 'a' then '0d210000-0000-4000-8000-00000000d0a1'
        else '0d210000-0000-4000-8000-00000000d0a2'
      end
    );
    execute format(
      'select %I.dblink_send_query(%L, %L)',
      v_schema,
      'krw_conc_' || v_session,
      v_sql
    );
  end loop;

  while v_ticks < 200 loop
    v_busy := 0;
    foreach v_name in array array['krw_conc_a', 'krw_conc_b']
    loop
      execute format('select %I.dblink_is_busy(%L)', v_schema, v_name)
        into v_result;
      if v_result::integer <> 0 then
        v_busy := v_busy + 1;
      end if;
    end loop;
    exit when v_busy = 0;
    perform pg_sleep(0.1);
    v_ticks := v_ticks + 1;
  end loop;

  if v_ticks >= 200 then
    insert into krw_conc_outcome (session_name, detail)
    values ('a', 'error:CONCURRENT_APPROVAL_TIMEOUT'),
           ('b', 'error:CONCURRENT_APPROVAL_TIMEOUT');
  else
    foreach v_session in array array['a', 'b']
    loop
      begin
        execute format(
          'select result from %I.dblink_get_result(%L) as t(result text)',
          v_schema,
          'krw_conc_' || v_session
        ) into v_result;
        insert into krw_conc_outcome (session_name, detail)
        values (v_session, 'ok:' || coalesce(v_result, ''));
      exception
        when others then
          insert into krw_conc_outcome (session_name, detail)
          values (v_session, 'error:' || sqlerrm);
      end;
      begin
        execute format(
          'select result from %I.dblink_get_result(%L) as t(result text)',
          v_schema,
          'krw_conc_' || v_session
        ) into v_result;
      exception
        when others then
          null;
      end;
    end loop;
  end if;

  foreach v_session in array array['krw_conc_a', 'krw_conc_b']
  loop
    begin
      execute format('select %I.dblink_disconnect(%L)', v_schema, v_session);
    exception
      when others then
        null;
    end;
  end loop;
end;
$$;

select ok(
  (select detail from krw_conc_outcome where session_name = 'a') like 'ok:%'
    and (select detail from krw_conc_outcome where session_name = 'b') like 'ok:%'
    and (select detail from krw_conc_outcome where session_name = 'a')
      = (select detail from krw_conc_outcome where session_name = 'b')
    and length((select detail from krw_conc_outcome where session_name = 'a')) > 3,
  'two sessions approve the same deposit and return the same ledger id'
);

select is(
  (
    select count(*)::integer
    from public.ledger_transactions as transaction
    where transaction.reference_type = 'deposit_request'
      and transaction.reference_id = (select deposit_id from krw_conc_deposit)
      and transaction.category = 'DEPOSIT'
      and transaction.currency = 'KRW'
  ),
  1,
  'concurrent approval posts one KRW deposit journal'
);

select ok(
  (
    select
      sum(entry.amount_atomic) filter (where entry.side = 'DEBIT') = 80000::numeric
      and sum(entry.amount_atomic) filter (where entry.side = 'CREDIT') = 80000::numeric
    from public.deposit_requests as request
    join public.ledger_entries as entry
      on entry.transaction_id = request.ledger_transaction_id
    where request.id = (select deposit_id from krw_conc_deposit)
  ),
  'the single journal is balanced at the approved amount'
);

select is(
  (
    select count(*)::integer
    from public.wallet_ledger as ledger
    where ledger.reference_type = 'deposit_request'
      and ledger.reference_id = (select deposit_id from krw_conc_deposit)
      and ledger.entry_type = 'DEPOSIT'
      and ledger.direction = 'CREDIT'
  ),
  1,
  'concurrent approval posts one wallet projection'
);

select is(
  (
    select count(*)::integer
    from public.outbox_events as event
    where event.aggregate_type = 'deposit_request'
      and event.aggregate_id = (select deposit_id from krw_conc_deposit)
      and event.event_type = 'DEPOSIT_CONFIRMED.v1'
  ),
  1,
  'concurrent approval emits one deposit confirmed outbox event'
);

select is(
  (
    select request.amount_atomic::text
      || ':'
      || request.approved_amount_atomic::text
      || ':'
      || request.status::text
    from public.deposit_requests as request
    where request.id = (select deposit_id from krw_conc_deposit)
  ),
  '80000:80000:APPROVED',
  'requested amount stays and the stored approval is the received amount'
);

select is(
  (
    select count(*)::integer
    from public.wallet_accounts as account
    where account.user_id = '0d210000-0000-4000-8000-000000000101'
      and account.currency = 'USDT'
  ),
  0,
  'concurrent KRW approval does not create a USDT wallet'
);

select is(
  (
    select count(*)::integer
    from public.money_source_movements as movement
    join public.deposit_requests as request
      on request.ledger_transaction_id = movement.ledger_transaction_id
    where request.id = (select deposit_id from krw_conc_deposit)
  ),
  1,
  'concurrent KRW approval captures one source movement for the original journal'
);

select ok(
  (
    select count(*) = 1 and bool_and(
      movement.schema_version = 1
      and movement.user_id = request.user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.origin_code = 'KRW_DEPOSIT'
      and movement.amount_atomic = request.approved_amount_atomic
      and movement.wallet_ledger_id = request.wallet_ledger_id
      and movement.effective_at = journal.posted_at
      and event.event_type = 'DEPOSIT_CONFIRMED.v1'
      and event.schema_version = 1
      and event.aggregate_type = 'deposit_request'
      and event.aggregate_id = request.id
      and event.actor_user_id = request.reviewed_by
      and event.payload->>'approved_amount_atomic' = movement.amount_atomic::text
      and event.payload->>'ledger_transaction_id' = journal.id::text
      and event.payload->>'wallet_ledger_id' = request.wallet_ledger_id::text
    )
    from public.deposit_requests as request
    join public.ledger_transactions as journal
      on journal.id = request.ledger_transaction_id
    join public.money_source_movements as movement
      on movement.ledger_transaction_id = journal.id
    join public.outbox_events as event
      on event.id = movement.source_event_id
    where request.id = (select deposit_id from krw_conc_deposit)
  ),
  'the single KRW PRINCIPAL CREDIT keeps the original wallet, event and effective instant'
);

-- CI는 main suite 뒤 이 전용 로컬 DB를 reset하고 세 동시성 검사만 실행한다.
-- 별도 세션에서 커밋한 금융 영수증은 일회용 러너 DB 폐기까지 함께 보존한다.
-- outbox/source/journal/audit row를 개별 삭제하지 않는다.

select * from finish();

rollback;
