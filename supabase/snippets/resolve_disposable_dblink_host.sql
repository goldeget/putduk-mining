-- 일회용 로컬 DB의 dblink 호스트를 이 세션의 서버 주소로 고정한다.
-- 과거 분리 스택 컨테이너 이름을 먼저 probe 하면
-- CI에서 LOCAL_DB_HOST_UNRESOLVED 가 나고 이후 금융 동시성 검사가 생략된다.
-- inet_server_addr() 가 없을 때만 putduk.qa_db_host 를 보고,
-- 그 값은 이 프로젝트 컨테이너 이름 패턴만 허용한다.

create or replace function pg_temp.putduk_disposable_dblink_host(
  p_failure_code text default 'LOCAL_DB_HOST_UNRESOLVED'
) returns text
language plpgsql
as $fn$
declare
  v_schema text;
  v_server inet;
  v_candidate text;
  v_conn text;
begin
  if p_failure_code not in (
    'LOCAL_DB_HOST_UNRESOLVED',
    'PUTDUK_LOCAL_DB_HOST_UNRESOLVED'
  ) then
    raise exception using message = 'LOCAL_DB_HOST_UNRESOLVED';
  end if;

  select namespace.nspname into v_schema
  from pg_extension as extension
  join pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'dblink';

  if v_schema is null then
    raise exception using message = 'DBLINK_EXTENSION_MISSING';
  end if;

  v_server := pg_catalog.inet_server_addr();
  v_candidate := coalesce(
    pg_catalog.host(v_server),
    pg_catalog.current_setting('putduk.qa_db_host', true)
  );

  if v_candidate is null
     or (
       v_server is null
       and v_candidate !~ '^supabase_db_putduk-mining[-a-z0-9]*$'
     )
     or v_candidate ~ '[\s''"\\]'
  then
    raise exception using message = 'EXACT_LOCAL_DB_HOST_REQUIRED';
  end if;

  v_conn := format(
    'host=%s dbname=postgres user=postgres password=postgres',
    v_candidate
  );

  begin
    execute format(
      'select %I.dblink_connect(%L, %L)',
      v_schema,
      'putduk_dblink_host_probe',
      v_conn
    );
    execute format(
      'select %I.dblink_disconnect(%L)',
      v_schema,
      'putduk_dblink_host_probe'
    );
  exception
    when others then
      begin
        execute format(
          'select %I.dblink_disconnect(%L)',
          v_schema,
          'putduk_dblink_host_probe'
        );
      exception
        when others then
          null;
      end;
      raise exception using message = p_failure_code;
  end;

  return v_candidate;
end;
$fn$;
