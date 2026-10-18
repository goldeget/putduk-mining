import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { assertUsdt195RunnerSources } from "./usdt-manual-195-runner-source.mjs";
const MANIFEST = "tests/e2e/fixtures/ci-backend-195-usdt-source.json";
const MANIFEST_SHA256 =
  "18f7c441a0928323d59eb9641b2df2c0379f9267f714d2e3d066ebf3cc9f18f4";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => {
  throw Error("USDT195_CI_BRIDGE_" + reason);
};
const EXPECTED = [
  "scripts/ci-backend-195-usdt.mjs",
  "scripts/ci-backend-195-usdt.d.mts",
  "scripts/ci-backend-195-usdt-artifacts.mjs",
  "scripts/ci-backend-195-usdt-artifacts.d.mts",
  "scripts/ci-backend-195-usdt-source.d.mts",
  "tests/unit/ci-backend-195-usdt-artifacts.test.ts",
  "apps/admin/lib/withdrawals/hold-release-receipt.ts",
  "tests/unit/withdrawal-release-hold-receipt.test.ts",
  "apps/admin/lib/assistant/content-source-preparation.ts",
  "apps/admin/tests/assistant-content-source-preparation.test.ts",
  "docs/quality/BACKEND-195-SOURCE-ONLY-INTEGRATION.md",
  "docs/architecture/BACKEND-FOR-UI-CONTRACT-HANDOFF-20261012.md",
  "docs/quality/BACKEND-195-SOURCE-ONLY-VALIDATION-MATRIX.csv",
  "domain/content/source-preview.ts",
  "domain/content/contract.ts",
  "domain/content/faq.ts",
  "apps/admin/lib/content/source-preview-handler.ts",
  "apps/admin/lib/auth/policy.ts",
  "lib/api/request-body.ts",
  "apps/admin/lib/assistant/operations.ts",
  "apps/admin/app/api/v1/admin/assistant/prepare/route.ts",
  "apps/admin/app/api/content/source/preview/route.ts",
].sort();
export function assertUsdt195CiBridgeSources(root, scope) {
  if (
    arguments.length !== 2 ||
    !["LOCAL_QA", "CANONICAL_CI"].includes(scope) ||
    !/^[0-9a-f]{64}$/.test(MANIFEST_SHA256)
  )
    fail("REVIEWED_SCOPE_AND_PIN_REQUIRED");
  const ownedRoot = realpathSync(root);
  const owned = (name) => {
    if (
      typeof name !== "string" ||
      isAbsolute(name) ||
      name.includes("\\") ||
      name.split("/").some((v) => !v || v === "." || v === "..")
    )
      fail("PATH_REJECTED");
    const target = realpathSync(resolve(ownedRoot, name)),
      loc = relative(ownedRoot, target);
    if (
      !loc ||
      isAbsolute(loc) ||
      loc === ".." ||
      loc.startsWith("../") ||
      loc.startsWith("..\\")
    )
      fail("PATH_REJECTED");
    return target;
  };
  const bytes = readFileSync(owned(MANIFEST));
  if (hash(bytes) !== MANIFEST_SHA256) fail("MANIFEST_CHANGED");
  const map = JSON.parse(bytes);
  if (
    Object.keys(map).sort().join(",") !==
      "repository,runnerGuardSha256,runnerManifestSha256,sources,version" ||
    map.version !== 1 ||
    map.repository !== "goldeget/putduk-mining" ||
    map.runnerGuardSha256 !==
      "137086003991fc6f4059063886b187f3c4419e5eab57094322f97f3467712d19" ||
    map.runnerManifestSha256 !==
      "f24506246a0ce47f8b5eef53f0cdb79ddcecd6323c69538666afd4c085e1d482" ||
    !Array.isArray(map.sources) ||
    JSON.stringify(map.sources.map((s) => s.path).sort()) !==
      JSON.stringify(EXPECTED)
  )
    fail("MANIFEST_INVALID");
  for (const row of map.sources) {
    if (
      Object.keys(row).sort().join(",") !== "path,sha256" ||
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      hash(readFileSync(owned(row.path))) !== row.sha256
    )
      fail("SOURCE_CHANGED");
  }
  if (
    hash(readFileSync(owned("scripts/usdt-manual-195-runner-source.mjs"))) !==
    map.runnerGuardSha256
  )
    fail("NESTED_GUARD_CHANGED");
  const reviewed = assertUsdt195RunnerSources(ownedRoot, scope); // Frozen195 remains strict; no runtime override.
  if (reviewed.runnerManifestSha256 !== map.runnerManifestSha256)
    fail("NESTED_MANIFEST_CHANGED");
  return Object.freeze({ ...reviewed, bridgeManifestSha256: MANIFEST_SHA256 });
}
