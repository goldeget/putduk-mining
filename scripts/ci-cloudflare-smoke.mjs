import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "test-results/cloudflare-compatibility");
const children = [];
const results = [];
let passed = false;
const testVars = {
  APP_ENV: "test",
  APP_TIMEZONE: "UTC",
  NEXT_PUBLIC_APP_ENV: "test",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  ADMIN_APP_URL: "http://127.0.0.1:3100",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:63421",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_local_cloudflare_compatibility_only",
  SUPABASE_SECRET_KEY: "sb_secret_local_cloudflare_compatibility_only",
};

async function requireUnusedPort(port) {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", accept);
  });
  await new Promise((accept, reject) =>
    probe.close((error) => (error ? reject(error) : accept())),
  );
}

async function start(name, cwd, port) {
  await requireUnusedPort(port);
  const args = [
    "exec",
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
  ];
  for (const [key, value] of Object.entries(testVars))
    args.push("--var", `${key}:${value}`);
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  for (const key of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
  ])
    delete env[key];
  const child = spawn("pnpm", args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const stdout = createWriteStream(resolve(output, `${name}.stdout.log`));
  const stderr = createWriteStream(resolve(output, `${name}.stderr.log`));
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.once("error", (error) => {
    child.launchError = error;
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (
      child.launchError ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      throw new Error(`${name} local Workers process failed to start`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 200) return;
    } catch {
      /* Wait only for our bounded local process startup. */
    }
    await new Promise((accept) => setTimeout(accept, 500));
  }
  throw new Error(`${name} local Workers startup exceeded 90 seconds`);
}

async function check(port, path, accept) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const location = response.headers.get("location");
  const item = { port, path, status: response.status, location };
  results.push(item);
  accept(response, location);
}

try {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_REPOSITORY, "goldeget/putduk-mining");
  assert.equal(process.env.RUNNER_OS, "Linux");
  mkdirSync(output, { recursive: true });
  await start("member", root, 3000);
  await start("admin", resolve(root, "apps/admin"), 3100);
  for (const port of [3000, 3100])
    await check(port, "/login", (response) =>
      assert.equal(response.status, 200),
    );
  for (const [port, path] of [
    [3000, "/wallet"],
    [3100, "/members"],
  ])
    await check(port, path, (response, location) => {
      assert.ok([302, 303, 307, 308].includes(response.status));
      const target = new URL(location, `http://127.0.0.1:${port}`);
      assert.equal(target.origin, `http://127.0.0.1:${port}`);
      assert.equal(target.pathname, "/login");
    });
  await check(3000, "/admin", (response) => assert.equal(response.status, 404));
  await check(3000, "/api/v1/wallet/summary", (response) =>
    assert.equal(response.status, 401),
  );
  console.log("Local workerd anonymous authentication boundary smoke passed.");
  passed = true;
} finally {
  const ended = [];
  const cleanupErrors = [];
  function groupExists(pid) {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  }
  for (const child of children) {
    if (!child.pid) continue;
    let groupRemoved = false;
    try {
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (!groupExists(child.pid)) break;
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        const deadline = Date.now() + 5_000;
        while (groupExists(child.pid) && Date.now() < deadline)
          await new Promise((accept) => setTimeout(accept, 100));
      }
      groupRemoved = !groupExists(child.pid);
      if (!groupRemoved)
        cleanupErrors.push(`Owned process group ${child.pid} remains`);
    } catch (error) {
      cleanupErrors.push(`Owned process group ${child.pid}: ${error.message}`);
    }
    ended.push({
      pid: child.pid,
      exitCode: child.exitCode,
      signal: child.signalCode,
      groupRemoved,
    });
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        profile: "LOCAL_WORKERD_TEST_VALUES_ONLY",
        repository: process.env.GITHUB_REPOSITORY,
        candidate: process.env.CI_HEAD_SHA,
        passed: passed && cleanupErrors.length === 0,
        cleanupErrors,
        results,
        ownedProcesses: ended,
        remoteDeployments: 0,
        remoteDatabaseWrites: 0,
        limitations:
          "Anonymous HTTP boundaries only; not authenticated domain flows, production artifacts or UI acceptance.",
      },
      null,
      2,
    ) + "\n",
  );
  assert.deepEqual(cleanupErrors, [], "Local Workers cleanup failed");
}
