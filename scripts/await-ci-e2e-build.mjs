import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPOSITORY = "goldeget/putduk-mining";
const REQUIRED_JOBS = [
  "E2E production build artifact",
  "WebServer lifecycle probe",
];

export function inspectBuild(run, jobs, expected) {
  if (
    run.id !== expected.runId ||
    run.head_sha !== expected.headSha ||
    run.run_attempt !== expected.attempt ||
    run.repository?.full_name !== REPOSITORY
  ) {
    throw new Error("Build run/candidate/attempt identity mismatch");
  }
  let ready = true;
  for (const name of REQUIRED_JOBS) {
    const matches = jobs.filter(
      (job) => job.name === name && job.run_attempt === expected.attempt,
    );
    if (matches.length > 1) throw new Error(`Ambiguous ${name} job`);
    const job = matches[0];
    if (!job || job.status !== "completed") {
      ready = false;
      continue;
    }
    if (job.conclusion !== "success") {
      throw new Error(`Current ${name} did not succeed`);
    }
  }
  return ready;
}

async function main() {
  const expected = {
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    headSha: process.env.CI_HEAD_SHA,
  };
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== REPOSITORY ||
    !Number.isSafeInteger(expected.runId) ||
    expected.runId <= 0 ||
    !Number.isSafeInteger(expected.attempt) ||
    expected.attempt <= 0 ||
    !/^[0-9a-f]{40}$/.test(expected.headSha ?? "")
  )
    throw new Error("Exact GitHub CI identity is required");
  const deadline = Date.now() + 180_000;
  const get = (suffix) => {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    if (origin !== `https://github.com/${REPOSITORY}.git`) {
      throw new Error("BLOCKED_TARGET_SCOPE: origin mismatch");
    }
    return JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          "--method",
          "GET",
          `repos/${REPOSITORY}/actions/runs/${expected.runId}${suffix}`,
        ],
        {
          encoding: "utf8",
          timeout: 15_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  };
  while (Date.now() < deadline) {
    const run = get("");
    const jobs = get("/jobs?filter=latest&per_page=100");
    if (inspectBuild(run, jobs.jobs ?? [], expected)) {
      console.log(
        "Current candidate E2E build and WebServer lifecycle probe succeeded; artifact download may proceed.",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(
    "Timed out waiting for current candidate E2E build and WebServer lifecycle probe",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
