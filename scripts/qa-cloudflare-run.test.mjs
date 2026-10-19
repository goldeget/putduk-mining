import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { join } from "node:path";
import * as runner from "./qa-cloudflare-run.mjs";

const sha = "a".repeat(40);
const account = "9dc502d4ef06b3b5374591de6e6933ca";
const preview = "https://mhchzipznxbwbocdihlg.supabase.co";
const targets = {
  member: { directory: ".", name: "putduk-mining-member-staging-ab1de38" },
  admin: {
    directory: "apps/admin",
    name: "putduk-mining-admin-staging-ab1de38",
  },
};
const versions = {
  member: {
    prior: "11111111-1111-4111-8111-111111111111",
    current: "22222222-2222-4222-8222-222222222222",
  },
  admin: {
    prior: "33333333-3333-4333-8333-333333333333",
    current: "44444444-4444-4444-8444-444444444444",
  },
};
const secret = "sb_secret_FIXTURE_ONLY_NEVER_A_REAL_KEY";
const secretDir = join("/qa-fixture-owned", "putduk-qa-secrets-001");
const secretFile = join(secretDir, "runtime.json");
const clone = (value) => JSON.parse(JSON.stringify(value));
const failure = (message, code) => Object.assign(new Error(message), { code });

beforeEach((t) => {
  t.mock.method(globalThis, "fetch", () => {
    assert.fail("deployment fixture attempted a real fetch");
  });
});

