import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAuthenticatedExecution,
  inventoryFromReport,
} from "../../scripts/ci-authenticated-shards.mjs";

const cwd = path.resolve("execution197-fixture");
function report() {
  return {
    config: {
      configFile: path.resolve(cwd, "playwright.backend-browser-197.config.ts"),
      rootDir: path.resolve(cwd, "tests/e2e/authenticated"),
    },
    errors: [],
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 12 },
    suites: [
      {
        specs: [
          {
            id: "case-197",
            file: "admin-today.spec.ts",
            tests: [
              {
                projectName: "chromium",
                expectedStatus: "passed",
                status: "expected",
                results: [{ status: "passed", retry: 0, duration: 12 }],
              },
            ],
          },
        ],
      },
    ],
  };
}
const testPath = "suites.0.specs.0.tests.0";
const resultPath = `${testPath}.results.0`;
const spec = report().suites[0]!.specs[0]!;
const falsifications: [string, string, unknown][] = [
  ["skip count", "stats.skipped", 1],
  ["concealed skip", `${resultPath}.status`, "skipped"],
  ["expected failure", `${testPath}.expectedStatus`, "failed"],
  ["unexpected result", `${testPath}.status`, "unexpected"],
  ["failure count", "stats.unexpected", 1],
  ["flaky count", "stats.flaky", 1],
  ["partial count", "stats.expected", 0],
  ["missing result", `${testPath}.results`, []],
  [
    "multiple attempts",
    `${testPath}.results`,
    [
      { status: "passed", retry: 0, duration: 12 },
      { status: "passed", retry: 1, duration: 2 },
    ],
  ],
  ["retry", `${resultPath}.retry`, 1],
  ["missing case", "suites.0.specs", []],
  ["duplicate case", "suites.0.specs", [spec, structuredClone(spec)]],
  ["wrong project", `${testPath}.projectName`, "mobile"],
  ["wrong id", "suites.0.specs.0.id", "other"],
  [
    "wrong config",
    "config.configFile",
    path.resolve(cwd, "playwright.config.ts"),
  ],
  ["wrong root", "config.rootDir", path.resolve(cwd, "tests/e2e")],
  ["invalid duration", `${resultPath}.duration`, Number.NaN],
  ["invalid total duration", "stats.duration", Number.POSITIVE_INFINITY],
  ["collection error", "errors", [{ message: "collection failed" }]],
];
function falsify(value: object, location: string, replacement: unknown) {
  const keys = location.split(".");
  let target = value;
  for (const key of keys.slice(0, -1)) {
    const next: unknown = Reflect.get(target, key);
    if (typeof next !== "object" || next === null) throw Error("FIXTURE_PATH");
    target = next;
  }
  Reflect.set(target, keys.at(-1)!, replacement);
}
describe("197 authenticated execution evidence", () => {
  it("accepts one successful attempt for the selected inventory", () => {
    const value = report();
    expect(
      assertAuthenticatedExecution(value, inventoryFromReport(value, cwd), cwd),
    ).toHaveLength(1);
  });
  it.each(falsifications)("rejects %s", (_name, location, replacement) => {
    const value = report();
    const expected = inventoryFromReport(value, cwd);
    falsify(value, location, replacement);
    expect(() => assertAuthenticatedExecution(value, expected, cwd)).toThrow();
  });
});
