"""Read this authorized repository only; writes catalog-ops evidence only."""
import datetime
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO, text=True).strip()


def write(name, value):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    freezes = {
        "parallel/admin-release": "f9b454a7c1b86dde1099b6e5a264092118258ead",
        "parallel/launch-ops-content": "ba9ed931f756488ce4f67f945cffad9552842c09",
        "parallel/product-scene-production": "505e20c097be8de1b5d02bc65a2dcbd054fe56d1",
    }
    for ref, sha in freezes.items():
        assert git("rev-parse", ref) == sha, ref
        assert git("rev-parse", "origin/" + ref) == sha, ref
    base = git("rev-parse", "origin/develop")
    assert git("merge-base", "HEAD", "origin/develop") == base
    source = "supabase/migrations/20260926192208_ws02_commands_and_catalog_seed.sql"
    seed = (REPO / source).read_text()
    inventory = json.loads(git("show", freezes["parallel/product-scene-production"] + ":scene-production/product-catalog-inventory.json"))
    for row in inventory["products"]:
        assert row["product_id"] in seed and "'" + row["slug"] + "'" in seed
    inventory.update(observed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     audit_scope="RECHECKED_REPOSITORY_SEED_NOT_LIVE_DATABASE", base_sha=base)
    write("current-catalog-audit.json", inventory)
    evidence = {
        "base_sha": base, "main_sha": git("rev-parse", "origin/main"),
        "develop_ahead_of_main": int(git("rev-list", "--count", "origin/main..origin/develop")),
        "frozen_branches": freezes, "catalog_seed": source,
        "catalog_seed_sha256": hashlib.sha256(seed.encode()).hexdigest(),
        "repository_catalog_status": "REPOSITORY_DRAFT", "repository_published_products": 0,
        "live_catalog_status": "LIVE_DB_UNKNOWN", "live_ids": None,
        "current_policy": json.loads((REPO / "docs/product/economy-v1-approved-2026-10-03.json").read_text()),
        "runtime_effect_guard": {"source": "domain/mining/funding-entitlement.ts:206",
                                 "state": "EFFECT_SCOPE_UNRESOLVED", "non_default_modifiers_usable": False},
    }
    write("evidence/current-catalog-evidence.json", evidence)
    files = sorted(list((REPO / "supabase/migrations").glob("*.sql")) +
                   list((REPO / "apps/admin/app/api").rglob("route.ts")) +
                   list((REPO / "apps/admin/lib").rglob("*.ts")) +
                   list((REPO / "app/api").rglob("route.ts")))
    functions = []
    hashes = []
    for path in files:
        body = path.read_text()
        hashes.append({"path": str(path.relative_to(REPO)), "sha256": hashlib.sha256(body.encode()).hexdigest()})
        for match in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+([\w.]+)", body, re.I):
            functions.append({"name": match[1], "source": str(path.relative_to(REPO)),
                              "line": body[:match.start()].count("\n") + 1})
    write("evidence/command-discovery.json", {
        "base_sha": base, "searched_files": hashes, "sql_functions": functions,
        "catalog_command": "NOT_FOUND", "content_command": "NOT_FOUND",
        "present_but_different": ["manage_economy_policy_version", "read_economy_policy_version_state",
                                  "app_private.enforce_catalog_version_transition (trigger; revoked execution)"],
        "excluded": ["events-fixtures.ts direct SQL test inserts", "schema triggers", "economy policy publisher"],
        "catalog_blocker": "APPROVED_CATALOG_COMMAND_REQUIRED",
        "content_blocker": "APPROVED_CONTENT_COMMAND_REQUIRED",
        "live_environment": "NOT_QUERIED", "production": "NOT_TOUCHED",
    })
    content_evidence = {}
    for kind in ["events", "notices", "faq", "notifications", "support-macros", "incident-templates"]:
        path = "launch-content/" + kind + ".json"
        body = git("show", freezes["parallel/launch-ops-content"] + ":" + path)
        data = json.loads(body)
        content_evidence[kind] = {"path": path, "count": len(data), "sha256": hashlib.sha256(body.encode()).hexdigest(),
                                  "slugs": [x["slug"] for x in data]}
    write("evidence/frozen-content-sources.json", {"ref": freezes["parallel/launch-ops-content"], "packages": content_evidence})
    write("evidence/frozen-scene-sources.json", {"ref": freezes["parallel/product-scene-production"],
        "product_codes": [x["product_code"] for x in inventory["products"]],
        "family_master_only": [x["product_code"] for x in inventory["products"] if x["current_scene_status"] == "FAMILY_MASTER_ONLY"],
        "scope": "11 scene specifications/prompts; none are approved product browser acceptance evidence"})
    print(json.dumps({"base": base, "repository_products": len(inventory["products"]), "scanned_files": len(files),
                      "content_counts": {k: v["count"] for k, v in content_evidence.items()}}))