function fixture() {
  const env = {
    RUNNER_OS: "Linux",
    RUNNER_TEMP: "/qa-fixture-owned",
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "2",
    QA_BUILD_ARTIFACT_ID: "789",
    QA_BUILD_ARTIFACT_DIGEST: "d".repeat(64),
    QA_CF_API_TOKEN: "fixture-cf-token",
    QA_MEMBER_ACCESS_CLIENT_ID: "fixture-member-id",
    QA_MEMBER_ACCESS_CLIENT_SECRET: "fixture-member-secret",
    QA_ADMIN_ACCESS_CLIENT_ID: "fixture-admin-id",
    QA_ADMIN_ACCESS_CLIENT_SECRET: "fixture-admin-secret",
    PUTDUK_QA_SUPABASE_SECRET_KEY: secret,
  };
  const prior = Object.fromEntries(
    ["member", "admin"].map((role) => [
      role,
      {
        deploymentId:
          role === "member"
            ? "55555555-5555-4555-8555-555555555555"
            : "66666666-6666-4666-8666-666666666666",
        versionId: versions[role].prior,
        routes: {
          zoneId: "c9e6c93451c3c2e107a1eca511bedaba",
          accountId: account,
          count: 0,
          sha256: "0".repeat(64),
        },
        accessDigest: (role === "member" ? "3" : "4").repeat(64),
        secretNames: ["SUPABASE_SECRET_KEY"],
      },
    ]),
  );
  const built = {
    sha,
    runId: "456",
    attempt: "2",
    node: "v24.21.0",
    pnpm: "12.6.0",
    cf: "1.0.0-beta.18",
    vinext: "1.2.0",
    workers: {
      member: {
        worker: "putduk-mining-member-staging-ab1de38",
        account,
        mode: "qa",
        preview,
        sha256: "1".repeat(64),
        files: 10,
      },
      admin: {
        worker: "putduk-mining-admin-staging-ab1de38",
        account,
        mode: "qa",
        preview,
        sha256: "2".repeat(64),
        files: 20,
      },
    },
  };
  const f = {
    env,
    prior,
    built,
    remote: clone(prior),
    events: [],
    saves: [],
    commands: [],
    files: new Map(),
    directories: new Set(),
    cliOutcomes: {},
    cliError: new Error("fixture CLI failure: PRIVATE_ERROR_SENTINEL"),
    ci: {
      id: 123,
      attempt: 2,
      sha,
      event: "pull_request",
      elapsedMs: 600_000,
      artifacts: [
        "e2e-next-production",
        "authenticated-playwright-smoke",
        "typography-public",
        "typography-protected",
        "worker-runtime",
        "backend-successor201-123-2",
      ].map((name, index) => ({
        id: index + 1,
        name,
        digest: `sha256:${"a".repeat(64)}`,
      })),
    },
    last: () => f.saves.at(-1),
  };
  f.io = {
    env,
    read(name) {
      assert.equal(name, "build");
      f.events.push({ type: "read-build" });
      return clone(built);
    },
    save(name, receipt) {
      assert.equal(name, "deployment");
      const snapshot = clone(receipt);
      f.saves.push(snapshot);
      f.events.push({ type: "save", receipt: snapshot });
    },
    async ciEvidence(wait) {
      assert.equal(wait, false);
      f.events.push({ type: "ci" });
      return clone(f.ci);
    },
    async verifyPreviewKeys() {
      f.events.push({ type: "preview-keys" });
    },
    async inspectBuild(role) {
      f.events.push({ type: "build", role });
      return clone(built.workers[role]);
    },
    async inspectRemote(role, phase) {
      f.events.push({ type: "remote", role, phase });
      return clone(f.remote[role]);
    },
    async loadSmoke() {
      return {
        async smoke(role, accessOnly) {
          f.events.push({ type: "smoke", role, accessOnly });
          return accessOnly
            ? { authenticatedAccess: "passed" }
            : { login: "passed", asset: { bytes: 689 } };
        },
      };
    },
    run(command, args, directory, extra, quiet) {
      const role = ["member", "admin"].find(
        (candidate) => targets[candidate].directory === directory,
      );
      assert.ok(role, "CLI must target one of the two existing QA directories");
      f.commands.push({ role, command, args, directory, extra, quiet });
      f.events.push({ type: "cli", role });
      if (f.cliOutcomes[role] === "error") throw f.cliError;
      if (f.cliOutcomes[role] !== "unchanged")
        f.remote[role] = {
          ...clone(prior[role]),
          deploymentId:
            role === "member"
              ? "77777777-7777-4777-8777-777777777777"
              : "88888888-8888-4888-8888-888888888888",
          versionId: versions[role].current,
        };
      if (f.cliOutcomes[role] === "lost") throw f.cliError;
    },
    async cloudflare(path) {
      f.events.push({ type: "version", path });
      const role = ["member", "admin"].find(
        (candidate) =>
          path ===
          `/workers/scripts/${targets[candidate].name}/versions/${versions[candidate].current}`,
      );
      assert.ok(role, "only the observed exact QA version may be inspected");
      return {
        id: versions[role].current,
        annotations: { "workers/tag": sha },
      };
    },
    fs: {
      mkdtempSync(prefix) {
        assert.equal(prefix, join(env.RUNNER_TEMP, "putduk-qa-secrets-"));
        f.events.push({ type: "mkdir" });
        f.directories.add(secretDir);
        return secretDir;
      },
      writeFileSync(path, content, options) {
        assert.equal(path, secretFile);
        assert.deepEqual(options, { mode: 0o600 });
        assert.deepEqual(JSON.parse(content), { SUPABASE_SECRET_KEY: secret });
        f.events.push({ type: "secret-write" });
        f.files.set(path, content);
      },
      unlinkSync(path) {
        assert.equal(path, secretFile);
        f.events.push({ type: "unlink" });
        if (!f.files.delete(path))
          throw failure("fixture missing file", "ENOENT");
      },
      rmdirSync(path) {
        assert.equal(path, secretDir);
        f.events.push({ type: "rmdir" });
        if (f.files.size)
          throw failure("fixture directory not empty", "ENOTEMPTY");
        if (!f.directories.delete(path))
          throw failure("fixture missing directory", "ENOENT");
      },
    },
  };
  return f;
}

async function rejected(f) {
  try {
    await runner.deploy(f.io);
  } catch (error) {
    return error;
  }
  assert.fail("expected actual deployment loop to reject");
}

function assertFailureReceipt(f) {
  assert.equal(f.last().state, "FAILED_OR_PARTIAL_REQUIRES_REVIEW");
  assertSanitized(f);
}

function assertSanitized(f) {
  const serialized = JSON.stringify(f.saves);
  for (const value of [
    secret,
    "fixture-cf-token",
    "fixture-member-secret",
    "fixture-admin-secret",
    "PRIVATE_ERROR_SENTINEL",
  ])
    assert.equal(serialized.includes(value), false);
}

