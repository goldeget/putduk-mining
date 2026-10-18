import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  assertConcurrencyScope,
  assertContainerMetadata,
  buildConcurrencySql,
  runConcurrencyProbe,
  verifyConcurrencyOutput,
} from "../../../scripts/assert-economy-policy-reader-concurrency.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const configText = readFileSync(
  new URL("../../../supabase/config.toml", import.meta.url),
  "utf8",
);
const env = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "goldeget/putduk-mining",
  GITHUB_JOB: "database",
  GITHUB_WORKSPACE: root,
  APP_ENV: "test",
};
const origin = "https://github.com/goldeget/putduk-mining.git";
const configuredProjectId = configText.match(
  /^project_id\s*=\s*"([^"]+)"/m,
)![1]!;
const configuredContainer = `supabase_db_${configuredProjectId}`;
const id = "00000000-0000-4000-8000-000000000001";
type ProbeCase = {
  case: string;
  readerPid: number;
  publisherPid?: number;
  waiterObserved?: boolean;
  intervalMatched?: boolean;
  rollbackReceiptsMatched?: boolean;
  repeatedReadMatched?: boolean;
  policyId?: string;
  publicationId?: string;
  effectiveAtMicroseconds?: string;
  sqlstate?: string;
  message?: string;
};
const receipt = (): {
  moneyUnchanged: boolean;
  policyEventsHeld: boolean;
  cases: ProbeCase[];
} => ({
  moneyUnchanged: true,
  policyEventsHeld: true,
  cases: [
    ...["publish_commit", "reader_first", "publish_rollback"].map((name) => ({
      case: name,
      waiterObserved: true,
      repeatedReadMatched: true,
      intervalMatched: true,
      rollbackReceiptsMatched: name === "publish_rollback",
      readerPid: 11,
      publisherPid: 12,
      policyId: id,
      publicationId: id,
      effectiveAtMicroseconds: "1790000000000123",
    })),
    ...["repeatable_read", "serializable"].map((name) => ({
      case: name,
      readerPid: 11,
      sqlstate: "25000",
      message: "ECONOMY_POLICY_FRESH_SNAPSHOT_REQUIRED",
    })),
  ],
});
const report = (value = receipt()) =>
  `PUTDUK_POLICY_READER_CONCURRENCY=${JSON.stringify(value)}\n`;

