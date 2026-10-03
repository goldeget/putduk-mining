import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertCiTestTarget,
  loadJobLocalAllowlist,
} from "./capture-local-supabase-env.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ORIGIN = "https://github.com/goldeget/putduk-mining.git";
const PREFIX = "PUTDUK_POLICY_READER_CONCURRENCY=";
const CASES = [
  "publish_commit",
  "reader_first",
  "publish_rollback",
  "repeatable_read",
  "serializable",
];

/** No local execution, remote target, container discovery or caller-selected target. */
export function assertConcurrencyScope({ env, origin, configText }) {
  if (
    env.CI !== "true" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
    env.GITHUB_JOB !== "database" ||
    origin.trim() !== ORIGIN
  )
    throw new Error("BLOCKED_TARGET_SCOPE: disposable database CI required");
  const target = loadJobLocalAllowlist(configText);
  for (const key of [
    "LOCAL_SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF",
  ]) {
    if (env[key] && env[key] !== target.projectId)
      throw new Error("BLOCKED_TARGET_SCOPE: local project mismatch");
  }
  assertCiTestTarget(env);
  return Object.freeze({
    container: `supabase_db_${target.projectId}`,
    projectId: target.projectId,
    projectRef: "osrmyjgmpdspdcwqjwuv",
    dbPort: target.dbPort,
  });
}

