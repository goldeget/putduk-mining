begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- 다른 세션이 커밋된 행을 잠금 대기하도록 준비한다.
-- 이 파일의 트랜잭션은 마지막에 롤백되므로, 잠금 대상만 별도 세션에서 커밋한다.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    create extension dblink with schema extensions;
  end if;
end;
$$;

-- 이 세션의 서버 주소만 쓴다. 과거 컨테이너 이름 목록은 쓰지 않는다.
create temporary table recon_ack_db_host (host text);

\ir ../snippets/resolve_disposable_dblink_host.inc

insert into recon_ack_db_host (host)
select pg_temp.putduk_disposable_dblink_host('LOCAL_DB_HOST_UNRESOLVED');

select lives_ok(
  $concurrent$
    do $body$
    declare
      v_schema text;
      v_connected boolean := false;
      v_status text;
      v_conn text;
    begin
      select namespace.nspname into v_schema
      from pg_extension as extension
      join pg_namespace as namespace on namespace.oid = extension.extnamespace
      where extension.extname = 'dblink';

      if v_schema is null then
        raise exception 'DBLINK_EXTENSION_MISSING';
      end if;

      -- 위에서 고른 이 서버 주소로 두 번째 세션을 연다.
      select 'host=' || host || ' dbname=postgres user=postgres password=postgres'
        into v_conn
      from recon_ack_db_host;
      execute format(
        'select %I.dblink_connect(%L, %L)',
        v_schema,
        'recon_ack_peer',
        v_conn
      );
      v_connected := true;

      execute format(
        'select %I.dblink_exec(%L, %L)',
        v_schema,
        'recon_ack_peer',
        $setup$
          do $inner$
          begin
            delete from public.reconciliation_mismatches
            where id = 'c3000000-0000-4000-8000-000000000906';
            delete from public.reconciliation_runs
            where id = 'c3000000-0000-4000-8000-000000000901';
            delete from public.user_roles
            where user_id = 'c3333333-3333-4333-8333-333333333333';
            delete from auth.users
            where id = 'c3333333-3333-4333-8333-333333333333';

            insert into auth.users (
              id, aud, role, email, encrypted_password, email_confirmed_at,
              raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new) values (
              'c3333333-3333-4333-8333-333333333333',
              'authenticated',
              'authenticated',
              'recon-ack-lock@putduk.test',
              '',
              statement_timestamp(),
              '{}'::jsonb,
              '{}'::jsonb,
              statement_timestamp(), statement_timestamp(), '', '', '', ''
            );
            insert into public.user_roles (user_id, role, granted_by)
            values (
              'c3333333-3333-4333-8333-333333333333',
              'ADMIN',
              'c3333333-3333-4333-8333-333333333333'
            );
            insert into public.reconciliation_runs (
              id, request_id, scope, status, checked_count, mismatch_count, completed_at
            ) values (
              'c3000000-0000-4000-8000-000000000901',
              'c3000000-0000-4000-8000-000000000902',
              'RECON_ACK_LOCK',
              'SUCCEEDED',
              1,
              1,
              statement_timestamp()
            );
            insert into public.reconciliation_mismatches (
              id, run_id, mismatch_type, subject_type, subject_id,
              expected_value, actual_value, status
            ) values (
              'c3000000-0000-4000-8000-000000000906',
              'c3000000-0000-4000-8000-000000000901',
              'PGTAP_LOCK',
              'recon_ack_pgtap',
              'lock-committed',
              '{"amount_atomic":"4"}'::jsonb,
              '{"amount_atomic":"5"}'::jsonb,
              'OPEN'
            );
          end
          $inner$
        $setup$
      );

      -- 서브트랜잭션을 되돌리면 행 잠금이 풀려 뒤 정리가 기다리지 않는다.
      begin
        perform mismatch.id
        from public.reconciliation_mismatches as mismatch
        where mismatch.id = 'c3000000-0000-4000-8000-000000000906'
        for update;

        execute format('select %I.dblink_exec(%L, %L)', v_schema, 'recon_ack_peer', 'begin');
        execute format(
          'select %I.dblink_exec(%L, %L)',
          v_schema,
          'recon_ack_peer',
          'set local lock_timeout = ''750ms'''
        );

        begin
          execute format(
            'select %I.dblink_exec(%L, %L)',
            v_schema,
            'recon_ack_peer',
            $sql$
              do $peer$
              begin
                perform public.acknowledge_reconciliation_mismatch(
                  'c3000000-0000-4000-8000-000000000906'::uuid,
                  'c3333333-3333-4333-8333-333333333333'::uuid,
                  'ACCEPTED',
                  '동시에 종료 확인을 시도합니다. 잠금이 풀리기 전에는 끝나지 않아야 합니다.',
                  'c3000000-0000-4000-8000-000000000396'::uuid
                );
              end
              $peer$
            $sql$
          );
          raise exception 'CONCURRENT_ACK_DID_NOT_BLOCK';
        exception
          when others then
            if sqlerrm not like '%lock%'
              and sqlerrm not like '%55P03%'
              and sqlerrm not like '%timeout%'
            then
              raise;
            end if;
        end;

        begin
          execute format('select %I.dblink_exec(%L, %L)', v_schema, 'recon_ack_peer', 'rollback');
        exception
          when others then
            null;
        end;

        select mismatch.status into v_status
        from public.reconciliation_mismatches as mismatch
        where mismatch.id = 'c3000000-0000-4000-8000-000000000906';
        if v_status is distinct from 'OPEN' then
          raise exception 'CONCURRENT_ACK_CHANGED_STATE:%', v_status;
        end if;

        raise exception 'RELEASE_ROW_LOCK';
      exception
        when others then
          if sqlerrm not like '%RELEASE_ROW_LOCK%' then
            raise;
          end if;
      end;

      execute format('select %I.dblink_disconnect(%L)', v_schema, 'recon_ack_peer');
      v_connected := false;
    exception
      when others then
        if v_connected then
          begin
            execute format('select %I.dblink_exec(%L, %L)', v_schema, 'recon_ack_peer', 'rollback');
          exception
            when others then
              null;
          end;
          begin
            execute format('select %I.dblink_disconnect(%L)', v_schema, 'recon_ack_peer');
          exception
            when others then
              null;
          end;
        end if;
        raise;
    end
    $body$;
  $concurrent$,
  'a second terminal acknowledgement blocks while the mismatch row is locked'
);

