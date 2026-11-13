import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
test("retained HTTP admission rejects stale, extra and incorrect successor migrations before real Auth commands", () => {
  execFileSync(process.execPath, ["scripts/workroom-auth-retained-stage.mjs"], {
    cwd: root,
    stdio: "pipe",
  });
  const helper = readFileSync(
    new URL(
      "../test-results/workroom-auth/retained-source/http-auth.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const start = helper.indexOf("export function requireBackend195Target()");
  const end = helper.indexOf("\nfunction adminOrigin()", start);
  assert.ok(start >= 0 && end > start);
  const guard = helper.slice(start, end).replace("export function", "function");
  const evaluate = (names, localGuard = () => {}) =>
    new Function(
      "readdirSync",
      "localGuard",
      guard + "\nreturn requireBackend195Target();",
    )(() => names, localGuard);
  const names = readdirSync(new URL("../supabase/migrations", import.meta.url));
  assert.equal(evaluate(names).migrationVersions.length, 206);
  assert.throws(
    () => evaluate(names.filter((name) => !name.startsWith("20261111065929_"))),
    /WORKROOM_206_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () => evaluate(names.filter((name) => !name.startsWith("20261113061155_"))),
    /WORKROOM_206_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () =>
      evaluate(
        names.map((name) =>
          name.startsWith("20261113061155_")
            ? "20261113061154_wrong.sql"
            : name,
        ),
      ),
    /WORKROOM_206_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () =>
      evaluate(
        names.map((name) =>
          name.startsWith("20261113061155_")
            ? "20261113061155_wrong.sql"
            : name,
        ),
      ),
    /WORKROOM_206_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () => evaluate([...names, "20991231000000_unreviewed.sql"]),
    /WORKROOM_206_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () =>
      evaluate(
        names.map((name) =>
          name.startsWith("20261111065929_")
            ? "20261111065928_wrong.sql"
            : name,
        ),
      ),
    /WORKROOM_206_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () =>
      evaluate(names, () => {
        throw Error("LOCAL_TARGET_REJECTED");
      }),
    /LOCAL_TARGET_REJECTED/,
  );

  const transfer = readFileSync(
    new URL(
      "../test-results/workroom-auth/retained-source/transfer-successor.spec.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(transfer.includes("next=%2Fworkroom%2Fcash/"));
  assert.ok(transfer.includes("next=%2Fworkroom%2Fcash%2Fwithdraw/"));
  assert.ok(!transfer.includes("%2Fworkroom%2Frecords"));
  const provenance = JSON.parse(
    readFileSync(
      new URL(
        "../test-results/workroom-auth/retained-source/provenance.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(provenance.financialAssertionsReverseExact, true);
  assert.ok(
    provenance.adapters.includes(
      "206 exact migration roster and disposable guard",
    ),
  );
});

test("cash completion rejects omitted, reordered, duplicate and assertion-free206 evidence", async () => {
  const {
    assertWorkroomCashCompletion,
    WORKROOM_CASH_BEFORE_ISOLATION,
    WORKROOM_CASH_ADOPTION,
    WORKROOM_CASH_ISOLATION_MIGRATION,
    WORKROOM_CASH_TESTS,
  } = await import("./workroom-cash-admission.mjs");
  const label = (path) => path.split("/").at(-1).replaceAll(".", "-");
  const names = [
    label(WORKROOM_CASH_BEFORE_ISOLATION),
    "cash-isolation-existing-rows-before",
    label(WORKROOM_CASH_ISOLATION_MIGRATION),
    "cash-isolation-existing-rows-after",
    "cash-isolation-migration-history",
    label(WORKROOM_CASH_ADOPTION),
    ...WORKROOM_CASH_TESTS.map(label),
  ];
  const records = names.map((label) => ({ label, assertions: 1 }));
  assert.doesNotThrow(() => assertWorkroomCashCompletion(records));
  for (let i = 0; i < records.length; i++)
    assert.throws(
      () =>
        assertWorkroomCashCompletion(records.filter((_, index) => index !== i)),
      /WORKROOM_CASH_COMPLETION_PROOF_REQUIRED/,
    );
  assert.throws(
    () => assertWorkroomCashCompletion([...records].reverse()),
    /WORKROOM_CASH_COMPLETION_PROOF_REQUIRED/,
  );
  assert.throws(
    () => assertWorkroomCashCompletion([...records, records[0]]),
    /WORKROOM_CASH_COMPLETION_PROOF_REQUIRED/,
  );
  for (let i = 5; i < records.length; i++)
    assert.throws(
      () =>
        assertWorkroomCashCompletion(
          records.map((r, index) =>
            index === i ? { ...r, assertions: 0 } : r,
          ),
        ),
      /WORKROOM_CASH_COMPLETION_PROOF_REQUIRED/,
    );
});
