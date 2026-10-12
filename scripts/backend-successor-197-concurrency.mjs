/** Financial v3 spans stay intact; only test-owned namespace and full Docker id change. */
import { createHash } from "node:crypto";
const hash = (x) => createHash("sha256").update(x).digest("hex");
export function bindBackend197Concurrency(
  derivative,
  scope,
  profile,
  containerId,
) {
  if (
    !["LOCAL_QA", "CANONICAL_CI"].includes(scope) ||
    !/^[0-9a-f]{64}$/.test(containerId) ||
    typeof derivative?.sql !== "string" ||
    hash(derivative.sql) !== derivative.sha256 ||
    derivative.changes?.length !== 2
  )
    throw Error("BACKEND197_CONCURRENCY_REVIEWED_INPUT_REQUIRED");
  let sql = derivative.sql;
  const changes = [];
  const once = (before, after, name) => {
    if (sql.split(before).length !== 2)
      throw Error("BACKEND197_CONCURRENCY_EXACT_OWNER_SPAN_REQUIRED");
    sql = sql.replace(before, () => after);
    changes.push({
      name,
      matches: 1,
      beforeSha256: hash(before),
      afterSha256: hash(after),
    });
  };
  if (scope === "LOCAL_QA") {
    if (
      profile?.projectId !== "putduk-backend197-20261012-0300" ||
      profile.dbPort !== 59522 ||
      profile.containerId !== containerId ||
      profile.configPath !==
        "D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/successor-worker-ci-2026-10-11T17-35-12-039Z/fresh-local-197-v2/supabase/config.toml" ||
      profile.profileSha256 !==
        "367e43056b547749557fab5a04602e2720d75886ad33957be993ac36683892fc"
    )
      throw Error("BACKEND197_CONCURRENCY_EXACT_PROFILE_REQUIRED");
    once(
      'expected_project = "putduk-mining-backend-patch-20261011"',
      'expected_project = "' + profile.projectId + '"',
      "owned-project",
    );
    once(
      "expected_port = 65422",
      "expected_port = " + profile.dbPort,
      "owned-port",
    );
    once(
      '(ROOT / "supabase/config.toml").read_text(encoding="utf-8")',
      'Path("' + profile.configPath + '").read_text(encoding="utf-8")',
      "owned-config",
    );
  } else if (profile !== null)
    throw Error("BACKEND197_CONCURRENCY_CANONICAL_PROFILE_REJECTED");
  once(
    'CONTAINER = "supabase_db_" + PROJECT',
    'CONTAINER = "' + containerId + '"',
    "owned-full-container-id",
  );
  return { ...derivative, sql, sha256: hash(sql), scopedChanges: changes };
}
