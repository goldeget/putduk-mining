import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT,
  REPOSITORY,
  TARGETS,
  assertCandidate,
  assertDeployCredentials,
  assertBuildOutput,
  assertCiEvidence,
  readCiAttemptEvidence,
  assertAccess,
  assertExistingWorker,
  assertWorkerReferences,
  qaValues,
} from "./qa-cloudflare-policy.mjs";
import { CI_REQUIRED_JOBS, CI_BUDGET_JOB } from "./ci-wall-clock.mjs";

const sha = "a".repeat(40);
const candidate = {
  repository: REPOSITORY,
  event: "push",
  branch: "develop",
  sha,
  remoteSha: sha,
};
const key = "sb_publishable_qa_example_only_1234567890";
const values = qaValues(key, "member");

test("deployment requires all dedicated credentials without staging fallback", () => {
  const names = [
    "QA_CF_API_TOKEN",
    "QA_MEMBER_ACCESS_CLIENT_ID",
    "QA_MEMBER_ACCESS_CLIENT_SECRET",
    "QA_ADMIN_ACCESS_CLIENT_ID",
    "QA_ADMIN_ACCESS_CLIENT_SECRET",
    "PUTDUK_QA_SUPABASE_SECRET_KEY",
  ];
  const credentials = Object.fromEntries(
    names.map((name) => [name, "test-placeholder"]),
  );
  assertDeployCredentials(credentials);
  for (const name of names)
    assert.throws(
      () => assertDeployCredentials({ ...credentials, [name]: "" }),
      /missing/,
    );
  assert.throws(
    () =>
      assertDeployCredentials({
        CLOUDFLARE_API_TOKEN: "production-must-not-fallback",
      }),
    /missing/,
  );
});

test("CI reads current attempt jobs and captures only complete paginated evidence", async () => {
  const fixture = ci();
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    if (path === "/actions/runs/12/attempts/2/jobs?per_page=100")
      return { total_count: fixture.jobs.length, jobs: fixture.jobs };
    if (path === "/actions/runs/12/artifacts?per_page=100")
      return {
        total_count: fixture.artifacts.length,
        artifacts: fixture.artifacts,
      };
    throw new Error("unexpected API path");
  };
  const result = await readCiAttemptEvidence(request, fixture.run);
  assertCiEvidence(result, sha);
  assert.deepEqual(paths, [
    "/actions/runs/12/attempts/2/jobs?per_page=100",
    "/actions/runs/12/artifacts?per_page=100",
  ]);
  await assert.rejects(
    () =>
      readCiAttemptEvidence(
        async (path) =>
          path.includes("/jobs?")
            ? { total_count: 20, jobs: fixture.jobs }
            : { total_count: 0, artifacts: [] },
        fixture.run,
      ),
    /pagination/,
  );
});
const output = () => ({
  rootConfig: {
    accountId: ACCOUNT,
    buildContext: { mode: "qa", isPreview: false },
  },
  containers: [],
  workers: {
    default: {
      config: {
        name: TARGETS.member.name,
        workersDev: true,
        previewUrls: false,
        triggers: [],
        exports: {},
        env: {
          ...Object.fromEntries(
            Object.entries(values).map(([k, value]) => [
              k,
              { type: "text", value },
            ]),
          ),
          SUPABASE_SECRET_KEY: { type: "secret" },
        },
        assets: { runWorkerFirst: ["/*", "!/brand/*", "!/_next/static/*"] },
      },
    },
  },
});

test("admit exact owned branch and reject foreign, public, stale or malformed candidates", () => {
  assertCandidate(candidate);
  for (const change of [
    { repository: "someone/putduk-mining" },
    { branch: "main" },
    { branch: "codex/anything" },
    { event: "pull_request" },
    { sha: "abc" },
    { remoteSha: "b".repeat(40) },
  ])
    assert.throws(
      () => assertCandidate({ ...candidate, ...change }),
      /QA_BLOCKED/,
    );
});

test("admit isolated emitted output and reject dangerous target changes", () => {
  assertBuildOutput(output(), "member", key);
  const mutations = [
    (o) => {
      o.workers.default.config.unsafe = { bindings: [{ type: "d1" }] };
    },
    (o) => {
      o.rootConfig.accountId = "wrong";
    },
    (o) => {
      o.rootConfig.buildContext.mode = "production";
    },
    (o) => {
      o.rootConfig.buildContext.isPreview = true;
    },
    (o) => {
      o.workers.default.config.name = "putduk-mining-web-staging";
    },
    (o) => {
      o.workers.default.config.previewUrls = true;
    },
    (o) => {
      o.workers.default.config.triggers = [
        { type: "fetch", pattern: "mining.putduk.com/*" },
      ];
    },
    (o) => {
      o.workers.default.config.env.DB = { type: "d1" };
    },
    (o) => {
      o.workers.default.config.env.NEXT_PUBLIC_SUPABASE_URL.value =
        "https://osrmyjgmpdspdcwqjwuv.supabase.co";
    },
    (o) => {
      o.workers.default.config.env.SUPABASE_SECRET_KEY.value = "secret";
    },
    (o) => {
      o.workers.default.config.exports.Durable = { type: "durable-object" };
    },
    (o) => {
      o.workers.extra = structuredClone(o.workers.default);
    },
    (o) => {
      o.containers.push({});
    },
    (o) => {
      delete o.workers.default.config.env.APP_ENV;
    },
  ];
  for (const mutate of mutations) {
    const o = output();
    mutate(o);
    assert.throws(() => assertBuildOutput(o, "member", key), /QA_BLOCKED/);
  }
});

