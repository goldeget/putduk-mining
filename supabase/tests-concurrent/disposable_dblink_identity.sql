-- Run only in the root-owned fresh disposable PostgreSQL generation.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(5);
\ir resolve_disposable_dblink_host.inc
select lives_ok($$select pg_temp.putduk_disposable_dblink_connection()$$,
  'current-server TCP probe verifies an independent connection to this exact cluster');
select ok(pg_temp.putduk_disposable_dblink_connection() like
  'host=' || pg_catalog.host(inet_server_addr()) || ' port=' || current_setting('port') || ' dbname=' || current_database() || '%',
  'connection is pinned to the internal port and current database');
select set_config('putduk.qa_db_host','supabase_db_unrelated',true);
select ok(pg_temp.putduk_disposable_dblink_connection() like
  'host=' || pg_catalog.host(inet_server_addr()) || ' %',
  'caller-selected historical host cannot redirect the helper');
select throws_ok($$select pg_temp.putduk_disposable_dblink_connection('arbitrary')$$,
  'P0001','LOCAL_DB_HOST_UNRESOLVED','unsupported error-code override is rejected');
select is(pg_temp.putduk_disposable_dblink_connection('PUTDUK_LOCAL_DB_HOST_UNRESOLVED'),
  pg_temp.putduk_disposable_dblink_connection(),
  'both legacy failure labels preserve the exact same verified connection');
select * from finish();
rollback;