test("actual deploy preserves ordered two-role receipts, exact CLI contract and owned cleanup", async () => {
  assert.equal(typeof runner.deploy, "function");
  const f = fixture();
  await runner.deploy(f.io);
  assert.equal(f.last().state, "QA_DEPLOYED_NOT_RELEASE_ACCEPTED");
  assert.deepEqual(
    f.commands.map((c) => c.role),
    ["member", "admin"],
  );
  const firstCli = f.events.findIndex((e) => e.type === "cli");
  assert.deepEqual(
    f.events
      .slice(0, firstCli)
      .filter((e) => e.type === "smoke")
      .map((e) => [e.role, e.accessOnly]),
    [
      ["member", true],
      ["admin", true],
    ],
  );
  for (const role of ["member", "admin"]) {
    const worker = f.last().workers[role];
    assert.deepEqual(worker.prior, f.prior[role]);
    assert.equal(worker.current.versionId, versions[role].current);
    assert.equal(worker.state, "QA_SMOKE_PASSED");
    const cliIndex = f.events.findIndex(
      (e) => e.type === "cli" && e.role === role,
    );
    assert.ok(
      f.events
        .slice(0, cliIndex)
        .some(
          (e) =>
            e.type === "save" &&
            e.receipt.workers[role]?.state === "DEPLOYING" &&
            !e.receipt.workers[role].current,
        ),
    );
    const smokeIndex = f.events.findIndex(
      (e) => e.type === "smoke" && e.role === role && !e.accessOnly,
    );
    assert.ok(
      f.events
        .slice(cliIndex, smokeIndex)
        .some(
          (e) =>
            e.type === "save" &&
            e.receipt.workers[role]?.current?.versionId ===
              versions[role].current,
        ),
    );
    const command = f.commands.find((c) => c.role === role);
    assert.deepEqual(command, {
      role,
      command: "pnpm",
      args: [
        "exec",
        "cf",
        "deploy",
        "--prebuilt",
        "--mode",
        "qa",
        "--no-provision",
        "--tag",
        sha,
        "--message",
        `QA goldeget/putduk-mining@${sha}`,
        "--secrets-file",
        secretFile,
      ],
      directory: role === "member" ? "." : "apps/admin",
      extra: {
        CLOUDFLARE_API_TOKEN: "fixture-cf-token",
        CLOUDFLARE_ACCOUNT_ID: account,
      },
      quiet: true,
    });
  }
  assert.deepEqual(
    f.saves[0].workers,
    {},
    "old snapshots must not change with the receipt",
  );
  assert.equal(f.files.size, 0);
  assert.equal(f.directories.size, 0);
  assert.deepEqual(
    f.events.slice(-3).map((e) => e.type),
    ["unlink", "rmdir", "save"],
  );
  assert.equal(JSON.stringify(f.saves).includes(secret), false);
});

