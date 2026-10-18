/** Closed root-owned local197 execution profile. Never a caller/env selected hash. */
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const ROOT =
  "C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011";
const FILE =
  "D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/successor-worker-ci-2026-10-11T17-35-12-039Z/LOCAL_197_EXECUTION_PROFILE_V2.json";
const CONFIG =
  "D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/successor-worker-ci-2026-10-11T17-35-12-039Z/fresh-local-197-v2/supabase/config.toml";
const PROFILE_SHA256 =
  "367e43056b547749557fab5a04602e2720d75886ad33957be993ac36683892fc"; // Root independently verified creation and ownership.
const CONFIG_SHA256 =
  "88ae87a834057df418c18e1684418844467f5a19541960703225ad67fc5a8816";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const fail = (x) => {
  throw Error("BACKEND197_PROFILE_" + x);
};
export function readBackend197LocalExecutionProfile() {
  if (
    arguments.length ||
    process.platform !== "win32" ||
    !/^[0-9a-f]{64}$/.test(PROFILE_SHA256)
  )
    fail("REVIEWED_LOCAL_ONLY");
  if (
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITHUB_JOB ||
    process.env.DOCKER_HOST ||
    process.env.DOCKER_TLS_VERIFY ||
    process.env.DOCKER_CERT_PATH ||
    process.env.NODE_OPTIONS ||
    process.env.NODE_PATH
  )
    fail("OVERRIDE_REJECTED");
  if (
    realpathSync(ROOT) !== realpathSync(process.cwd()) ||
    realpathSync(FILE) !== resolve(FILE) ||
    realpathSync(CONFIG) !== resolve(CONFIG)
  )
    fail("PATH_REJECTED");
  const bytes = readFileSync(FILE);
  if (
    hash(bytes) !== PROFILE_SHA256 ||
    hash(readFileSync(CONFIG)) !== CONFIG_SHA256
  )
    fail("SOURCE_CHANGED");
  const p = JSON.parse(bytes);
  if (
    JSON.stringify(Object.keys(p).sort()) !==
      JSON.stringify(
        [
          "apiPort",
          "configPath",
          "configSha256",
          "containerCreatedAt",
          "containerId",
          "dbPort",
          "projectId",
          "repository",
          "scope",
          "version",
          "volumeCreatedAt",
        ].sort(),
      ) ||
    p.version !== 1 ||
    p.repository !== "goldeget/putduk-mining" ||
    p.scope !== "LOCAL_QA" ||
    p.projectId !== "putduk-backend197-20261012-0300" ||
    p.apiPort !== 59521 ||
    p.dbPort !== 59522 ||
    p.configPath !== CONFIG ||
    p.configSha256 !== CONFIG_SHA256 ||
    !/^[0-9a-f]{64}$/.test(p.containerId)
  )
    fail("EXACT_PROFILE_REQUIRED");
  for (const created of [p.containerCreatedAt, p.volumeCreatedAt]) {
    const age = Date.now() - Date.parse(created);
    if (!Number.isFinite(age) || age < 0 || age > 3600000)
      fail("FRESH_WINDOW_EXPIRED");
  }
  const config = readFileSync(CONFIG, "utf8");
  if (
    !config.includes('project_id = "' + p.projectId + '"') ||
    !config.includes("port = 59521") ||
    !config.includes("port = 59522")
  )
    fail("CONFIG_TARGET_MISMATCH");
  return Object.freeze({ ...p, profileSha256: PROFILE_SHA256 });
}
