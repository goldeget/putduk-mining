"""Committed synthetic concurrency test; run only in this task's disposable DB.

Requires APP_ENV=test and an exact local or approved GitHub database-job context.
Does not clean, reset, deploy, fetch, or contact production.
The CREDIT fixture is owner-sealed synthetic evidence, not a real earned worker.
Run after rollback-based DB suites: committed fixtures remain for inspection.
"""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import threading
import time
import tomllib
import uuid


ROOT = Path(__file__).resolve().parents[2]
AUTHORIZED_ROOT = Path(
    r"C:\Users\PC\Desktop\putduk-mining\.worktrees\backend-engine-patch-20261011"
)
PROJECT = None
CONTAINER = None
MIGRATION = "20261010233034"
FIXTURE = ROOT / "supabase/tests/database/krw_deposit_journal_integrity.sql"
ASSERTIONS = []


def require(condition, name):
    ASSERTIONS.append({"name": name, "passed": bool(condition)})
    if not condition:
        raise RuntimeError(name)


def command(args, timeout=45):
    return subprocess.run(
        args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout, check=False,
    )


def sql(source, must_succeed=True):
    if CONTAINER is None:
        raise RuntimeError("DISPOSABLE_CONTAINER_NOT_VALIDATED")
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-A", "-t",
         "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        cwd=ROOT, input="SET statement_timeout='20s'; SET lock_timeout='12s';\n" + source,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=40, check=False,
    )
    if must_succeed and result.returncode != 0:
        # Never print SQL, statement context, user fields, or credentials.
        raise RuntimeError("DISPOSABLE_SQL_FAILED")
    return result


