import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWorkroomNativeFiles } from "./workroom-native-stage.mjs";
import {
  assertNativeTap,
  assertWorkroomLegacyReceipt,
} from "./workroom-native-runner.mjs";
import { adaptWorkroomPractice } from "./workroom-native-adapters.mjs";
import {
  buildConcurrency195Fixture,
  USDT_195_FROZEN_SOURCES,
} from "./usdt-manual-195-native-fixture-v3.mjs";
test("complete historical332 roster is unchanged and successor derivatives match reviewed hashes", () => {
  const files = buildWorkroomNativeFiles();
  assert.equal(files.length, 332);
  assert.equal(
    files.filter((x) => x.path.startsWith("supabase/migrations/")).length,
    201,
  );
  assert.equal(
    files.filter(
      (x) =>
        x.path.startsWith("supabase/tests/database/") &&
        x.path.endsWith(".sql"),
    ).length,
    114,
  );
  assert.deepEqual(
    files.map(({ path, sourceSha256, baselineSha256, successorSha256 }) => ({
      path,
      sourceSha256,
      baselineSha256,
      successorSha256,
    })),
    JSON.parse(
      readFileSync(
        new URL("./workroom-native-roster.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  for (const f of files.filter((x) =>
    x.path.startsWith("supabase/migrations/"),
  ))
    assert.equal(f.successor, f.baseline);
});
test("historical external-send v3 adapter preserves frozen financial source", () => {
  const source = readFileSync(
    new URL("../" + USDT_195_FROZEN_SOURCES.concurrency.path, import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const r = buildConcurrency195Fixture(source, { fullPayoutConfirmed: true });
  assert.equal(r.changes.length, 2);
  assert.match(r.sql, /def verify\(method/);
  assert.match(r.sql, /SAME_REQUEST_TWO_SESSIONS_ONE_ID/);
});
test("TAP cannot pass with zero assertions, partial plan, failure or bailout", () => {
  assert.equal(assertNativeTap("ok 1 - protected\nok 2 - atomic\n1..2\n"), 2);
  for (const raw of [
    "1..0\n",
    "ok 1\n1..2\n",
    "not ok 1\n1..1\n",
    "ok 1\n1..1\nBail out!",
  ])
    assert.throws(() => assertNativeTap(raw), /COMPLETE_TAP_REQUIRED/);
});
test("WORKROOM native practice preserves invalid/replay signup assertions and uses actual time", () => {
  const original = readFileSync(
    new URL(
      "../supabase/tests/database/workroom_practice.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const r = adaptWorkroomPractice(original);
  assert.doesNotMatch(r.sql, /session_replication_role/);
  assert.match(r.sql, /pg_sleep\(31\)/);
  assert.equal((r.sql.match(/pg_sleep\(31\);/g) || []).length, 2);
  assert.match(r.sql, /perform pg_sleep\(11.1\)/);
  assert.match(r.sql, /'WORKROOM_INVITATION_REQUIRED'/);
  assert.match(r.sql, /'WORKROOM_INVITATION_INVALID'/);
  assert.doesNotMatch(r.sql, /insert into app_private.workroom_cohort/);
  assert.match(r.sql, /id,email,email_confirmed_at,raw_user_meta_data/);
});
test("split legacy proof rejects omitted suites, duplicate suites, wrong HEAD and changed DB container", () => {
  const labels = Array.from({ length: 114 }, (_, i) => "suite-" + i);
  const proof = {
    kind: "WORKROOM_NATIVE_PHASE",
    phase: "legacy",
    principal: null,
    state: "PASSED",
    head: "candidate",
    containerId: "owned-db",
    records: [{ label: "preflight" }, ...labels.map((label) => ({ label }))],
  };
  const ctx = { head: "candidate", containerId: "owned-db" };
  assert.doesNotThrow(() => assertWorkroomLegacyReceipt(proof, labels, ctx));
  for (const changed of [
    { ...proof, head: "older" },
    { ...proof, containerId: "other-db" },
    { ...proof, records: proof.records.slice(1) },
    {
      ...proof,
      records: [...proof.records.slice(0, -1), { label: labels[0] }],
    },
  ])
    assert.throws(
      () => assertWorkroomLegacyReceipt(changed, labels, ctx),
      /LEGACY_114_REQUIRED/,
    );
});
