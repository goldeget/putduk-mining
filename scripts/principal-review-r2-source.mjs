/** Reviewed 187-migration successor; all earlier source maps remain immutable. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = "tests/e2e/fixtures/principal-review-r2-ci-source.json";
// Set only after the complete per-file migration/runtime delta is independently reviewed.
const MANIFEST_SHA =
  "338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1";
// Append-only authorization: the original 183-migration/29-runtime map is
// independently pinned above, and only these four reviewed additions follow it.
const SUCCESSOR_MANIFEST =
  "tests/e2e/fixtures/principal-backend-engine-187-source.json";
const SUCCESSOR_MANIFEST_SHA =
  "1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3";
const REVIEWED_SOURCE_HEAD = "c4414fae676aae959bdaeb16b02caf6d2be9b992";
const ADDITIONAL_MIGRATIONS = [
  "supabase/migrations/20261010233034_external_send_payload_binding_and_fixed_cycle_duration.sql",
  "supabase/migrations/20261011001426_explicit_member_cash_terms_read_boundary.sql",
  "supabase/migrations/20261011001444_permanent_zero_fee_policy.sql",
  "supabase/migrations/20261011003244_krw_manual_full_payout_completion.sql",
];
// Installed CLI truncates configured IDs to 36 characters; the exact newly
// created resource identity was independently captured before using this ID.
const PROJECT = "putduk-mining-ci-r2-20261009";
const CONFIGURED_PROJECT = "putduk-mining-ci-r2-20261009";
const PREVIOUS = [
  [
    "tests/e2e/fixtures/principal-review-r2-source.json",
    "c67be88e77c998e56e0df793fc0705c9e4dff2966ee17db415953aa707adc289",
  ],
  [
    "tests/e2e/fixtures/principal-integrated-source.json",
    "7c20596498cea26d9943a8fbaf3b56815cbaf65c934f468a6214815f7bfc4baf",
  ],
  [
    "tests/e2e/fixtures/principal-local-recovery-source.json",
    "7b84b1a76b113a9bc24d58eada9d31be2b93b9484ef28f1b4abde688d4a6858d",
  ],
  [
    "tests/e2e/fixtures/principal-local-recovery-source-v3.json",
    "435d6e9cffa1e3feb40742bf9100a1c030fe6a5139a902bec4a2839098e34ceb",
  ],
  [
    "tests/e2e/fixtures/principal-local-recovery-source-v4.json",
    "6d4af5c25f3a4fe45f3c60a860838c9f1d2857fa36cd51e1b287e6e5e09e53ce",
  ],
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
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Optional root only isolates negative guard tests; no environment bypass exists. */
export function assertReviewedPrincipalCandidateSources(root = ROOT) {
  const checkout = realpathSync(root);
  function owned(name) {
    const actual = realpathSync(resolve(checkout, name));
    const rel = relative(checkout, actual);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\")
    )
      throw new Error("REVIEW_R2_SOURCE_SCOPE_REJECTED");
    return actual;
  }
  for (const [name, expected] of PREVIOUS) {
    if (digest(readFileSync(owned(name))) !== expected)
      throw new Error("REVIEW_R2_PREVIOUS_FROZEN_MAP_CHANGED");
  }
  const bytes = readFileSync(owned(MANIFEST));
  if (digest(bytes) !== MANIFEST_SHA)
    throw new Error("REVIEW_R2_FROZEN_MAP_CHANGED");
  const map = JSON.parse(bytes.toString("utf8"));
  if (
    map.version !== 2 ||
    map.repository !== "goldeget/putduk-mining" ||
    map.project_id !== PROJECT ||
    map.configured_project_id !== CONFIGURED_PROJECT ||
    map.api_port !== 63421 ||
    map.baseHead !== "c08a59c20213c85a166f4338539804603faa5e69" ||
    map.baseCandidateManifestSha256 !==
      "b31d55471cca3d4520a2e0081f3458d3395d7edf408156c7a7551ef0da50d5f2" ||
    map.previousFrozenManifestSha256 !== PREVIOUS[0][1] ||
    !Number.isSafeInteger(map.migration_count) ||
    map.migration_count !== 183 ||
    !Array.isArray(map.sources) ||
    map.sources.length !== RUNTIME.length + map.migration_count
  )
    throw new Error("REVIEW_R2_SOURCE_MAP_INVALID");
  const successorBytes = readFileSync(owned(SUCCESSOR_MANIFEST));
  if (digest(successorBytes) !== SUCCESSOR_MANIFEST_SHA)
    throw new Error("REVIEW_R2_SUCCESSOR_FROZEN_MAP_CHANGED");
  const successor = JSON.parse(successorBytes.toString("utf8"));
  if (
    successor.version !== 1 ||
    successor.repository !== map.repository ||
    successor.project_id !== PROJECT ||
    successor.configured_project_id !== CONFIGURED_PROJECT ||
    successor.api_port !== map.api_port ||
    successor.reviewedSourceHead !== REVIEWED_SOURCE_HEAD ||
    successor.baselineManifestPath !== MANIFEST ||
    successor.baselineManifestSha256 !== MANIFEST_SHA ||
    successor.baselineMigrationCount !== 183 ||
    successor.baselineRuntimeCount !== RUNTIME.length ||
    successor.migration_count !== 187 ||
    successor.additional_migration_count !== 4 ||
    !Array.isArray(successor.sources) ||
    successor.sources.length !== 4 ||
    successor.sources.some((row) => row.kind !== "migration") ||
    JSON.stringify(successor.sources.map((row) => row.path).sort()) !==
      JSON.stringify(ADDITIONAL_MIGRATIONS)
  )
    throw new Error("REVIEW_R2_SUCCESSOR_SOURCE_MAP_INVALID");
  const sources = [...map.sources, ...successor.sources];
  const migrations = sources.filter((row) => row.kind === "migration");
  const runtime = map.sources
    .filter((row) => row.kind === "runtime")
    .map((row) => row.path)
    .sort();
  const actual = readdirSync(owned("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => `supabase/migrations/${name}`)
    .sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(migrations.map((row) => row.path).sort())
  )
    throw new Error("REVIEW_R2_MIGRATION_INVENTORY_CHANGED");
  if (
    migrations.length !== successor.migration_count ||
    JSON.stringify(runtime) !== JSON.stringify(RUNTIME) ||
    new Set(sources.map((row) => row.path)).size !== sources.length
  )
    throw new Error("REVIEW_R2_SOURCE_MAP_INVALID");
  for (const row of sources) {
    if (
      typeof row.path !== "string" ||
      isAbsolute(row.path) ||
      row.path.split(/[\\/]/).includes("..") ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      (row.kind !== "runtime" && row.kind !== "migration") ||
      (row.kind === "migration" &&
        !/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(row.path))
    )
      throw new Error("REVIEW_R2_SOURCE_SCOPE_REJECTED");
    if (digest(readFileSync(owned(row.path))) !== row.sha256)
      throw new Error("REVIEW_R2_SOURCE_CHANGED");
  }
  return {
    projectId: PROJECT,
    apiPort: map.api_port,
    runtimeSources: RUNTIME.length,
    migrationSources: successor.migration_count,
    migrationVersions: migrations
      .map((row) => row.path.split("/").at(-1).slice(0, 14))
      .sort(),
    manifestSha256: SUCCESSOR_MANIFEST_SHA,
    baselineManifestSha256: MANIFEST_SHA,
  };
}
