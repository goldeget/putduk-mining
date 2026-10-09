/** Non-secret, versioned source binding for the integrated principal browser fixture. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LEGACY_MANIFEST = "tests/e2e/fixtures/principal-integrated-source.json";
const LEGACY_SHA =
  "7c20596498cea26d9943a8fbaf3b56815cbaf65c934f468a6214815f7bfc4baf";
const PREVIOUS_MANIFEST =
  "tests/e2e/fixtures/principal-local-recovery-source.json";
const PREVIOUS_SHA =
  "7b84b1a76b113a9bc24d58eada9d31be2b93b9484ef28f1b4abde688d4a6858d";
const PREVIOUS_SOURCE_MANIFEST =
  "tests/e2e/fixtures/principal-local-recovery-source-v3.json";
const PREVIOUS_SOURCE_SHA =
  "435d6e9cffa1e3feb40742bf9100a1c030fe6a5139a902bec4a2839098e34ceb";
const MANIFEST = "tests/e2e/fixtures/principal-local-recovery-source-v4.json";
const MANIFEST_SHA =
  "6d4af5c25f3a4fe45f3c60a860838c9f1d2857fa36cd51e1b287e6e5e09e53ce";
const MIGRATION_COUNT = 175;
const RUNTIME = [
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
].sort();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The optional root is only for isolated guard tests; the browser uses the module's checkout. */
export function assertPrincipalCandidateSources(root = ROOT) {
  const checkout = realpathSync(root);
  function owned(path) {
    const actual = realpathSync(resolve(checkout, path));
    const rel = relative(checkout, actual);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\")
    ) {
      throw new Error("PRINCIPAL_E2E_SOURCE_SCOPE_REJECTED");
    }
    return actual;
  }
  if (digest(readFileSync(owned(LEGACY_MANIFEST))) !== LEGACY_SHA)
    throw new Error("PRINCIPAL_E2E_LEGACY_MAP_CHANGED");
  if (digest(readFileSync(owned(PREVIOUS_MANIFEST))) !== PREVIOUS_SHA)
    throw new Error("PRINCIPAL_E2E_PREVIOUS_MAP_CHANGED");
  if (
    digest(readFileSync(owned(PREVIOUS_SOURCE_MANIFEST))) !==
    PREVIOUS_SOURCE_SHA
  )
    throw new Error("PRINCIPAL_E2E_PREVIOUS_SOURCE_MAP_CHANGED");
  const bytes = readFileSync(owned(MANIFEST));
  if (digest(bytes) !== MANIFEST_SHA)
    throw new Error("PRINCIPAL_E2E_FROZEN_MAP_CHANGED");
  const map = JSON.parse(bytes.toString("utf8"));
  if (
    map.version !== 4 ||
    map.repository !== "goldeget/putduk-mining" ||
    map.migration_count !== MIGRATION_COUNT ||
    map.baselineManifestSha256 !== LEGACY_SHA ||
    map.previousManifestSha256 !== PREVIOUS_SHA ||
    map.previousSourceManifestSha256 !== PREVIOUS_SOURCE_SHA ||
    !Array.isArray(map.sources) ||
    map.sources.length !== RUNTIME.length + MIGRATION_COUNT
  ) {
    throw new Error("PRINCIPAL_E2E_RUNTIME_MAP_INVALID");
  }
  const runtime = map.sources
    .filter((row) => row.kind === "runtime")
    .map((row) => row.path)
    .sort();
  const migrations = map.sources.filter((row) => row.kind === "migration");
  const actualMigrations = readdirSync(owned("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => `supabase/migrations/${name}`)
    .sort();
  if (
    JSON.stringify(actualMigrations) !==
    JSON.stringify(migrations.map((row) => row.path).sort())
  )
    throw new Error("PRINCIPAL_E2E_MIGRATION_INVENTORY_CHANGED");
  if (
    JSON.stringify(runtime) !== JSON.stringify(RUNTIME) ||
    migrations.length !== MIGRATION_COUNT ||
    new Set(map.sources.map((row) => row.path)).size !==
      RUNTIME.length + MIGRATION_COUNT
  )
    throw new Error("PRINCIPAL_E2E_RUNTIME_MAP_INVALID");
  for (const row of map.sources) {
    if (
      typeof row.path !== "string" ||
      isAbsolute(row.path) ||
      row.path.split(/[\\/]/).includes("..") ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      (row.kind === "migration" &&
        !/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(row.path))
    ) {
      throw new Error("PRINCIPAL_E2E_SOURCE_SCOPE_REJECTED");
    }
    if (digest(readFileSync(owned(row.path))) !== row.sha256)
      throw new Error("PRINCIPAL_E2E_SOURCE_CHANGED");
  }
  return {
    runtimeSources: 15,
    migrationSources: MIGRATION_COUNT,
    manifestSha256: MANIFEST_SHA,
  };
}