for (const role of ["member", "admin"]) {
  test(`${role} Access preflight failure prevents every deployment`, async () => {
    const f = fixture();
    const load = f.io.loadSmoke;
    const denied = new Error("fixture Access denied");
    f.io.loadSmoke = async () => {
      const original = await load();
      return {
        async smoke(at, accessOnly) {
          const result = await original.smoke(at, accessOnly);
          if (at === role && accessOnly) throw denied;
          return result;
        },
      };
    };
    assert.equal(await rejected(f), denied);
    assertFailureReceipt(f);
    assert.equal(f.commands.length, 0);
    assert.equal(f.directories.size, 0);
    assert.deepEqual(f.last().workers[role].prior, f.prior[role]);
    assert.equal(f.last().workers[role].state, "NOT_DEPLOYED");
    if (role === "member") assert.equal(f.last().workers.admin, undefined);
  });

  test(`${role} post-smoke failure retains observed current and stops later mutation`, async () => {
    const f = fixture();
    const load = f.io.loadSmoke;
    const failedSmoke = new Error("fixture post-smoke failure");
    f.io.loadSmoke = async () => {
      const original = await load();
      return {
        async smoke(at, accessOnly) {
          const result = await original.smoke(at, accessOnly);
          if (at === role && !accessOnly) throw failedSmoke;
          return result;
        },
      };
    };
    assert.equal(await rejected(f), failedSmoke);
    assertFailureReceipt(f);
    assert.deepEqual(f.last().workers[role].prior, f.prior[role]);
    assert.equal(
      f.last().workers[role].current.versionId,
      versions[role].current,
    );
    assert.equal(f.last().workers[role].state, "DEPLOYING");
    assert.equal(f.commands.length, role === "member" ? 1 : 2);
    if (role === "member")
      assert.equal(f.last().workers.admin.state, "NOT_DEPLOYED");
    else assert.equal(f.last().workers.member.state, "QA_SMOKE_PASSED");
    assert.equal(f.files.size, 0);
    assert.equal(f.directories.size, 0);
  });

  for (const field of ["accessDigest", "secretNames"]) {
    test(`${role} ${field} drift is saved before rejection and prevents next deploy`, async () => {
      const f = fixture();
      const inspect = f.io.inspectRemote;
      f.io.inspectRemote = async (at, phase) => {
        const snapshot = await inspect(at, phase);
        if (at === role && phase === "after")
          snapshot[field] =
            field === "accessDigest"
              ? "f".repeat(64)
              : ["SUPABASE_SECRET_KEY", "UNREVIEWED_SECRET"];
        return snapshot;
      };
      assert.match(
        (await rejected(f)).message,
        /Access\/secret bindings changed/,
      );
      assertFailureReceipt(f);
      const worker = f.last().workers[role];
      assert.deepEqual(worker.prior, f.prior[role]);
      assert.equal(worker.current.versionId, versions[role].current);
      assert.notDeepEqual(worker.current[field], worker.prior[field]);
      assert.equal(worker.state, "DEPLOYING");
      assert.ok(
        f.saves.some(
          (receipt) =>
            receipt.state === "PREFLIGHT" &&
            receipt.workers[role]?.current?.versionId ===
              versions[role].current,
        ),
      );
      assert.equal(f.commands.length, role === "member" ? 1 : 2);
      assert.equal(
        f.events.some(
          (e) => e.type === "smoke" && e.role === role && !e.accessOnly,
        ),
        false,
      );
    });
  }

  test(`${role} remote race rejects before its CLI and keeps original rollback evidence`, async () => {
    const f = fixture();
    const inspect = f.io.inspectRemote;
    let beforeCount = 0;
    f.io.inspectRemote = async (at, phase) => {
      if (at === role && phase === "before" && ++beforeCount === 2)
        f.remote[role].versionId = "99999999-9999-4999-8999-999999999999";
      return inspect(at, phase);
    };
    assert.match((await rejected(f)).message, /remote changed before deploy/);
    assertFailureReceipt(f);
    assert.deepEqual(f.last().workers[role].prior, f.prior[role]);
    assert.equal(f.last().workers[role].state, "NOT_DEPLOYED");
    assert.equal(f.last().workers[role].current, undefined);
    assert.equal(f.commands.length, role === "member" ? 0 : 1);
  });

  test(`${role} prebuilt byte race prevents its CLI without erasing earlier success`, async () => {
    const f = fixture();
    const inspect = f.io.inspectBuild;
    let count = 0;
    f.io.inspectBuild = async (at) => {
      const built = await inspect(at);
      if (at === role && ++count === 2) built.sha256 = "c".repeat(64);
      return built;
    };
    assert.match((await rejected(f)).message, /prebuilt bytes changed/);
    assertFailureReceipt(f);
    assert.equal(f.commands.length, role === "member" ? 0 : 1);
    assert.deepEqual(f.last().workers[role].prior, f.prior[role]);
    assert.equal(f.last().workers[role].state, "NOT_DEPLOYED");
    if (role === "admin")
      assert.equal(f.last().workers.member.state, "QA_SMOKE_PASSED");
  });

  test(`${role} fresh CI rejection prevents its CLI while retaining prior receipts`, async () => {
    const f = fixture();
    const readCi = f.io.ciEvidence;
    let count = 0;
    const changedCi = new Error("fixture CI attempt changed");
    f.io.ciEvidence = async (wait) => {
      const evidence = await readCi(wait);
      if (++count === (role === "member" ? 2 : 3)) throw changedCi;
      return evidence;
    };
    assert.equal(await rejected(f), changedCi);
    assertFailureReceipt(f);
    assert.equal(f.commands.length, role === "member" ? 0 : 1);
    assert.deepEqual(f.last().workers[role].prior, f.prior[role]);
    assert.equal(f.last().workers[role].state, "NOT_DEPLOYED");
    if (role === "admin")
      assert.equal(f.last().workers.member.state, "QA_SMOKE_PASSED");
  });
}

