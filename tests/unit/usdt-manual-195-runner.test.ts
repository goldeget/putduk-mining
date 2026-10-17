import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseUsdt195RunnerArguments,
  assertUsdt195Tap,
  assertUsdt195Concurrency,
} from "../../scripts/usdt-manual-195-results.mjs";

const contract = JSON.parse(
  readFileSync(
    new URL(
      "../e2e/fixtures/usdt-manual-195-concurrency-contract.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const run = "a".repeat(16);
const tap = (n: number) =>
  Array.from({ length: n }, (_, i) => "ok " + (i + 1) + " - synthetic").join(
    "\n",
  ) +
  "\n1.." +
  n +
  "\n";
function concurrency(scope: "LOCAL_QA" | "CANONICAL_CI") {
  return {
    status: "PASS",
    assertions: contract[scope === "LOCAL_QA" ? "local" : "canonical"].map(
      (name: string) => ({ name: name.replace("{run}", run), passed: true }),
    ),
    fixture_origin: contract.fixture_origin,
    fixture_sha256: contract.fixture_sha256,
    cleanup_performed: false,
    committed_synthetic_fixtures: true,
  };
}
describe("USDT195 runner result acceptance — authored, execution held", () => {
  it("requires all explicit synthetic execution flags plus exact container and output", () => {
    expect(
      parseUsdt195RunnerArguments([
        "--execute",
        "--confirmed-full-payout",
        "--allow-synthetic-db-writes",
        "--fresh-container-id=" + "a".repeat(64),
        "--output=external",
      ]),
    ).toEqual({ containerId: "a".repeat(64), output: "external" });
  });
  for (const args of [
    [],
    ["--plan"],
    ["--execute"],
    [
      "--execute",
      "--execute",
      "--confirmed-full-payout",
      "--fresh-container-id=" + "a".repeat(64),
      "--output=x",
    ],
    [
      "--execute",
      "--confirmed-full-payout",
      "--allow-synthetic-db-writes",
      "--fresh-container-id=short",
      "--output=x",
    ],
  ]) {
    it(
      "rejects missing, duplicate, default and malformed execution arguments " +
        JSON.stringify(args),
      () => expect(() => parseUsdt195RunnerArguments(args)).toThrow(),
    );
  }
  for (const count of [80, 388] as const) {
    it("requires exact complete terminal TAP" + count, () =>
      expect(assertUsdt195Tap(tap(count), 0, count).assertions).toBe(count),
    );
    for (const mutation of [
      (s: string) => s.replace("ok 1 -", "not ok 1 -"),
      (s: string) => s + "1..999 # extra\n",
      (s: string) => s + "1.." + count + "\n",
      (s: string) => s.replace("ok 2 -", "ok 1 -"),
      (s: string) => s.replace("ok 1 - synthetic\n", ""),
      (s: string) =>
        s.replace("ok 1 - synthetic", "ok 1 - synthetic # SKIP optional"),
      (s: string) =>
        s.replace("ok 1 - synthetic", "ok 1 - synthetic # TODO failure"),
      (s: string) => "Bail out! synthetic\n" + s,
      (s: string) => "1.." + count + "\n" + s.replace("1.." + count + "\n", ""),
      (s: string) => s + "ok " + (count + 1) + " - late\n",
    ]) {
      it(
        "rejects incomplete/ambiguous TAP" + count + " " + mutation.toString(),
        () =>
          expect(() =>
            assertUsdt195Tap(mutation(tap(count)), 0, count),
          ).toThrow(),
      );
    }
    it("rejects exit failure after all TAP assertions" + count, () =>
      expect(() => assertUsdt195Tap(tap(count), 1, count)).toThrow(),
    );
    it("rejects an empty log" + count, () =>
      expect(() => assertUsdt195Tap("", 0, count)).toThrow(),
    );
    it(
      "allows ordinary SQL NOTICE chatter while keeping TAP exact" + count,
      () =>
        expect(
          assertUsdt195Tap(
            "t\n" + tap(count) + "NOTICE: extension already exists, skipping\n",
            0,
            count,
          ).assertions,
        ).toBe(count),
    );
  }
  for (const scope of ["LOCAL_QA", "CANONICAL_CI"] as const) {
    it("requires original ordered scope assertion set" + scope, () =>
      expect(
        assertUsdt195Concurrency(
          JSON.stringify(concurrency(scope)),
          0,
          scope,
          contract,
        ).assertions,
      ).toBe(scope === "LOCAL_QA" ? 39 : 41),
    );
    for (const mode of [
      "missing",
      "duplicate",
      "false",
      "string-true",
      "shared-run",
      "unknown",
      "prelude",
      "cleanup",
      "extra",
      "passed-as-status",
    ]) {
      it("rejects changed concurrency proof " + scope + " " + mode, () => {
        const report = concurrency(scope);
        if (mode === "missing") report.assertions.pop();
        if (mode === "duplicate")
          report.assertions[1] = { ...report.assertions[0] };
        if (mode === "false") report.assertions[0].passed = false;
        if (mode === "string-true") report.assertions[0].passed = "true";
        if (mode === "shared-run")
          report.assertions.find((r: { name: string }) =>
            r.name.includes("-USDT_ADDRESS-different_"),
          ).name = report.assertions
            .find((r: { name: string }) =>
              r.name.includes("-USDT_ADDRESS-different_"),
            )
            .name.replace(run, "b".repeat(16));
        if (mode === "unknown") report.assertions[0].name = "unknown";
        if (mode === "prelude") report.fixture_sha256 = "c".repeat(64);
        if (mode === "cleanup") report.cleanup_performed = true;
        if (mode === "extra") Object.assign(report, { extra: true });
        if (mode === "passed-as-status") report.status = "PASSED";
        expect(() =>
          assertUsdt195Concurrency(JSON.stringify(report), 0, scope, contract),
        ).toThrow();
      });
    }
    it("rejects log chatter or failed child" + scope, () => {
      const text = JSON.stringify(concurrency(scope));
      expect(() =>
        assertUsdt195Concurrency("prefix\n" + text, 0, scope, contract),
      ).toThrow();
      expect(() =>
        assertUsdt195Concurrency(text, 1, scope, contract),
      ).toThrow();
    });
  }
});
