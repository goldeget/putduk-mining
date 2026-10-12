import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBackendHttp195CanonicalCandidateSources,
  assertBackendHttp195LocalCandidateSources,
} from "./backend-http-195-source.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = "tests/e2e/fixtures/usdt-manual-195-runner-source.json";
const MANIFEST_SHA256 =
  "f24506246a0ce47f8b5eef53f0cdb79ddcecd6323c69538666afd4c085e1d482";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function assertUsdt195RunnerSources(root = ROOT, scope) {
  if (
    arguments.length !== 2 ||
    !["LOCAL_QA", "CANONICAL_CI"].includes(scope) ||
    !/^[0-9a-f]{64}$/.test(MANIFEST_SHA256)
  )
    throw new Error("USDT195_RUNNER_REVIEWED_SCOPE_REQUIRED");
  const ownedRoot = realpathSync(root);
  const owned = (name) => {
    if (
      typeof name !== "string" ||
      isAbsolute(name) ||
      name.includes("\\") ||
      name.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new Error("USDT195_RUNNER_PATH_REJECTED");
    const target = realpathSync(resolve(ownedRoot, name));
    const location = relative(ownedRoot, target);
    if (
      !location ||
      isAbsolute(location) ||
      location === ".." ||
      location.startsWith("../") ||
      location.startsWith("..\\")
    )
      throw new Error("USDT195_RUNNER_PATH_REJECTED");
    return target;
  };
  const bytes = readFileSync(owned(MANIFEST));
  if (hash(bytes) !== MANIFEST_SHA256)
    throw new Error("USDT195_RUNNER_MANIFEST_CHANGED");
  const map = JSON.parse(bytes);
  if (
    map.version !== 1 ||
    map.repository !== "goldeget/putduk-mining" ||
    map.candidate195ManifestSha256 !==
      "0d078c0787b5619edfebd800f3f6a5f00848540d97373fac369c87872313b3df" ||
    !Array.isArray(map.sources) ||
    map.sources.length !== 9 ||
    new Set(map.sources.map((r) => r.path)).size !== 9
  )
    throw new Error("USDT195_RUNNER_MANIFEST_INVALID");
  for (const row of map.sources) {
    if (
      Object.keys(row).sort().join(",") !== "path,sha256" ||
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      hash(readFileSync(owned(row.path))) !== row.sha256
    )
      throw new Error("USDT195_RUNNER_SOURCE_CHANGED");
  }
  if (
    hash(readFileSync(owned("scripts/backend-http-195-source.mjs"))) !==
    "cfca3b3190b99148a80f3ab0c365f9e252dbb59d239206c6674ce2a1c2679068"
  )
    throw new Error("USDT195_CANDIDATE_GUARD_CHANGED");
  const candidate =
    scope === "LOCAL_QA"
      ? assertBackendHttp195LocalCandidateSources(ownedRoot)
      : assertBackendHttp195CanonicalCandidateSources(ownedRoot);
  return Object.freeze({ candidate, runnerManifestSha256: MANIFEST_SHA256 });
}