test("second CLI error preserves first success and marks second outcome conservatively", async () => {
  const f = fixture();
  f.cliOutcomes.admin = "error";
  assert.equal(await rejected(f), f.cliError);
  assertFailureReceipt(f);
  assert.deepEqual(
    f.commands.map((c) => c.role),
    ["member", "admin"],
  );
  assert.equal(f.last().workers.member.state, "QA_SMOKE_PASSED");
  assert.equal(
    f.last().workers.member.current.versionId,
    versions.member.current,
  );
  assert.deepEqual(f.last().workers.admin.prior, f.prior.admin);
  assert.equal(f.last().workers.admin.state, "DEPLOYING");
  assert.equal(f.last().workers.admin.current, undefined);
  assert.equal(f.remote.admin.versionId, versions.admin.prior);
  assert.equal(f.directories.size, 0);
});

test("lost CLI response after remote change keeps DEPLOYING without retry or false rollback", async () => {
  const f = fixture();
  f.cliOutcomes.admin = "lost";
  assert.equal(await rejected(f), f.cliError);
  assertFailureReceipt(f);
  assert.equal(f.remote.admin.versionId, versions.admin.current);
  assert.equal(f.last().workers.admin.state, "DEPLOYING");
  assert.equal(f.last().workers.admin.current, undefined);
  assert.deepEqual(f.last().workers.admin.prior, f.prior.admin);
  assert.equal(f.last().workers.member.state, "QA_SMOKE_PASSED");
  assert.equal(f.commands.length, 2);
  assert.equal(f.files.size, 0);
});

test("unobserved new version retains current evidence but cannot pass smoke or deploy admin", async () => {
  const f = fixture();
  f.cliOutcomes.member = "unchanged";
  assert.match((await rejected(f)).message, /new version not observed/);
  assertFailureReceipt(f);
  assert.deepEqual(f.last().workers.member.current, f.prior.member);
  assert.equal(f.last().workers.member.state, "DEPLOYING");
  assert.equal(f.commands.length, 1);
  assert.equal(
    f.events.some((e) => e.type === "version"),
    false,
  );
});

test("wrong deployed SHA tag retains observed version and prevents successful admission", async () => {
  const f = fixture();
  const inspect = f.io.cloudflare;
  f.io.cloudflare = async (path) => {
    const version = await inspect(path);
    version.annotations["workers/tag"] = "b".repeat(40);
    return version;
  };
  assert.match((await rejected(f)).message, /deployed version SHA tag/);
  assertFailureReceipt(f);
  assert.equal(
    f.last().workers.member.current.versionId,
    versions.member.current,
  );
  assert.equal(f.last().workers.member.state, "DEPLOYING");
  assert.equal(f.commands.length, 1);
});

test("post-deploy inspection failure preserves prior without inventing an observed current", async () => {
  const f = fixture();
  const inspect = f.io.inspectRemote;
  const unreadable = new Error("fixture remote post-read failed");
  f.io.inspectRemote = async (role, phase) => {
    if (role === "member" && phase === "after") throw unreadable;
    return inspect(role, phase);
  };
  assert.equal(await rejected(f), unreadable);
  assertFailureReceipt(f);
  assert.equal(f.remote.member.versionId, versions.member.current);
  assert.deepEqual(f.last().workers.member.prior, f.prior.member);
  assert.equal(f.last().workers.member.current, undefined);
  assert.equal(f.last().workers.member.state, "DEPLOYING");
  assert.equal(f.commands.length, 1);
});

test("preflight artifact mismatch blocks both roles before secret creation", async () => {
  const f = fixture();
  const inspect = f.io.inspectBuild;
  f.io.inspectBuild = async (role) => ({
    ...(await inspect(role)),
    ...(role === "admin" ? { files: 999 } : {}),
  });
  assert.match((await rejected(f)).message, /artifact changed after dry run/);
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 0);
  assert.equal(f.last().workers.member.state, "NOT_DEPLOYED");
  assert.equal(f.last().workers.admin, undefined);
  assert.equal(f.directories.size, 0);
});

