/** Official Playwright runtime, isolated from application/DB processes on the host.
 * https://playwright.dev/docs/docker#remote-connection
 * The amd64 digest was resolved from Microsoft's v1.63.0-noble OCI index.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const image =
  "mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7";
export function browserPlan(env, root, platform, version) {
  if (
    platform !== "linux" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
    env.APP_ENV !== "test" ||
    version !== "1.63.0" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:63421" ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
    !/^[a-zA-Z0-9_-]+$/.test(env.GITHUB_JOB ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.CI_HEAD_SHA ?? "") ||
    !root.startsWith("/") ||
    /[:\r\n]/.test(root)
  )
    throw Error("WORKROOM_BROWSER_DISPOSABLE_IDENTITY_REQUIRED");
  return {
    image,
    endpoint: "ws://127.0.0.1:9323/",
    root,
    name: `workroom-browser-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${env.GITHUB_JOB}`,
    labels: {
      "com.putduk.ci.repository": env.GITHUB_REPOSITORY,
      "com.putduk.ci.run": env.GITHUB_RUN_ID,
      "com.putduk.ci.attempt": env.GITHUB_RUN_ATTEMPT,
      "com.putduk.ci.job": env.GITHUB_JOB,
      "com.putduk.ci.head": env.CI_HEAD_SHA,
    },
  };
}
export function ownsBrowser(labels, plan) {
  return Boolean(
    labels &&
    Object.entries(plan.labels).every(([key, value]) => labels[key] === value),
  );
}
function stop(plan) {
  const inspected = spawnSync(
    "docker",
    ["inspect", plan.name, "--format", "{{json .Config.Labels}}"],
    { encoding: "utf8" },
  );
  if (inspected.status !== 0) {
    if (/No such (object|container)/i.test(inspected.stderr ?? "")) return;
    throw Error("WORKROOM_BROWSER_INSPECT_FAILED");
  }
  if (!ownsBrowser(JSON.parse(inspected.stdout), plan))
    throw Error("WORKROOM_BROWSER_OWNERSHIP_MISMATCH");
  execFileSync("docker", ["stop", "--time", "10", plan.name], {
    stdio: "inherit",
    timeout: 30000,
  });
}
async function main() {
  const require = createRequire(import.meta.url);
  const version = require("@playwright/test/package.json").version;
  const plan = browserPlan(
    process.env,
    process.cwd(),
    process.platform,
    version,
  );
  if (process.argv[2] === "--stop") {
    stop(plan);
    return;
  }
  if (process.argv[2] !== "--start" || !process.env.GITHUB_ENV)
    throw Error("WORKROOM_BROWSER_COMMAND_REQUIRED");
  execFileSync("docker", ["pull", "--platform", "linux/amd64", plan.image], {
    stdio: "inherit",
    timeout: 300000,
  });
  const labels = Object.entries(plan.labels).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);
  execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--init",
      "--name",
      plan.name,
      "--platform",
      "linux/amd64",
      "--network",
      "host",
      "--ipc",
      "host",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=1g",
      "--user",
      "pwuser",
      "--volume",
      `${plan.root}:/work:ro`,
      "--workdir",
      "/work",
      ...labels,
      plan.image,
      "node",
      "/work/node_modules/@playwright/test/cli.js",
      "run-server",
      "--host",
      "127.0.0.1",
      "--port",
      "9323",
    ],
    { stdio: "inherit", timeout: 60000 },
  );
  try {
    const { chromium } = require("@playwright/test");
    const deadline = Date.now() + 60000;
    let browser;
    while (!browser && Date.now() < deadline) {
      try {
        browser = await chromium.connect(plan.endpoint, { timeout: 3000 });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!browser) throw Error("WORKROOM_BROWSER_SERVER_NOT_READY");
    let browserVersion;
    try {
      browserVersion = browser.version();
      const page = await browser.newPage();
      await page.setContent("<h1>WORKROOM runtime ready</h1>");
      if ((await page.textContent("h1")) !== "WORKROOM runtime ready")
        throw Error("WORKROOM_BROWSER_RENDER_FAILED");
    } finally {
      await browser.close();
    }
    mkdirSync("test-results/workroom-browser-runtime", { recursive: true });
    writeFileSync(
      "test-results/workroom-browser-runtime/receipt.json",
      JSON.stringify(
        {
          ok: true,
          head: process.env.CI_HEAD_SHA,
          runId: process.env.GITHUB_RUN_ID,
          attempt: process.env.GITHUB_RUN_ATTEMPT,
          image: plan.image,
          packageVersion: version,
          browserVersion,
          endpoint: plan.endpoint,
          applicationProcesses: "host",
          browserProcesses: "official immutable image",
          testsSkipped: false,
          productionContacted: false,
        },
        null,
        2,
      ) + "\n",
    );
    appendFileSync(
      process.env.GITHUB_ENV,
      `PW_TEST_CONNECT_WS_ENDPOINT=${plan.endpoint}\n`,
    );
    console.log("WORKROOM_BROWSER_SERVER_READY " + browserVersion);
  } catch (error) {
    stop(plan);
    throw error;
  }
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
