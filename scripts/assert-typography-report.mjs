/**
 * Playwright JSON 리포트에서 타이포그래피 게이트 수를 확인한다.
 * 통과 수, 스크린샷 수, hydration 주석이 기대와 다르면 실패한다.
 * --redact 는 리포트에 남은 로컬 서버 env 값을 지운 뒤 저장한다.
 */
import { readFileSync, writeFileSync } from "node:fs";

export function summarizeTypographyReport(report) {
  const specs = [];
  for (const suite of report?.suites ?? []) {
    collectSpecs(suite, specs);
  }

  let passed = 0;
  let failed = 0;
  let screenshots = 0;
  let hydration = 0;

  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      const annotations = [...(test.annotations ?? [])];
      for (const result of test.results ?? []) {
        if (result.status === "passed") passed += 1;
        else failed += 1;
        annotations.push(...(result.annotations ?? []));
        for (const attachment of result.attachments ?? []) {
          if (String(attachment.contentType ?? "").includes("image/")) {
            screenshots += 1;
          }
        }
      }
      if (annotations.some((annotation) => annotation.type === "hydration")) {
        hydration += 1;
      }
    }
  }

  const stats = report?.stats ?? {};
  return {
    durationMs: Number(stats.duration ?? 0),
    errors: Array.isArray(report?.errors) ? report.errors.length : 0,
    expected: Number(stats.expected ?? 0),
    failed,
    flaky: Number(stats.flaky ?? 0),
    hydration,
    passed,
    screenshots,
    skipped: Number(stats.skipped ?? 0),
    unexpected: Number(stats.unexpected ?? 0),
  };
}

export function assertTypographySummary(summary, expected) {
  const problems = [];
  if (
    summary.expected !== expected.passed ||
    summary.passed !== expected.passed
  ) {
    problems.push(
      `통과 수가 ${expected.passed}이 아닙니다. stats.expected=${summary.expected} walked=${summary.passed}`,
    );
  }
  if (
    summary.unexpected !== 0 ||
    summary.failed !== 0 ||
    summary.errors !== 0
  ) {
    problems.push(
      `실패가 있습니다. unexpected=${summary.unexpected} failed=${summary.failed} errors=${summary.errors}`,
    );
  }
  if (summary.skipped !== 0 || summary.flaky !== 0) {
    problems.push(
      `건너뛴 테스트가 있습니다. skipped=${summary.skipped} flaky=${summary.flaky}`,
    );
  }
  if (
    expected.screenshots !== undefined &&
    summary.screenshots !== expected.screenshots
  ) {
    problems.push(
      `스크린샷 수가 ${expected.screenshots}이 아닙니다. actual=${summary.screenshots}`,
    );
  }
  if (
    expected.hydration !== undefined &&
    summary.hydration !== expected.hydration
  ) {
    problems.push(
      `hydration 불일치가 ${expected.hydration}이 아닙니다. actual=${summary.hydration}`,
    );
  }
  return problems;
}

export function redactTypographyReport(report) {
  const servers = report?.config?.webServer;
  const list = Array.isArray(servers) ? servers : servers ? [servers] : [];
  for (const server of list) {
    if (!server?.env || typeof server.env !== "object") continue;
    for (const key of Object.keys(server.env)) {
      server.env[key] = "<redacted>";
    }
  }
  return report;
}

function collectSpecs(suite, specs) {
  for (const spec of suite.specs ?? []) specs.push(spec);
  for (const child of suite.suites ?? []) collectSpecs(child, specs);
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} 값이 필요합니다.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} 는 0 이상의 정수여야 합니다.`);
  }
  return parsed;
}

function selfCheck() {
  const passed = fakeReport({
    hydration: false,
    passed: 2,
    screenshots: 2,
  });
  const ok = assertTypographySummary(summarizeTypographyReport(passed), {
    hydration: 0,
    passed: 2,
    screenshots: 2,
  });
  if (ok.length !== 0) {
    throw new Error(`정상 리포트가 실패했습니다. ${ok.join(" / ")}`);
  }

  const wrongCount = assertTypographySummary(
    summarizeTypographyReport(passed),
    {
      passed: 3,
    },
  );
  if (wrongCount.length === 0) {
    throw new Error("통과 수 불일치를 놓쳤습니다.");
  }

  const hydrated = fakeReport({
    hydration: true,
    passed: 1,
    screenshots: 1,
  });
  const hydrationProblems = assertTypographySummary(
    summarizeTypographyReport(hydrated),
    { hydration: 0, passed: 1, screenshots: 1 },
  );
  if (!hydrationProblems.some((problem) => problem.includes("hydration"))) {
    throw new Error("hydration 불일치를 놓쳤습니다.");
  }

  const secret = fakeReport({
    hydration: false,
    passed: 1,
    screenshots: 0,
  });
  secret.config.webServer.env.SUPABASE_SECRET_KEY = "sb_secret_local";
  redactTypographyReport(secret);
  if (secret.config.webServer.env.SUPABASE_SECRET_KEY !== "<redacted>") {
    throw new Error("env 값을 지우지 못했습니다.");
  }
  process.stdout.write("typography report self-check passed\n");
}

function fakeReport(input) {
  const results = [];
  for (let index = 0; index < input.passed; index += 1) {
    const attachments = [];
    if (index < input.screenshots) {
      attachments.push({ contentType: "image/png", name: `shot-${index}` });
    }
    results.push({
      annotations: input.hydration ? [{ type: "hydration" }] : [],
      attachments,
      status: "passed",
    });
  }
  return {
    config: {
      webServer: {
        env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
      },
    },
    errors: [],
    stats: {
      duration: 1000,
      expected: input.passed,
      flaky: 0,
      skipped: 0,
      unexpected: 0,
    },
    suites: [
      { specs: [{ tests: results.map((result) => ({ results: [result] })) }] },
    ],
  };
}

function main() {
  if (process.argv.includes("--self-check")) {
    selfCheck();
    return;
  }

  const reportPath = process.argv[2];
  if (!reportPath || reportPath.startsWith("--")) {
    throw new Error(
      "사용법: node scripts/assert-typography-report.mjs <report.json> --passed N [--screenshots N] [--hydration N] [--redact]",
    );
  }

  const expected = {
    hydration: readFlag("--hydration"),
    passed: readFlag("--passed"),
    screenshots: readFlag("--screenshots"),
  };
  if (expected.passed === undefined) {
    throw new Error("--passed 가 필요합니다.");
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (process.argv.includes("--redact")) {
    redactTypographyReport(report);
    writeFileSync(reportPath, JSON.stringify(report));
  }
  const summary = summarizeTypographyReport(report);
  const problems = assertTypographySummary(summary, expected);
  const seconds = Math.round(summary.durationMs / 1000);
  process.stdout.write(
    `typography passed=${summary.passed} screenshots=${summary.screenshots} hydration=${summary.hydration} unexpected=${summary.unexpected} duration=${seconds}s\n`,
  );
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("scripts/assert-typography-report.mjs")
) {
  try {
    main();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "typography report check failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
