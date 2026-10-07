"""Prepare blocked plans and genuine unrun evidence; never runs commands."""
# OWNER_CORRECTION_GENERATOR_GUARD
from pathlib import Path as _OwnerPath
if __name__ == "__main__" and (_OwnerPath(__file__).parent / "product-access-policy.json").exists():
    raise SystemExit("SUPERSEDED_BY_OWNER_CORRECTION: use owner-correction.py; do not regenerate the rejected Tier access model or overwrite reviewed evidence")

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent


def write(name, data):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    steps = ["draft", "preview", "approve", "publish", "archive", "cancel"]
    for kind in ["catalog", "content"]:
        blocker = "APPROVED_" + kind.upper() + "_COMMAND_REQUIRED"
        plan = {
            "schema_version": 1, "kind": kind, "status": "BLOCKED", "blocker": blocker,
            "base_sha": "0a7e95ba8bf55539fe32fd6f4654ee49a0be226d", "command_status": "NOT_FOUND",
            "approved_commands": {step: None for step in steps},
            "isolation": "OWNED_ISOLATED_LOCAL_REQUIRED", "local_target": None,
            "shared_staging": "DEFERRED_PRIMARY_OWNED_ENVIRONMENT", "production": "FORBIDDEN_IN_THIS_LANE",
            "registration_ready": False, "production_ready": False,
            "generated_ids": [], "readback": "BLOCKED", "render": "BLOCKED", "rollback": "BLOCKED",
            "local_registration": "NOT_RUN", "direct_sql_allowed": False,
            "fixtures_allowed": False, "migration_allowed": False,
            "required_evidence": ["EXACT_COMMAND_NAME_AND_PERMISSION", "APPROVED_OPERATOR_AAL2_SESSION",
                "SAME_ORIGIN_VALIDATION", "REVISION_RECHECK", "REQUEST_AND_IDEMPOTENCY_KEYS", "REASON",
                "EXACT_IMPACT_PREVIEW", "HUMAN_CONFIRMATION", "AUDIT_RECEIPT", "DRAFT_CREATED_ID",
                "READBACK_MATCH", "REAL_MEMBER_AND_ADMIN_RENDER", "CANCEL_OR_ARCHIVE_READBACK",
                "RETRY_NO_DUPLICATES", "DENIED_ROLE_AND_REVOKED_SESSION", "HISTORIC_RECEIPTS_PRESERVED"],
            "preview_impact": ["target members/segments", "content diff and immutable digest", "schedule Asia/Seoul display + UTC storage",
                "visibility and availability", "notification channels/cooldown/quiet hours/opt-in", "economic policy and budget impact",
                "old sessions/receipts/ledger retained", "unsupported metadata rejected visibly"],
            "retry": "Same logical action reuses idempotency; new revision needs re-preview and re-confirmation",
            "rollback_plan": "Use actual authorized cancel/archive command; stop future exposure/schedule/fanout; retain audit/claims/delivery/ledger. Verify readback and member hide.",
            "steps": [{"step": step, "execution": "UNRUN", "command": None, "receipt": None} for step in steps],
            "not_runtime_payload": True,
        }
        write(kind + "-registration-plan.json", plan)
    routes = {}
    for path in (ROOT.parent / "app").rglob("page.tsx"):
        parts = [part for part in path.relative_to(ROOT.parent / "app").parts[:-1] if not part.startswith("(")]
        if any(part.startswith("[") for part in parts): continue
        routes["/" + "/".join(parts)] = str(path.relative_to(ROOT.parent))
    # Explicit versioned trust documents are resolved by a catch-all route.
    # Route support is not inferred for arbitrary catch-all paths.
    trust_source = (ROOT.parent / "lib/trust/public-content.ts").read_text()
    for route in re.findall(r'path: "(/[a-z0-9/-]+)"', trust_source):
        routes[route] = "app/(trust)/[...document]/page.tsx + lib/trust/public-content.ts"
    write("evidence/route-inventory.json", {"base_sha": "0a7e95ba8bf55539fe32fd6f4654ee49a0be226d",
        "static_routes": routes, "scope": "ROUTE_EXISTENCE_ONLY_NOT_FEATURE_QA",
        "notification_safe_paths": ["/home", "/start", "/mining", "/notifications", "/ai", "/products", "/events", "/wallet/deposit", "/wallet/withdraw"],
        "notification_source": "lib/auth/return-path.ts and domain/notifications/member-inbox.ts"})
    for name, operation in [("registration-readback", "LOCAL_DRAFT_CREATE_AND_READBACK"),
                            ("render-evidence", "REAL_CATALOG_CMS_BROWSER_RENDER"),
                            ("rollback-evidence", "LOCAL_CANCEL_ARCHIVE_READBACK")]:
        write("evidence/" + name + ".json", {"schema_version": 1, "operation": operation,
            "status": "BLOCKED", "execution": "UNRUN", "reason": "APPROVED_CATALOG_COMMAND_REQUIRED / APPROVED_CONTENT_COMMAND_REQUIRED",
            "target": None, "created_id": None, "request_id": None, "readback_result": None,
            "screenshots": [], "rollback_receipt": None,
            "proof_source": "evidence/command-discovery.json", "production_touched": False,
            "shared_staging_written": False, "direct_sql_executed": False,
            "note": "No fabricated IDs, readback, previews or screenshot substitutes. Schema and static draft are not registration evidence."})
    print("Blocked registration plans and genuine UNRUN evidence saved")
