/** Non-secret, versioned source binding for the integrated principal browser fixture. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = "tests/e2e/fixtures/principal-integrated-source.json";
const MANIFEST_SHA =
  "e0d8481d70dc17657204196558732f21237b53a115adcdad27eddd6436c3f2ff";
const RUNTIME = [
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
  const bytes = readFileSync(owned(MANIFEST));
  if (digest(bytes) !== MANIFEST_SHA)
    throw new Error("PRINCIPAL_E2E_FROZEN_MAP_CHANGED");
  const map = JSON.parse(bytes.toString("utf8"));
  if (
    map.version !== 1 ||
    map.repository !== "goldeget/putduk-mining" ||
    map.migration_count !== 152 ||
    !Array.isArray(map.sources) ||
    map.sources.length !== 46
  ) {
    throw new Error("PRINCIPAL_E2E_RUNTIME_MAP_INVALID");
  }
  const runtime = map.sources
    .filter((row) => row.kind === "runtime")
    .map((row) => row.path)
    .sort();
  const migrations = map.sources.filter((row) => row.kind === "migration");
  if (
    JSON.stringify(runtime) !== JSON.stringify(RUNTIME) ||
    migrations.length !== 32 ||
    new Set(map.sources.map((row) => row.path)).size !== 46
  )
    throw new Error("PRINCIPAL_E2E_RUNTIME_MAP_INVALID");
  for (const row of map.sources) {
    if (
      typeof row.path !== "string" ||
      isAbsolute(row.path) ||
      row.path.split(/[\\/]/).includes("..") ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      (row.kind === "migration" &&
        !/^supabase\/migrations\/2026100613[0-9]{4}_[a-z0-9_]+\.sql$/.test(
          row.path,
        ))
    ) {
      throw new Error("PRINCIPAL_E2E_SOURCE_SCOPE_REJECTED");
    }
    if (digest(readFileSync(owned(row.path))) !== row.sha256)
      throw new Error("PRINCIPAL_E2E_SOURCE_CHANGED");
  }
  return {
    runtimeSources: 14,
    migrationSources: 32,
    manifestSha256: MANIFEST_SHA,
  };
}
