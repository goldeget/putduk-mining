#!/usr/bin/env python3
"""One isolated native case on an already accepted exact152 checkout.

No migration-definition replay. The original active120 staging runner is separate.
This prepared caller is not runtime acceptance or permission to dispatch CI.
"""
from pathlib import Path
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
COUNTS = {"A": 25, "B": 24, "C": 24, "D": 24, "E": 23}
SQL_INPUTS = {
    "supabase/test-fixtures/principal_finalize_current_basis.sql":
        "a9869874465283af88759d86f7fc608c96e70abb296774b32f3e40002a96b8d2",
    "supabase/tests-concurrent/principal_finalize_native_contention.sql":
        "608283473ea77736b9bc3a1250833b3078bff8694ff2f7c91ecdd7ed0cad4f6d",
}
DOCKER = ["docker"]
PSQL = DOCKER + ["exec", "-i", "supabase_db_putduk-mining", "psql", "-X",
                 "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]
IDENTITY_SQL = "\nselect count(*) from supabase_migrations.schema_migrations;\nselect md5(string_agg(version::text,E'\n' order by version)) from supabase_migrations.schema_migrations;\nselect md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),E'\n'\n order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)))\nfrom pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prokind='f';\nselect md5(string_agg(n.nspname||'.'||c.relname||c.relkind::text||c.relowner::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,''),E'\n' order by n.nspname,c.relname))\nfrom pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private');\nselect md5(string_agg(pg_get_triggerdef(t.oid)||t.tgenabled::text,E'\n' order by n.nspname,c.relname,t.tgname))\nfrom pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private') and not t.tgisinternal;\nselect md5(string_agg(n.nspname||'.'||c.relname||a.attname||coalesce(a.attacl::text,''),E'\n' order by n.nspname,c.relname,a.attnum))\nfrom pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private') and a.attnum>0 and not a.attisdropped;\nselect md5(string_agg(n.nspname||'.'||c.relname||p.polname||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),E'\n' order by n.nspname,c.relname,p.polname))\nfrom pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private');\nselect md5(string_agg(n.nspname||n.nspowner::text||coalesce(n.nspacl::text,''),E'\n' order by n.nspname)) from pg_namespace n where n.nspname in('public','app_private');\nselect md5(string_agg(n.nspname||'.'||t.typname||t.typowner::text||coalesce(t.typacl::text,''),E'\n' order by n.nspname,t.typname)) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in('public','app_private');\nselect md5(string_agg(n.nspname||'.'||c.relname||k.conname||pg_get_constraintdef(k.oid)||k.convalidated::text,E'\n' order by n.nspname,c.relname,k.conname)) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private');\n"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@contextmanager
def own_generation_lock():
    path = ROOT / "test-results" / ".principal-native152.lock"
    with path.open("a") as handle:
        path.chmod(0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("ANOTHER_OWNED_NATIVE_SQL_GENERATION_ACTIVE") from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def source_inputs():
    files = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    if len(files) != 152:
        raise RuntimeError("EXACT152_ACTIVE_SOURCE_REQUIRED")
    tests = sorted((ROOT / "supabase/tests/database").glob("*.sql"))
    if len(tests) != 70:
        raise RuntimeError("EXACT70_WHOLE_SQL_FILES_REQUIRED")
    files += tests + [ROOT / path for path in SQL_INPUTS]
    files += [Path(__file__).resolve(), ROOT / "scripts/capture-local-supabase-env.mjs",
              ROOT / "supabase/config.toml"]
    for relative, expected in SQL_INPUTS.items():
        if digest(ROOT / relative) != expected:
            raise RuntimeError("UNMODIFIED_NATIVE_SQL_REQUIRED")
    return {str(p.relative_to(ROOT)): digest(p) for p in files}


def verify_whole_proof(proof, source):
    if (proof.get("accepted") is not True or proof.get("migration_count") != 152
            or proof.get("definer_count") != 29):
        raise RuntimeError("ACCEPTED_WHOLE152_PREREQUISITE_REQUIRED")
    gates = proof.get("gates", {})
    for name in ("fresh_reset", "whole_sql", "db_lint", "db_advisors"):
        code = gates.get(name, {}).get("exit_code")
        if type(code) is not int or code != 0:
            raise RuntimeError("COMPLETE_WHOLE152_GATES_REQUIRED")
    suite = gates["whole_sql"]
    if (suite.get("assertions") != 4073 or suite.get("files") != 70
            or suite.get("failed") != 0 or suite.get("skipped") != 0
            or suite.get("todo") != 0):
        raise RuntimeError("ACTUAL4073_WITHOUT_SKIPS_REQUIRED")
    if proof.get("source_inputs") != source:
        raise RuntimeError("WHOLE152_EXACT_SOURCE_BINDING_REQUIRED")
    staged = proof.get("staged139", {})
    appended = sorted(path for path in source if path.startswith("supabase/migrations/"))[-32:]
    if (staged.get("accepted") is not True
            or staged.get("all_cases_and_restoration_proven") is not True
            or staged.get("case_counts") != COUNTS
            or staged.get("native_assertions") != 120
            or staged.get("canonical_assertions") != 1940
            or staged.get("appended_migration_sources") != {path: source[path] for path in appended}):
        raise RuntimeError("ACCEPTED_SAME_SOURCE_ALL139_CASES_REQUIRED")
    identity = proof.get("baseline_identity", "").splitlines()
    if len(identity) != 10 or identity[0] != "152" or any(
            re.fullmatch(r"[a-f0-9]{32}", value) is None for value in identity[1:]):
        raise RuntimeError("WHOLE152_SECURITY_IDENTITY_REQUIRED")


def apps_closed():
    for port in (3000, 3200, 3300, 34765, 34766):
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError("STOP_APPS_BEFORE_NATIVE_SQL")
    # Only commands whose cwd is this exact checkout; never enumerate another
    # project's runtime or emit process commands/environments.
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if not (entry / "cwd").resolve(strict=True).is_relative_to(ROOT):
                continue
            cmd = (entry / "cmdline").read_bytes().lower()
            if any(word in cmd for word in
                   (b"next-server", b"/next/", b"playwright", b"run-worker", b"/workers/")):
                raise RuntimeError("STOP_OWNED_BUILD_BROWSER_WORKER_BEFORE_SQL")
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue


def local_identity(require_152=True):
    apps_closed()
    if os.environ.get("APP_ENV") != "test":
        raise RuntimeError("EXPLICIT_LOCAL_TEST_ENV_REQUIRED")
    origin = subprocess.check_output(["git", "remote", "get-url", "origin"],
                                     cwd=ROOT, text=True).strip()
    git_root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"],
                                       cwd=ROOT, text=True).strip()
    cfg = tomllib.loads((ROOT / "supabase/config.toml").read_text())
    if (Path(git_root).resolve() != ROOT or origin not in
            ("https://github.com/goldeget/putduk-mining.git", "https://github.com/goldeget/putduk-mining")
            or (cfg["project_id"], cfg["api"]["port"], cfg["db"]["port"]) !=
            ("putduk-mining", 58421, 65432)):
        raise RuntimeError("AUTHORIZED_CHECKOUT_LOCAL_PROJECT_REQUIRED")
    # Existing target guard checks remote environment names/URLs in memory.
    # It never prints CLI credential values or invents a CI binding.
    guard = subprocess.run(["node", "--input-type=module", "-e",
        "import {assertCiTestTarget} from './scripts/capture-local-supabase-env.mjs';"
        "assertCiTestTarget();"], cwd=ROOT, capture_output=True, text=True)
    if guard.returncode:
        raise RuntimeError("EXISTING_LOCAL_ENV_TARGET_GUARD_FAILED")
    state = subprocess.check_output(DOCKER + ["inspect", "supabase_db_putduk-mining",
        "--format", "{{index .Config.Labels \"com.supabase.cli.project\"}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}"], text=True).strip()
    if state != "putduk-mining running healthy":
        raise RuntimeError("OWNED_HEALTHY_LOCAL_DATABASE_REQUIRED")
    identity = subprocess.check_output(PSQL + ["-At", "-c", IDENTITY_SQL],
                                       text=True, timeout=30).strip()
    if require_152:
        versions = sorted(p.name.split("_", 1)[0]
                          for p in (ROOT / "supabase/migrations").glob("*.sql"))
        expected = hashlib.md5("\n".join(versions).encode()).hexdigest()
        if identity.splitlines()[:2] != ["152", expected]:
            raise RuntimeError("EXACT152_APPLIED_HISTORY_REQUIRED")
    return identity


def reset(directory, label, baseline, recover_partial=False):
    # Recheck authorization and source history before any disposable reset.
    local_identity(require_152=not recover_partial)
    source_inputs()
    log = directory / (label + "-reset152.log")
    with log.open("x") as handle:
        log.chmod(0o600)
        result = subprocess.run(["pnpm", "db:reset"], cwd=ROOT,
                                stdout=handle, stderr=subprocess.STDOUT, timeout=240)
    log.chmod(0o600)
    restored = result.returncode == 0 and local_identity() == baseline
    return {"exit_code": result.returncode, "restored152_security_identity": restored,
            "log_sha256": digest(log)}


def run_sql(directory, label, sql, count):
    local_identity()
    source_inputs()
    log = directory / (label + ".log")
    try:
        result = subprocess.run(PSQL, input=sql, capture_output=True,
                                text=True, timeout=240)
    except subprocess.TimeoutExpired as error:
        def as_bytes(value):
            return value.encode() if isinstance(value, str) else (value or b"")
        raw = as_bytes(error.stdout) + b"\n" + as_bytes(error.stderr)
        log.write_bytes(raw)
        log.chmod(0o600)
        raise RuntimeError("NATIVE_SQL_TIMEOUT") from error
    log.write_text(result.stdout + "\n" + result.stderr)
    log.chmod(0o600)
    rows = re.findall(r"^\s*(not ok|ok)\s+(\d+)\b", result.stdout, re.M)
    plans = re.findall(r"^\s*1\.\.(\d+)\s*$", result.stdout, re.M)
    report = {"exit_code": result.returncode, "assertions": len(rows),
              "failed": [int(n) for outcome, n in rows if outcome == "not ok"],
              "plans": plans, "log_sha256": digest(log)}
    accepted = (result.returncode == 0 and not report["failed"]
                and [int(n) for _, n in rows] == list(range(1, count + 1))
                and plans == [str(count)])
    report["accepted"] = accepted
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=COUNTS, required=True)
    parser.add_argument("--whole-proof", required=True)
    parser.add_argument("--whole-proof-sha", required=True)
    parser.add_argument("--run-label", required=True)
    args = parser.parse_args()
    if (not re.fullmatch(r"[a-f0-9]{64}", args.whole_proof_sha)
            or not re.fullmatch(r"principal-finalize-[a-z0-9-]{8,100}", args.run_label)):
        raise RuntimeError("PINNED_PROOF_AND_FRESH_LABEL_REQUIRED")
    proof_path = Path(args.whole_proof).resolve(strict=True)
    if not proof_path.is_relative_to(ROOT / "test-results"):
        raise RuntimeError("CHECKOUT_OWNED_PROOF_ARTIFACT_REQUIRED")
    if digest(proof_path) != args.whole_proof_sha:
        raise RuntimeError("WHOLE_PROOF_SHA_MISMATCH")
    before = source_inputs()
    proof = json.loads(proof_path.read_text())
    verify_whole_proof(proof, before)
    with own_generation_lock():
        return execute_case(args, before, proof)