function ci() {
  const run = {
    id: 12,
    run_attempt: 2,
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    head_sha: sha,
    path: ".github/workflows/ci.yml",
    event: "push",
    status: "completed",
    conclusion: "success",
    created_at: "2026-10-19T00:00:00Z",
    run_started_at: "2026-10-19T01:00:00Z",
    updated_at: "2026-10-19T01:10:00Z",
  };
  const jobs = [...CI_REQUIRED_JOBS, CI_BUDGET_JOB].map((name) => ({
    name,
    status: "completed",
    conclusion: name === "Exact diff integrity" ? "skipped" : "success",
    completed_at: run.updated_at,
  }));
  const artifacts = [
    "e2e-next-production",
    "authenticated-playwright-smoke",
    "typography-public",
    "typography-protected",
    "worker-runtime",
    "backend-successor201-12-2",
  ].map((name, i) => ({
    id: i + 1,
    name,
    expired: false,
    size_in_bytes: 100,
    digest: `sha256:${sha}${"a".repeat(24)}`,
    created_at: run.updated_at,
    workflow_run: { head_sha: sha },
  }));
  return { run, jobs, artifacts };
}

test("accept complete exact attempt only, never stale artifacts, failed budgets or partial jobs", () => {
  const evidence = ci();
  assertCiEvidence(evidence, sha);
  for (const mutate of [
    (e) => {
      e.run.head_sha = "b".repeat(40);
    },
    (e) => {
      e.run.conclusion = "failure";
    },
    (e) => {
      e.jobs.pop();
    },
    (e) => {
      e.jobs.at(-1).conclusion = "failure";
    },
    (e) => {
      e.jobs[1].conclusion = "skipped";
    },
    (e) => {
      e.artifacts[0].created_at = e.run.created_at;
    },
    (e) => {
      e.artifacts[0].digest = undefined;
    },
    (e) => {
      e.artifacts.pop();
    },
    (e) => {
      e.run.updated_at = "2026-10-19T01:21:00Z";
    },
  ]) {
    const e = ci();
    mutate(e);
    assert.throws(() => assertCiEvidence(e, sha));
  }
});

test("Access must remain machine-only and must target the exact worker", () => {
  const app = {
    id: TARGETS.member.accessId,
    destinations: [
      {
        type: "public",
        uri: `${TARGETS.member.name}.putduk-landing.workers.dev`,
      },
    ],
  };
  const policies = [
    {
      decision: "non_identity",
      include: [{ service_token: { token_id: "existing-token" } }],
    },
  ];
  assertAccess(app, policies, "member");
  const workerApp = {
    ...app,
    destinations: [{ type: "worker", worker_id: TARGETS.member.workerId }],
  };
  assertAccess(workerApp, policies, "member", TARGETS.member.workerId);
  assert.throws(() =>
    assertAccess(workerApp, policies, "member", TARGETS.admin.workerId),
  );
  assert.throws(() =>
    assertAccess(
      {
        ...workerApp,
        destinations: [
          {
            ...workerApp.destinations[0],
            overrides: [{ behavior: "public", path_pattern: "/*" }],
          },
        ],
      },
      policies,
      "member",
      TARGETS.member.workerId,
    ),
  );
  assert.throws(() =>
    assertAccess(
      app,
      [...policies, { decision: "bypass", include: [{ everyone: {} }] }],
      "member",
    ),
  );
  assert.throws(() =>
    assertAccess({ ...app, id: TARGETS.admin.accessId }, policies, "member"),
  );
});

test("existing worker requires preview runtime, existing secret and a full rollback version", () => {
  const state = {
    settings: {
      bindings: [
        ...Object.entries(values).map(([name, text]) => ({
          name,
          type: "plain_text",
          text,
        })),
        { name: "SUPABASE_SECRET_KEY", type: "secret_text" },
      ],
    },
    subdomain: { enabled: true, previews_enabled: false },
    schedules: { schedules: [] },
    deployments: {
      deployments: [
        {
          id: "prior",
          versions: [{ version_id: "old-version", percentage: 100 }],
        },
      ],
    },
  };
  assertExistingWorker(state, key, "member", "after");
  for (const mutate of [
    (s) => {
      s.settings.bindings.pop();
    },
    (s) => {
      s.subdomain.previews_enabled = true;
    },
    (s) => {
      s.deployments.deployments = [];
    },
    (s) => {
      s.settings.bindings.push({ type: "d1", name: "DB" });
    },
    (s) => {
      s.settings.bindings.find(
        (b) => b.name === "NEXT_PUBLIC_SUPABASE_URL",
      ).text = "https://osrmyjgmpdspdcwqjwuv.supabase.co";
    },
  ]) {
    const s = structuredClone(state);
    mutate(s);
    assert.throws(() => assertExistingWorker(s, key, "member", "after"));
  }
});