select is(
  (
    select status
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000906'
  ),
  'OPEN',
  'a blocked concurrent acknowledgement does not commit a terminal state'
);

-- 잠금을 푼 뒤 커밋된 잠금 대상만 지운다. 테스트 본문 롤백으로는 지워지지 않는다.
do $$
declare
  v_schema text;
  v_conn text;
begin
  select namespace.nspname into v_schema
  from pg_extension as extension
  join pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'dblink';

  select 'host=' || host || ' dbname=postgres user=postgres password=postgres'
    into v_conn
  from recon_ack_db_host;

  execute format(
    'select %I.dblink_connect(%L, %L)',
    v_schema,
    'recon_ack_cleanup',
    v_conn
  );
  execute format(
    'select %I.dblink_exec(%L, %L)',
    v_schema,
    'recon_ack_cleanup',
    $cleanup$
      do $inner$
      begin
        delete from public.reconciliation_mismatches
        where id = 'c3000000-0000-4000-8000-000000000906';
        delete from public.reconciliation_runs
        where id = 'c3000000-0000-4000-8000-000000000901';
        delete from public.user_roles
        where user_id = 'c3333333-3333-4333-8333-333333333333';
        delete from auth.users
        where id = 'c3333333-3333-4333-8333-333333333333';
      end
      $inner$
    $cleanup$
  );
  execute format('select %I.dblink_disconnect(%L)', v_schema, 'recon_ack_cleanup');
end;
$$;


insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
values
  (
    'c3111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'recon-ack-admin@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    'c3222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'recon-ack-viewer@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  );

insert into public.user_roles (user_id, role, granted_by)
values
  (
    'c3111111-1111-4111-8111-111111111111',
    'ADMIN',
    'c3111111-1111-4111-8111-111111111111'
  ),
  (
    'c3222222-2222-4222-8222-222222222222',
    'VIEWER',
    'c3111111-1111-4111-8111-111111111111'
  );

insert into public.reconciliation_runs (
  id,
  request_id,
  scope,
  status,
  checked_count,
  mismatch_count,
  completed_at
)
values (
  'c3000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002',
  'RECON_ACK_PGTAP',
  'SUCCEEDED',
  1,
  1,
  statement_timestamp()
);

insert into public.reconciliation_mismatches (
  id,
  run_id,
  mismatch_type,
  subject_type,
  subject_id,
  expected_value,
  actual_value,
  status,
  resolution_reason,
  resolved_by,
  resolved_at
)
values
  (
    'c3000000-0000-4000-8000-000000000101',
    'c3000000-0000-4000-8000-000000000001',
    'PGTAP_ACCEPT',
    'recon_ack_pgtap',
    'accept',
    '{"amount_atomic":"5000"}'::jsonb,
    '{"amount_atomic":"0"}'::jsonb,
    'OPEN',
    null,
    null,
    null
  ),
  (
    'c3000000-0000-4000-8000-000000000102',
    'c3000000-0000-4000-8000-000000000001',
    'PGTAP_INVESTIGATE',
    'recon_ack_pgtap',
    'investigate',
    '{"amount_atomic":"5000"}'::jsonb,
    '{"amount_atomic":"1"}'::jsonb,
    'OPEN',
    null,
    null,
    null
  ),
  (
    'c3000000-0000-4000-8000-000000000103',
    'c3000000-0000-4000-8000-000000000001',
    'PGTAP_CLOSED',
    'recon_ack_pgtap',
    'closed',
    '{"amount_atomic":"9"}'::jsonb,
    '{"amount_atomic":"8"}'::jsonb,
    'RESOLVED',
    '이미 닫힌 예외입니다. 다시 열지 않습니다.',
    'c3111111-1111-4111-8111-111111111111',
    statement_timestamp()
  ),
  (
    'c3000000-0000-4000-8000-000000000104',
    'c3000000-0000-4000-8000-000000000001',
    'PGTAP_REPLAY',
    'recon_ack_pgtap',
    'replay',
    '{"amount_atomic":"3"}'::jsonb,
    '{"amount_atomic":"2"}'::jsonb,
    'OPEN',
    null,
    null,
    null
  ),
  (
    'c3000000-0000-4000-8000-000000000105',
    'c3000000-0000-4000-8000-000000000001',
    'PGTAP_AUDIT_FAIL',
    'recon_ack_pgtap',
    'audit-fail',
    '{"amount_atomic":"7"}'::jsonb,
    '{"amount_atomic":"6"}'::jsonb,
    'OPEN',
    null,
    null,
    null
  ),
  (
    'c3000000-0000-4000-8000-000000000106',
    'c3000000-0000-4000-8000-000000000001',
    'PGTAP_LOCK',
    'recon_ack_pgtap',
    'lock',
    '{"amount_atomic":"4"}'::jsonb,
    '{"amount_atomic":"5"}'::jsonb,
    'OPEN',
    null,
    null,
    null
  );

