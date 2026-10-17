-- Session-local helper for freshly created disposable PUTDUK PostgreSQL only.
-- Use the current TCP server address: loopback trust cannot authenticate non-superuser dblink.
-- Never resolve or probe historical Docker names or caller-selected hosts.
-- Each probe verifies the current cluster before any remote fixture can write.
create or replace function pg_temp.putduk_disposable_dblink_connection(
  p_failure_code text default 'LOCAL_DB_HOST_UNRESOLVED'
) returns text language plpgsql security invoker set search_path = pg_catalog
as $fn$
declare
  extension_schema text;
  server_address inet;
  connection text;
  local_cluster text;
  remote_cluster text;
  remote_database text;
  probe text := 'putduk_dblink_probe_' || pg_backend_pid()::text;
begin
  if p_failure_code not in ('LOCAL_DB_HOST_UNRESOLVED', 'PUTDUK_LOCAL_DB_HOST_UNRESOLVED') then
    raise exception 'LOCAL_DB_HOST_UNRESOLVED';
  end if;
  if current_user <> 'postgres' or current_database() <> 'postgres' then
    raise exception 'DISPOSABLE_DB_OWNER_REQUIRED';
  end if;
  select n.nspname into extension_schema from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
  if extension_schema is null then raise exception 'DBLINK_EXTENSION_MISSING'; end if;
  server_address := pg_catalog.inet_server_addr();
  if server_address is null or server_address <<= '127.0.0.0/8'::inet
    or server_address = '::1'::inet or server_address <<= '::ffff:7f00:0/104'::inet then
    raise exception 'EXACT_LOCAL_DB_TCP_SERVER_REQUIRED';
  end if;
  select system_identifier::text into local_cluster from pg_control_system();
  connection := format('host=%s port=%s dbname=%s user=postgres password=postgres connect_timeout=2',
    pg_catalog.host(server_address), current_setting('port'), current_database());
  begin
    execute format('select %I.dblink_connect(%L,%L)',extension_schema,probe,connection);
    execute format('select cluster,database from %I.dblink(%L,%L) as r(cluster text,database text)',
      extension_schema,probe,'select system_identifier::text,current_database() from pg_control_system()')
      into remote_cluster,remote_database;
    execute format('select %I.dblink_disconnect(%L)',extension_schema,probe);
  exception when others then
    begin execute format('select %I.dblink_disconnect(%L)',extension_schema,probe);
    exception when others then null; end;
    raise exception using message=p_failure_code;
  end;
  if remote_cluster is distinct from local_cluster or remote_database is distinct from current_database() then
    raise exception 'DISPOSABLE_DB_CLUSTER_IDENTITY_MISMATCH';
  end if;
  return connection;
end;
$fn$;