// Public-only reconstruction of the 2026-10-19T14:16:04.683Z sanitized old
// settings. The key is a fixture; no prior settings are copied into deployments.
function oldState(role) {
  const appUrl = `https://${TARGETS[role].name}.putduk-landing.workers.dev`;
  return {
    settings: {
      bindings: [
        { name: "APP_ENV", type: "plain_text", text: "staging" },
        { name: "APP_TIMEZONE", type: "plain_text", text: "UTC" },
        { name: "ASSETS", type: "assets" },
        { name: "NEXT_PUBLIC_APP_ENV", type: "plain_text", text: "staging" },
        { name: "NEXT_PUBLIC_APP_URL", type: "plain_text", text: appUrl },
        {
          name: "NEXT_PUBLIC_SUPABASE_URL",
          type: "plain_text",
          text: "https://mhchzipznxbwbocdihlg.supabase.co",
        },
        {
          name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          type: "plain_text",
          text: key,
        },
        { name: "SUPABASE_SECRET_KEY", type: "secret_text" },
        {
          name: "WORKER_SELF_REFERENCE",
          type: "service",
          service: TARGETS[role].name,
          environment: "production",
        },
        ...(role === "admin"
          ? [{ name: "ADMIN_APP_URL", type: "plain_text", text: appUrl }]
          : []),
      ],
    },
    subdomain: { enabled: true, previews_enabled: false },
    schedules: { schedules: [] },
    deployments: {
      deployments: [
        { id: "prior", versions: [{ version_id: "version", percentage: 100 }] },
      ],
    },
  };
}

test("reviewed old role settings transition to strict desired settings", () => {
  for (const role of ["member", "admin"]) {
    const old = oldState(role);
    assertExistingWorker(old, key, role, "before");
    assert.throws(() => assertExistingWorker(old, key, role, "after"));
    for (const mutate of [
      (s) => {
        s.settings.bindings.find((b) => b.type === "service").service =
          TARGETS[role === "member" ? "admin" : "member"].name;
      },
      (s) => {
        s.settings.bindings.find((b) => b.type === "service").environment =
          "other";
      },
      (s) => {
        s.settings.bindings.find((b) => b.type === "service").entrypoint =
          "Unreviewed";
      },
      (s) => {
        s.settings.bindings.find((b) => b.name === "NEXT_PUBLIC_APP_URL").text =
          "https://mining.putduk.com";
      },
      (s) => {
        s.settings.bindings.find(
          (b) => b.name === "NEXT_PUBLIC_SUPABASE_URL",
        ).text = "https://osrmyjgmpdspdcwqjwuv.supabase.co";
      },
      (s) => {
        s.settings.bindings.push({
          name: "OTHER",
          type: "service",
          service: "foreign",
          environment: "production",
        });
      },
    ]) {
      const s = structuredClone(old);
      mutate(s);
      assert.throws(() => assertExistingWorker(s, key, role, "before"));
    }
    const desired = structuredClone(old);
    desired.settings.bindings = [
      ...Object.entries(qaValues(key, role)).map(([name, text]) => ({
        name,
        type: "plain_text",
        text,
      })),
      { name: "SUPABASE_SECRET_KEY", type: "secret_text" },
    ];
    assertExistingWorker(desired, key, role, "after");
    assertExistingWorker(desired, key, role, "before");
    desired.settings.bindings = desired.settings.bindings.filter(
      (b) => b.name !== "ADMIN_APP_URL",
    );
    assert.throws(() => assertExistingWorker(desired, key, role, "after"));
  }
  assert.equal(
    qaValues(key, "admin").NEXT_PUBLIC_APP_URL,
    "https://putduk-mining-admin-staging-ab1de38.putduk-landing.workers.dev",
  );
});

test("only observed exact own Worker reference is admitted before the transition", () => {
  for (const role of ["member", "admin"]) {
    const target = TARGETS[role];
    const worker = {
      references: {
        workers: [{ id: target.workerId, name: target.name }],
        domains: [],
        dispatch_namespace_outbounds: [],
        durable_objects: [],
        queues: [],
      },
      tail_consumers: [],
    };
    assertWorkerReferences(worker, role, "before");
    assert.throws(() => assertWorkerReferences(worker, role, "after"));
    const foreign = structuredClone(worker);
    foreign.references.workers[0].id =
      TARGETS[role === "member" ? "admin" : "member"].workerId;
    assert.throws(() => assertWorkerReferences(foreign, role, "before"));
    worker.references.workers = [];
    assertWorkerReferences(worker, role, "after");
    worker.references.domains.push({ hostname: "mining.putduk.com" });
    assert.throws(() => assertWorkerReferences(worker, role, "after"));
  }
});
