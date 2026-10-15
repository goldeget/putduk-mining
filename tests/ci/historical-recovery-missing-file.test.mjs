import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  prepareBackend197UnitFixtures,
  prepareHistorical195UnitFixtures,
  readHistoricalRecoveryFixtureSource,
  readHistoricalRecoverySource,
  verifyHistoricalRecoveryBytes,
} from "../../scripts/historical-recovery-unit-stage.mjs";

const root = realpathSync(resolve(import.meta.dirname, "../.."));
const scratch = realpathSync(tmpdir());
const missing = "apps/admin/proxy.ts";

for (const generation of [195, 197]) {
  test(`historical ${generation} fixture recovers a renamed path without allowing runtime reads`, () => {
    assert.equal(existsSync(resolve(root, missing)), false);
    const bytes = readHistoricalRecoveryFixtureSource(
      root,
      missing,
      generation,
    );
    assert.equal(
      verifyHistoricalRecoveryBytes(missing, bytes, generation),
      true,
    );
    // The historical cache must not turn a missing runtime source into a pass.
    assert.throws(
      () => readHistoricalRecoverySource(root, missing, generation),
      { code: "ENOENT" },
    );
    assert.throws(
      () =>
        readHistoricalRecoveryFixtureSource(root, "../proxy.ts", generation),
      /HISTORICAL_RECOVERY_PATH_REJECTED/,
    );
    assert.throws(
      () => readHistoricalRecoveryFixtureSource(scratch, missing, generation),
      /HISTORICAL_RECOVERY_ROOT_REJECTED/,
    );
    assert.throws(
      () =>
        verifyHistoricalRecoveryBytes(
          missing,
          Buffer.from("changed"),
          generation,
        ),
      /HISTORICAL_RECOVERY_BLOB_CHANGED/,
    );
  });
}

test("actual 195 and 197 fixture constructors verify immutable copies and preserve current source", () => {
  const roots = [];
  const specs = [
    [195, "putduk-backend-195-source-", prepareHistorical195UnitFixtures],
    [197, "putduk-backend197-unit-", prepareBackend197UnitFixtures],
  ];
  try {
    for (const [generation, prefix, prepare] of specs) {
      const fixture = prepare(root, scratch, prefix, roots);
      fixture.prepare("renamed current path regression");
      const active = fixture.root("canonical");
      assert.equal(dirname(realpathSync(active)), scratch);
      const bytes = readFileSync(resolve(active, missing));
      assert.equal(
        verifyHistoricalRecoveryBytes(missing, bytes, generation),
        true,
      );
      assert.equal(existsSync(resolve(root, missing)), false);
    }
  } finally {
    for (const active of roots) {
      assert.equal(dirname(realpathSync(active)), scratch);
      assert.ok(
        specs.some(([, prefix]) =>
          active.split(/[\\/]/).at(-1).startsWith(prefix),
        ),
      );
      rmSync(active, { recursive: true, force: true });
      assert.equal(existsSync(active), false);
    }
  }
});
