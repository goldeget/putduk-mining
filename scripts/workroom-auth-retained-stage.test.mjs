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
  assert.equal(evaluate(names).migrationVersions.length, 203);
  assert.throws(
    () => evaluate(names.filter((name) => !name.startsWith("20261111065929_"))),
    /WORKROOM_203_MIGRATION_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () => evaluate([...names, "20991231000000_unreviewed.sql"]),
    /WORKROOM_203_MIGRATION_CONTEXT_REQUIRED/,
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
    /WORKROOM_203_MIGRATION_CONTEXT_REQUIRED/,
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
      "203 exact migration roster and disposable guard",
    ),
  );
});
