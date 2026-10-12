/** Independently pinned 193-source boundary with two closed execution contexts. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPOSITORY = "goldeget/putduk-mining";
const REVIEWED_HEAD = "e220356be85a56e21e3469023b19b0c2fd4aebba";
const SOURCE_MANIFEST = "tests/e2e/fixtures/backend-http-local-193-source.json";
const EXECUTION_PROFILE =
  "tests/e2e/fixtures/backend-http-local-execution-profile.json";
// The coordinator supplies these constants only after independent final review.
// Empty pins intentionally reject all execution. Manifest content cannot self-approve.
const SOURCE_MANIFEST_SHA256 = "8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922";
const EXECUTION_PROFILE_SHA256 = "5767adadaf2e4f96e8db557ea61de4de53a4eae7a3f635c8c972a3ee13f62046";
const REVIEWED_ACK_MIGRATION = "supabase/migrations/20261011112058_nonmoney_award_outbox_ack.sql";
const REVIEWED_ACK_SHA256 = "96d977e238c2f40fcc244ab4c0e615cc878e348b01393e55f5d2a66069db647c";
const REVIEWED_RUNNER_SHA256 = "4c5153a182955f7a22f1363e410353f4a948b939bb92cbe0269dd3096f6c5f2b";
const REVIEWED_WALLET_ROUTE_SHA256 = "00c5e5dc02e1e8578062a8a717d8008764d9e1397a18569050024975ee2f9a0c";
const REVIEWED_LOCAL_CONFIG_SHA256 = "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7";
const REVIEWED_CANONICAL_CONFIG_SHA256 = "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac";
const BRIDGE_MIGRATION =
  "supabase/migrations/20261011110300_backend_referral_nonmoney_bridge.sql";
const BRIDGE_SHA256 =
  "3389a828e745afd23c13fbb4f80e449c2f4f0d976bd4ed5208f5827ffb5a4cd6";
const BASELINE_MANIFEST = "tests/e2e/fixtures/principal-review-r2-ci-source.json";
const BASELINE_SHA256 =
  "338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1";
const LAYERS = [
  {
    path: "tests/e2e/fixtures/principal-backend-engine-187-source.json",
    sha256: "1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3",
    count: 187,
    added: 4,
  },
  {
    path: "tests/e2e/fixtures/principal-backend-first-188-source.json",
    sha256: "9c2ea55a0c06f07c3570f25ff80341e6ff67b37623ec497fde3062646882d616",
    count: 188,
    added: 1,
  },
  {
    path: "tests/e2e/fixtures/principal-backend-first-191-source.json",
    sha256: "899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb",
    count: 191,
    added: 3,
  },
];
const PREDECESSORS = [
  ["principal-review-r2-source.json", "c67be88e77c998e56e0df793fc0705c9e4dff2966ee17db415953aa707adc289"],
  ["principal-integrated-source.json", "7c20596498cea26d9943a8fbaf3b56815cbaf65c934f468a6214815f7bfc4baf"],
  ["principal-local-recovery-source.json", "7b84b1a76b113a9bc24d58eada9d31be2b93b9484ef28f1b4abde688d4a6858d"],
  ["principal-local-recovery-source-v3.json", "435d6e9cffa1e3feb40742bf9100a1c030fe6a5139a902bec4a2839098e34ceb"],
  ["principal-local-recovery-source-v4.json", "6d4af5c25f3a4fe45f3c60a860838c9f1d2857fa36cd51e1b287e6e5e09e53ce"],
];
const RUNTIME = [
  "supabase/config.toml",
  "components/layout/product-shell.module.css",
  "app/globals.css",
  "components/product/withdrawal-page.module.css",
  "components/product/principal-money.tsx",
  "components/product/principal-recovery.module.css",
  "app/(product)/wallet/withdraw/page.tsx",
  "app/api/v1/withdrawals/intents/route.ts",
  "components/product/principal-withdrawal-form.tsx",
  "components/product/principal-crypto-withdrawal-form.tsx",
  "lib/wallet/principal-withdrawal-client.ts",
  "lib/wallet/principal-withdrawal-logical-request.ts",
  "lib/wallet/principal-withdrawal-read.ts",
  "lib/wallet/read-principal-withdrawal.server.ts",
  "lib/wallet/withdrawal-logical-record.ts",
  "lib/wallet/withdrawal-logical-recovery.ts",
  "lib/wallet/principal-crypto-withdrawal-read.ts",
  "lib/wallet/read-principal-crypto-withdrawal.server.ts",
  "workers/runner.mjs",
  "workers/funding-scheduler.mjs",
  "domain/referral/qualification.ts",
  "lib/ai/usage.ts",
  "lib/ai/member-policy.ts",
  "lib/product/mining-server-display.ts",
  "tests/e2e/authenticated/helpers/principal-product-fixture.ts",
  "playwright.review-r2.config.ts",
  "domain/events/participation.ts",
  "lib/events/participation-handler.server.ts",
  "app/api/v1/events/participation/route.ts",
].sort();
const OLD_RUNTIME_REPLACEMENTS = [
  "domain/events/participation.ts",
  "lib/events/participation-handler.server.ts",
].sort();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const migrationPath = (value) =>
  typeof value === "string" && /^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(value);

/** Private mode is chosen only by the two explicit exports, never by a caller. */
function assertCandidateSources(root, scope) {
  const failure = (code) => new Error(scope === "CANONICAL_CI"
    ? code.replace("BACKEND_HTTP_LOCAL_", "BACKEND_HTTP_CANONICAL_") : code);
  if (
    ![
      SOURCE_MANIFEST_SHA256,
      EXECUTION_PROFILE_SHA256,
      REVIEWED_ACK_SHA256,
      REVIEWED_RUNNER_SHA256,
      REVIEWED_WALLET_ROUTE_SHA256,
      REVIEWED_LOCAL_CONFIG_SHA256,
      REVIEWED_CANONICAL_CONFIG_SHA256,
    ].every(validHash) ||
    !migrationPath(REVIEWED_ACK_MIGRATION) ||
    REVIEWED_ACK_MIGRATION <= BRIDGE_MIGRATION
  ) throw failure("BACKEND_HTTP_LOCAL_REVIEW_NOT_PINNED");

  const checkout = realpathSync(root);
  function owned(name) {
    if (typeof name !== "string" || isAbsolute(name) || name.split(/[\\/]/).includes(".."))
      throw failure("BACKEND_HTTP_LOCAL_SOURCE_SCOPE_REJECTED");
    const actual = realpathSync(resolve(checkout, name));
    const rel = relative(checkout, actual);
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
      throw failure("BACKEND_HTTP_LOCAL_SOURCE_SCOPE_REJECTED");
    return actual;
  }
  function pinnedJson(name, expected) {
    const bytes = readFileSync(owned(name));
    if (hash(bytes) !== expected) throw failure("BACKEND_HTTP_LOCAL_FROZEN_MAP_CHANGED");
    return JSON.parse(bytes.toString("utf8"));
  }
  for (const [name, expected] of PREDECESSORS) {
    pinnedJson(`tests/e2e/fixtures/${name}`, expected);
  }
  const baseline = pinnedJson(BASELINE_MANIFEST, BASELINE_SHA256);
  if (
    baseline.version !== 2 || baseline.repository !== REPOSITORY ||
    baseline.project_id !== "putduk-mining-ci-r2-20261009" ||
    baseline.configured_project_id !== "putduk-mining-ci-r2-20261009" ||
    baseline.api_port !== 63421 || baseline.migration_count !== 183 ||
    !Array.isArray(baseline.sources) || baseline.sources.length !== 212 ||
    !same(baseline.sources.filter((row) => row.kind === "runtime").map((row) => row.path).sort(), RUNTIME)
  ) throw failure("BACKEND_HTTP_LOCAL_BASELINE_INVALID");
  let previousPath = BASELINE_MANIFEST;
  let previousHash = BASELINE_SHA256;
  let previousCount = 183;
  const sources = [...baseline.sources];
  let content;
  for (const layer of LAYERS) {
    const map = pinnedJson(layer.path, layer.sha256);
    if (
      map.version !== 1 || map.repository !== REPOSITORY ||
      map.project_id !== baseline.project_id || map.configured_project_id !== baseline.configured_project_id ||
      map.api_port !== baseline.api_port || map.baselineManifestPath !== BASELINE_MANIFEST ||
      map.baselineManifestSha256 !== BASELINE_SHA256 || map.baselineMigrationCount !== 183 ||
      map.baselineRuntimeCount !== 29 || map.migration_count !== layer.count ||
      map.additional_migration_count !== layer.added ||
      !Array.isArray(map.sources) || map.sources.length !== layer.added ||
      map.sources.some((row) => row.kind !== "migration") ||
      (layer.count !== 187 && (map.previousManifestPath !== previousPath ||
        map.previousManifestSha256 !== previousHash || map.previousMigrationCount !== previousCount))
    ) throw failure("BACKEND_HTTP_LOCAL_PREFIX_INVALID");
    sources.push(...map.sources);
    previousPath = layer.path;
    previousHash = layer.sha256;
    previousCount = layer.count;
    content = map;
  }
  const previousOverrides = content.reviewedRuntimeOverrides;
  if (
    !Array.isArray(previousOverrides) || previousOverrides.length !== 2 ||
    !same(previousOverrides.map((row) => row.path).sort(), OLD_RUNTIME_REPLACEMENTS) ||
    previousOverrides.some((row) => row.kind !== "runtime" || !validHash(row.previousSha256) ||
      !validHash(row.reviewedSha256) || row.previousSha256 === row.reviewedSha256 ||
      baseline.sources.find((source) => source.path === row.path)?.sha256 !== row.previousSha256)
  ) throw failure("BACKEND_HTTP_LOCAL_PREVIOUS_OVERRIDE_INVALID");
  const manifest = pinnedJson(SOURCE_MANIFEST, SOURCE_MANIFEST_SHA256);
  const expectedAdded = [
    { kind: "migration", path: BRIDGE_MIGRATION, sha256: BRIDGE_SHA256 },
    { kind: "migration", path: REVIEWED_ACK_MIGRATION, sha256: REVIEWED_ACK_SHA256 },
  ];
  const originalRunner = baseline.sources.find((row) => row.path === "workers/runner.mjs");
  const expectedOverride = [{
    kind: "runtime", path: "workers/runner.mjs",
    previousSha256: originalRunner.sha256, reviewedSha256: REVIEWED_RUNNER_SHA256,
  }];
  const expectedAdditionalRuntime = [{
    kind: "runtime", path: "app/api/v1/wallet/summary/route.ts",
    sha256: REVIEWED_WALLET_ROUTE_SHA256,
  }];
  if (
    manifest.version !== 1 || manifest.repository !== REPOSITORY ||
    manifest.reviewedSourceHead !== REVIEWED_HEAD ||
    manifest.previousManifestPath !== previousPath || manifest.previousManifestSha256 !== previousHash ||
    manifest.previousMigrationCount !== 191 || manifest.migration_count !== 193 ||
    manifest.additional_migration_count !== 2 || manifest.baselineRuntimeCount !== 29 ||
    manifest.runtime_count !== 30 || manifest.additional_runtime_count !== 1 ||
    !same(manifest.sources, expectedAdded) ||
    !same(manifest.additionalRuntimeSources, expectedAdditionalRuntime) ||
    !same(manifest.reviewedRuntimeOverrides, expectedOverride) ||
    originalRunner.sha256 === REVIEWED_RUNNER_SHA256
  ) throw failure("BACKEND_HTTP_LOCAL_SUCCESSOR_INVALID");
  const originalConfig = baseline.sources.find((row) => row.path === "supabase/config.toml");
  if (originalConfig?.sha256 !== REVIEWED_CANONICAL_CONFIG_SHA256)
    throw failure("BACKEND_HTTP_LOCAL_CANONICAL_CONFIG_PIN_CHANGED");
  const localProfile = scope === "LOCAL_QA"
    ? pinnedJson(EXECUTION_PROFILE, EXECUTION_PROFILE_SHA256) : null;
  if (localProfile && (
    !same(Object.keys(localProfile).sort(), ["version", "repository", "scope", "project_id", "api_port", "db_port", "configPath", "previousSha256", "reviewedSha256"].sort()) ||
    localProfile.version !== 1 || localProfile.repository !== REPOSITORY || localProfile.scope !== "LOCAL_QA" ||
    localProfile.project_id !== "putduk-mining-backend-patch-20261011" || localProfile.api_port !== 65421 ||
    localProfile.db_port !== 65422 || localProfile.configPath !== "supabase/config.toml" ||
    localProfile.previousSha256 !== originalConfig.sha256 || localProfile.reviewedSha256 !== REVIEWED_LOCAL_CONFIG_SHA256 ||
    localProfile.previousSha256 === localProfile.reviewedSha256
  )) throw failure("BACKEND_HTTP_LOCAL_EXECUTION_PROFILE_INVALID");
  const profile = localProfile ?? Object.freeze({
    project_id: "putduk-mining-ci-r2-20261009", api_port: 63421, db_port: 63422,
    configPath: "supabase/config.toml", reviewedSha256: REVIEWED_CANONICAL_CONFIG_SHA256,
  });
  sources.push(...expectedAdded, ...expectedAdditionalRuntime);
  const replacements = [...previousOverrides, ...expectedOverride];
  const effective = sources.map((row) => {
    if (row.path === profile.configPath) return { ...row, sha256: profile.reviewedSha256 };
    const replacement = replacements.find((candidate) => candidate.path === row.path);
    return replacement ? { ...row, sha256: replacement.reviewedSha256 } : row;
  });
  const migrations = effective.filter((row) => row.kind === "migration");
  const actual = readdirSync(owned("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => `supabase/migrations/${name}`).sort();
  if (migrations.length !== 193 || !same(actual, migrations.map((row) => row.path).sort()) ||
    new Set(effective.map((row) => row.path)).size !== effective.length)
    throw failure("BACKEND_HTTP_LOCAL_MIGRATION_INVENTORY_CHANGED");
  for (const row of effective) {
    if (!validHash(row.sha256) || !["runtime", "migration"].includes(row.kind) ||
      (row.kind === "migration" && !migrationPath(row.path)))
      throw failure("BACKEND_HTTP_LOCAL_SOURCE_SCOPE_REJECTED");
    if (hash(readFileSync(owned(row.path))) !== row.sha256)
      throw failure("BACKEND_HTTP_LOCAL_SOURCE_CHANGED");
  }
  const config = readFileSync(owned(profile.configPath), "utf8");
  const sectionPort = (name) => {
    const body = config.split(new RegExp(`^\\[${name}\\]\\s*$`, "m"))[1]?.split(/^\[/m)[0];
    return Number(body?.match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1]);
  };
  if (config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] !== profile.project_id ||
    sectionPort("api") !== profile.api_port || sectionPort("db") !== profile.db_port)
    throw failure("BACKEND_HTTP_LOCAL_CONFIG_TARGET_MISMATCH");
  return Object.freeze({
    scope, repository: REPOSITORY,
    projectId: profile.project_id, apiPort: profile.api_port, dbPort: profile.db_port,
    baselineRuntimeSources: 29, runtimeSources: 30, migrationSources: 193,
    migrationVersions: migrations.map((row) => row.path.split("/").at(-1).slice(0, 14)).sort(),
    manifestSha256: SOURCE_MANIFEST_SHA256,
    executionProfileSha256: scope === "LOCAL_QA" ? EXECUTION_PROFILE_SHA256 : null,
    previousManifestSha256: previousHash, baselineManifestSha256: BASELINE_SHA256,
  });
}

/** Optional root relocates evidence; callers cannot supply a mode or approved hash. */
export function assertBackendHttpLocalCandidateSources(root = ROOT) {
  return assertCandidateSources(root, "LOCAL_QA");
}

/** Frozen canonical config only; no task config/profile, Git or environment fallback. */
export function assertBackendHttpCanonicalCandidateSources(root = ROOT) {
  return assertCandidateSources(root, "CANONICAL_CI");
}
