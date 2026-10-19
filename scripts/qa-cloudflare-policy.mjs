import {
  assertCiRunIdentity,
  CI_BUDGET_JOB,
  CI_BUDGET_MS,
  evaluateCiJobs,
} from "./ci-wall-clock.mjs";

export const REPOSITORY = "goldeget/putduk-mining";
export const ACCOUNT = "9dc502d4ef06b3b5374591de6e6933ca";
export const PREVIEW_URL = "https://mhchzipznxbwbocdihlg.supabase.co";
export const BRANCHES = ["codex/qa-handoff-diagnostics-20261019", "develop"];
export const TARGETS = Object.freeze({
  member: {
    name: "putduk-mining-member-staging-ab1de38",
    directory: ".",
    accessId: "090f3674-1923-4d85-863c-959947d20760",
    workerId: "9cb2ca97274e4d9ea432de1e9ea3c832",
  },
  admin: {
    name: "putduk-mining-admin-staging-ab1de38",
    directory: "apps/admin",
    accessId: "822e4379-70f0-467e-95ee-8d29deb0677e",
    workerId: "30c28a61bece4783a0b4094b513b1bf2",
  },
});
export const origin = (role) =>
  `https://${TARGETS[role].name}.putduk-landing.workers.dev`;
export function requireQa(condition, message) {
  if (!condition) throw new Error(`QA_BLOCKED: ${message}`);
}
export function qaValues(key, role) {
  requireQa(Object.hasOwn(TARGETS, role), "role");
  requireQa(
    typeof key === "string" && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key),
    "QA publishable key missing or invalid",
  );
  return {
    APP_ENV: "staging",
    APP_TIMEZONE: "UTC",
    NEXT_PUBLIC_APP_URL: origin(role),
    ADMIN_APP_URL: origin("admin"),
    NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    AI_PROVIDER_DISPATCH_ENABLED: "false",
  };
}
export function assertCandidate({ repository, event, branch, sha, remoteSha }) {
  requireQa(
    repository === REPOSITORY &&
      ["push", "workflow_dispatch"].includes(event) &&
      BRANCHES.includes(branch),
    "repository/event/branch",
  );
  requireQa(
    /^[a-f0-9]{40}$/.test(sha) && sha === remoteSha,
    "stale or invalid candidate",
  );
}
export function assertDeployCredentials(values) {
  for (const name of [
    "QA_CF_API_TOKEN",
    "QA_MEMBER_ACCESS_CLIENT_ID",
    "QA_MEMBER_ACCESS_CLIENT_SECRET",
    "QA_ADMIN_ACCESS_CLIENT_ID",
    "QA_ADMIN_ACCESS_CLIENT_SECRET",
    "PUTDUK_QA_SUPABASE_SECRET_KEY",
    "PUTDUK_QA_WITHDRAWAL_DATA_KEY",
  ])
    requireQa(
      typeof values[name] === "string" && values[name].trim().length > 0,
      `missing ${name}`,
    );
  const withdrawalKey = values.PUTDUK_QA_WITHDRAWAL_DATA_KEY;
  requireQa(
    /^[A-Za-z0-9+/]{43}=$/.test(withdrawalKey) &&
      Buffer.from(withdrawalKey, "base64").byteLength === 32 &&
      Buffer.from(withdrawalKey, "base64").toString("base64") === withdrawalKey,
    "QA withdrawal key must be canonical base64 for exactly 32 bytes",
  );
}
export function assertBuildOutput(output, role, key) {
  requireQa(Object.hasOwn(TARGETS, role), "role");
  const { rootConfig, workers, containers } = output;
  requireQa(
    rootConfig.accountId === ACCOUNT &&
      rootConfig.buildContext?.mode === "qa" &&
      rootConfig.buildContext.isPreview === false,
    "build account/mode",
  );
  requireQa(
    Object.keys(workers).join() === "default" && containers.length === 0,
    "extra Worker/container",
  );
  const worker = workers.default.config;
  requireQa(!worker.unsafe && !rootConfig.unsafe, "unsafe configuration");
  requireQa(
    worker.name === TARGETS[role].name &&
      worker.workersDev === true &&
      worker.previewUrls === false,
    "Worker/preview URL target",
  );
  requireQa(
    (worker.triggers ?? []).length === 0,
    "public or scheduled trigger",
  );
  requireQa(
    Object.entries(worker.exports ?? {}).every(
      ([name, value]) =>
        name === "default" && value.type === "worker" && !value.cache?.enabled,
    ),
    "resource export/cache",
  );
  const expected = qaValues(key, role);
  const env = worker.env ?? {};
  requireQa(
    Object.keys(env).length === Object.keys(expected).length + 2,
    "unexpected or missing binding",
  );
  for (const [name, value] of Object.entries(expected))
    requireQa(
      env[name]?.type === "text" && env[name].value === value,
      `binding ${name}`,
    );
  requireQa(
    JSON.stringify(env.SUPABASE_SECRET_KEY) === '{"type":"secret"}',
    "server secret must remain a value-free reference",
  );
  requireQa(
    JSON.stringify(env.WITHDRAWAL_DATA_KEY) === '{"type":"secret"}',
    "withdrawal secret must remain a value-free reference",
  );
  requireQa(
    worker.assets?.runWorkerFirst?.includes("!/brand/*"),
    "brand assets must bypass Worker",
  );
  requireQa(
    !worker.cache?.enabled &&
      !worker.tailConsumers?.length &&
      !worker.streamingTailConsumers?.length,
    "unapproved cache/tail resource",
  );
  return {
    worker: worker.name,
    account: ACCOUNT,
    mode: "qa",
    preview: PREVIEW_URL,
  };
}
export function assertCiEvidence({ run, jobs, artifacts }, sha) {
  assertCiRunIdentity(run, {
    runId: run.id,
    attempt: run.run_attempt,
    headSha: sha,
  });
  requireQa(
    run.status === "completed" && run.conclusion === "success",
    "CI not successful",
  );
  const start = Date.parse(
    run.run_attempt === 1 ? run.created_at : run.run_started_at,
  );
  const end = Date.parse(run.updated_at);
  requireQa(
    Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start &&
      end - start <= CI_BUDGET_MS,
    "CI final duration",
  );
  const result = evaluateCiJobs(run, jobs, end);
  requireQa(
    result.accepted &&
      jobs.find((j) => j.name === CI_BUDGET_JOB)?.conclusion === "success",
    "CI incomplete/failed/budget",
  );
  const required = [
    "e2e-next-production",
    "authenticated-playwright-smoke",
    "typography-public",
    "typography-protected",
    "worker-runtime",
    `backend-successor201-${run.id}-${run.run_attempt}`,
  ];
  const receipt = [];
  for (const name of required) {
    const matches = artifacts.filter((a) => a.name === name);
    requireQa(matches.length === 1, `CI artifact ${name}`);
    const a = matches[0];
    requireQa(
      !a.expired &&
        a.size_in_bytes > 0 &&
        /^sha256:[a-f0-9]{64}$/.test(a.digest ?? "") &&
        a.workflow_run?.head_sha === sha &&
        Date.parse(a.created_at) >= start &&
        Date.parse(a.created_at) <= end,
      "CI artifact attempt/provenance",
    );
    receipt.push({ id: a.id, name, digest: a.digest });
  }
  return {
    id: run.id,
    attempt: run.run_attempt,
    sha,
    event: run.event,
    elapsedMs: end - start,
    artifacts: receipt,
  };
}