def execute_case(args, before, proof):
    baseline = local_identity()
    if baseline != proof["baseline_identity"]:
        raise RuntimeError("ACCEPTED_WHOLE152_GENERATION_REQUIRED")
    directory = ROOT / "test-results" / args.run_label
    directory.mkdir(mode=0o700, exist_ok=False)
    report = {"case": args.case, "whole_proof_sha256": args.whole_proof_sha,
              "source_inputs": before, "accepted": False,
              "definition_migrations_replayed": 0, "remote_mutations": False}
    try:
        report["fresh_reset"] = reset(directory, "before", baseline)
        if not report["fresh_reset"]["restored152_security_identity"]:
            raise RuntimeError("FRESH152_RESET_REQUIRED")
        report["canonical388"] = run_sql(directory, "canonical388",
            (ROOT / next(iter(SQL_INPUTS))).read_text(), 388)
        if not report["canonical388"]["accepted"]:
            raise RuntimeError("ACTUAL388_FINISH_AND_SERVICE_COMMIT_REQUIRED")
        report["contention"] = run_sql(directory, "native-" + args.case,
            "select set_config('putduk.test139_case','" + args.case + "',false);\n" +
            (ROOT / "supabase/tests-concurrent/principal_finalize_native_contention.sql").read_text(),
            COUNTS[args.case])
    except Exception as error:
        report["error_type"] = type(error).__name__
        # Custom messages are fixed codes; never include raw subprocess SQL.
        if isinstance(error, RuntimeError):
            report["error_code"] = str(error)
    finally:
        try:
            report["finally_reset"] = reset(directory, "finally", baseline, recover_partial=True)
        except Exception as error:
            report["finally_reset"] = {"restored152_security_identity": False,
                                       "error_type": type(error).__name__}
        try:
            report["all_source_unchanged"] = source_inputs() == before
        except Exception as error:
            report["all_source_unchanged"] = False
            report["source_guard_error_type"] = type(error).__name__
        report["accepted"] = (report.get("canonical388", {}).get("accepted") is True
            and report.get("contention", {}).get("accepted") is True
            and report["finally_reset"]["restored152_security_identity"] is True
            and report["all_source_unchanged"])
        target = directory / "report.json"
        target.write_text(json.dumps(report, indent=2) + "\n")
        target.chmod(0o600)
    print(json.dumps({"case": args.case, "accepted": report["accepted"],
                      "restored152": report["finally_reset"]["restored152_security_identity"],
                      "report_sha256": digest(target)}))
    return 0 if report["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