test("preview key validation failure blocks all remote deployment work", async () => {
  const f = fixture();
  const invalid = new Error("fixture preview key denied");
  f.io.verifyPreviewKeys = async () => {
    throw invalid;
  };
  assert.equal(await rejected(f), invalid);
  assertFailureReceipt(f);
  assert.deepEqual(f.last().workers, {});
  assert.equal(f.commands.length, 0);
});

test("incomplete explicit I/O never falls back to a live production boundary", async () => {
  const f = fixture();
  delete f.io.ciEvidence;
  assert.match((await rejected(f)).message, /ciEvidence is not a function/);
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 0);
  assert.equal(
    f.events.some((e) => e.type === "ci"),
    false,
  );
});

for (const [name, mutate] of [
  [
    "non-hosted runner",
    (f) => {
      f.env.RUNNER_OS = "Windows";
    },
  ],
  [
    "relative runner temp",
    (f) => {
      f.env.RUNNER_TEMP = "relative";
    },
  ],
  [
    "missing deploy credential",
    (f) => {
      delete f.env.QA_CF_API_TOKEN;
    },
  ],
  [
    "invalid artifact ID",
    (f) => {
      f.env.QA_BUILD_ARTIFACT_ID = "not-an-id";
    },
  ],
  [
    "different build provenance",
    (f) => {
      f.built.sha = "b".repeat(40);
    },
  ],
]) {
  test(`${name} is rejected before a deployment receipt or CLI is created`, async () => {
    const f = fixture();
    mutate(f);
    assert.match((await rejected(f)).message, /QA_BLOCKED/);
    assert.equal(f.commands.length, 0);
    assert.equal(f.saves.length, 0);
    assert.equal(
      f.events.some((e) => e.type === "ci"),
      false,
    );
  });
}

test("temporary directory creation failure saves known priors with no deployment", async () => {
  const f = fixture();
  const denied = failure("fixture mkdir denied", "EACCES");
  f.io.fs.mkdtempSync = () => {
    throw denied;
  };
  assert.equal(await rejected(f), denied);
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.last().workers.member.prior, f.prior.member);
  assert.deepEqual(f.last().workers.admin.prior, f.prior.admin);
  assert.equal(
    f.events.some((e) => e.type === "unlink" || e.type === "rmdir"),
    false,
  );
});

test("secret write failure before file creation preserves the primary error and removes owned directory", async () => {
  const f = fixture();
  const writeError = failure("fixture secret write denied", "EACCES");
  f.io.fs.writeFileSync = () => {
    throw writeError;
  };
  const error = await rejected(f);
  assert.deepEqual(
    {
      primaryPreserved: error === writeError,
      rmdirAttempted: f.events.some((e) => e.type === "rmdir"),
      remainingDirectories: f.directories.size,
    },
    { primaryPreserved: true, rmdirAttempted: true, remainingDirectories: 0 },
  );
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 0);
  assert.equal(f.files.size, 0);
});

test("partially written secret is removed without losing the write failure", async () => {
  const f = fixture();
  const write = f.io.fs.writeFileSync;
  const partialWrite = new Error("fixture write response lost");
  f.io.fs.writeFileSync = (...args) => {
    write(...args);
    throw partialWrite;
  };
  assert.equal(await rejected(f), partialWrite);
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 0);
  assert.equal(f.files.size, 0);
  assert.equal(f.directories.size, 0);
});

test("CLI failure survives cleanup failures and still attempts both known paths", async () => {
  const f = fixture();
  f.cliOutcomes.member = "error";
  f.io.fs.unlinkSync = (path) => {
    assert.equal(path, secretFile);
    f.events.push({ type: "unlink" });
    throw failure("fixture unlink denied", "EACCES");
  };
  const error = await rejected(f);
  assert.deepEqual(
    {
      primaryPreserved: error === f.cliError,
      rmdirAttempted: f.events.some((e) => e.type === "rmdir"),
    },
    { primaryPreserved: true, rmdirAttempted: true },
  );
  assertFailureReceipt(f);
  assert.equal(f.last().workers.member.state, "DEPLOYING");
  assert.deepEqual(f.last().workers.member.prior, f.prior.member);
  assert.equal(
    f.files.has(secretFile),
    true,
    "unremoved secret must not be claimed cleaned",
  );
});