select results_eq(
  $$
    select acl.grantee::regrole::text
    from pg_proc as proc
    cross join lateral aclexplode(proc.proacl) as acl
    where proc.oid = 'public.acknowledge_reconciliation_mismatch(uuid, uuid, text, text, uuid)'::regprocedure
      and acl.privilege_type = 'EXECUTE'
    order by 1
  $$,
  $$ values ('postgres'), ('service_role') $$,
  'execute stays with the function owner and service_role only'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.acknowledge_reconciliation_mismatch(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'anon cannot execute acknowledgement'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.acknowledge_reconciliation_mismatch(uuid, uuid, text, text, uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute acknowledgement'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.acknowledge_reconciliation_mismatch(uuid, uuid, text, text, uuid)'::regprocedure
  ),
  'acknowledgement command is SECURITY INVOKER'
);

select ok(
  (
    select proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'public.acknowledge_reconciliation_mismatch(uuid, uuid, text, text, uuid)'::regprocedure
  ),
  'acknowledgement command pins search_path to pg_catalog'
);

select ok(
  not (
    pg_get_functiondef(
      'public.acknowledge_reconciliation_mismatch(uuid, uuid, text, text, uuid)'::regprocedure
    ) ~* 'ledger_transactions|ledger_entries|wallet_ledger|wallet_accounts|wallet_balance_snapshots'
  ),
  'acknowledgement command does not reference ledger or wallet relations'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.reconciliation_mismatches'::regclass
  )
  and not exists (
    select 1
    from pg_policy
    where polrelid = 'public.reconciliation_mismatches'::regclass
  ),
  'reconciliation mismatch RLS stays deny-by-default without a new policy'
);

create temporary table recon_ack_money_fingerprint (
  captured_at text primary key,
  fingerprint text not null
);

insert into recon_ack_money_fingerprint (captured_at, fingerprint)
select
  'before',
  md5(concat_ws(
    '||',
    (
      select coalesce(string_agg(id::text || ':' || idempotency_key, '|' order by id), '')
      from public.ledger_transactions
    ),
    (
      select coalesce(string_agg(id::text || ':' || amount_atomic::text, '|' order by id), '')
      from public.ledger_entries
    ),
    (
      select coalesce(string_agg(id::text || ':' || code, '|' order by id), '')
      from public.ledger_accounts
    ),
    (
      select coalesce(string_agg(id::text || ':' || user_id::text, '|' order by id), '')
      from public.wallet_accounts
    ),
    (
      select coalesce(
        string_agg(id::text || ':' || amount_atomic::text || ':' || direction::text, '|' order by id),
        ''
      )
      from public.wallet_ledger
    ),
    (
      select coalesce(
        string_agg(
          wallet_account_id::text || ':' || balance_atomic || ':' || available_balance_atomic,
          '|' order by wallet_account_id
        ),
        ''
      )
      from public.wallet_balance_snapshots
    )
  ));

create temporary table recon_ack_result (
  payload jsonb
);

-- service_role 이 호출해도 상태와 성공 감사가 함께 남는지 확인한다.
do $$
declare
  v_payload jsonb;
  v_owner text := current_user;
begin
  execute 'set local role service_role';
  v_payload := public.acknowledge_reconciliation_mismatch(
    'c3000000-0000-4000-8000-000000000101'::uuid,
    'c3111111-1111-4111-8111-111111111111'::uuid,
    'ACCEPTED',
    '차이를 인정합니다. 원장 수리는 하지 않습니다.',
    'c3000000-0000-4000-8000-000000000201'::uuid
  );
  execute format('set local role %I', v_owner);
  insert into recon_ack_result (payload) values (v_payload);
end;
$$;

select is(
  (select payload->>'code' from recon_ack_result),
  'ACKNOWLEDGED',
  'service_role acknowledgement returns ACKNOWLEDGED'
);

select is(
  (
    select status
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000101'
  ),
  'ACCEPTED',
  'successful acknowledgement changes the mismatch status'
);

select is(
  (
    select count(*)
    from public.audit_logs
    where target_id = 'c3000000-0000-4000-8000-000000000101'
      and action = 'RECONCILIATION_EXCEPTION_ACK'
      and request_id = 'c3000000-0000-4000-8000-000000000201'
  ),
  1::bigint,
  'successful acknowledgement inserts one correlated success audit'
);

select is(
  (
    select expected_value
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000101'
  ),
  '{"amount_atomic":"5000"}'::jsonb,
  'acknowledgement does not change expected evidence'
);

