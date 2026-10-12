/** Independent 195-candidate boundary. File reads/hashes only; no historic guard calls. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPOSITORY = "goldeget/putduk-mining";
const REVIEWED_HEAD = "e220356be85a56e21e3469023b19b0c2fd4aebba";
const HISTORICAL_193_SHA256 = "8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922";
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

const HISTORICAL_193_MANIFEST = "tests/e2e/fixtures/backend-http-local-193-source.json";
const EXECUTION_PROFILE = "tests/e2e/fixtures/backend-http-local-execution-profile.json";
const SOURCE_MANIFEST = "tests/e2e/fixtures/backend-http-195-source.json";
// Coordinator sets only after the manifest and independent review are final.
// An empty pin rejects execution. Neither environment nor manifest can approve it.
const SOURCE_MANIFEST_SHA256 = "0d078c0787b5619edfebd800f3f6a5f00848540d97373fac369c87872313b3df";
const NEW_MIGRATIONS = [
  "supabase/migrations/20261011132851_usdt_manual_full_payout_contract.sql",
  "supabase/migrations/20261011132924_withdrawal_lifecycle_outbox_ack.sql",
];
const NEW_OVERRIDES = ["lib/ai/usage.ts", "workers/runner.mjs"];
const NEW_RUNTIME = [
  "app/api/v1/ai/chat/route.ts",
  "apps/admin/app/api/v1/admin/withdrawals/command/route.ts",
  "apps/admin/lib/withdrawals/usdt-manual-payout-contract.ts",
];
const REQUIRED_EVIDENCE = [
  "scripts/ci-backend-195.mjs",
  "scripts/ci-backend-195.d.mts",
  "playwright.backend-http-195.config.ts",
  "tests/unit/backend-http-195-consumer.test.ts",
  "tests/e2e/authenticated/helpers/backend-http-195-auth.ts",
  "tests/e2e/authenticated/helpers/usdt-manual-195-fixture.ts",
  "tests/e2e/authenticated/usdt-manual-full-payout-195.spec.ts",
  "scripts/usdt-manual-195-native-fixture.mjs",
  "scripts/usdt-manual-195-native-fixture.d.mts",
  "tests/unit/usdt-manual-195-fixture.test.ts",
  "tests/unit/usdt-manual-payout-contract.test.ts",
  "tests/unit/withdrawal-lifecycle-worker.test.ts",
  "tests/unit/ai-chat-audit-persistence-failure.test.ts",
  "tests/unit/ai-persistence-recovery-regression.test.ts",
  "tests/unit/ai-member-help-route.test.ts",
  "supabase/tests/database/usdt_manual_full_payout_contract.sql",
  "supabase/tests/database/withdrawal_lifecycle_outbox_ack.sql",
  "supabase/test-fixtures/principal_finalize_current_basis.sql",
  "supabase/tests/database/native_principal_finalize_input3_continuity.sql",
  "supabase/tests/database/krw_deposit_journal_integrity.sql",
  "tests/integration/external-send-concurrency.py",
  "tests/e2e/fixtures/authenticated-setup.ts",
  "scripts/e2e-web-server.mjs",
  "apps/admin/app/api/v1/admin/session/totp-verify/route.ts",
  "apps/admin/app/api/v1/admin/session/step-up/route.ts",
  "apps/admin/app/api/v1/admin/session/mfa-confirmed/route.ts",
  "apps/admin/app/login/page.tsx",
  "apps/admin/proxy.ts",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const validHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const migrationPath = (value) => typeof value === "string" && /^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(value);
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value) && same(Object.keys(value).sort(), [...expected].sort());

function assertCandidateSources(root, scope) {
  const failure = (suffix) => new Error("BACKEND_HTTP_195_" + suffix);
  if (!validHash(SOURCE_MANIFEST_SHA256)) throw failure("UNREVIEWED_MANIFEST");
  const ownedRoot = realpathSync(root);
  const owned = (name) => {
    if (typeof name !== "string" || name.includes("\\") || isAbsolute(name) || name.split("/").some((part) => !part || part === "." || part === "..")) throw failure("PATH_REJECTED");
    let target;
    try { target = realpathSync(resolve(ownedRoot, name)); }
    catch { throw failure("SOURCE_MISSING"); }
    const location = relative(ownedRoot, target);
    if (!location || isAbsolute(location) || location === ".." || location.startsWith("../") || location.startsWith("..\\")) throw failure("PATH_REJECTED");
    return target;
  };
  const pinnedJson = (path, approvedHash) => {
    if (!validHash(approvedHash) || hash(readFileSync(owned(path))) !== approvedHash) throw failure("MANIFEST_CHANGED");
    try { return JSON.parse(readFileSync(owned(path), "utf8")); }
    catch { throw failure("MANIFEST_INVALID"); }
  };
  const sourceRow = (row, kind) => keys(row, ["kind", "path", "sha256"]) && row.kind === kind && typeof row.path === "string" && validHash(row.sha256) && (kind !== "migration" || migrationPath(row.path));
  for (const [name, pin] of PREDECESSORS) pinnedJson("tests/e2e/fixtures/" + name, pin);
  const baseline = pinnedJson(BASELINE_MANIFEST, BASELINE_SHA256);
  if (baseline.version !== 2 || baseline.repository !== REPOSITORY || baseline.configured_project_id !== "putduk-mining-ci-r2-20261009" || baseline.api_port !== 63421 || baseline.migration_count !== 183 || !Array.isArray(baseline.sources) || baseline.sources.length !== 212 || !same(baseline.sources.filter((row) => row.kind === "runtime").map((row) => row.path).sort(), RUNTIME) || !baseline.sources.every((row) => sourceRow(row, row.kind) && ["runtime", "migration"].includes(row.kind))) throw failure("HISTORY_INVALID");
  const sources = [...baseline.sources];
  let previousPath = BASELINE_MANIFEST, previousHash = BASELINE_SHA256, previousCount = 183;
  let lastLayer;
  for (const layer of LAYERS) {
    const value = pinnedJson(layer.path, layer.sha256);
    if (value.version !== 1 || value.repository !== REPOSITORY || value.configured_project_id !== baseline.configured_project_id || value.api_port !== 63421 || value.baselineManifestPath !== BASELINE_MANIFEST || value.baselineManifestSha256 !== BASELINE_SHA256 || value.baselineMigrationCount !== 183 || value.baselineRuntimeCount !== 29 || value.migration_count !== layer.count || value.additional_migration_count !== layer.added || !Array.isArray(value.sources) || value.sources.length !== layer.added || !value.sources.every((row) => sourceRow(row, "migration")) || (previousCount !== 183 && (value.previousManifestPath !== previousPath || value.previousManifestSha256 !== previousHash || value.previousMigrationCount !== previousCount))) throw failure("HISTORY_INVALID");
    sources.push(...value.sources);
    previousPath = layer.path; previousHash = layer.sha256; previousCount = layer.count; lastLayer = value;
  }
  const oldOverrides = lastLayer.reviewedRuntimeOverrides;
  if (!Array.isArray(oldOverrides) || !same(oldOverrides.map((row) => row.path).sort(), OLD_RUNTIME_REPLACEMENTS) || !oldOverrides.every((row) => keys(row, ["kind", "path", "previousSha256", "reviewedSha256"]) && row.kind === "runtime" && validHash(row.reviewedSha256) && baseline.sources.find((item) => item.path === row.path)?.sha256 === row.previousSha256 && row.previousSha256 !== row.reviewedSha256)) throw failure("HISTORY_OVERRIDE_INVALID");
  const historical193 = pinnedJson(HISTORICAL_193_MANIFEST, HISTORICAL_193_SHA256);
  const originalRunner = baseline.sources.find((row) => row.path === "workers/runner.mjs");
  const expected193Added = [
    { kind: "migration", path: BRIDGE_MIGRATION, sha256: BRIDGE_SHA256 },
    { kind: "migration", path: REVIEWED_ACK_MIGRATION, sha256: REVIEWED_ACK_SHA256 },
  ];
  const expected193Override = [{ kind: "runtime", path: "workers/runner.mjs", previousSha256: originalRunner?.sha256, reviewedSha256: REVIEWED_RUNNER_SHA256 }];
  const expected193Runtime = [{ kind: "runtime", path: "app/api/v1/wallet/summary/route.ts", sha256: REVIEWED_WALLET_ROUTE_SHA256 }];
  if (historical193.version !== 1 || historical193.repository !== REPOSITORY || historical193.reviewedSourceHead !== REVIEWED_HEAD || historical193.previousManifestPath !== previousPath || historical193.previousManifestSha256 !== previousHash || historical193.previousMigrationCount !== 191 || historical193.migration_count !== 193 || historical193.additional_migration_count !== 2 || historical193.baselineRuntimeCount !== 29 || historical193.runtime_count !== 30 || historical193.additional_runtime_count !== 1 || !same(historical193.sources, expected193Added) || !same(historical193.reviewedRuntimeOverrides, expected193Override) || !same(historical193.additionalRuntimeSources, expected193Runtime)) throw failure("HISTORY_193_INVALID");
  sources.push(...expected193Added, ...expected193Runtime);
  const historicalEffective = sources.map((row) => {
    const override = [...oldOverrides, ...expected193Override].find((item) => item.path === row.path);
    return override ? { ...row, sha256: override.reviewedSha256 } : row;
  });
  const candidate = pinnedJson(SOURCE_MANIFEST, SOURCE_MANIFEST_SHA256);
  if (!keys(candidate, ["version", "repository", "reviewedSourceHead", "previousManifestPath", "previousManifestSha256", "previousMigrationCount", "migration_count", "additional_migration_count", "baselineRuntimeCount", "runtime_count", "additional_runtime_count", "sources", "reviewedRuntimeOverrides", "additionalRuntimeSources", "evidenceSources", "evidence_count"]) || candidate.version !== 1 || candidate.repository !== REPOSITORY || candidate.reviewedSourceHead !== REVIEWED_HEAD || candidate.previousManifestPath !== HISTORICAL_193_MANIFEST || candidate.previousManifestSha256 !== HISTORICAL_193_SHA256 || candidate.previousMigrationCount !== 193 || candidate.migration_count !== 195 || candidate.additional_migration_count !== 2 || candidate.baselineRuntimeCount !== 30 || candidate.runtime_count !== 33 || candidate.additional_runtime_count !== 3 || !Array.isArray(candidate.sources) || !same(candidate.sources.map((row) => row.path), NEW_MIGRATIONS) || !candidate.sources.every((row) => sourceRow(row, "migration")) || !Array.isArray(candidate.reviewedRuntimeOverrides) || !same(candidate.reviewedRuntimeOverrides.map((row) => row.path).sort(), NEW_OVERRIDES) || !candidate.reviewedRuntimeOverrides.every((row) => keys(row, ["kind", "path", "previousSha256", "reviewedSha256"]) && row.kind === "runtime" && validHash(row.reviewedSha256) && historicalEffective.find((item) => item.path === row.path)?.sha256 === row.previousSha256 && row.previousSha256 !== row.reviewedSha256) || !Array.isArray(candidate.additionalRuntimeSources) || !same(candidate.additionalRuntimeSources.map((row) => row.path).sort(), NEW_RUNTIME) || !candidate.additionalRuntimeSources.every((row) => sourceRow(row, "runtime")) || !Array.isArray(candidate.evidenceSources) || !Number.isInteger(candidate.evidence_count) || candidate.evidence_count !== candidate.evidenceSources.length || !candidate.evidenceSources.every((row) => sourceRow(row, "evidence"))) throw failure("SUCCESSOR_INVALID");
  const originalConfig = baseline.sources.find((row) => row.path === "supabase/config.toml");
  if (!REQUIRED_EVIDENCE.every((path) => candidate.evidenceSources.some((row) => row.path === path))) throw failure("EVIDENCE_ROSTER_INCOMPLETE");
  if (originalConfig?.sha256 !== REVIEWED_CANONICAL_CONFIG_SHA256) throw failure("CONFIG_PIN_CHANGED");
  const profile = scope === "LOCAL_QA" ? pinnedJson(EXECUTION_PROFILE, EXECUTION_PROFILE_SHA256) : {
    project_id: "putduk-mining-ci-r2-20261009", api_port: 63421, db_port: 63422,
    configPath: "supabase/config.toml", reviewedSha256: REVIEWED_CANONICAL_CONFIG_SHA256,
  };
  if (scope === "LOCAL_QA" && (!keys(profile, ["version", "repository", "scope", "project_id", "api_port", "db_port", "configPath", "previousSha256", "reviewedSha256"]) || profile.version !== 1 || profile.repository !== REPOSITORY || profile.scope !== "LOCAL_QA" || profile.project_id !== "putduk-mining-backend-patch-20261011" || profile.api_port !== 65421 || profile.db_port !== 65422 || profile.configPath !== "supabase/config.toml" || profile.previousSha256 !== REVIEWED_CANONICAL_CONFIG_SHA256 || profile.reviewedSha256 !== REVIEWED_LOCAL_CONFIG_SHA256)) throw failure("EXECUTION_PROFILE_INVALID");
  const effective = [...historicalEffective, ...candidate.sources, ...candidate.additionalRuntimeSources].map((row) => {
    if (row.path === profile.configPath) return { ...row, sha256: profile.reviewedSha256 };
    const override = candidate.reviewedRuntimeOverrides.find((item) => item.path === row.path);
    return override ? { ...row, sha256: override.reviewedSha256 } : row;
  });
  const migrations = effective.filter((row) => row.kind === "migration");
  const actual = readdirSync(owned("supabase/migrations")).filter((name) => name.endsWith(".sql")).map((name) => "supabase/migrations/" + name).sort();
  if (migrations.length !== 195 || effective.filter((row) => row.kind === "runtime").length !== 33 || !same(actual, migrations.map((row) => row.path).sort()) || new Set([...effective, ...candidate.evidenceSources].map((row) => row.path)).size !== effective.length + candidate.evidenceSources.length) throw failure("INVENTORY_CHANGED");
  for (const row of [...effective, ...candidate.evidenceSources]) {
    if (hash(readFileSync(owned(row.path))) !== row.sha256) throw failure("SOURCE_CHANGED");
  }
  const config = readFileSync(owned(profile.configPath), "utf8");
  const sectionPort = (name) => Number(config.split(new RegExp("^\\[" + name + "\\]\\s*$", "m"))[1]?.split(/^\[/m)[0]?.match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1]);
  if (config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] !== profile.project_id || sectionPort("api") !== profile.api_port || sectionPort("db") !== profile.db_port) throw failure("CONFIG_TARGET_MISMATCH");
  return Object.freeze({
    scope, repository: REPOSITORY, projectId: profile.project_id, apiPort: profile.api_port, dbPort: profile.db_port,
    baselineRuntimeSources: 30, runtimeSources: 33, migrationSources: 195,
    evidenceSources: candidate.evidence_count, migrationVersions: Object.freeze(migrations.map((row) => row.path.split("/").at(-1).slice(0, 14)).sort()),
    manifestSha256: SOURCE_MANIFEST_SHA256, executionProfileSha256: scope === "LOCAL_QA" ? EXECUTION_PROFILE_SHA256 : null,
    previousManifestSha256: HISTORICAL_193_SHA256, baselineManifestSha256: BASELINE_SHA256,
  });
}

/** Whole canonical config only; no caller-selected mode, pins or environment fallbacks. */
export function assertBackendHttp195CanonicalCandidateSources(root = ROOT) {
  if (arguments.length > 1) throw new Error("BACKEND_HTTP_195_CALLER_OPTIONS_REJECTED");
  return assertCandidateSources(root, "CANONICAL_CI");
}

/** Exact task-local config only, independently pinned; never a canonical-config bypass. */
export function assertBackendHttp195LocalCandidateSources(root = ROOT) {
  if (arguments.length > 1) throw new Error("BACKEND_HTTP_195_CALLER_OPTIONS_REJECTED");
  return assertCandidateSources(root, "LOCAL_QA");
}
