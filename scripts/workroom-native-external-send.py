"""Run pinned historical financial setup before cutover, same real races after.

The successor native runner performs the repository, Docker endpoint, full ID,
fresh-generation and source admission gates. This helper never invokes the old
source-admission guard, whose immutable201 contract intentionally rejects202.
All historical financial setup/verify functions remain byte-identical v3 adapters.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

mode, module_path, context_path, container_id, project = sys.argv[1:]
if mode not in ("seed", "verify") or os.environ.get("APP_ENV") != "test":
    raise RuntimeError("WORKROOM_NATIVE_EXPLICIT_TEST_PHASE_REQUIRED")
if not re.fullmatch(r"[a-f0-9]{64}", container_id) or project not in (
        "putduk-mining-ci-r2-20261009", "putduk-mining-workroom-local-20261104"):
    raise RuntimeError("WORKROOM_NATIVE_EXACT_TARGET_REQUIRED")
inspected = json.loads(subprocess.check_output(["docker", "inspect", container_id], text=True))[0]
if inspected["Id"] != container_id or inspected["Name"] != "/supabase_db_" + project or not inspected["State"]["Running"]:
    raise RuntimeError("WORKROOM_NATIVE_CONTAINER_MISMATCH")
if inspected["Config"]["Labels"].get("com.supabase.cli.project") != project:
    raise RuntimeError("WORKROOM_NATIVE_PROJECT_LABEL_MISMATCH")
spec = importlib.util.spec_from_file_location("preserved_external_send", module_path)
historical = importlib.util.module_from_spec(spec)
spec.loader.exec_module(historical)
historical.CONTAINER = container_id
context_file = Path(context_path)
if mode == "seed":
    if context_file.exists():
        raise RuntimeError("WORKROOM_NATIVE_FRESH_CONTEXT_REQUIRED")
    run = uuid.uuid4().hex[:16]
    admin, rows, fixture_hash = historical.setup(run)
    context_file.write_text(json.dumps({"container": container_id, "run": run, "admin": admin,
        "rows": rows, "fixtureHash": fixture_hash}), encoding="utf-8")
else:
    context = json.loads(context_file.read_text(encoding="utf-8"))
    if context["container"] != container_id:
        raise RuntimeError("WORKROOM_NATIVE_SAME_SEEDED_GENERATION_REQUIRED")
    for method in ("KRW_BANK", "USDT_ADDRESS"):
        historical.verify(method, [row for row in context["rows"] if row["method"] == method], context["admin"], context["run"])
    if not historical.ASSERTIONS or not all(row["passed"] for row in historical.ASSERTIONS):
        raise RuntimeError("WORKROOM_NATIVE_FINANCIAL_ASSERTIONS_REQUIRED")
print(json.dumps({"status": "PASS", "phase": mode, "assertions": historical.ASSERTIONS,
    "pre202SeedPreserved": mode == "verify", "container": container_id}))
