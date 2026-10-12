import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { format, resolveConfig } from "prettier";
import {
  stageHistoricalRecoveryTestSource,
  stageHistoricalRecoveryGuardSource,
  readHistoricalBrowserTransportSource,
  verifyPreparedHistoricalFixture,
} from "../../scripts/historical-recovery-unit-stage.mjs";
import { createBrandFixtureReader } from "../../scripts/brand-unit-file-cache.mjs";
import {
  unitRunCompleteness,
  jsonUnitCompleteness,
} from "../../scripts/unit-completeness-reporter.mjs";
const root = resolve(".");
const original = (name: string) =>
  execFileSync(
    "git",
    ["show", `630ca8ac2cfda90e39cdf6e04b0df906986cb275:tests/unit/${name}`],
    { encoding: "utf8" },
  );
const roots: string[] = [];
afterEach(() => {
  for (const owned of roots.splice(0)) {
    if (
      !["putduk-brand-reader-unit-", "putduk-backend197-unit-"].some((prefix) =>
        owned.startsWith(join(tmpdir(), prefix)),
      )
    )
      throw Error("CLEANUP_SCOPE");
    rmSync(owned, { recursive: true, force: true });
  }
});
describe("release validation preserves reviewed test contracts", () => {
  it.each([
    "principal-review-r2-source.test.ts",
    "backend-http-canonical-source.test.ts",
    "backend-http-local-source.test.ts",
    "backend-http-195-source.test.ts",
    "usdt-manual-195-native-fixture-v3.test.ts",
    "usdt-manual-195-native-fixture-v2.test.ts",
  ])(
    "accepts only the exact known formatting projection of %s",
    async (name) => {
      const source = original(name);
      const formatted = await format(source, {
        ...(await resolveConfig(`tests/unit/${name}`)),
        filepath: `tests/unit/${name}`,
      });
      const staged = stageHistoricalRecoveryTestSource(formatted, name);
      expect(staged).toBe(stageHistoricalRecoveryTestSource(source, name));
      expect(() =>
        stageHistoricalRecoveryTestSource(formatted + "\n// unreviewed", name),
      ).toThrow("TEST_SOURCE_CHANGED");
    },
  );
  it("copies the independently pinned historical browser config while rejecting unmapped paths and roots", () => {
    expect(
      readHistoricalBrowserTransportSource(root, "vitest.config.ts").toString(),
    ).not.toContain("historicalRecoveryUnitPlugin");
    expect(() =>
      readHistoricalBrowserTransportSource(root, "../vitest.config.ts"),
    ).toThrow("PATH_REJECTED");
    expect(() =>
      readHistoricalBrowserTransportSource(root, "package.json"),
    ).toThrow("UNMAPPED_SOURCE");
    expect(() =>
      readHistoricalBrowserTransportSource(resolve(".."), "vitest.config.ts"),
    ).toThrow("ROOT_REJECTED");
  });
  it("stages browser and brand fixture plumbing without changing any assertion body", () => {
    for (const name of [
      "backend-successor-197-browser-source.test.ts",
      "brand-assets.test.ts",
      "usdt-manual-195-native-fixture-v3.test.ts",
      "usdt-manual-195-native-fixture-v2.test.ts",
    ]) {
      const source = original(name);
      const staged = stageHistoricalRecoveryTestSource(source, name);
      const at = source.indexOf("describe(");
      expect(staged.slice(staged.indexOf("describe("))).toBe(source.slice(at));
      expect(() =>
        stageHistoricalRecoveryTestSource(source + "\n// extra", name),
      ).toThrow("TEST_SOURCE_CHANGED");
    }
  });
  it.each(["backend-http-195-source.mjs", "backend-successor-197-source.mjs"])(
    "stages only exact original or reviewed formatter bytes of native guard %s",
    async (name) => {
      const source = execFileSync(
        "git",
        ["show", `630ca8ac2cfda90e39cdf6e04b0df906986cb275:scripts/${name}`],
        { encoding: "utf8" },
      );
      const formatted = await format(source, {
        ...(await resolveConfig(`scripts/${name}`)),
        filepath: `scripts/${name}`,
      });
      const staged = stageHistoricalRecoveryGuardSource(source, name);
      expect(stageHistoricalRecoveryGuardSource(formatted, name)).toBe(staged);
      expect(staged).toContain("const realpathSync = nodeRealpathSync.native;");
      const match = source.match(/import \{([^}]+)\} from "node:fs";/)!;
      const after =
        match[0].replace("realpathSync", "realpathSync as nodeRealpathSync") +
        "\nconst realpathSync = nodeRealpathSync.native;";
      expect(staged.replace(after, match[0])).toBe(source);
      expect(() =>
        stageHistoricalRecoveryGuardSource(source + "\n//unreviewed", name),
      ).toThrow("GUARD_SOURCE_CHANGED");
    },
  );
  it("validates copied physical fixture bytes without caching a later change", () => {
    const owned = mkdtempSync(join(tmpdir(), "putduk-backend197-unit-"));
    roots.push(owned);
    const name = "actual.txt";
    const expected = Buffer.from("copied historical bytes");
    writeFileSync(join(owned, name), expected);
    expect(() =>
      verifyPreparedHistoricalFixture(
        owned,
        [[name, expected]],
        "putduk-backend197-unit-",
      ),
    ).not.toThrow();
    writeFileSync(join(owned, name), "later unreviewed mutation");
    expect(() =>
      verifyPreparedHistoricalFixture(
        owned,
        [[name, expected]],
        "putduk-backend197-unit-",
      ),
    ).toThrow("FIXTURE_COPY_CHANGED");
    expect(() =>
      verifyPreparedHistoricalFixture(
        owned,
        [["../outside.txt", expected]],
        "putduk-backend197-unit-",
      ),
    ).toThrow("PATH_REJECTED");
    expect(() =>
      verifyPreparedHistoricalFixture(root, [], "putduk-backend197-unit-"),
    ).toThrow("FIXTURE_SCOPE_REJECTED");
    expect(() =>
      verifyPreparedHistoricalFixture(owned, [], "arbitrary-prefix-"),
    ).toThrow("FIXTURE_SCOPE_REJECTED");
  });
  it("keeps cached buffers immutable and observes file changes rather than accepting stale bytes", async () => {
    const owned = mkdtempSync(join(tmpdir(), "putduk-brand-reader-unit-"));
    roots.push(owned);
    mkdirSync(join(owned, "public"));
    const file = join(owned, "public", "bytes.txt");
    writeFileSync(file, "first");
    const reader = createBrandFixtureReader(owned);
    const first = (await reader.read(file)) as Buffer;
    first[0] = 0;
    expect((await reader.read(file)).toString()).toBe("first");
    writeFileSync(file, "changed-length");
    expect((await reader.read(file)).toString()).toBe("changed-length");
    await expect(
      reader.read(resolve("tests/unit/release-validation-remediation.test.ts")),
    ).rejects.toThrow("PATH_REJECTED");
  });
  it("detects a missing admitted AI module without inventing a failed or passed assertion", () => {
    const project = { name: "root" } as Parameters<
      typeof unitRunCompleteness
    >[0][number]["project"];
    const ai = { project, moduleId: "tests/unit/ai-shared-session.test.ts" };
    const other = { project, moduleId: "tests/unit/other.test.ts" };
    expect(unitRunCompleteness([ai, other], [other])).toEqual({
      complete: false,
      expectedFiles: 2,
      reportedFiles: 1,
      missing: [ai.moduleId],
      unexpected: [],
      duplicateAdmissions: [],
      duplicateModules: [],
    });
    expect(unitRunCompleteness([ai, other], [ai, other]).complete).toBe(true);
    expect(unitRunCompleteness([], []).complete).toBe(false);
    expect(unitRunCompleteness([ai, ai], [ai]).complete).toBe(false);
    expect(unitRunCompleteness([ai], [ai, ai]).complete).toBe(false);
    expect(unitRunCompleteness([ai], [ai, other]).complete).toBe(false);
    const receipt = {
      complete: true,
      modules: [
        {
          moduleId: ai.moduleId,
          tests: 49,
          passed: 49,
          failed: 0,
          skipped: 0,
          assertions: Array.from({ length: 49 }, (_, index) => ({
            identity: JSON.stringify([`AI${index}`]),
            state: "passed",
          })),
        },
      ],
    };
    const row = {
      name: ai.moduleId,
      assertionResults: Array.from({ length: 49 }, (_, index) => ({
        status: "passed",
        title: `AI${index}`,
        ancestorTitles: [],
      })),
    };
    const report = {
      testResults: [row],
      numTotalTests: 49,
      numPassedTests: 49,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    };
    expect(jsonUnitCompleteness(receipt, report).complete).toBe(true);
    expect(
      jsonUnitCompleteness(receipt, { ...report, testResults: [] }).complete,
    ).toBe(false);
    expect(
      jsonUnitCompleteness(receipt, { ...report, testResults: [row, row] })
        .complete,
    ).toBe(false);
    expect(
      jsonUnitCompleteness(receipt, {
        ...report,
        testResults: [
          { ...row, assertionResults: row.assertionResults.slice(1) },
        ],
      }).complete,
    ).toBe(false);
    expect(
      jsonUnitCompleteness(receipt, { ...report, numTotalTests: 48 }).complete,
    ).toBe(false);
    expect(
      jsonUnitCompleteness(receipt, {
        ...report,
        testResults: [
          {
            ...row,
            assertionResults: [
              row.assertionResults[0]!,
              ...row.assertionResults.slice(0, 48),
            ],
          },
        ],
      }).complete,
    ).toBe(false);
  });
});