def scalar(source):
    lines = [line.strip() for line in sql(source).stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("DISPOSABLE_QUERY_EMPTY")
    return lines[-1]


def guard():
    global PROJECT, CONTAINER
    require(os.environ.get("APP_ENV") == "test", "APP_ENV_TEST_REQUIRED")
    if sys.platform == "win32":
        require(not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS")
                and not os.environ.get("GITHUB_JOB"),
                "LOCAL_CI_SPOOF_FORBIDDEN")
        require(ROOT == AUTHORIZED_ROOT.resolve(), "EXACT_ISOLATED_ROOT")
        expected_project = "putduk-mining-backend-patch-20261011"
        expected_port = 65422
    elif sys.platform == "linux":
        require(os.environ.get("CI") == "true" and os.environ.get("GITHUB_ACTIONS") == "true",
                "ACTUAL_GITHUB_ACTIONS_REQUIRED")
        require(os.environ.get("GITHUB_REPOSITORY") == "goldeget/putduk-mining"
                and os.environ.get("GITHUB_JOB") == "database", "EXACT_APPROVED_DATABASE_JOB")
        workspace = os.environ.get("GITHUB_WORKSPACE")
        require(bool(workspace) and ROOT == Path(workspace).resolve(), "EXACT_GITHUB_WORKSPACE")
        origin = command(["git", "--no-optional-locks", "remote", "get-url", "origin"])
        require(origin.returncode == 0 and origin.stdout.strip() in (
            "https://github.com/goldeget/putduk-mining",
            "https://github.com/goldeget/putduk-mining.git",
        ), "APPROVED_CI_CHECKOUT_ORIGIN")
        expected_project = "putduk-mining"
        expected_port = 63422
    else:
        require(False, "UNAPPROVED_EXECUTION_PLATFORM")
    require((ROOT / ".git").is_dir(), "INDEPENDENT_CLONE_GIT_DIRECTORY")
    git = command(["git", "--no-optional-locks", "rev-parse", "--show-toplevel"])
    require(git.returncode == 0 and Path(git.stdout.strip()).resolve() == ROOT,
            "EXACT_GIT_TOPLEVEL")
    config = tomllib.loads((ROOT / "supabase/config.toml").read_text(encoding="utf-8"))
    require(config.get("project_id") == expected_project and config["db"]["port"] == expected_port,
            "DISPOSABLE_PROJECT_CONFIG")
    PROJECT = config["project_id"]
    CONTAINER = "supabase_db_" + PROJECT
    inspected = command(["docker", "inspect", "--format", "{{json .Config.Labels}}", CONTAINER])
    require(inspected.returncode == 0, "NAMED_DISPOSABLE_CONTAINER_EXISTS")
    labels = json.loads(inspected.stdout)
    require(labels.get("com.supabase.cli.project") == PROJECT,
            "DISPOSABLE_CONTAINER_PROJECT_LABEL")
    migration_files = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    require(bool(migration_files) and all(
        re.fullmatch(r"[0-9]{14}_.+\.sql", path.name) and path.stat().st_size > 0
        for path in migration_files
    ), "VALID_NONEMPTY_SOURCE_MIGRATIONS")
    source_versions = [path.name.split("_", 1)[0] for path in migration_files]
    require(len(set(source_versions)) == len(source_versions)
            and MIGRATION in source_versions, "UNIQUE_SOURCE_MIGRATIONS_WITH_BINDING_PATCH")
    installed_versions = json.loads(scalar("""select coalesce(jsonb_agg(version order by version),
        '[]'::jsonb)::text from supabase_migrations.schema_migrations;"""))
    require(installed_versions == sorted(source_versions), "EXACT_SOURCE_DB_MIGRATION_VERSIONS")
    require(scalar("""select current_database()='postgres'
        and to_regclass('app_private.withdrawal_external_send_keys') is not null
        and pg_get_functiondef('public.record_usdt_external_send(uuid,text,text,numeric,jsonb,uuid,timestamptz,text)'::regprocedure)
          like '%EXTERNAL_SEND_PAYLOAD_MISMATCH%';""") == "t", "PATCH_BINDING_PRESENT")


def setup(run):
    source = FIXTURE.read_text(encoding="utf-8")
    start = source.index("-- BEGIN TEST-ONLY VERIFIED MINING REWARD FIXTURE")
    end = source.index("-- END TEST-ONLY VERIFIED MINING REWARD FIXTURE", start)
    fixture = source[start:end]
    admin = str(uuid.uuid4())
    rows = []
    members = []
    for method in ("KRW_BANK", "USDT_ADDRESS"):
        for ordinal in range(2):
            members.append((method, ordinal, str(uuid.uuid4()), str(uuid.uuid4())))
    users = [admin] + [item[2] for item in members]
    values = ",".join(
        f"('{user}'::uuid,'esc-{run}-{index}@putduk.test')"
        for index, user in enumerate(users)
    )
    setup_sql = f"""BEGIN;
      {fixture}
      create temp table esc_users(id uuid,email text);
      insert into esc_users values {values};
      insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
        confirmation_token,recovery_token,email_change,email_change_token_new)
      select id,'authenticated','authenticated',email,'',statement_timestamp(),
        '{{}}'::jsonb,'{{}}'::jsonb,statement_timestamp(),statement_timestamp(),'','','',''
        from esc_users;
      insert into public.user_roles(user_id,role,granted_by)
        values('{admin}','ADMIN','{admin}');
      create temp table esc_context(method text,ordinal integer,member uuid,destination uuid,withdrawal uuid);
    """
    for method in ("KRW_BANK", "USDT_ADDRESS"):
        config = '{"country":"KR"}' if method == "KRW_BANK" else '{"allowed_networks":["TRC20"]}'
        setup_sql += f"""
          insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,
            minimum_amount_atomic,fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
          select 'KRW','{method}',coalesce(max(version),0)+1,true,1,0,'{config}'::jsonb,
            statement_timestamp()-interval '3 hours','{admin}',false
          from public.withdrawal_policies where currency='KRW' and destination_type='{method}';
        """
    for method, ordinal, member, destination in members:
        movement = str(uuid.uuid4())
        setup_sql += f"""
          select public.bootstrap_user('{member}');
          select * from app_private.ensure_withdrawal_hold_accounts('{member}');
          select pg_temp.plant_verified_mining_reward('{member}','{movement}',10000,
            statement_timestamp(),statement_timestamp(),'esc-{run}-credit-{method}-{ordinal}');
          insert into public.withdrawal_destinations(id,user_id,destination_type,encrypted_value,
            value_fingerprint,display_hint,verification_status,verified_at,protection_until)
          values('{destination}','{member}','{method}',convert_to('SYNTHETIC-ONLY','UTF8'),
            'esc-{run}-{method}-{ordinal}','synthetic destination','VERIFIED',
            statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day');
          insert into esc_context(method,ordinal,member,destination)
            values('{method}',{ordinal},'{member}','{destination}');
        """
    setup_sql += "grant select,update on esc_context to service_role; SET LOCAL ROLE service_role;"
    for method in ("KRW_BANK", "USDT_ADDRESS"):
        function = "request_krw_withdrawal" if method == "KRW_BANK" else "request_usdt_withdrawal"
        setup_sql += f"""update esc_context set withdrawal=public.{function}(member,destination,5000,
          'esc-{run}-hold-{method}-'||ordinal::text) where method='{method}';"""
    setup_sql += "RESET ROLE; SELECT jsonb_agg(esc_context ORDER BY method,ordinal)::text FROM esc_context; COMMIT;"
    result = sql(setup_sql)
    arrays = [json.loads(line) for line in result.stdout.splitlines()
              if line.lstrip().startswith("[")]
    require(len(arrays) == 1 and isinstance(arrays[0], list), "UNIQUE_SYNTHETIC_FIXTURE_ARRAY")
    rows = arrays[0]
    expected_members = {(method, ordinal): (member, destination)
                        for method, ordinal, member, destination in members}
    required_fields = {"method", "ordinal", "member", "destination", "withdrawal"}
    valid_rows = len(rows) == 4
    for row in rows:
        if not isinstance(row, dict) or set(row) != required_fields:
            valid_rows = False
            break
        identity = (row["method"], row["ordinal"])
        if (row["method"] not in ("KRW_BANK", "USDT_ADDRESS")
                or type(row["ordinal"]) is not int or row["ordinal"] not in (0, 1)
                or expected_members.get(identity) != (row["member"], row["destination"])):
            valid_rows = False
            break
        try:
            for field in ("member", "destination", "withdrawal"):
                if not isinstance(row[field], str) or str(uuid.UUID(row[field])) != row[field]:
                    valid_rows = False
        except (ValueError, AttributeError):
            valid_rows = False
    require(valid_rows and len({(row["method"], row["ordinal"]) for row in rows}) == 4
            and len({row["withdrawal"] for row in rows}) == 4, "SYNTHETIC_FIXTURE_SHAPE_AND_IDENTITIES")
    require(len(rows) == 4, "FOUR_COMMITTED_SYNTHETIC_HELD_REQUESTS")
    return admin, rows, sha256(fixture.encode()).hexdigest()


def rpc(method, withdrawal, admin, run, key, changed=False):
    sent_at = "2026-10-01T00:00:00Z"
    if method == "KRW_BANK":
        amount = 4999 if changed else 5000
        return f"public.record_krw_external_send('{withdrawal}','ESC-BANK-{run}',{amount},'{admin}','{sent_at}','{key}')"
    amount = "1.250001" if changed else "1.250000"
    return f"public.record_usdt_external_send('{withdrawal}','TRC20','esc-tx-{run}',{amount},'{{\"local\":\"synthetic\"}}'::jsonb,'{admin}','{sent_at}','{key}')"


def result_id(result):
    matches = [line for line in result.stdout.splitlines()
               if re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", line)]
    return matches[0] if result.returncode == 0 and len(matches) == 1 else None


def pair(call_a, call_b, application_prefix):
    barrier = threading.Barrier(3)

    def invoke(call, lane):
        barrier.wait(timeout=10)
        return sql(f"""BEGIN; SET application_name='{application_prefix}-{lane}';
          SET LOCAL ROLE service_role; SELECT {call}; SELECT pg_sleep(3); COMMIT;""", False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(invoke, call_a, "a")
        second = pool.submit(invoke, call_b, "b")
        barrier.wait(timeout=10)
        observed_wait = False
        # Restrict observations to these two task-owned sessions. No financial rows read here.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not (first.done() and second.done()):
            observed_wait |= scalar(f"""select exists(select 1 from pg_stat_activity
              where application_name like '{application_prefix}-%'
                and wait_event_type='Lock' and lower(wait_event)='advisory');""") == "t"
            if observed_wait:
                break
            time.sleep(0.1)
        results = [first.result(timeout=40), second.result(timeout=40)]
    require(observed_wait, application_prefix + "_ACTUAL_ADVISORY_WAIT_OBSERVED")
    return results


def verify(method, requests, admin, run):
    key = f"esc-{run}-{method}-shared"
    calls = [rpc(method, item["withdrawal"], admin, run + method, key) for item in requests]
    outcomes = pair(*calls, f"esc-{run}-{method}-different")
    successes = [index for index, result in enumerate(outcomes) if result_id(result)]
    require(len(successes) == 1, method + "_ONE_DIFFERENT_WITHDRAWAL_SUCCESS")
    winner = successes[0]
    loser = 1 - winner
    send = result_id(outcomes[winner])
    require("IDEMPOTENCY_KEY_REUSED" in outcomes[loser].stderr,
            method + "_OTHER_WITHDRAWAL_CONFLICT")
    winner_id, loser_id = requests[winner]["withdrawal"], requests[loser]["withdrawal"]
    require(scalar(f"""select status='HELD' and processing_started_at is null
      and not exists(select 1 from public.withdrawal_external_sends where withdrawal_id='{loser_id}')
      from public.withdrawal_requests where id='{loser_id}';""") == "t", method + "_LOSER_UNCHANGED")
    require(scalar(f"""select
      (select count(*) from public.withdrawal_external_sends where withdrawal_id in ('{winner_id}','{loser_id}'))=1
      and (select count(*) from app_private.withdrawal_external_send_keys where idempotency_key='{key}')=1
      and (select count(*) from public.outbox_events where event_type='WITHDRAWAL_EXTERNAL_SENT.v1'
        and aggregate_id in ('{winner_id}','{loser_id}'))=1;""") == "t", method + "_ONE_SEND_KEY_EVENT")
    repeated = pair(calls[winner], calls[winner], f"esc-{run}-{method}-same")
    require(all(result_id(result) == send for result in repeated), method + "_SAME_REQUEST_TWO_SESSIONS_ONE_ID")
    require(result_id(sql("BEGIN; SET LOCAL ROLE service_role; SELECT " + calls[winner] + "; COMMIT;")) == send,
            method + "_LOST_RESPONSE_RETRY_ORIGINAL_RECEIPT")
    alias = f"esc-{run}-{method}-alias"
    alias_call = rpc(method, winner_id, admin, run + method, alias)
    require(result_id(sql("BEGIN; SET LOCAL ROLE service_role; SELECT " + alias_call + "; COMMIT;")) == send,
            method + "_NEW_KEY_IDENTICAL_PAYLOAD_BINDS_ORIGINAL")
    reused = sql("BEGIN; SET LOCAL ROLE service_role; SELECT " + rpc(method, loser_id, admin, run + method, alias) + "; COMMIT;", False)
    require(reused.returncode != 0 and "IDEMPOTENCY_KEY_REUSED" in reused.stderr,
            method + "_SUCCESSFUL_ALIAS_CANNOT_MOVE_TO_OTHER_WITHDRAWAL")
    changed = sql("BEGIN; SET LOCAL ROLE service_role; SELECT " + rpc(method, winner_id, admin, run + method, f"esc-{run}-{method}-changed", True) + "; COMMIT;", False)
    require(changed.returncode != 0 and "EXTERNAL_SEND_PAYLOAD_MISMATCH" in changed.stderr,
            method + "_NEW_KEY_CHANGED_PAYLOAD_REJECTED")
    require(scalar(f"""select
      (select count(*) from public.withdrawal_external_sends where withdrawal_id='{winner_id}')=1
      and (select count(*) from app_private.withdrawal_external_send_keys where send_id='{send}')=2
      and (select count(*) from public.outbox_events where event_type='WITHDRAWAL_EXTERNAL_SENT.v1'
        and aggregate_id='{winner_id}')=1
      and (select status='HELD' from public.withdrawal_requests where id='{loser_id}');""") == "t",
            method + "_REPLAYS_AND_CONFLICTS_LEAVE_ONE_EVENT_AND_TWO_BOUND_KEYS")


def main():
    run = uuid.uuid4().hex[:16]
    guard()
    admin, rows, fixture_hash = setup(run)
    for method in ("KRW_BANK", "USDT_ADDRESS"):
        verify(method, [row for row in rows if row["method"] == method], admin, run)
    print(json.dumps({"status": "PASS", "assertions": ASSERTIONS,
                      "fixture_origin": "OWNER_ONLY_SEALED_SYNTHETIC_CREDIT",
                      "fixture_sha256": fixture_hash, "cleanup_performed": False,
                      "committed_synthetic_fixtures": True}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Guard/test names only; suppress raw subprocess errors and statement context.
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({"status": "FAIL", "reason": reason, "assertions": ASSERTIONS,
                          "cleanup_performed": False}, ensure_ascii=False))
        raise SystemExit(1)
