import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adaptWorkroomAppDefinerRoster,
  assertWorkroomAppAdmission,
  assertWorkroomAppCompletion,
  WORKROOM_APP_FILES,
  WORKROOM_APP_TESTS,
  WORKROOM_APP_MIGRATION,
} from "./workroom-app-admission.mjs";
import { createHash } from "node:crypto";
import { buildWorkroomNativeFiles } from "./workroom-native-stage.mjs";
import {
  adaptWorkroomCashDefinerRoster,
  WORKROOM_CASH_ACL_TESTS,
} from "./workroom-cash-admission.mjs";

test("207 allows exactly four additive definers and reverse preserves90 fixture", () => {
  const raw = readFileSync(
    new URL(
      "../supabase/tests/database/ai_conversation_storage.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const anchor =
    "        'app_private.workroom_cash_owner_ready(uuid)'::regprocedure,";
  const original = buildWorkroomNativeFiles().find(
    (f) => f.path === "supabase/tests/database/ai_conversation_storage.sql",
  );
  const source = adaptWorkroomCashDefinerRoster(original.successor).sql;
  const adapted = adaptWorkroomAppDefinerRoster(source);
  assert.match(adapted.sql, /select count\(\*\) = 94/);
  assert.equal(adapted.reverseExact, true);
  assert.equal(
    (adapted.sql.match(/::regprocedure/g) || []).length,
    (source.match(/::regprocedure/g) || []).length + 4,
  );
  assert.throws(
    () => adaptWorkroomAppDefinerRoster(source.replace("90", "89")),
    /90_ROSTER/,
  );
  assert.throws(
    () => adaptWorkroomAppDefinerRoster(source + anchor),
    /90_ROSTER/,
  );
  assert.ok(raw.includes("procedure.prosecdef"));
});
test("207 staged admission rejects omissions, reorder, duplicates and changed bytes", () => {
  const bytes = Buffer.from("fixture");
  const records = WORKROOM_APP_FILES.map((path) => ({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  assert.doesNotThrow(() =>
    assertWorkroomAppAdmission(
      records,
      () => bytes,
      () => bytes,
    ),
  );
  for (const bad of [
    records.slice(1),
    [...records].reverse(),
    [...records, records[0]],
  ])
    assert.throws(() =>
      assertWorkroomAppAdmission(
        bad,
        () => bytes,
        () => bytes,
      ),
    );
  assert.throws(
    () =>
      assertWorkroomAppAdmission(
        records,
        () => bytes,
        () => Buffer.from("changed"),
      ),
    /BYTES_CHANGED/,
  );
});
test("207 completion requires preservation, exact history and positive real TAP in order", () => {
  const label = (p) => p.split("/").at(-1).replaceAll(".", "-");
  const names = [
    "app-existing-rows-before",
    label(WORKROOM_APP_MIGRATION),
    "app-existing-rows-after",
    "app-migration-history",
    ...WORKROOM_CASH_ACL_TESTS.map((p) => "app-acl-" + label(p)),
    ...WORKROOM_APP_TESTS.map(label),
  ];
  const records = names.map((label) => ({ label, assertions: 1 }));
  assert.doesNotThrow(() => assertWorkroomAppCompletion(records));
  for (let i = 0; i < records.length; i++)
    assert.throws(() =>
      assertWorkroomAppCompletion(records.filter((_, j) => i !== j)),
    );
  assert.throws(() => assertWorkroomAppCompletion([...records].reverse()));
  assert.throws(() =>
    assertWorkroomAppCompletion([...records, records.at(-1)]),
  );
  const invalid = records.map((r) => ({ ...r }));
  invalid.at(-1).assertions = 0;
  assert.throws(() => assertWorkroomAppCompletion(invalid));
});
