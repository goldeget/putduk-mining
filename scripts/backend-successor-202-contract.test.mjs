import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertBackend202ManifestShape,
  assertBackend202CanonicalSources,
} from "./backend-successor-202-source.mjs";
import {
  validateReviewed202Roster,
  parseStaged202Index,
  parse202BatchBlobs,
  create202BatchDigestParser,
  read202IndexSnapshot,
} from "./pin-backend-successor-202-tracked-sources.mjs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { assertBackend202Origin } from "./backend-successor-202-source.mjs";
import { resolveBackend202Context } from "./backend-successor-202-http-context.mjs";
import { planBackend202Gates } from "./ci-backend-202.mjs";
import {
  EMPTY202,
  REQUIRED_COLUMNS202,
  CATALOG202_QUERIES,
  assertBackend202CatalogProof,
} from "./backend-successor-202-catalog.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const placeholder = JSON.parse(
  readFileSync(
    new URL(
      "../tests/e2e/fixtures/backend-successor-202-source.json",
      import.meta.url,
    ),
  ),
);
// Synthetic rejection fixture remains rejected after the root pins the real map.
placeholder.admissionState = "NOT_ACCEPTED_FINAL_INDEX_PIN_REQUIRED";
function reviewedShape() {
  const m = structuredClone(placeholder);
  m.admissionState = "REVIEWED_FINAL_INDEX_PINNED";
  for (const [path, h] of Object.entries(m.browserConsumerHashes))
    m.sourceHashes[path] = h;
  return m;
}
test("202 shape is distinct from final source admission and rejects placeholder", () => {
  assert.throws(
    () => assertBackend202ManifestShape(placeholder),
    /FINAL_INDEX_PIN_REQUIRED/,
  );
  assert.equal(
    assertBackend202ManifestShape(reviewedShape()).state,
    "SHAPE_VALIDATED_NOT_SOURCE_ADMITTED",
  );
  assert.throws(
    () => assertBackend202ManifestShape(reviewedShape(), { allowDirty: true }),
    /CALLER_OPTIONS_REJECTED/,
  );
});
test("202 root pin builder rejects automatic enrollment, extra index paths and changed reviewed bytes", () => {
  const path = "scripts/approved.mjs",
    bytes = Buffer.from("reviewed"),
    map = "tests/e2e/fixtures/backend-successor-202-source.json",
    guard = "scripts/backend-successor-202-source.mjs";
  const roster = {
    state: "OWNER_REVIEWED_EXACT_INDEX_ROSTER",
    revision: 202,
    reviewReceiptSha256: "a".repeat(64),
    sourceHashes: { [path]: hash(bytes) },
  };
  const names = [path, map, guard];
  assert.deepEqual(
    validateReviewed202Roster(roster, names, () => bytes),
    roster.sourceHashes,
  );
  assert.throws(() =>
    validateReviewed202Roster(
      { ...roster, state: "AUTOMATIC" },
      names,
      () => bytes,
    ),
  );
  assert.throws(() =>
    validateReviewed202Roster(roster, [...names, "secret.env"], () => bytes),
  );
  assert.throws(() =>
    validateReviewed202Roster(roster, names, () => Buffer.from("changed")),
  );
});
const blobOid = (bytes) =>
  createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
const staged = (path, oid, stage = 0, mode = "100644") =>
  Buffer.from(`${mode} ${oid} ${stage}\t${path}\0`);
const batchBlob = (bytes) =>
  Buffer.concat([
    Buffer.from(`${blobOid(bytes)} blob ${bytes.length}\n`),
    bytes,
    Buffer.from("\n"),
  ]);
