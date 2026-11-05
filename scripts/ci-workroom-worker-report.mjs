/** Successor source context; every historical raw worker-report assertion is reused unchanged. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { summarizeWorkerReport } from "./assert-worker-report.mjs";
import { readWorkroomRunIdentity } from "./ci-workroom-content-stage.mjs";
import { readGitBlobs } from "./ci-workroom-git-blobs.mjs";
import { execFileSync } from "node:child_process";
const hash = (b) => createHash("sha256").update(b).digest("hex");
if (
  process.argv.length !== 5 ||
  process.argv[3] !== "--started-after" ||
  !["acceptance", "cloudflare-acceptance"].includes(process.env.GITHUB_JOB)
)
  throw Error("WORKROOM_WORKER_REPORT_CONTEXT");
const originalPaths = [
  "scripts/assert-worker-report.mjs",
  "scripts/ci-source-evidence.mjs",
];
const historical = readGitBlobs(
  process.cwd(),
  "9ccc287c5c05b998a9ad345392e9ff07a03a5836",
  originalPaths,
);
const provenance = originalPaths.map((path) => {
  const original = historical
      .get(path)
      .toString("utf8")
      .replaceAll("\r\n", "\n"),
    current = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  if (current !== original)
    throw Error("WORKROOM_FROZEN_WORKER_ASSERTIONS_CHANGED");
  return { path, canonicalSha256: hash(original) };
});
if (
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim()
)
  throw Error("WORKROOM_WORKER_CLEAN_SOURCE_REQUIRED");
const identity = await readWorkroomRunIdentity(process.env.GITHUB_JOB);
const raw = readFileSync(process.argv[2]);
const summary = summarizeWorkerReport(JSON.parse(raw), {
  startedAfter: Number(process.argv[4]),
});
mkdirSync("test-results/worker", { recursive: true });
writeFileSync(
  "test-results/worker/report.json",
  JSON.stringify(
    {
      source: {
        ...identity,
        scope: "CI",
        sourceSha: identity.checkoutSha,
        worktreeClean: true,
      },
      historicalAssertions: {
        strategy:
          "unchanged exported summarizeWorkerReport; no assertion-source transformation",
        inverseExact: true,
        files: provenance,
      },
      rawSha256: hash(raw),
      ...summary,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Worker execution: passed=" +
    summary.counts.numPassedTests +
    " failed=" +
    summary.counts.numFailedTests +
    " skipped=" +
    summary.counts.numPendingTests +
    " todo=" +
    summary.counts.numTodoTests +
    "; accepted=" +
    summary.accepted,
);
if (!summary.accepted) throw Error(summary.problems.join("; "));
