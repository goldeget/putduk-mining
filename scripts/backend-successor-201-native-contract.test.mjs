import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  BACKEND201_NATIVE_SOURCE_ROOTS,
  adaptBackend201DefinerRoster,
  adaptBackend201ServiceRoleInsertFloor,
  adaptBackend201NativeInput3,
} from "./backend-successor-201-native-stage.mjs";
import {
  buildPrincipal195Fixture,
  USDT_195_FROZEN_SOURCES,
} from "./usdt-manual-195-native-fixture-v3.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(
    new URL("tests/e2e/fixtures/backend-successor-201-source.json", root),
    "utf8",
  ),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function source(path) {
  const bytes = readFileSync(new URL(path, root));
  const row = manifest.nativeFiles.find((entry) => entry.path === path);
  assert.ok(row, "exact native input must be listed");
  assert.equal(digest(bytes), row.sourceSha256);
  return { bytes, row };
}
function plan(sql) {
  return sql.match(/\bselect\s+plan\((\d+)\)/i)?.[1];
}

for (const [name, matches] of [
  ["rls.sql", 1],
  ["ws04_security_money_workers.sql", 2],
  ["ai_conversation_storage.sql", 1],
  ["ai_conversation_summaries.sql", 1],
  ["ai_tool_evidence.sql", 1],
]) {
  test(`201 ${name} adds only exact safe-mode ACK identity/count with original TAP plan`, () => {
    const { bytes, row } = source(`supabase/tests/database/${name}`);
    const result = adaptBackend201DefinerRoster(name, bytes);
    assert.equal(result.sha256, row.derivativeSha256);
    assert.equal(result.originalSha256, row.sourceSha256);
    assert.equal(result.reverseExact, true);
    assert.equal(result.changes[0].matches, matches);
    const before =
      "        'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)'::regprocedure,";
    const after =
      before +
      "\n        'app_private.ack_safe_mode_outbox(uuid,text)'::regprocedure,";
    assert.equal(result.sql.split(after).length - 1, matches);
    assert.equal(result.sql.split("select count(*) = 84").length - 1, 1);
    const reversed = result.sql
      .replaceAll(after, before)
      .replace("select count(*) = 84", "select count(*) = 83");
    assert.equal(digest(reversed), digest(bytes));
    assert.equal(Buffer.byteLength(reversed), bytes.length);
    assert.ok(plan(bytes.toString("utf8")));
    assert.equal(plan(result.sql), plan(bytes.toString("utf8")));
    assert.throws(() =>
      adaptBackend201DefinerRoster(
        name,
        Buffer.concat([bytes, Buffer.from("\n")]),
      ),
    );
  });
}

test("201 insert floor removes only reviewed first event-consumer INSERT expectation", () => {
  const { bytes, row } = source(
    "supabase/tests/database/service_role_image_default_floor.sql",
  );
  const result = adaptBackend201ServiceRoleInsertFloor(bytes);
  assert.equal(result.sha256, row.derivativeSha256);
  const before =
    "    'deposit_requests',\n    'event_consumer_deliveries',\n    'funding_principal_lots',";
  const after = "    'deposit_requests',\n    'funding_principal_lots',";
  assert.equal(digest(result.sql.replace(after, before)), digest(bytes));
  assert.equal(
    result.sql.split("'event_consumer_deliveries'").length,
    bytes.toString("utf8").split("'event_consumer_deliveries'").length - 1,
  );
  assert.equal(plan(result.sql), plan(bytes.toString("utf8")));
  assert.equal(result.reverseExact, true);
  assert.throws(() =>
    adaptBackend201ServiceRoleInsertFloor(
      Buffer.concat([bytes, Buffer.from("\n")]),
    ),
  );
});

test("201 input3 uses frozen full-payout fixture spans and preserves all other source bytes", () => {
  const { bytes, row } = source(
    "supabase/tests/database/native_principal_finalize_input3_continuity.sql",
  );
  const basis = readFileSync(
    new URL(USDT_195_FROZEN_SOURCES.principal.path, root),
  );
  const changes = buildPrincipal195Fixture(basis, {
    fullPayoutConfirmed: true,
  }).changes;
  const result = adaptBackend201NativeInput3(bytes, basis);
  assert.equal(result.sha256, row.derivativeSha256);
  assert.equal(result.reverseExact, true);
  let reversed = result.sql;
  for (const change of [...changes].reverse()) {
    assert.equal(reversed.split(change.after).length - 1, 1);
    reversed = reversed.replace(change.after, change.before);
  }
  assert.equal(digest(reversed), digest(bytes));
  assert.equal(plan(result.sql), plan(bytes.toString("utf8")));
  assert.throws(
    () =>
      adaptBackend201NativeInput3(Buffer.concat([bytes, Buffer.from("\n")])),
    /SOURCE_CHANGED/,
  );
});

test("201 staging traverses all332 pinned native files including the nine concurrent originals", () => {
  assert.ok(Object.isFrozen(BACKEND201_NATIVE_SOURCE_ROOTS));
  assert.deepEqual(BACKEND201_NATIVE_SOURCE_ROOTS, [
    "supabase/migrations",
    "supabase/tests",
    "supabase/test-fixtures",
    "supabase/tests-concurrent",
  ]);
  const actualPaths = [];
  function walk(directory) {
    for (const entry of readdirSync(new URL(directory + "/", root), {
      withFileTypes: true,
    })) {
      assert.equal(
        entry.isSymbolicLink(),
        false,
        "native inputs must be owned regular files",
      );
      const path = directory + "/" + entry.name;
      if (entry.isDirectory()) walk(path);
      else {
        assert.ok(entry.isFile(), "unexpected native input type");
        actualPaths.push(path);
      }
    }
  }
  for (const directory of BACKEND201_NATIVE_SOURCE_ROOTS) walk(directory);
  assert.equal(actualPaths.length, 332);
  assert.equal(
    new Set(actualPaths).size,
    332,
    "overlapping roots or repeated files are forbidden",
  );
  assert.deepEqual(
    actualPaths.sort(),
    manifest.nativeFiles.map((row) => row.path).sort(),
  );
  const concurrent = actualPaths.filter((path) =>
    path.startsWith("supabase/tests-concurrent/"),
  );
  assert.equal(concurrent.length, 9);
  assert.deepEqual(
    concurrent,
    manifest.nativeFiles
      .filter((row) => row.path.startsWith("supabase/tests-concurrent/"))
      .map((row) => row.path)
      .sort(),
  );
  for (const path of actualPaths) {
    const row = manifest.nativeFiles.find((entry) => entry.path === path);
    assert.ok(row);
    assert.equal(
      digest(readFileSync(new URL(path, root))),
      row.sourceSha256,
      "the traversal must copy each exact mapped input",
    );
    if (path.startsWith("supabase/tests-concurrent/")) {
      assert.deepEqual(row.changes, []);
      assert.equal(
        row.sourceSha256,
        row.derivativeSha256,
        "all nine concurrent originals remain byte-identical",
      );
    }
  }
  assert.equal(
    actualPaths.filter((path) => path.startsWith("supabase/migrations/"))
      .length,
    201,
  );
  assert.equal(
    actualPaths.filter(
      (path) =>
        path.startsWith("supabase/tests/database/") && path.endsWith(".sql"),
    ).length,
    114,
  );
});