export function assertContainerMetadata(text, target) {
  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch {
    throw new Error("BLOCKED_TARGET_SCOPE: container metadata invalid");
  }
  if (
    !metadata ||
    metadata.name !== `/${target.container}` ||
    metadata.project !== target.projectId
  )
    throw new Error(
      "BLOCKED_TARGET_SCOPE: container project metadata mismatch",
    );
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** The only persistent fixture uses the existing real administrator lifecycle. */
export function buildConcurrencySql({
  container,
  runId,
  seedDigest,
  approvalDigest,
}) {
  if (
    !/^supabase_db_putduk-mining(?:-[a-z0-9-]+)?$/.test(container) ||
    !/^[a-f0-9]{32}$/.test(runId) ||
    !/^[a-f0-9]{64}$/.test(seedDigest) ||
    !/^[a-f0-9]{64}$/.test(approvalDigest)
  )
    throw new Error("BLOCKED_TARGET_SCOPE: SQL identity invalid");
  const app = `putduk-policy-${runId}`;
  return `\\set ON_ERROR_STOP on
set statement_timeout = '70000ms';
set lock_timeout = '10000ms';
set application_name = ${literal(`${app}-controller`)};
begin;
create extension if not exists dblink with schema extensions;
create temporary table policy_probe_receipt(value jsonb);
create function pg_temp.remote_json(c text, q text) returns jsonb language plpgsql as $helper$
declare s text; r text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
  execute format('select r from %I.dblink(%L,%L) as t(r text)',s,c,q) into r;
  return r::jsonb;
end; $helper$;
create function pg_temp.remote_exec(c text, q text) returns void language plpgsql as $helper$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
  execute format('select %I.dblink_exec(%L,%L)',s,c,q);
end; $helper$;
create function pg_temp.waiter(w integer,h integer,m text) returns void language plpgsql as $helper$
declare deadline timestamptz := clock_timestamp()+interval '8 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_locks a join pg_locks b on b.classid=a.classid and b.objid=a.objid
      and b.objsubid=a.objsubid join pg_stat_activity activity on activity.pid=a.pid
      where a.pid=w and b.pid=h and a.locktype='advisory' and b.locktype='advisory'
      and not a.granted and b.granted and a.mode=m and h=any(pg_blocking_pids(w))
      and activity.wait_event_type='Lock' and activity.wait_event='advisory') then return; end if;
    if clock_timestamp()>deadline then raise exception 'POLICY_ACTUAL_ADVISORY_WAITER_MISSING'; end if;
    perform pg_sleep(0.01); -- Polls an actual owned waiter; elapsed time is never success evidence.
  end loop;
end; $helper$;
create function pg_temp.clock_reached(t bigint) returns void language plpgsql as $helper$
declare deadline timestamptz := clock_timestamp()+interval '7 seconds';
begin
  while (extract(epoch from clock_timestamp())*1000000)::bigint<t loop
    if clock_timestamp()>deadline then raise exception 'POLICY_EFFECTIVE_CLOCK_TIMEOUT'; end if;
    perform pg_sleep(0.01); -- A future canonical publication must reach the real DB clock.
  end loop;
end; $helper$;
create function pg_temp.async_result(c text) returns jsonb language plpgsql as $helper$
declare s text; busy integer; r text; deadline timestamptz := clock_timestamp()+interval '10 seconds';
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
  loop
    execute format('select %I.dblink_is_busy(%L)',s,c) into busy;
    exit when busy=0;
    if clock_timestamp()>deadline then raise exception 'POLICY_ASYNC_RESULT_TIMEOUT'; end if;
    perform pg_sleep(0.01);
  end loop;
  execute format('select r from %I.dblink_get_result(%L) as t(r text)',s,c) into r;
  -- Consume the terminal empty result before another query on this exact connection.
  execute format('select r from %I.dblink_get_result(%L) as t(r text)',s,c);
  return r::jsonb;
end; $helper$;
do $probe$
declare
  s text; publisher text := ${literal(`${app}-publisher`)}; reader text := ${literal(`${app}-reader`)};
  conn text; pp integer; rp integer; seed bigint; event bigint; cluster text;
  before_read jsonb; observed jsonb; outcome jsonb; future jsonb; proof jsonb;
  evidence jsonb := '[]'::jsonb; money jsonb; baseline jsonb; iso text; phase text; c text;
begin
  if current_database()<>'postgres' then raise exception 'POLICY_DATABASE_SCOPE_MISMATCH'; end if;
  if not exists(select 1 from pg_proc p where p.oid='public.read_effective_economy_policy(bigint)'::regprocedure
    and not p.prosecdef and p.provolatile='v' and 'search_path=pg_catalog'=any(p.proconfig))
    or not has_function_privilege('service_role','public.read_effective_economy_policy(bigint)','EXECUTE')
    or has_function_privilege('anon','public.read_effective_economy_policy(bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.read_effective_economy_policy(bigint)','EXECUTE')
    then raise exception 'POLICY_READER_FUNCTION_METADATA_MISMATCH'; end if;
  if not exists(select 1 from pg_proc p
      where p.oid='public.manage_economy_policy_version(text,text,text,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)'::regprocedure
        and not p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig))
    or not exists(select 1 from pg_proc p where p.oid='public.issue_admin_step_up(uuid,uuid,text,text,integer)'::regprocedure
        and not p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig))
    then raise exception 'POLICY_PUBLISHER_FUNCTION_METADATA_MISMATCH'; end if;
  select (extract(epoch from p.effective_from)*1000000)::bigint into seed
    from app_private.economy_policy_published p join app_private.economy_policy_versions v on v.id=p.policy_id
    where v.is_reference and v.manifest_digest=${literal(seedDigest)} and v.approval_evidence_digest=${literal(approvalDigest)};
  if seed is null then raise exception 'POLICY_APPROVED_SEED_MISMATCH'; end if;
  select jsonb_build_array((select count(*) from public.ledger_transactions),(select count(*) from public.ledger_entries),
    (select count(*) from public.wallet_ledger),(select count(*) from public.money_source_movements)) into money;
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
  select system_identifier::text into cluster from pg_control_system();
  foreach c in array array[publisher,reader] loop
    conn:=format('host=%s dbname=postgres user=postgres password=postgres connect_timeout=2 application_name=%s',${literal(container)},c);
    execute format('select %I.dblink_connect(%L,%L)',s,c,conn);
    proof:=pg_temp.remote_json(c,'select jsonb_build_object(''database'',current_database(),''cluster'',system_identifier::text)::text from pg_control_system()');
    if proof->>'database'<>'postgres' or proof->>'cluster' is distinct from cluster
      then raise exception 'POLICY_CONNECTION_DATABASE_IDENTITY_MISMATCH'; end if;
    perform pg_temp.remote_exec(c,'set statement_timeout=15000; set lock_timeout=10000; set default_transaction_isolation=''read committed''; set time zone ''UTC''');
  end loop;
  pp:=(pg_temp.remote_json(publisher,'select to_jsonb(pg_backend_pid())::text'))::text::integer;
  rp:=(pg_temp.remote_json(reader,'select to_jsonb(pg_backend_pid())::text'))::text::integer;
  if pp=rp or pp=pg_backend_pid() or rp=pg_backend_pid() then raise exception 'POLICY_INDEPENDENT_CONNECTIONS_REQUIRED'; end if;
  perform pg_temp.remote_exec(publisher,$fixture$
    create temporary table policy_probe_context(actor uuid,session uuid,version text,start_at timestamptz,draft jsonb,preview jsonb,approval jsonb);
    insert into policy_probe_context(actor,session) values(gen_random_uuid(),gen_random_uuid());
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
      created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
      select actor,'authenticated','authenticated','policy-concurrency-'||actor::text||'@putduk.test','',clock_timestamp(),
        '{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp(),'','','','' from policy_probe_context;
    insert into public.user_roles(user_id,role,granted_by) select actor,'ADMIN',actor from policy_probe_context;
    insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
      select session,actor,'policy-concurrency-'||session::text,'policy-concurrency-'||session::text,
        clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours' from policy_probe_context;
    grant select,update on policy_probe_context to service_role;
    do $grant$ begin execute format('grant usage on schema %I to service_role',
      (select nspname from pg_namespace where oid=pg_my_temp_schema())); end; $grant$;
    create function pg_temp.policy_command(operation text) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $command$
    declare ctx record; token text:=gen_random_uuid()::text; manifest text; result jsonb; prior uuid;
    begin
      select * into ctx from pg_temp.policy_probe_context;
      perform public.issue_admin_step_up(ctx.session,ctx.actor,'ECONOMY_POLICY',token,600);
      if operation='CREATE' then
        select jsonb_set(config,'{policyVersion}',to_jsonb(ctx.version))::text into manifest
          from app_private.economy_policy_versions where is_reference;
      elsif operation='PREVIEW' then prior:=(ctx.draft->>'revisionId')::uuid;
      elsif operation='APPROVE' then prior:=(ctx.preview->>'revisionId')::uuid;
      else prior:=(ctx.approval->>'revisionId')::uuid; end if;
      result:=public.manage_economy_policy_version(operation,ctx.version,manifest,prior,
        case when operation='CREATE' then null else ctx.draft->>'configDigest' end,
        case when operation='CREATE' then null else ctx.start_at end,
        ctx.actor,ctx.session,'policy-concurrency-'||ctx.session::text,'aal2',token,
        'Disposable CI policy reader contention proof','policy-concurrency:'||ctx.version||':'||operation);
      return result;
    end; $command$;
    grant execute on function pg_temp.policy_command(text) to service_role;
    set role service_role;
  $fixture$);
  perform pg_temp.remote_exec(reader,$fixture$
    create function pg_temp.capture_policy_error(t bigint) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $error$
    begin
      perform public.read_effective_economy_policy(t);
      return jsonb_build_object('state','SUCCESS');
    exception when others then return jsonb_build_object('state',sqlstate,'message',sqlerrm); end; $error$;
    do $grant$ begin execute format('grant usage on schema %I to service_role',
      (select nspname from pg_namespace where oid=pg_my_temp_schema())); end; $grant$;
    grant execute on function pg_temp.capture_policy_error(bigint) to service_role;
    set role service_role;
  $fixture$);

  foreach phase in array array['publish_commit','reader_first','publish_rollback'] loop
    perform pg_temp.remote_exec(publisher,format($prepare$
      update pg_temp.policy_probe_context set version=%L,
        start_at=greatest(clock_timestamp()+interval '5 seconds',
          (select max(effective_from)+interval '1 microsecond' from app_private.economy_policy_publications));
      update pg_temp.policy_probe_context set draft=pg_temp.policy_command('CREATE');
      update pg_temp.policy_probe_context set preview=pg_temp.policy_command('PREVIEW');
      update pg_temp.policy_probe_context set approval=pg_temp.policy_command('APPROVE');
    $prepare$, ${literal(`PUTDUK-READER-CI-${runId.toUpperCase()}`)}||'-'||upper(phase)));
    future:=pg_temp.remote_json(publisher,$future$
      select jsonb_build_object('at',(extract(epoch from start_at)*1000000)::bigint::text,
        'policyId',draft->>'policyId','revision',approval->>'revisionId')::text from pg_temp.policy_probe_context
    $future$);
    event:=(future->>'at')::bigint;
    before_read:=pg_temp.remote_json(reader,'select public.read_effective_economy_policy((extract(epoch from clock_timestamp())*1000000)::bigint)::text');
    if phase='reader_first' then
      perform pg_temp.remote_exec(reader,'begin');
      observed:=pg_temp.remote_json(reader,format('select public.read_effective_economy_policy(%s)::text',seed));
      perform pg_temp.remote_exec(publisher,'begin');
      execute format('select %I.dblink_send_query(%L,%L)',s,publisher,'select pg_temp.policy_command(''PUBLISH'')::text');
      perform pg_temp.waiter(pp,rp,'ExclusiveLock');
      proof:=pg_temp.remote_json(reader,format('select public.read_effective_economy_policy(%s)::text',seed));
      if proof->'policy' is distinct from observed->'policy' then raise exception 'POLICY_UNCOMMITTED_PUBLISH_VISIBLE'; end if;
      perform pg_temp.remote_exec(reader,'commit');
      outcome:=pg_temp.async_result(publisher);
      perform pg_temp.remote_exec(publisher,'commit');
      perform pg_temp.clock_reached(event);
      observed:=pg_temp.remote_json(reader,format('select public.read_effective_economy_policy(%s)::text',event));
    else
      baseline:=pg_temp.remote_json(publisher,$counts$
        select jsonb_build_array((select count(*) from app_private.economy_policy_publications),
          (select count(*) from app_private.economy_policy_receipts),(select count(*) from public.audit_logs),
          (select count(*) from public.outbox_events),(select count(*) from public.admin_step_up_grants),
          (select count(*) from app_private.idempotency_keys),(select count(*) from public.security_events),
          (select to_jsonb(session) from public.admin_sessions session
            where session.id=(select context.session from pg_temp.policy_probe_context context)))::text
      $counts$);
      perform pg_temp.remote_exec(publisher,'begin');
      outcome:=pg_temp.remote_json(publisher,'select pg_temp.policy_command(''PUBLISH'')::text');
      execute format('select %I.dblink_send_query(%L,%L)',s,reader,
        format('select public.read_effective_economy_policy(%s)::text',event));
      perform pg_temp.waiter(rp,pp,'ShareLock');
      perform pg_temp.clock_reached(event);
      perform pg_temp.remote_exec(publisher,case when phase='publish_rollback' then 'rollback' else 'commit' end);
      observed:=pg_temp.async_result(reader);
      if phase='publish_rollback' then
        proof:=pg_temp.remote_json(publisher,$counts$
          select jsonb_build_array((select count(*) from app_private.economy_policy_publications),
            (select count(*) from app_private.economy_policy_receipts),(select count(*) from public.audit_logs),
            (select count(*) from public.outbox_events),(select count(*) from public.admin_step_up_grants),
            (select count(*) from app_private.idempotency_keys),(select count(*) from public.security_events),
            (select to_jsonb(session) from public.admin_sessions session
              where session.id=(select context.session from pg_temp.policy_probe_context context)))::text
        $counts$);
        if proof is distinct from baseline or observed->'policy' is distinct from before_read->'policy'
          then raise exception 'POLICY_ROLLBACK_RECEIPT_LEAK'; end if;
      end if;
    end if;
    if observed->>'effectiveAtMicroseconds' is distinct from event::text
      or observed->>'policyReceiptComplete' is distinct from 'true'
      then raise exception 'POLICY_READER_ENVELOPE_MISMATCH'; end if;
    if phase<>'publish_rollback' and (observed->'policy'->>'policyId' is distinct from future->>'policyId'
      or observed->'policy'->>'revisionId' is distinct from outcome->>'revisionId'
      or observed->'policy'->>'effectiveFromMicroseconds' is distinct from future->>'at'
      or observed->'policy'->>'effectiveUntilMicroseconds' is not null) then raise exception 'POLICY_COMMITTED_SUCCESSOR_NOT_VISIBLE'; end if;
    if phase<>'publish_rollback' then
      proof:=pg_temp.remote_json(reader,format('select public.read_effective_economy_policy(%s)::text',event-1));
      if proof->'policy'->>'policyId' is distinct from before_read->'policy'->>'policyId'
        or proof->'policy'->>'effectiveUntilMicroseconds' is distinct from event::text
        then raise exception 'POLICY_HALF_OPEN_PREDECESSOR_MISMATCH'; end if;
    end if;
    if (observed->>'readAtMicroseconds')::bigint<event then raise exception 'POLICY_CLOCK_NOT_SAMPLED_AFTER_WAIT'; end if;
    proof:=pg_temp.remote_json(reader,format('select public.read_effective_economy_policy(%s)::text',event));
    if proof->'policy' is distinct from observed->'policy' then raise exception 'POLICY_FRESH_REPEAT_READ_MISMATCH'; end if;
    evidence:=evidence||jsonb_build_array(jsonb_build_object('case',phase,'waiterObserved',true,
      'readerPid',rp,'publisherPid',pp,'policyId',observed->'policy'->>'policyId',
      'publicationId',observed->'policy'->>'publicationId','effectiveAtMicroseconds',event::text,
      'intervalMatched',true,'rollbackReceiptsMatched',phase='publish_rollback','repeatedReadMatched',true));
  end loop;
  foreach iso in array array['repeatable read','serializable'] loop
    perform pg_temp.remote_exec(reader,'begin isolation level '||iso);
    -- Establish an actual snapshot before calling the guarded volatile RPC.
    proof:=pg_temp.remote_json(reader,'select to_jsonb(count(*))::text from app_private.economy_policy_publications');
    observed:=pg_temp.remote_json(reader,format('select pg_temp.capture_policy_error(%s)::text',seed));
    if observed->>'state'<>'25000' or observed->>'message'<>'ECONOMY_POLICY_FRESH_SNAPSHOT_REQUIRED'
      then raise exception 'POLICY_STALE_ISOLATION_NOT_REJECTED'; end if;
    perform pg_temp.remote_exec(reader,'rollback');
    evidence:=evidence||jsonb_build_array(jsonb_build_object('case',replace(iso,' ','_'),'sqlstate','25000',
      'message',observed->>'message','readerPid',rp));
  end loop;
  select jsonb_build_array((select count(*) from public.ledger_transactions),(select count(*) from public.ledger_entries),
    (select count(*) from public.wallet_ledger),(select count(*) from public.money_source_movements)) into baseline;
  if baseline is distinct from money then raise exception 'POLICY_PROBE_MONEY_WRITE'; end if;
  if exists(select 1 from public.outbox_events where event_type='ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (available_at<>'infinity'::timestamptz or status<>'PENDING' or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED'))
    then raise exception 'POLICY_PROBE_CONSUMER_ACTIVATED'; end if;
  foreach c in array array[publisher,reader] loop execute format('select %I.dblink_disconnect(%L)',s,c); end loop;
  insert into policy_probe_receipt values(jsonb_build_object('cases',evidence,'moneyUnchanged',true,'policyEventsHeld',true));
exception when others then
  -- Only this run's named connections. Closing them rolls back unfinished writes.
  foreach c in array array[publisher,reader] loop
    begin execute format('select %I.dblink_disconnect(%L)',s,c); exception when others then null; end;
  end loop;
  raise;
end; $probe$;
select '${PREFIX}'||value::text from policy_probe_receipt;
rollback;
`;
}

export function verifyConcurrencyOutput(text) {
  const reports = String(text)
    .split(/\r?\n/)
    .filter((line) => line.includes(PREFIX));
  if (reports.length !== 1)
    throw new Error("POLICY_CONCURRENCY_EVIDENCE_MISSING");
  let value;
  try {
    value = JSON.parse(reports[0].split(PREFIX)[1]);
  } catch {
    throw new Error("POLICY_CONCURRENCY_EVIDENCE_INVALID");
  }
  if (
    !value ||
    typeof value !== "object" ||
    value.moneyUnchanged !== true ||
    value.policyEventsHeld !== true ||
    !Array.isArray(value.cases) ||
    value.cases.length !== CASES.length ||
    !CASES.every((name, index) => value.cases[index]?.case === name)
  )
    throw new Error("POLICY_CONCURRENCY_EVIDENCE_INCOMPLETE");
  for (const item of value.cases) {
    if (!Number.isSafeInteger(item.readerPid) || item.readerPid <= 0)
      throw new Error("POLICY_CONCURRENCY_CONNECTION_INVALID");
    if (item.case.includes("publish") || item.case === "reader_first") {
      if (
        item.waiterObserved !== true ||
        item.repeatedReadMatched !== true ||
        item.intervalMatched !== true ||
        (item.case === "publish_rollback" &&
          item.rollbackReceiptsMatched !== true) ||
        !Number.isSafeInteger(item.publisherPid) ||
        item.publisherPid <= 0 ||
        item.publisherPid === item.readerPid ||
        !/^[a-f0-9-]{36}$/.test(item.policyId ?? "") ||
        !/^[a-f0-9-]{36}$/.test(item.publicationId ?? "") ||
        !/^(0|[1-9][0-9]*)$/.test(item.effectiveAtMicroseconds ?? "")
      )
        throw new Error("POLICY_CONCURRENCY_WAITER_EVIDENCE_INVALID");
    } else if (
      item.sqlstate !== "25000" ||
      item.message !== "ECONOMY_POLICY_FRESH_SNAPSHOT_REQUIRED"
    )
      throw new Error("POLICY_CONCURRENCY_ISOLATION_EVIDENCE_INVALID");
  }
  return value;
}

export function runConcurrencyProbe({
  env = process.env,
  execute = execFileSync,
} = {}) {
  if (
    !env.GITHUB_WORKSPACE ||
    realpathSync(env.GITHUB_WORKSPACE) !== realpathSync(ROOT) ||
    realpathSync(process.cwd()) !== realpathSync(ROOT)
  )
    throw new Error("BLOCKED_TARGET_SCOPE: exact checkout required");
  // Resolve this checkout and exact project metadata before any Docker execution.
  let origin;
  try {
    origin = execute("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("BLOCKED_TARGET_SCOPE: authorized origin unavailable");
  }
  const target = assertConcurrencyScope({
    env,
    origin,
    configText: readFileSync(
      new URL("../supabase/config.toml", import.meta.url),
      "utf8",
    ),
  });
  let metadata;
  try {
    metadata = execute(
      "docker",
      [
        "inspect",
        "--type",
        "container",
        "--format",
        '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}}}',
        target.container,
      ],
      {
        cwd: ROOT,
        env,
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error("BLOCKED_TARGET_SCOPE: container metadata unavailable");
  }
  assertContainerMetadata(metadata, target);
  const runId = randomUUID().replaceAll("-", "");
  const app = `putduk-policy-${runId}`;
  const hash = (path) =>
    createHash("sha256")
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest("hex");
  const sql = buildConcurrencySql({
    ...target,
    runId,
    seedDigest: hash("../docs/product/economy-v1-approved-2026-10-03.json"),
    approvalDigest: hash(
      "../docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md",
    ),
  });
  const args = [
    "exec",
    "-i",
    target.container,
    "psql",
    "-X",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-A",
    "-t",
    "-f",
    "-",
  ];
  const options = {
    cwd: ROOT,
    env,
    encoding: "utf8",
    input: sql,
    timeout: 85000,
    killSignal: "SIGTERM",
    maxBuffer: 1048576,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  };
  let result;
  let failed = false;
  try {
    result = execute("docker", args, options);
    return verifyConcurrencyOutput(result);
  } catch (error) {
    failed = true;
    const diagnostic =
      String(error.stderr ?? error.message).match(
        /\b(?:ECONOMY_POLICY|POLICY)_[A-Z_]+\b/,
      )?.[0] ?? "SQL_OR_TIMEOUT";
    throw new Error(`POLICY_CONCURRENCY_PROBE_FAILED:${diagnostic}`);
  } finally {
    try {
      execute("docker", args, {
        ...options,
        timeout: 5000,
        input: `select pg_terminate_backend(pid) from pg_stat_activity where pid<>pg_backend_pid() and datname='postgres' and application_name in (${["controller", "publisher", "reader"].map((name) => literal(`${app}-${name}`)).join(",")});\n`,
      });
    } catch {
      if (!failed) throw new Error("POLICY_CONCURRENCY_CLEANUP_FAILED");
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(runConcurrencyProbe()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
