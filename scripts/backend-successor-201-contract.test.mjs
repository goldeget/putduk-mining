import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertBackend201Origin } from "./backend-successor-201-source.mjs";
import { resolveBackend201Context } from "./backend-successor-201-http-context.mjs";
import {
  EMPTY201,
  REQUIRED_COLUMNS201,
  CATALOG201_QUERIES,
  assertBackend201CatalogProof,
} from "./backend-successor-201-catalog.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
test("201 source rejects foreign/missing origin and foreign/unknown CI repository", () => {
  assert.doesNotThrow(() =>
    assertBackend201Origin("https://github.com/goldeget/putduk-mining.git", {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "goldeget/putduk-mining",
    }),
  );
  for (const origin of [
    "",
    "https://github.com/foreign/repo.git",
    "git@github.com:goldeget/putduk-mining.git",
  ])
    assert.throws(() => assertBackend201Origin(origin));
  for (const env of [
    { GITHUB_ACTIONS: "true" },
    { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "foreign/repo" },
    { GITHUB_REPOSITORY: "foreign/repo" },
  ])
    assert.throws(() =>
      assertBackend201Origin(
        "https://github.com/goldeget/putduk-mining.git",
        env,
      ),
    );
});
test("201 seam calls exactly one reader; preserves default197 and rejects unknown revision", () => {
  let old = 0,
    current = 0;
  const legacy = () => {
      old++;
      return 197;
    },
    next = () => {
      current++;
      return 201;
    };
  assert.equal(resolveBackend201Context(undefined, legacy, next), 197);
  assert.equal(old, 1);
  assert.equal(current, 0);
  assert.equal(resolveBackend201Context("201", legacy, next), 201);
  assert.equal(old, 1);
  assert.equal(current, 1);
  for (const value of ["", "197", "202"])
    assert.throws(() => resolveBackend201Context(value, legacy, next));
  assert.equal(old, 1);
  assert.equal(current, 1);
});
const versions = Array.from({ length: 201 }, (_, i) =>
    String(20261000000000 + i),
  ),
  cid = "a".repeat(64);
function proof() {
  const metadata = {
    database: "postgres",
    user: "postgres",
    primary: true,
    systemIdentifier: "123",
    relations: [...EMPTY201],
    columns: structuredClone(REQUIRED_COLUMNS201),
  };
  const counts = Object.fromEntries(EMPTY201.map((n) => [n, 0]));
  const values = [metadata, versions, counts];
  return {
    state: "EXACT_201_AUTH_STORAGE_SCHEMA_EMPTY_READY",
    containerId: cid,
    startedAt: 1,
    finishedAt: 10,
    metadata,
    migrationVersions: versions,
    expectedMigrationVersions: versions,
    counts,
    absentTables: [],
    missingOrWrongTypeColumns: {},
    existingProtectedTablesEmpty: true,
    schemaAndCatalogReady: true,
    rawProcesses: CATALOG201_QUERIES.map((q, i) => {
      const stdout = JSON.stringify(values[i]);
      return {
        label: q.label,
        sqlSha256: hash(q.sql),
        stdout,
        stderr: "",
        stdoutSha256: hash(stdout),
        stderrSha256: hash(""),
        exitCode: 0,
        timedOut: false,
        startedAt: i + 2,
        finishedAt: i + 3,
      };
    }),
  };
}
function sync(p, index, value) {
  p.rawProcesses[index].stdout = JSON.stringify(value);
  p.rawProcesses[index].stdoutSha256 = hash(p.rawProcesses[index].stdout);
}
test("201 catalog accepts exact16 empty tables and required Auth/Storage types", () =>
  assert.doesNotThrow(() =>
    assertBackend201CatalogProof(proof(), versions, cid),
  ));
for (const table of [
  "auth.sessions",
  "storage.objects",
  "public.kyc_cases",
  "public.kyc_submissions",
  "public.kyc_operation_receipts",
  "public.kyc_evidence_delivery_receipts",
])
  test("201 catalog rejects nonempty " + table, () => {
    const p = proof();
    p.counts[table] = 1;
    sync(p, 2, p.counts);
    assert.throws(() => assertBackend201CatalogProof(p, versions, cid));
  });
test("201 catalog rejects missing table or wrong auth AAL type", () => {
  const p = proof();
  p.metadata.relations = p.metadata.relations.filter(
    (n) => n !== "storage.objects",
  );
  sync(p, 0, p.metadata);
  assert.throws(() => assertBackend201CatalogProof(p, versions, cid));
  const q = proof();
  q.metadata.columns["auth.sessions"].aal = "text";
  sync(q, 0, q.metadata);
  assert.throws(() => assertBackend201CatalogProof(q, versions, cid));
});
test("201 catalog rejects raw tampering, missing process, different target or versions", () => {
  const p = proof();
  p.rawProcesses[0].stdout += " ";
  assert.throws(() => assertBackend201CatalogProof(p, versions, cid));
  const q = proof();
  q.rawProcesses.pop();
  assert.throws(() => assertBackend201CatalogProof(q, versions, cid));
  assert.throws(() =>
    assertBackend201CatalogProof(proof(), versions, "b".repeat(64)),
  );
  assert.throws(() =>
    assertBackend201CatalogProof(proof(), versions.slice(1), cid),
  );
});

test("201 catalog rejects proof outside the current execution clock", () => {
  assert.throws(() =>
    assertBackend201CatalogProof(proof(), versions, cid, {
      startedAt: 2,
      observedAt: 10,
    }),
  );
  assert.throws(() =>
    assertBackend201CatalogProof(proof(), versions, cid, {
      startedAt: 1,
      observedAt: 9,
    }),
  );
});

import {
  backend201HttpPaths,
  BACKEND201_PLAYWRIGHT_OUTPUT_DIRS,
} from "./backend-successor-201-http-paths.mjs";
test("201 HTTP evidence is outside every reviewed Playwright output including default root", () => {
  for (const dir of BACKEND201_PLAYWRIGHT_OUTPUT_DIRS)
    assert.doesNotThrow(() => backend201HttpPaths("/owned/repo", [dir]));
  const p = backend201HttpPaths("/owned/repo");
  assert.notEqual(p.reportOutput, p.evidenceOutput);
  assert.equal(p.intent.endsWith("execution-intent.json"), true);
  assert.equal(p.proof.endsWith("current-proof.json"), true);
});
test("201 HTTP path guard rejects equal, parent and child cleanup directories", () => {
  for (const dir of [
    "playwright-report",
    "playwright-report/backend201-http-evidence",
    "playwright-report/backend201-http-evidence/child",
  ])
    assert.throws(() => backend201HttpPaths("/owned/repo", [dir]));
  for (const dir of ["../foreign", "/foreign"])
    assert.throws(() => backend201HttpPaths("/owned/repo", [dir]));
});
