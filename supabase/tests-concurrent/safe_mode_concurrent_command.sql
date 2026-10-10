begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
do $$ begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    create extension dblink with schema extensions;
  end if;
end; $$;
create temporary table safe_conc_context (host text, blocked_sessions integer);
create temporary table safe_conc_outcome (session_name text primary key, receipt text);

-- 새로 reset 한 이 프로젝트 DB만 사용한다. 공유 이력은 지우지 않는다.
\ir ../snippets/resolve_disposable_dblink_host.sql

do $test$
declare
  v_schema text;
  v_host text;
  v_conn text;
  v_name text;
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
  v_host := pg_temp.putduk_disposable_dblink_host('PUTDUK_LOCAL_DB_HOST_UNRESOLVED');
  v_conn := format(
    'host=%s dbname=postgres user=postgres password=postgres connect_timeout=2',
    v_host
  );
  insert into safe_conc_context (host) values (v_host);
  execute format(
    'select %I.dblink_connect(%L, %L)',
    v_schema,
    'safe_conc_setup',
    v_conn
  );
  execute format('select %I.dblink_exec(%L, %L)', v_schema, 'safe_conc_setup', $setup$
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('0d460000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated',
      'safe-mode-concurrent-admin@putduk.test', '', statement_timestamp(),
      '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', '');
    insert into public.user_roles (user_id, role, granted_by)
    values ('0d460000-0000-4000-8000-0000000000f1', 'ADMIN', '0d460000-0000-4000-8000-0000000000f1');
    insert into public.safe_mode_controls (id, component, is_paused, reason, changed_by, request_id)
    values ('0d460000-0000-4000-8000-00000000f001', 'AI', false,
      'initial concurrent test state', '0d460000-0000-4000-8000-0000000000f1',
      '0d460000-0000-4000-8000-00000000f002');
  $setup$);
  execute format('select %I.dblink_disconnect(%L)', v_schema, 'safe_conc_setup');

  execute format('select %I.dblink_connect(%L, %L)', v_schema, 'safe_conc_holder', v_conn);
  execute format('select %I.dblink_exec(%L, %L)', v_schema, 'safe_conc_holder', 'begin');
  execute format('select result from %I.dblink(%L, %L) as t(result text)',
    v_schema, 'safe_conc_holder', $lock$
      select id::text from public.safe_mode_controls
      where id = '0d460000-0000-4000-8000-00000000f001' for update
    $lock$) into v_result;
  if v_result is distinct from '0d460000-0000-4000-8000-00000000f001' then
    raise exception 'SAFE_MODE_CONCURRENT_FIXTURE_NOT_LOCKED';
  end if;
  foreach v_name in array array['a', 'b'] loop
    execute format('select %I.dblink_connect(%L, %L)', v_schema, 'safe_conc_' || v_name, v_conn);
    execute format('select %I.dblink_exec(%L, %L)', v_schema, 'safe_conc_' || v_name,
      'set statement_timeout = 15000');
    execute format('select %I.dblink_exec(%L, %L)', v_schema, 'safe_conc_' || v_name,
      'set lock_timeout = 10000');
    execute format('select %I.dblink_exec(%L, %L)', v_schema, 'safe_conc_' || v_name,
      'set role service_role');
    execute format('select result from %I.dblink(%L, %L) as t(result text)',
      v_schema, 'safe_conc_' || v_name, 'select pg_backend_pid()::text') into v_result;
    if v_name = 'a' then v_pid_a := v_result::integer; else v_pid_b := v_result::integer; end if;
    execute format('select %I.dblink_send_query(%L, %L)', v_schema, 'safe_conc_' || v_name, $command$
      insert into public.audit_logs (actor_user_id, actor_role, action, target_type,
        target_id, reason, request_id, metadata)
      values ('0d460000-0000-4000-8000-0000000000f1', 'ADMIN', 'SAFE_MODE_ENABLED',
        'SAFE_MODE', 'AI', 'concurrent reviewed safe mode', gen_random_uuid(),
        jsonb_build_object('command_version', 1, 'idempotency_key', 'safe-mode-concurrent-key',
          'component', 'AI', 'is_paused', true, 'review_at', null,
          'expected_request_id', '0d460000-0000-4000-8000-00000000f002'))
      returning id::text
    $command$);
  end loop;
  for v_ticks in 1..100 loop
    select count(distinct pid)::integer into v_blocked from pg_locks
    where pid = any (array[v_pid_a, v_pid_b]) and not granted;
    exit when v_blocked = 2;
    perform pg_sleep(0.05);
  end loop;
  update safe_conc_context set blocked_sessions = v_blocked;
  if v_blocked <> 2 then raise exception 'SAFE_MODE_CONCURRENT_CONTENTION_MISSING'; end if;
  execute format('select %I.dblink_exec(%L, %L)', v_schema, 'safe_conc_holder', 'commit');
  execute format('select %I.dblink_disconnect(%L)', v_schema, 'safe_conc_holder');
  for v_ticks in 1..200 loop
    v_busy := 0;
    foreach v_name in array array['a', 'b'] loop
      execute format('select %I.dblink_is_busy(%L)', v_schema, 'safe_conc_' || v_name) into v_result;
      v_busy := v_busy + v_result::integer;
    end loop;
    exit when v_busy = 0;
    perform pg_sleep(0.05);
  end loop;
  if v_busy <> 0 then raise exception 'SAFE_MODE_CONCURRENT_COMMAND_TIMEOUT'; end if;
  foreach v_name in array array['a', 'b'] loop
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',
      v_schema, 'safe_conc_' || v_name) into v_result;
    execute format('select result from %I.dblink_get_result(%L) as t(result text)',
      v_schema, 'safe_conc_' || v_name) into v_result;
    -- A fresh read after completing the command sees the original receipt in
    -- both sessions; an INSERT statement's earlier snapshot is not reused.
    execute format('select result from %I.dblink(%L, %L) as t(result text)',
      v_schema, 'safe_conc_' || v_name, $receipt$
        select id::text from public.audit_logs where target_type = 'SAFE_MODE'
          and metadata->>'idempotency_key' = 'safe-mode-concurrent-key'
      $receipt$) into v_result;
    insert into safe_conc_outcome values (v_name, v_result);
    execute format('select %I.dblink_disconnect(%L)', v_schema, 'safe_conc_' || v_name);
  end loop;
end;
$test$;

select is((select blocked_sessions from safe_conc_context), 2,
  'two actual independent service-role sessions waited before the control lock was released');
select ok((select receipt from safe_conc_outcome where session_name = 'a') is not null
  and (select receipt from safe_conc_outcome where session_name = 'a')
    = (select receipt from safe_conc_outcome where session_name = 'b'),
  'both sessions read the same immutable command receipt');
select is((select count(*)::integer from public.audit_logs where
  metadata->>'idempotency_key' = 'safe-mode-concurrent-key'), 1, 'one concurrent command has one audit');
select is((select count(*)::integer from public.outbox_events where
  idempotency_key = 'safe-mode:safe-mode-concurrent-key'), 1, 'one concurrent command has one event');
select ok((select is_paused and request_id = (select request_id from public.audit_logs
  where metadata->>'idempotency_key' = 'safe-mode-concurrent-key')
  from public.safe_mode_controls where component = 'AI'), 'actual pause and audit share the committed request');
select is((select count(*)::integer from app_private.idempotency_keys where
  scope = 'safe_mode.control' and idempotency_key = 'safe-mode-concurrent-key' and status = 'COMPLETED'),
  1, 'one logical key completes despite concurrent submission');
select * from finish();
rollback;
