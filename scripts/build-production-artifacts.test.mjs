import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { CI_REQUIRED_JOBS, CI_BUDGET_JOB } from "./ci-wall-clock.mjs";
import {
  productionValues,
  productionTarget,
} from "./production-cloudflare-policy.mjs";
import {
  assertProductionDispatch,
  productionBuildEnvironment,
  productionControlEnvironment,
  assertAcceptedRunEvidence,
  assertProductionBuildOutput,
  assertProductionFile,
} from "./build-production-artifacts.mjs";
const sha = "a".repeat(40),
  key = "sb_publishable_" + "a".repeat(24),
  repo = "goldeget/putduk-mining",
  branch = "codex/qa-handoff-diagnostics-20261019";
function context() {
  return {
    GITHUB_ACTIONS: "true",
    CI: "true",
    GITHUB_REPOSITORY: repo,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/" + branch,
    GITHUB_REF_NAME: branch,
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    GITHUB_WORKFLOW_REF:
      repo + "/.github/workflows/qa-cloudflare-deploy.yml@refs/heads/" + branch,
    GITHUB_RUN_ID: "99",
    GITHUB_RUN_ATTEMPT: "1",
    PRODUCTION_PURPOSE: "production-artifacts",
    PRODUCTION_CANDIDATE_SHA: sha,
    PRODUCTION_CI_RUN_ID: "11",
    PRODUCTION_CI_ATTEMPT: "1",
    PRODUCTION_FULL_RUN_ID: "12",
    PRODUCTION_FULL_ATTEMPT: "1",
    PRODUCTION_QA_RUN_ID: "13",
    PRODUCTION_QA_ATTEMPT: "1",
    PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY: key,
  };
}
function identity() {
  return {
    origin: "https://github.com/" + repo + ".git",
    head: sha,
    clean: true,
    remoteSha: sha,
  };
}
test("production artifacts require exact same-repository manual ref/workflow/candidate and explicit accepted attempts", () => {
  const e = context();
  assert.equal(assertProductionDispatch(e, identity()).sha, sha);
  assert.equal(
    assertProductionDispatch(e, {
      ...identity(),
      origin: `https://github.com/${repo}`,
    }).sha,
    sha,
  );
  for (const origin of [
    `https://github.com/${repo}/`,
    `https://github.com/${repo}.git/`,
    `https://user@github.com/${repo}.git`,
    `git@github.com:${repo}.git`,
    `https://github.com/${repo}.git?other=1`,
    `https://github.com/${repo}-other`,
  ])
    assert.throws(() => assertProductionDispatch(e, { ...identity(), origin }));
  for (const change of [
    (e) => (e.GITHUB_EVENT_NAME = "push"),
    (e) => (e.GITHUB_REPOSITORY = "other/repo"),
    (e) => (e.GITHUB_SHA = "b".repeat(40)),
    (e) => (e.GITHUB_WORKFLOW_SHA = "b".repeat(40)),
    (e) => (e.GITHUB_WORKFLOW_REF = "untrusted"),
    (e) => (e.PRODUCTION_QA_RUN_ID = ""),
    (e) => (e.PRODUCTION_FULL_ATTEMPT = "0"),
    (e) => (e.PRODUCTION_PURPOSE = "qa"),
  ]) {
    const x = context();
    change(x);
    assert.throws(() => assertProductionDispatch(x, identity()));
  }
  for (const change of [
    (x) => (x.clean = false),
    (x) => (x.head = "b".repeat(40)),
    (x) => (x.remoteSha = "b".repeat(40)),
    (x) => (x.origin = "https://github.com/other/repo.git"),
  ]) {
    const x = identity();
    change(x);
    assert.throws(() => assertProductionDispatch(e, x));
  }
});
test("production child receives public production values and no inherited provider, GitHub, Actions or loader credentials", () => {
  const e = {
    ...context(),
    PATH: "/safe/bin",
    HOME: "/old/auth",
    GH_TOKEN: "not-for-child",
    GITHUB_TOKEN: "not-for-child",
    ACTIONS_RUNTIME_TOKEN: "not-for-child",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "not-for-child",
    SUPABASE_SECRET_KEY: "not-for-child",
    QA_CF_API_TOKEN: "not-for-child",
    CLOUDFLARE_API_TOKEN: "not-for-child",
    NODE_OPTIONS: "--import=unsafe",
    PUTDUK_QA_SUPABASE_PUBLISHABLE_KEY: "not-for-child",
  };
  const child = productionBuildEnvironment(e, "member", "/owned-empty-home");
  assert.equal(child.APP_ENV, "production");
  assert.equal(child.NEXT_PUBLIC_APP_URL, "https://mining.putduk.com");
  assert.equal(child.HOME, "/owned-empty-home");
  assert.equal(child.AI_PROVIDER_DISPATCH_ENABLED, "false");
  for (const name of Object.keys(child))
    assert.ok(
      !/^(?:GH_|GITHUB_|ACTIONS_|QA_|CLOUDFLARE_|NODE_OPTIONS|SUPABASE_SECRET|PUTDUK_QA_)/.test(
        name,
      ),
      name,
    );
});
test("all control-command children inherit only platform and public source identity, never automatic tokens", () => {
  const env = {
    ...context(),
    PATH: "/safe/bin",
    GH_TOKEN: "private-parent-only",
    GITHUB_TOKEN: "forbidden",
    ACTIONS_RUNTIME_TOKEN: "forbidden",
    SUPABASE_SECRET_KEY: "forbidden",
    HOME: "/auth-profile",
    NODE_OPTIONS: "unsafe",
  };
  const clean = productionControlEnvironment(env);
  assert.equal(clean.GITHUB_SHA, sha);
  assert.equal(clean.PATH, "/safe/bin");
  for (const name of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
    "SUPABASE_SECRET_KEY",
    "HOME",
    "NODE_OPTIONS",
  ])
    assert.equal(clean[name], undefined, name);
});
function evidence(kind) {
  const id = { ci: 11, full: 12, qa: 13 }[kind],
    path = {
      ci: "ci.yml",
      full: "ci-full-e2e.yml",
      qa: "qa-cloudflare-deploy.yml",
    }[kind];
  const run = {
    id,
    run_attempt: 1,
    repository: { full_name: repo },
    head_repository: { full_name: repo },
    head_sha: sha,
    head_branch: branch,
    path: ".github/workflows/" + path,
    event:
      kind === "ci"
        ? "pull_request"
        : kind === "qa"
          ? "push"
          : "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    created_at: "2026-10-21T00:00:00Z",
    run_started_at: "2026-10-21T00:00:00Z",
    updated_at: "2026-10-21T00:05:00Z",
  };
  const names =
    kind === "ci"
      ? [...CI_REQUIRED_JOBS, CI_BUDGET_JOB]
      : kind === "full"
        ? [
            "E2E production build artifact",
            ...Array.from(
              { length: 12 },
              (_, i) => `Authenticated product gates (${i + 1}/12)`,
            ),
          ]
        : ["qa"];
  const jobs = names.map((name, i) => ({
    id: 100 + i,
    run_id: id,
    run_attempt: 1,
    name,
    status: "completed",
    conclusion: "success",
    started_at: run.created_at,
    completed_at: run.updated_at,
    steps: (kind === "qa"
      ? [
          "Wait for complete existing CI on the exact source candidate",
          "Build once per app and dry-run the identical output without credentials",
          "Deploy existing isolated QA Workers and verify boundaries",
        ]
      : kind === "full" && i > 0
        ? ["Run authenticated browser tests"]
        : []
    ).map((name) => ({ name, status: "completed", conclusion: "success" })),
  }));
  const artifacts = (
    kind === "ci"
      ? [
          "e2e-next-production",
          "authenticated-playwright-smoke",
          "typography-public",
          "typography-protected",
          "worker-runtime",
          `backend-successor202-${id}-1`,
        ]
      : kind === "full"
        ? [
            "e2e-next-production",
            ...Array.from(
              { length: 12 },
              (_, i) => `authenticated-playwright-shard-${i + 1}`,
            ),
          ]
        : [`qa-worker-build-${sha}-${id}-1`, `qa-deployment-receipts-${id}-1`]
  ).map((name, i) => ({
    id: 200 + i,
    name,
    expired: false,
    size_in_bytes: 100,
    digest: "sha256:" + "a".repeat(64),
    created_at: run.updated_at,
    workflow_run: { id, head_sha: sha },
  }));
  return { run, jobs, artifacts };
}
test("production admission retains ordinary budget verifier and requires complete exact Full/normal-QA evidence", () => {
  const expected = {
    sha,
    branch,
    runIds: { ci: 11, full: 12, qa: 13 },
    attempts: { ci: 1, full: 1, qa: 1 },
  };
  for (const kind of ["ci", "full", "qa"]) {
    assert.equal(
      assertAcceptedRunEvidence(kind, evidence(kind), expected).id,
      expected.runIds[kind],
    );
    for (const change of [
      (e) => (e.run.head_sha = "b".repeat(40)),
      (e) => (e.run.run_attempt = 2),
      (e) => e.jobs.pop(),
      (e) => (e.jobs[0].conclusion = "failure"),
      (e) => (e.jobs[0].run_id = 999),
      (e) => (e.jobs[0].run_attempt = 2),
      (e) => e.artifacts.pop(),
      (e) => (e.artifacts[0].expired = true),
      (e) => (e.artifacts[0].workflow_run.id = 999),
      (e) => (e.artifacts[0].created_at = "2026-10-20T00:00:00Z"),
    ]) {
      const x = evidence(kind);
      change(x);
      assert.throws(() => assertAcceptedRunEvidence(kind, x, expected), kind);
    }
  }
  const x = evidence("qa");
  x.jobs[0].name = "Production artifact build only";
  assert.throws(() => assertAcceptedRunEvidence("qa", x, expected));
  const y = evidence("qa");
  y.jobs[0].steps[2].conclusion = "skipped";
  assert.throws(() => assertAcceptedRunEvidence("qa", y, expected));
  const z = evidence("ci");
  z.run.updated_at = "2026-10-21T00:21:00Z";
  assert.throws(() => assertAcceptedRunEvidence("ci", z, expected));
});
function output(role) {
  const t = productionTarget(
    "production-" + role,
    role === "admin" ? "admin" : "member",
  );
  const env = Object.fromEntries(
    Object.entries(productionValues(key, role)).map(([k, v]) => [
      k,
      { type: "text", value: v },
    ]),
  );
  if (role !== "landing")
    Object.assign(env, {
      SUPABASE_SECRET_KEY: { type: "secret" },
      WITHDRAWAL_DATA_KEY: { type: "secret" },
    });
  return {
    rootConfig: {
      accountId: "9dc502d4ef06b3b5374591de6e6933ca",
      buildContext: { mode: "production-" + role, isPreview: false },
    },
    containers: [],
    workers: {
      default: {
        config: {
          name: t.name,
          env,
          exports: { default: { type: "worker" } },
          assets: { runWorkerFirst: ["/*"] },
        },
      },
    },
  };
}
test("production output proves exact role, mode, origin and value-free secret references", () => {
  for (const role of ["member", "admin", "landing"]) {
    assert.equal(
      assertProductionBuildOutput(output(role), role, key).role,
      role,
    );
    for (const change of [
      (x) => (x.rootConfig.buildContext.mode = "qa"),
      (x) => (x.workers.default.config.name = "foreign"),
      (x) => (x.workers.default.config.env.APP_ENV.value = "test"),
      (x) =>
        (x.workers.default.config.env.SUPABASE_SECRET_KEY = {
          type: "secret",
          value: "must-not-exist",
        }),
      (x) => (x.workers.default.config.triggers = [{ type: "cron" }]),
    ]) {
      const x = output(role);
      change(x);
      assert.throws(() => assertProductionBuildOutput(x, role, key));
    }
  }
});
test("production packaging rejects path escapes, hidden credentials, source maps and literal secret values", () => {
  assertProductionFile(
    "workers/default/index.js",
    Buffer.from("export default {};"),
  );
  for (const name of [
    "static/_headers",
    "static/_redirects",
    "static/.assetsignore",
    "workers/default/runtime.wasm",
  ])
    assertProductionFile(name, Buffer.from([0, 97, 115, 109]));
  for (const name of [
    "../escape",
    ".env.production",
    "workers/.dev.vars",
    "worker.js.map",
    ".git/config",
  ])
    assert.throws(() => assertProductionFile(name, Buffer.from("safe")));
  assert.throws(() =>
    assertProductionFile(
      "worker.js",
      Buffer.from("sb_secret_" + "x".repeat(32)),
    ),
  );
});
test("production build guards intercept actual fs and transport entrypoints before any file or remote request", () => {
  const url = new URL("./build-production-artifacts.mjs", import.meta.url).href;
  const fileUrl = new URL("./.env.test", import.meta.url).href;
  const code = `import assert from 'node:assert/strict';import fs from 'node:fs';import https from 'node:https';import tls from 'node:tls';const {installBuildGuards}=await import(${JSON.stringify(url)});const clean=installBuildGuards();assert.deepEqual(clean(),{dotenvReads:0,networkRequests:0});assert.throws(()=>fs.readFileSync('/synthetic/.env.production'),/PRODUCTION_DOTENV_READ_BLOCKED/);assert.throws(()=>fs.openSync(Buffer.from('/synthetic/.dev.vars'),'r'),/PRODUCTION_DOTENV_READ_BLOCKED/);await assert.rejects(()=>fs.promises.readFile(new URL(${JSON.stringify(fileUrl)})),/PRODUCTION_DOTENV_READ_BLOCKED/);await assert.rejects(()=>fetch('https://example.invalid'),/PRODUCTION_BUILD_NETWORK_BLOCKED/);assert.throws(()=>https.get('https://example.invalid'),/PRODUCTION_BUILD_NETWORK_BLOCKED/);assert.throws(()=>tls.connect({host:'example.invalid',port:443}),/PRODUCTION_BUILD_NETWORK_BLOCKED/);assert.throws(()=>tls.connect(443,{host:'example.invalid'}),/PRODUCTION_BUILD_NETWORK_BLOCKED/);assert.throws(clean,/build attempted dotenv or network read/);`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      env: productionBuildEnvironment(
        { ...context(), PATH: process.env.PATH },
        "member",
        process.cwd(),
      ),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
test("direct and derived Socket.connect paths cannot bypass remote guard, including normalized arguments", () => {
  const url = new URL("./build-production-artifacts.mjs", import.meta.url).href;
  const code = `import assert from 'node:assert/strict';import net from 'node:net';let calls=0;net.Socket.prototype.connect=function(){calls++;return this;};const {installBuildGuards}=await import(${JSON.stringify(url)});installBuildGuards();class Derived extends net.Socket{};for(const socket of[new net.Socket(),new Derived()])assert.throws(()=>socket.connect({host:'example.invalid',port:443}),/PRODUCTION_BUILD_NETWORK_BLOCKED/);assert.throws(()=>new net.Socket().connect([{host:'example.invalid',port:443}]),/PRODUCTION_BUILD_NETWORK_BLOCKED/);assert.equal(calls,0);new net.Socket().connect({host:'127.0.0.1',port:1});new net.Socket().connect([{host:'::1',port:1}]);assert.equal(calls,2);`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      env: productionBuildEnvironment(
        { ...context(), PATH: process.env.PATH },
        "member",
        process.cwd(),
      ),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
test("existing single-job workflow excludes every QA credential/deployment step from production artifact purpose", () => {
  const yaml = readFileSync(
    new URL("../.github/workflows/qa-cloudflare-deploy.yml", import.meta.url),
    "utf8",
  );
  assert.equal(
    (
      yaml
        .slice(yaml.indexOf("jobs:"))
        .split("    steps:")[0]
        .match(/^  [a-z][a-z_-]*:/gm) || []
    ).length,
    1,
  );
  const blocks = yaml.split(/(?=^      - )/m).slice(1),
    normal =
      "github.event_name != 'workflow_dispatch' || inputs.purpose != 'production-artifacts'",
    prod =
      "github.event_name == 'workflow_dispatch' && inputs.purpose == 'production-artifacts'";
  const secret = blocks.filter((b) => b.includes("${{ secrets."));
  assert.equal(secret.length, 1);
  assert.ok(secret[0].includes("if: " + normal));
  assert.ok(secret[0].includes("qa-cloudflare-run.mjs deploy"));
  for (const b of blocks.filter((b) =>
    /qa-cloudflare-run\.mjs|qa-worker-build-|qa-deployment-receipts-|Install smoke browser|Verify local browser network/.test(
      b,
    ),
  ))
    assert.ok(b.includes(normal), b.split("\n")[0]);
  const production = blocks.filter(
    (b) =>
      b.includes("build-production-artifacts.mjs") ||
      b.includes("name: production-member-") ||
      b.includes("name: production-admin-") ||
      b.includes("name: production-apex-"),
  );
  assert.equal(production.length, 5);
  for (const b of production) {
    assert.ok(b.includes("if: " + prod));
    assert.ok(!b.includes("${{ secrets."));
    assert.ok(!b.includes("qa-cloudflare-run.mjs deploy"));
  }
  assert.ok(yaml.includes("always() && (" + normal + ")"));
  assert.ok(yaml.includes("&& vars.PUTDUK_QA_SUPABASE_PUBLISHABLE_KEY || ''"));
  assert.ok(!yaml.includes("production-artifact-build.yml"));
});