export async function readCiAttemptEvidence(request, run) {
  requireQa(
    Number.isSafeInteger(run.id) &&
      run.id > 0 &&
      Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0,
    "CI run/attempt identifiers",
  );
  const jobs = await request(
    `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
  );
  const artifacts = await request(
    `/actions/runs/${run.id}/artifacts?per_page=100`,
  );
  requireQa(
    Array.isArray(jobs.jobs) &&
      jobs.total_count === jobs.jobs.length &&
      Array.isArray(artifacts.artifacts) &&
      artifacts.total_count === artifacts.artifacts.length,
    "CI evidence pagination",
  );
  return { run, jobs: jobs.jobs, artifacts: artifacts.artifacts };
}
export function assertCompleteAccessPolicies(data) {
  const info = data?.result_info;
  requireQa(
    data?.success === true &&
      Array.isArray(data.result) &&
      info?.page === 1 &&
      info.total_pages === 1 &&
      Number.isSafeInteger(info.per_page) &&
      info.per_page > 0 &&
      info.per_page >= data.result.length &&
      info.count === data.result.length &&
      info.total_count === data.result.length &&
      !info.cursor &&
      !info.cursors &&
      !info.next_page &&
      !data.cursor &&
      !data.cursors &&
      !data.next_page,
    "Access policies pagination incomplete",
  );
  return data.result;
}
export function assertAccess(app, policies, role, workerId) {
  const target = TARGETS[role];
  requireQa(app.id === target.accessId, "Access application identity");
  const destinations = app.destinations ?? [];
  requireQa(
    destinations.length > 0 &&
      destinations.every((d) => !d.overrides?.length) &&
      destinations.some(
        (d) =>
          (d.type === "worker" &&
            typeof workerId === "string" &&
            d.worker_id === workerId) ||
          (d.type === "public" && d.uri === new URL(origin(role)).hostname),
      ),
    "Access destination/override",
  );
  requireQa(
    policies.length > 0 &&
      policies.every(
        (p) =>
          p.decision === "non_identity" &&
          p.include?.length > 0 &&
          p.include.every(
            (rule) =>
              Object.keys(rule).join() === "service_token" &&
              typeof rule.service_token?.token_id === "string",
          ),
      ),
    "Access machine-only policy",
  );
}
export function assertWorkerReferences(worker, role, phase) {
  requireQa(
    Object.hasOwn(TARGETS, role) && ["before", "after"].includes(phase),
    "reference role/phase",
  );
  const categories = [
    "workers",
    "domains",
    "dispatch_namespace_outbounds",
    "durable_objects",
    "queues",
  ];
  const references = worker.references;
  requireQa(
    references &&
      Object.keys(references).length === categories.length &&
      categories.every((name) => Array.isArray(references[name])) &&
      !worker.tail_consumers?.length,
    "Worker references shape",
  );
  for (const category of categories) {
    const entries = references[category];
    if (category === "workers" && phase === "before" && entries.length === 1) {
      const own = entries[0];
      requireQa(
        Object.keys(own).sort().join() === "id,name" &&
          own.id === TARGETS[role].workerId &&
          own.name === TARGETS[role].name,
        "foreign Worker reference",
      );
    } else
      requireQa(
        entries.length === 0,
        "Worker is referenced by other resources",
      );
  }
}
export function assertExistingWorker(state, key, role, phase) {
  requireQa(
    Object.hasOwn(TARGETS, role) && ["before", "after"].includes(phase),
    "runtime role/phase",
  );
  const { settings, subdomain, schedules, deployments } = state;
  const bindings = settings.bindings ?? [];
  const allowedSecrets = ["SUPABASE_SECRET_KEY", "WITHDRAWAL_DATA_KEY"];
  const expected = qaValues(key, role);
  const names = new Set();
  requireQa(
    bindings.every((b) => {
      if (names.has(b.name)) return false;
      names.add(b.name);
      if (b.type === "plain_text")
        return (
          Object.hasOwn(expected, b.name) ||
          (phase === "before" &&
            b.name === "NEXT_PUBLIC_APP_ENV" &&
            b.text === "staging")
        );
      if (b.type === "secret_text") return allowedSecrets.includes(b.name);
      if (phase === "before" && b.type === "assets") return b.name === "ASSETS";
      return (
        phase === "before" &&
        b.name === "WORKER_SELF_REFERENCE" &&
        b.type === "service" &&
        b.service === TARGETS[role].name &&
        b.environment === "production" &&
        Object.keys(b).sort().join() === "environment,name,service,type"
      );
    }),
    "existing unapproved resource/secret",
  );
  requireQa(
    bindings.some(
      (b) => b.name === "SUPABASE_SECRET_KEY" && b.type === "secret_text",
    ),
    "existing server secret absent",
  );
  requireQa(
    phase === "before" ||
      bindings.some(
        (b) => b.name === "WITHDRAWAL_DATA_KEY" && b.type === "secret_text",
      ),
    "deployed withdrawal secret absent",
  );
  for (const [name, text] of Object.entries(expected)) {
    // Only the observed member ADMIN addition and disabled-AI default transition
    // are optional before upload; every desired binding is mandatory afterward.
    const optionalBefore =
      phase === "before" &&
      ((role === "member" && name === "ADMIN_APP_URL") ||
        name === "AI_PROVIDER_DISPATCH_ENABLED");
    if (optionalBefore && !names.has(name)) continue;
    requireQa(
      bindings.some(
        (b) => b.name === name && b.type === "plain_text" && b.text === text,
      ),
      `existing preview binding ${name}`,
    );
  }
  requireQa(
    subdomain.enabled === true &&
      subdomain.previews_enabled === false &&
      schedules.schedules?.length === 0,
    "existing triggers",
  );
  const previous = deployments.deployments?.[0];
  requireQa(
    previous?.id &&
      previous.versions?.length === 1 &&
      previous.versions[0].percentage === 100 &&
      previous.versions[0].version_id,
    "prior rollback version unavailable",
  );
  return {
    deploymentId: previous.id,
    versionId: previous.versions[0].version_id,
  };
}