test("unlink denial after two deployments fails overall and still attempts owned rmdir", async () => {
  const f = fixture();
  const unlinkError = failure("fixture unlink denied", "EACCES");
  f.io.fs.unlinkSync = () => {
    f.events.push({ type: "unlink" });
    throw unlinkError;
  };
  assert.equal(await rejected(f), unlinkError);
  assertFailureReceipt(f);
  assert.equal(
    f.events.some((e) => e.type === "rmdir"),
    true,
  );
  for (const role of ["member", "admin"]) {
    assert.equal(f.last().workers[role].state, "QA_SMOKE_PASSED");
    assert.equal(
      f.last().workers[role].current.versionId,
      versions[role].current,
    );
    assert.deepEqual(f.last().workers[role].prior, f.prior[role]);
  }
});

test("only the known secret file ENOENT can be ignored during successful cleanup", async () => {
  const f = fixture();
  const unlink = f.io.fs.unlinkSync;
  f.io.fs.unlinkSync = (path) => {
    f.files.delete(path);
    unlink(path);
  };
  await runner.deploy(f.io);
  assert.equal(f.last().state, "QA_DEPLOYED_NOT_RELEASE_ACCEPTED");
  assert.equal(f.files.size, 0);
  assert.equal(f.directories.size, 0);
});

for (const code of ["EACCES", "ENOENT"]) {
  test(`owned rmdir ${code} is not ignored and preserves both deployed versions`, async () => {
    const f = fixture();
    const denied = failure("fixture rmdir failure", code);
    f.io.fs.rmdirSync = () => {
      throw denied;
    };
    assert.equal(await rejected(f), denied);
    assertFailureReceipt(f);
    assert.equal(f.files.size, 0);
    for (const role of ["member", "admin"]) {
      assert.equal(f.last().workers[role].state, "QA_SMOKE_PASSED");
      assert.equal(
        f.last().workers[role].current.versionId,
        versions[role].current,
      );
    }
  });
}

test("initial receipt write failure permits no CLI and invents no persisted receipt", async () => {
  const f = fixture();
  const denied = new Error("fixture initial receipt denied");
  f.io.save = () => {
    throw denied;
  };
  assert.equal(await rejected(f), denied);
  assert.equal(f.commands.length, 0);
  assert.equal(f.saves.length, 0);
});

test("failed DEPLOYING receipt save blocks its CLI and final failure retains known priors", async () => {
  const f = fixture();
  const save = f.io.save;
  const denied = new Error("fixture pre-CLI receipt denied");
  f.io.save = (name, receipt) => {
    if (
      receipt.state === "PREFLIGHT" &&
      receipt.workers.member?.state === "DEPLOYING"
    )
      throw denied;
    save(name, receipt);
  };
  assert.equal(await rejected(f), denied);
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.last().workers.member.prior, f.prior.member);
  assert.equal(f.last().workers.member.current, undefined);
});

test("failed current receipt save retains observed version in final failure instead of rolling back", async () => {
  const f = fixture();
  const save = f.io.save;
  const denied = new Error("fixture current receipt denied");
  f.io.save = (name, receipt) => {
    if (receipt.state === "PREFLIGHT" && receipt.workers.member?.current)
      throw denied;
    save(name, receipt);
  };
  assert.equal(await rejected(f), denied);
  assertFailureReceipt(f);
  assert.equal(f.commands.length, 1);
  assert.deepEqual(f.last().workers.member.prior, f.prior.member);
  assert.equal(
    f.last().workers.member.current.versionId,
    versions.member.current,
  );
  assert.equal(f.last().workers.member.state, "DEPLOYING");
});

test("final receipt failure rejects without fabricating a persisted overall success", async () => {
  const f = fixture();
  const save = f.io.save;
  const denied = new Error("fixture final receipt denied");
  f.io.save = (name, receipt) => {
    if (receipt.state === "QA_DEPLOYED_NOT_RELEASE_ACCEPTED") throw denied;
    save(name, receipt);
  };
  assert.equal(await rejected(f), denied);
  assert.equal(f.commands.length, 2);
  assert.equal(f.last().state, "PREFLIGHT");
  assert.equal(
    f.saves.some((r) => r.state === "QA_DEPLOYED_NOT_RELEASE_ACCEPTED"),
    false,
  );
  assert.equal(f.last().workers.member.state, "QA_SMOKE_PASSED");
  assert.equal(f.last().workers.admin.state, "QA_SMOKE_PASSED");
  assertSanitized(f);
});