select is(
  (
    select actual_value
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000101'
  ),
  '{"amount_atomic":"0"}'::jsonb,
  'acknowledgement does not change actual evidence'
);

insert into recon_ack_money_fingerprint (captured_at, fingerprint)
select
  'after',
  md5(concat_ws(
    '||',
    (
      select coalesce(string_agg(id::text || ':' || idempotency_key, '|' order by id), '')
      from public.ledger_transactions
    ),
    (
      select coalesce(string_agg(id::text || ':' || amount_atomic::text, '|' order by id), '')
      from public.ledger_entries
    ),
    (
      select coalesce(string_agg(id::text || ':' || code, '|' order by id), '')
      from public.ledger_accounts
    ),
    (
      select coalesce(string_agg(id::text || ':' || user_id::text, '|' order by id), '')
      from public.wallet_accounts
    ),
    (
      select coalesce(
        string_agg(id::text || ':' || amount_atomic::text || ':' || direction::text, '|' order by id),
        ''
      )
      from public.wallet_ledger
    ),
    (
      select coalesce(
        string_agg(
          wallet_account_id::text || ':' || balance_atomic || ':' || available_balance_atomic,
          '|' order by wallet_account_id
        ),
        ''
      )
      from public.wallet_balance_snapshots
    )
  ));

select ok(
  (
    select before_row.fingerprint = after_row.fingerprint
    from recon_ack_money_fingerprint as before_row
    cross join recon_ack_money_fingerprint as after_row
    where before_row.captured_at = 'before'
      and after_row.captured_at = 'after'
  ),
  'acknowledgement does not change ledger, wallet, or balance projection rows'
);

select is(
  (
    public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000102'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'INVESTIGATING',
      '먼저 조사 중으로 남깁니다. 숫자는 고치지 않습니다.',
      'c3000000-0000-4000-8000-000000000202'::uuid
    )
  )->>'status',
  'INVESTIGATING',
  'the first investigating claim is stored'
);

select throws_ok(
  $$
    select public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000102'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'INVESTIGATING',
      '나중 조사 요청은 사유를 덮어쓰지 않아야 합니다.',
      'c3000000-0000-4000-8000-000000000212'::uuid
    )
  $$,
  '55000',
  'ALREADY_INVESTIGATING',
  'a second investigating claim fails without taking over'
);

select is(
  (
    select resolution_reason
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000102'
  ),
  '먼저 조사 중으로 남깁니다. 숫자는 고치지 않습니다.',
  'investigating concurrency keeps the first reason'
);

select is(
  (
    public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000102'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'RESOLVED',
      '조사를 마칩니다. 원장 수리는 하지 않습니다.',
      'c3000000-0000-4000-8000-000000000222'::uuid
    )
  )->>'status',
  'RESOLVED',
  'investigating may still move to one terminal disposition'
);

select throws_ok(
  $$
    select public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000102'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'ACCEPTED',
      '나중 종료 확인은 기존 처분을 바꾸면 안 됩니다.',
      'c3000000-0000-4000-8000-000000000232'::uuid
    )
  $$,
  '55000',
  'STALE_OR_CLOSED',
  'a second terminal acknowledgement fails'
);

select is(
  (
    select resolution_reason
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000102'
  ),
  '조사를 마칩니다. 원장 수리는 하지 않습니다.',
  'the losing terminal acknowledgement does not overwrite the disposition'
);

select is(
  (
    select count(*)
    from public.audit_logs
    where target_id = 'c3000000-0000-4000-8000-000000000102'
      and action = 'RECONCILIATION_EXCEPTION_ACK'
  ),
  2::bigint,
  'only the investigating claim and the winning terminal ack are audited'
);

select throws_ok(
  $$
    select public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000103'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'ACCEPTED',
      '닫힌 예외를 다시 확인하려고 합니다.',
      'c3000000-0000-4000-8000-000000000203'::uuid
    )
  $$,
  '55000',
  'STALE_OR_CLOSED',
  'a stale or closed target fails'
);