describe("disposable policy reader concurrency gate", () => {
  it("resolves only this checkout's configured project container", () => {
    const target = assertConcurrencyScope({ env, origin, configText });
    expect(target.projectRef).toBe("osrmyjgmpdspdcwqjwuv");
    expect(target.container).toBe(`supabase_db_${target.projectId}`);
    expect(Object.isFrozen(target)).toBe(true);
  });

  it.each([
    { CI: "false" },
    { GITHUB_ACTIONS: "false" },
    { GITHUB_JOB: "application" },
    { GITHUB_REPOSITORY: "outside/scope" },
    { APP_ENV: "production" },
    { LOCAL_SUPABASE_PROJECT_ID: "putduk-mining-unrelated" },
    { SUPABASE_PROJECT_ID: "putduk-mining-unrelated" },
    { SUPABASE_PROJECT_REF: "osrmyjgmpdspdcwqjwuv" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co" },
    {
      LOCAL_SUPABASE_DB_URL:
        "postgresql://postgres:fixture@outside.invalid:65432/postgres",
    },
  ])("rejects an unsafe execution context before Docker: %j", (change) => {
    expect(() =>
      assertConcurrencyScope({
        env: { ...env, ...change },
        origin,
        configText,
      }),
    ).toThrow();
  });

  it("rejects another origin or nonproject configuration", () => {
    expect(() =>
      assertConcurrencyScope({
        env,
        origin: "https://github.com/outside/scope.git",
        configText,
      }),
    ).toThrow("BLOCKED_TARGET_SCOPE");
    expect(() =>
      assertConcurrencyScope({
        env,
        origin,
        configText: configText.replace(
          /^project_id\s*=\s*"[^"]+"/m,
          'project_id = "outside"',
        ),
      }),
    ).toThrow();
  });

  it("requires the exact container name and CLI project label", () => {
    const target = assertConcurrencyScope({ env, origin, configText });
    expect(() =>
      assertContainerMetadata(
        JSON.stringify({
          name: `/${target.container}`,
          project: target.projectId,
        }),
        target,
      ),
    ).not.toThrow();
    for (const wrong of [
      { name: "/other", project: target.projectId },
      { name: `/${target.container}`, project: "putduk-mining-other" },
      { name: `/${target.container}`, project: null },
    ])
      expect(() =>
        assertContainerMetadata(JSON.stringify(wrong), target),
      ).toThrow("BLOCKED_TARGET_SCOPE");
  });

  it("accepts all five actual-outcome receipts and no shortened substitute", () => {
    expect(verifyConcurrencyOutput(report())).toEqual(receipt());
    expect(() => verifyConcurrencyOutput(report() + report())).toThrow();
    expect(() =>
      verifyConcurrencyOutput("a timeout elapsed without any receipt"),
    ).toThrow();
    const incomplete = receipt();
    incomplete.cases.pop();
    expect(() => verifyConcurrencyOutput(report(incomplete))).toThrow();
  });

  it.each([
    "waiter",
    "repeat",
    "interval",
    "rollback",
    "same_pid",
    "money",
    "outbox",
    "isolation",
  ])("rejects missing safety evidence: %s", (caseName) => {
    const value = receipt();
    if (caseName === "money") value.moneyUnchanged = false;
    else if (caseName === "outbox") value.policyEventsHeld = false;
    else if (caseName === "isolation") value.cases[3]!.sqlstate = "SUCCESS";
    else if (caseName === "waiter") value.cases[0]!.waiterObserved = false;
    else if (caseName === "repeat") value.cases[0]!.repeatedReadMatched = false;
    else if (caseName === "interval") value.cases[0]!.intervalMatched = false;
    else if (caseName === "rollback")
      value.cases[2]!.rollbackReceiptsMatched = false;
    else value.cases[0]!.publisherPid = value.cases[0]!.readerPid;
    expect(() => verifyConcurrencyOutput(report(value))).toThrow();
  });

  it("rejects SQL target injection before constructing a connection", () => {
    const input = {
      container: "supabase_db_putduk-mining",
      runId: "a".repeat(32),
      seedDigest: "b".repeat(64),
      approvalDigest: "c".repeat(64),
    };
    expect(() =>
      buildConcurrencySql({ ...input, container: "other;drop" }),
    ).toThrow();
    expect(() =>
      buildConcurrencySql({ ...input, runId: "'or true" }),
    ).toThrow();
  });

  it.each([{ CI: "false" }, { APP_ENV: "production" }])(
    "the actual runner rejects unsafe context without contacting Docker: %j",
    (change) => {
      const execute = vi.fn(() => origin);
      expect(() =>
        runConcurrencyProbe({ env: { ...env, ...change }, execute }),
      ).toThrow();
      expect(execute.mock.calls).toHaveLength(1);
    },
  );

  it("does not execute SQL when project metadata is missing", () => {
    const execute = vi.fn((command: string) =>
      command === "git"
        ? origin
        : JSON.stringify({ name: `/${configuredContainer}`, project: null }),
    );
    expect(() => runConcurrencyProbe({ env, execute })).toThrow(
      "BLOCKED_TARGET_SCOPE",
    );
    expect(execute.mock.calls).toHaveLength(2);
  });

  it("does not leak private diagnostics from an unavailable origin", () => {
    const execute = vi.fn(() => {
      throw new Error("private credential text");
    });
    expect(() => runConcurrencyProbe({ env, execute })).toThrow(
      "BLOCKED_TARGET_SCOPE: authorized origin unavailable",
    );
    expect(execute.mock.calls).toHaveLength(1);
  });

  it("uses a bounded scoped stdin process and cleans up on failure", () => {
    const execute = vi.fn(
      (
        command: string,
        _args: readonly string[],
        options: Record<string, unknown>,
      ) => {
        if (command === "git") return origin;
        if (_args[0] === "inspect")
          return JSON.stringify({
            name: `/${configuredContainer}`,
            project: configuredProjectId,
          });
        if (String(options.input).includes("pg_terminate_backend")) return "";
        throw new Error("psql timeout containing a private connection string");
      },
    );
    expect(() => runConcurrencyProbe({ env, execute })).toThrow(
      "POLICY_CONCURRENCY_PROBE_FAILED",
    );
    const calls = execute.mock.calls.filter(
      (call) => call[0] === "docker" && call[1][0] === "exec",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]![1][2]).toBe(configuredContainer);
    expect(calls[0]![2].timeout).toBe(85000);
    expect(calls[0]![2].killSignal).toBe("SIGTERM");
    expect(calls[0]![2].stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(calls[1]![2].timeout).toBe(5000);
    const cleanup = String(calls[1]![2].input);
    expect(cleanup).toContain("application_name in");
    expect(cleanup).toContain("datname='postgres'");
    expect(cleanup).not.toContain("like");
  });

  it("accepts SQL receipts and still requires successful owned-process cleanup", () => {
    const execute = vi.fn(
      (
        command: string,
        _args: readonly string[],
        options: Record<string, unknown>,
      ) => {
        if (command === "git") return origin;
        if (_args[0] === "inspect")
          return JSON.stringify({
            name: `/${configuredContainer}`,
            project: configuredProjectId,
          });
        return String(options.input).includes("pg_terminate_backend")
          ? ""
          : report();
      },
    );
    expect(runConcurrencyProbe({ env, execute })).toEqual(receipt());
    execute.mockImplementation((command, _args, options) => {
      if (command === "git") return origin;
      if (_args[0] === "inspect")
        return JSON.stringify({
          name: `/${configuredContainer}`,
          project: configuredProjectId,
        });
      if (String(options.input).includes("pg_terminate_backend"))
        throw new Error("cleanup failure");
      return report();
    });
    expect(() => runConcurrencyProbe({ env, execute })).toThrow(
      "POLICY_CONCURRENCY_CLEANUP_FAILED",
    );
  });
});
