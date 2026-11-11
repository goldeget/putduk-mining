import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  WORKROOM_CASH_FILES,
  assertWorkroomCashAdmission,
  adaptWorkroomCashDefinerRoster,
} from "./workroom-cash-admission.mjs";

const content = new Map(WORKROOM_CASH_FILES.map((p) => [p, Buffer.from(p)]));
const rows = WORKROOM_CASH_FILES.map((path) => ({
  path,
  sha256: createHash("sha256").update(content.get(path)).digest("hex"),
}));
const read = (path) => content.get(path);

test("cash admission rejects omitted, duplicate, reordered and unknown inputs", () => {
  assert.doesNotThrow(() => assertWorkroomCashAdmission(rows, read, read));
  for (const candidate of [
    rows.slice(1),
    [rows[0], rows[1], rows[1]],
    [...rows].reverse(),
    [...rows, { path: "unreviewed.sql", sha256: rows[0].sha256 }],
  ])
    assert.throws(
      () => assertWorkroomCashAdmission(candidate, read, read),
      /EXACT_ROSTER_REQUIRED/,
    );
});

test("cash admission rejects changed source, changed stage and forged digest", () => {
  const tampered = (path) =>
    path === WORKROOM_CASH_FILES[0]
      ? Buffer.from("changed money rule")
      : read(path);
  assert.throws(
    () => assertWorkroomCashAdmission(rows, tampered, read),
    /STAGED_BYTES_CHANGED/,
  );
  assert.throws(
    () => assertWorkroomCashAdmission(rows, read, tampered),
    /STAGED_BYTES_CHANGED/,
  );
  assert.throws(
    () =>
      assertWorkroomCashAdmission(
        rows.map((row, i) =>
          i === 0 ? { ...row, sha256: "0".repeat(64) } : row,
        ),
        read,
        read,
      ),
    /STAGED_BYTES_CHANGED/,
  );
});

test("cash definer admission extends the exact historical fixture without relaxing its checks", () => {
  const original =
    "-- existing checks\n        'app_private.resolve_operator_login_email(text)'::regprocedure,\nselect count(*) = 89\n-- retained grants and policy assertions";
  const result = adaptWorkroomCashDefinerRoster(original);
  assert.equal(result.reverseExact, true);
  assert.match(result.sql, /workroom_cash_owner_ready\(uuid\)/);
  assert.match(result.sql, /select count\(\*\) = 90/);
  assert.match(result.sql, /retained grants and policy assertions/);
  const twoLists =
    original +
    "\n        'app_private.resolve_operator_login_email(text)'::regprocedure,";
  assert.throws(
    () => adaptWorkroomCashDefinerRoster(twoLists),
    /89_ROSTER_REQUIRED/,
  );
  const twoResult = adaptWorkroomCashDefinerRoster(twoLists, {
    occurrences: 2,
  });
  assert.equal(
    (twoResult.sql.match(/workroom_cash_owner_ready\(uuid\)/g) ?? []).length,
    2,
  );
  assert.equal(twoResult.reverseExact, true);
  for (const malformed of [
    original.replace("89", "88"),
    original + original,
    "",
  ])
    assert.throws(
      () => adaptWorkroomCashDefinerRoster(malformed),
      /89_ROSTER_REQUIRED/,
    );
});