test("202 batch index preserves spaces, UTF8 paths and exact binary/CRLF blob bytes", () => {
  const bytes = Buffer.from([0, 255, 13, 10, 10, 65, 0]),
    oid = blobOid(bytes),
    name = "docs/한글 문서.md";
  const rows = parseStaged202Index(staged(name, oid));
  assert.deepEqual(rows, [{ mode: "100644", oid, path: name }]);
  const blobs = parse202BatchBlobs(batchBlob(bytes), [oid]);
  assert.deepEqual(blobs.get(oid), {
    sha256: hash(bytes),
    bytes: bytes.length,
  });
  assert.deepEqual(
    Object.keys(blobs.get(oid)),
    ["sha256", "bytes"],
    "retains metadata only, never the aggregate blob bytes",
  );
});
test("202 batch index rejects duplicate/unmerged/nonfile/traversal and malformed UTF8 stage rosters", () => {
  const oid = blobOid(Buffer.from("x")),
    row = staged("safe path.txt", oid);
  for (const raw of [
    Buffer.concat([row, row]),
    staged("x", oid, 1),
    staged("x", oid, 0, "120000"),
    staged("../x", oid),
    Buffer.from(`100644 ${oid} 0\tx`),
    Buffer.concat([Buffer.from(`100644 ${oid} 0\t`), Buffer.from([255, 0])]),
  ])
    assert.throws(() => parseStaged202Index(raw));
});
test("202 batch blob parser rejects missing/type/order/size/OID/content/trailer/trailing-data corruption", () => {
  const bytes = Buffer.from("binary\0payload\r\n"),
    oid = blobOid(bytes),
    valid = batchBlob(bytes),
    header = Buffer.from(`${oid} blob ${bytes.length}\n`),
    other = blobOid(Buffer.from("other"));
  for (const raw of [
    Buffer.from(`${oid} missing\n`),
    Buffer.from(`${oid} tree 0\n\n`),
    Buffer.from(`${other} blob 0\n\n`),
    Buffer.concat([
      Buffer.from(`${oid} blob 99999\n`),
      bytes,
      Buffer.from("\n"),
    ]),
    Buffer.concat([header, Buffer.alloc(bytes.length), Buffer.from("\n")]),
    valid.subarray(0, valid.length - 1),
    Buffer.concat([valid, Buffer.from("unexpected")]),
    Buffer.from(`${oid} blob -1\n`),
  ])
    assert.throws(() => parse202BatchBlobs(raw, [oid]));
  assert.throws(() => parse202BatchBlobs(valid, [oid, oid]));
});
test("202 batch reader uses one unique-OID request and detects index changes before final writes", async () => {
  const bytes = Buffer.from("same bytes\r\n"),
    oid = blobOid(bytes),
    names = ["a file.txt", "문서.txt"],
    raw = Buffer.concat(names.map((p) => staged(p, oid))),
    calls = [];
  let current = raw;
  const snapshot = await read202IndexSnapshot(
    (args) => {
      calls.push({ args });
      return current;
    },
    async (oids, onChunk) => {
      calls.push({
        args: ["cat-file", "--batch"],
        input: Buffer.from(oids.join("\n") + "\n"),
      });
      onChunk(batchBlob(bytes));
    },
  );
  assert.deepEqual(snapshot.names, names);
  assert.equal(snapshot.readIndexSha256(names[1]), hash(bytes));
  assert.throws(() => snapshot.readIndexSha256("missing"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ["cat-file", "--batch"]);
  assert.equal(calls[1].input.toString(), oid + "\n");
  assert.doesNotThrow(() => snapshot.assertUnchanged());
  assert.equal(calls.length, 3);
  current = staged(names[0], blobOid(Buffer.from("changed")));
  assert.throws(() => snapshot.assertUnchanged(), /INDEX_CHANGED_DURING_PIN/);
  const map = "tests/e2e/fixtures/backend-successor-202-source.json",
    guard = "scripts/backend-successor-202-source.mjs";
  const review = {
    state: "OWNER_REVIEWED_EXACT_INDEX_ROSTER",
    revision: 202,
    reviewReceiptSha256: "a".repeat(64),
    sourceHashes: { [names[0]]: hash(Buffer.from("wrong bytes")) },
  };
  assert.throws(
    () =>
      validateReviewed202Roster(review, [names[0], map, guard], () => bytes),
    /REVIEWED_INDEX_BYTES_CHANGED/,
  );
});
test("202 streaming batch digests arbitrary chunk boundaries and empty/binary blobs without retaining payload", () => {
  const contents = [
      Buffer.alloc(0),
      Buffer.from([255, 0, 13, 10, 65, 0, 10]),
      Buffer.from("한글\n"),
    ],
    oids = contents.map(blobOid),
    raw = Buffer.concat(contents.map(batchBlob));
  for (const size of [1, 2, 7, 64, raw.length]) {
    const parser = create202BatchDigestParser(oids);
    for (let i = 0; i < raw.length; i += size)
      parser.push(raw.subarray(i, i + size));
    assert.deepEqual(
      [...parser.finish()],
      contents.map((b, i) => [oids[i], { sha256: hash(b), bytes: b.length }]),
    );
  }
  const incomplete = create202BatchDigestParser(oids);
  incomplete.push(raw.subarray(0, raw.length - 1));
  assert.throws(() => incomplete.finish(), /BATCH_TRUNCATED/);
});
test("202 streaming batch failure or truncated output cannot yield an index snapshot", async () => {
  const bytes = Buffer.from("x"),
    oid = blobOid(bytes),
    stage = staged("x", oid);
  await assert.rejects(
    read202IndexSnapshot(
      () => stage,
      async () => {
        throw Error("mock process failed");
      },
    ),
  );
  await assert.rejects(
    read202IndexSnapshot(
      () => stage,
      async (_, push) => push(batchBlob(bytes).subarray(0, -1)),
    ),
    /BATCH_TRUNCATED/,
  );
});
test("202 canonical admission rejects caller overrides", () => {
  assert.throws(
    () => assertBackend202CanonicalSources(undefined, { allowDirty: true }),
    /CALLER_OPTIONS_REJECTED/,
  );
});
for (const [name, change] of Object.entries({
  predecessor: (m) => (m.previousManifestSha256 = "a".repeat(64)),
  immutable201: (m) => (m.immutable201Migrations[200].sha256 = "a".repeat(64)),
  historical201: (m) =>
    (m.sourceHashes["scripts/ci-backend-201.mjs"] = "a".repeat(64)),
  nativeMissing: (m) => m.nativeFiles.pop(),
  nativeExtra: (m) => m.nativeFiles.push({ ...m.nativeFiles[0] }),
  ownerHash: (m) =>
    (m.sourceHashes[
      "supabase/tests/database/owner_admin_provisioning_intent.sql"
    ] = "a".repeat(64)),
  exclusions: (m) =>
    m.selfExcludedPaths.push("scripts/owner-admin-202-concurrency.mjs"),
  browser: (m) => (m.browserConsumerHashes.extra = "a".repeat(64)),
  target: (m) => (m.ciTarget.dbPort = 5432),
}))
  test("202 rejects " + name, () => {
    const m = reviewedShape();
    change(m);
    assert.throws(() => assertBackend202ManifestShape(m));
  });
test("202 catalog requires both empty owner intent tables with exact columns", () => {
  assert.ok(EMPTY202.includes("app_private.owner_admin_provision_intents"));
  assert.ok(EMPTY202.includes("app_private.owner_admin_provision_receipts"));
  assert.equal(
    REQUIRED_COLUMNS202["app_private.owner_admin_provision_receipts"]
      .receipt_digest,
    "text",
  );
  for (const table of [
    "app_private.owner_admin_provision_intents",
    "app_private.owner_admin_provision_receipts",
  ]) {
    const p = proof();
    p.counts[table] = 1;
    sync(p, 2, p.counts);
    assert.throws(() => assertBackend202CatalogProof(p, versions, cid));
  }
});
test("202 source rejects foreign/missing origin and foreign/unknown CI repository", () => {
  assert.doesNotThrow(() =>
    assertBackend202Origin("https://github.com/goldeget/putduk-mining.git", {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "goldeget/putduk-mining",
    }),
  );
  for (const origin of [
    "",
    "https://github.com/foreign/repo.git",
    "git@github.com:goldeget/putduk-mining.git",
  ])
    assert.throws(() => assertBackend202Origin(origin));
  for (const env of [
    { GITHUB_ACTIONS: "true" },
    { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "foreign/repo" },
    { GITHUB_REPOSITORY: "foreign/repo" },
  ])
    assert.throws(() =>
      assertBackend202Origin(
        "https://github.com/goldeget/putduk-mining.git",
        env,
      ),
    );
});
test("202 seam calls exactly one reader; preserves default197 and rejects unknown revision", () => {
  let old = 0,
    current = 0;
  const legacy = () => {
      old++;
      return 197;
    },
    next = () => {
      current++;
      return 202;
    };
  assert.equal(resolveBackend202Context(undefined, legacy, next), 197);
  assert.equal(old, 1);
  assert.equal(current, 0);
  assert.equal(resolveBackend202Context("202", legacy, next), 202);
  assert.equal(old, 1);
  assert.equal(current, 1);
  assert.equal(
    resolveBackend202Context("201", legacy, next, () => 201),
    201,
  );
  for (const value of ["", "197", "203"])
    assert.throws(() => resolveBackend202Context(value, legacy, next));
  assert.equal(old, 1);
  assert.equal(current, 1);
});
test("principal fixture dispatches actual revision201 and202 arguments to distinct browser readers", () => {
  const source = readFileSync(
    new URL(
      "../tests/e2e/authenticated/helpers/principal-canonical-193-fixture.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "principal-fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let call;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "reviewed" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      call = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(call?.expression.getText(ast), "resolveBackend202Context");
  assert.equal(
    call.arguments.length,
    4,
    "historical201 reader must occupy argument4 exactly",
  );
  const dispatch = new Function(
    "process",
    "resolveBackend202Context",
    "assertBackend197BrowserCanonicalSources",
    "assertBackend201BrowserCanonicalSources",
    "assertBackend202BrowserCanonicalSources",
    "return " + call.getText(ast),
  );
  for (const revision of [undefined, "201", "202"]) {
    const calls = [];
    const reader = (id) => () => {
      calls.push(id);
      return { migrationSources: id };
    };
    const result = dispatch(
      { env: { APP_ENV: "test", PUTDUK_BACKEND_SOURCE_REVISION: revision } },
      resolveBackend202Context,
      reader(197),
      reader(201),
      reader(202),
    );
    const expected = revision === undefined ? 197 : Number(revision);
    assert.equal(result.migrationSources, expected);
    assert.deepEqual(calls, [expected]);
  }
});
const versions = Array.from({ length: 202 }, (_, i) =>
    String(20261000000000 + i),
  ),
  cid = "a".repeat(64);
test("202 gate plan keeps financial assertions and separately requires owned owner-admin concurrency", () => {
  const b = {
    scope: "CANONICAL_CI",
    repository: "goldeget/putduk-mining",
    projectId: "putduk-mining-ci-r2-20261009",
    apiPort: 63421,
    dbPort: 63422,
    migrationSources: 202,
    runtimeSources: 33,
    evidenceSources: 334,
    manifestSha256: cid,
    migrationVersions: versions,
  };
  const p = planBackend202Gates(b);
  assert.deepEqual(
    p.gates.find((g) => g.id === "nativeConcurrency197").expected,
    { krw: 80, principal: 388, concurrency: 41 },
  );
  assert.equal(
    p.gates.find((g) => g.id === "ownerAdminConcurrency202").expected
      .connections,
    2,
  );
  assert.equal(
    p.gates.find((g) => g.id === "ownerAdminConcurrency202").expected
      .originalDatabaseApplicationWrites,
    0,
  );
  assert.ok(
    p.gates.every(
      (g) =>
        g.required &&
        g.skipped === 0 &&
        g.flaky === 0 &&
        g.expectedFailures === 0,
    ),
  );
  assert.throws(() => planBackend202Gates({ ...b, evidenceSources: 332 }));
});
function proof() {
  const metadata = {
    database: "postgres",
    user: "postgres",
    primary: true,
    systemIdentifier: "123",
    relations: [...EMPTY202],
    columns: structuredClone(REQUIRED_COLUMNS202),
  };
  const counts = Object.fromEntries(EMPTY202.map((n) => [n, 0]));
  const values = [metadata, versions, counts];
  return {
    state: "EXACT_202_AUTH_STORAGE_SCHEMA_EMPTY_READY",
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
    rawProcesses: CATALOG202_QUERIES.map((q, i) => {
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
test("202 catalog accepts exact18 empty tables and required Auth/Storage types", () =>
  assert.doesNotThrow(() =>
    assertBackend202CatalogProof(proof(), versions, cid),
  ));
for (const table of [
  "auth.sessions",
  "storage.objects",
  "public.kyc_cases",
  "public.kyc_submissions",
  "public.kyc_operation_receipts",
  "public.kyc_evidence_delivery_receipts",
])
  test("202 catalog rejects nonempty " + table, () => {
    const p = proof();
    p.counts[table] = 1;
    sync(p, 2, p.counts);
    assert.throws(() => assertBackend202CatalogProof(p, versions, cid));
  });
test("202 catalog rejects missing table or wrong auth AAL type", () => {
  const p = proof();
  p.metadata.relations = p.metadata.relations.filter(
    (n) => n !== "storage.objects",
  );
  sync(p, 0, p.metadata);
  assert.throws(() => assertBackend202CatalogProof(p, versions, cid));
  const q = proof();
  q.metadata.columns["auth.sessions"].aal = "text";
  sync(q, 0, q.metadata);
  assert.throws(() => assertBackend202CatalogProof(q, versions, cid));
});
test("202 catalog rejects raw tampering, missing process, different target or versions", () => {
  const p = proof();
  p.rawProcesses[0].stdout += " ";
  assert.throws(() => assertBackend202CatalogProof(p, versions, cid));
  const q = proof();
  q.rawProcesses.pop();
  assert.throws(() => assertBackend202CatalogProof(q, versions, cid));
  assert.throws(() =>
    assertBackend202CatalogProof(proof(), versions, "b".repeat(64)),
  );
  assert.throws(() =>
    assertBackend202CatalogProof(proof(), versions.slice(1), cid),
  );
});

test("202 catalog rejects proof outside the current execution clock", () => {
  assert.throws(() =>
    assertBackend202CatalogProof(proof(), versions, cid, {
      startedAt: 2,
      observedAt: 10,
    }),
  );
  assert.throws(() =>
    assertBackend202CatalogProof(proof(), versions, cid, {
      startedAt: 1,
      observedAt: 9,
    }),
  );
});

import {
  backend202HttpPaths,
  BACKEND202_PLAYWRIGHT_OUTPUT_DIRS,
} from "./backend-successor-202-http-paths.mjs";
test("202 HTTP evidence is outside every reviewed Playwright output including default root", () => {
  for (const dir of BACKEND202_PLAYWRIGHT_OUTPUT_DIRS)
    assert.doesNotThrow(() => backend202HttpPaths("/owned/repo", [dir]));
  const p = backend202HttpPaths("/owned/repo");
  assert.notEqual(p.reportOutput, p.evidenceOutput);
  assert.equal(p.intent.endsWith("execution-intent.json"), true);
  assert.equal(p.proof.endsWith("current-proof.json"), true);
});
test("202 HTTP path guard rejects equal, parent and child cleanup directories", () => {
  for (const dir of [
    "playwright-report",
    "playwright-report/backend202-http-evidence",
    "playwright-report/backend202-http-evidence/child",
  ])
    assert.throws(() => backend202HttpPaths("/owned/repo", [dir]));
  for (const dir of ["../foreign", "/foreign"])
    assert.throws(() => backend202HttpPaths("/owned/repo", [dir]));
});