select is(
  (
    select resolution_reason
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000103'
  ),
  '이미 닫힌 예외입니다. 다시 열지 않습니다.',
  'a closed target keeps its original disposition'
);

select is(
  (
    public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000104'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'ACCEPTED',
      '같은 요청의 첫 확인입니다. 원장은 그대로 둡니다.',
      'c3000000-0000-4000-8000-000000000204'::uuid
    )
  )->>'code',
  'ACKNOWLEDGED',
  'the first request is acknowledged once'
);

select is(
  (
    public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000104'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'INVESTIGATING',
      '같은 요청을 다른 결과로 다시 보내도 처분은 유지됩니다.',
      'c3000000-0000-4000-8000-000000000204'::uuid
    )
  )->>'code',
  'ACKNOWLEDGED_REPLAY',
  'the same request id replays without a new transition'
);

select is(
  (
    select status
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000104'
  ),
  'ACCEPTED',
  'a replay does not overwrite the terminal disposition'
);

select is(
  (
    select count(*)
    from public.audit_logs
    where target_id = 'c3000000-0000-4000-8000-000000000104'
      and action = 'RECONCILIATION_EXCEPTION_ACK'
  ),
  1::bigint,
  'a replay does not insert a second success audit'
);

-- 테스트 트랜잭션 안에서만 성공 감사 삽입을 실패시킨다.
create function public.recon_ack_test_fail_success_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'RECONCILIATION_EXCEPTION_ACK' then
    raise exception using errcode = 'P0001', message = 'FORCED_AUDIT_INSERT_FAILURE';
  end if;
  return new;
end;
$$;

create trigger recon_ack_test_fail_success_audit
before insert on public.audit_logs
for each row
execute function public.recon_ack_test_fail_success_audit();

select throws_ok(
  $$
    select public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000105'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'ACCEPTED',
      '감사 삽입이 실패하면 상태도 되돌려야 합니다.',
      'c3000000-0000-4000-8000-000000000205'::uuid
    )
  $$,
  'P0001',
  'AUDIT_WRITE_FAILED',
  'audit insert failure aborts the acknowledgement'
);

select ok(
  (
    select status = 'OPEN'
      and resolution_reason is null
      and resolved_at is null
      and resolved_by is null
    from public.reconciliation_mismatches
    where id = 'c3000000-0000-4000-8000-000000000105'
  ),
  'audit insert failure rolls back the mismatch update'
);

select is(
  (
    select count(*)
    from public.audit_logs
    where target_id = 'c3000000-0000-4000-8000-000000000105'
      and action = 'RECONCILIATION_EXCEPTION_ACK'
  ),
  0::bigint,
  'rolled back acknowledgement leaves no success audit'
);

drop trigger recon_ack_test_fail_success_audit on public.audit_logs;
drop function public.recon_ack_test_fail_success_audit();


select throws_ok(
  $$
    select public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000101'::uuid,
      'c3222222-2222-4222-8222-222222222222'::uuid,
      'ACCEPTED',
      '조회 역할은 예외를 확인하지 못합니다.',
      'c3000000-0000-4000-8000-000000000207'::uuid
    )
  $$,
  '42501',
  'ADMIN_ROLE_REQUIRED',
  'a viewer role cannot acknowledge a mismatch'
);

set local role authenticated;

select throws_ok(
  $$
    select public.acknowledge_reconciliation_mismatch(
      'c3000000-0000-4000-8000-000000000106'::uuid,
      'c3111111-1111-4111-8111-111111111111'::uuid,
      'ACCEPTED',
      '브라우저 역할은 이 명령을 실행하지 못합니다.',
      'c3000000-0000-4000-8000-000000000208'::uuid
    )
  $$,
  '42501',
  'permission denied for function acknowledge_reconciliation_mismatch',
  'authenticated browser role cannot execute the acknowledgement command'
);

reset role;

select * from finish();

rollback;
