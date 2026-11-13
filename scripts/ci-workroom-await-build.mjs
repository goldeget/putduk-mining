/** Run native gates while the independent app build runs; admit only its exact successful artifact before browsers start. */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BUILD_ARTIFACT_EXTRACTOR = `import sys,zipfile,pathlib,stat
root=pathlib.Path.cwd().resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 names=set()
 for entry in z.infolist():
  name=entry.filename.rstrip('/')
  if not name: continue
  parts=pathlib.PurePosixPath(name).parts
  if name in names or name.startswith('/') or any(p in ('..','.') for p in parts) or '\\\\' in name or ':' in name or stat.S_ISLNK(entry.external_attr>>16): raise ValueError('unsafe build entry')
  names.add(name)
  if not any(name==p or name.startswith(p+'/') for p in ('.next','apps/admin/.next','test-results/workroom-application','test-results/workroom-runtime')): raise ValueError('unexpected build root')
  if not (root/name).resolve().is_relative_to(root): raise ValueError('build outside checkout')
 z.extractall(root)
`;

export function successfulApplication(run, jobs, identity) {
  const full = identity.profile === "full";
  const workflow = full
    ? ".github/workflows/ci-full-e2e.yml"
    : ".github/workflows/ci.yml";
  if (
    run.id !== identity.id ||
    run.run_attempt !== identity.attempt ||
    run.head_sha !== identity.head ||
    run.repository?.full_name !== "goldeget/putduk-mining" ||
    run.path !== workflow
  )
    throw Error("EXACT_BUILD_RUN_REQUIRED");
  const matches = jobs.filter(
    (job) =>
      job.name ===
      (full ? "WORKROOM full application gates" : "WORKROOM application gates"),
  );
  if (matches.length > 1) throw Error("AMBIGUOUS_APPLICATION_JOB");
  const job = matches[0];
  if (!job || job.status !== "completed") return false;
  if (job.conclusion !== "success")
    throw Error("APPLICATION_GATES_DID_NOT_PASS");
  return true;
}
export function selectBuildArtifact(rows, identity) {
  const name = `workroom-build-${identity.id}-${identity.attempt}-${identity.head}`;
  const matches = rows.filter((row) => row.name === name && !row.expired);
  if (
    matches.length !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? "")
  )
    throw Error("EXACT_BUILD_ARTIFACT_REQUIRED");
  return matches[0];
}
async function main() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
    process.env.APP_ENV !== "test" ||
    process.env.WORKROOM_EARLY_NATIVE !== "1" ||
    !["pr-smoke", "full"].includes(process.env.WORKROOM_CI_PROFILE) ||
    process.env.WORKROOM_CI_RUNTIME
  )
    throw Error("DISPOSABLE_PARALLEL_NATIVE_REQUIRED");
  const identity = {
    id: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    head: process.env.CI_HEAD_SHA,
    profile: process.env.WORKROOM_CI_PROFILE,
  };
  if (
    !Number.isSafeInteger(identity.id) ||
    !Number.isSafeInteger(identity.attempt) ||
    !/^[a-f0-9]{40}$/.test(identity.head ?? "")
  )
    throw Error("BUILD_IDENTITY_REQUIRED");
  const api = (path) =>
    JSON.parse(
      execFileSync("gh", ["api", path], {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      }),
    );
  const base = `repos/goldeget/putduk-mining/actions/runs/${identity.id}`;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    ready = successfulApplication(
      api(base),
      api(`${base}/attempts/${identity.attempt}/jobs?per_page=100`).jobs,
      identity,
    );
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!ready) throw Error("APPLICATION_BUILD_WAIT_EXPIRED");
  const artifact = selectBuildArtifact(
    api(`${base}/artifacts?per_page=100`).artifacts,
    identity,
  );
  const directory = mkdtempSync(
    resolve(process.env.RUNNER_TEMP ?? tmpdir(), "workroom-app-build-"),
  );
  const archive = resolve(directory, "build.zip");
  const fd = openSync(archive, "wx");
  let downloaded;
  try {
    downloaded = spawnSync(
      "gh",
      [
        "api",
        `repos/goldeget/putduk-mining/actions/artifacts/${artifact.id}/zip`,
      ],
      { stdio: ["ignore", fd, "pipe"], timeout: 180000 },
    );
  } finally {
    closeSync(fd);
  }
  if (downloaded.error || downloaded.status !== 0)
    throw Error("BUILD_DOWNLOAD_FAILED");
  const bytes = readFileSync(archive);
  if (
    bytes.length !== artifact.size_in_bytes ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      artifact.digest
  )
    throw Error("BUILD_ARTIFACT_DIGEST_MISMATCH");
  execFileSync("python3", ["-c", BUILD_ARTIFACT_EXTRACTOR, archive], {
    stdio: "inherit",
    timeout: 180000,
  });
  mkdirSync("test-results/workroom-acceptance", { recursive: true });
  writeFileSync(
    "test-results/workroom-acceptance/parallel-build.json",
    JSON.stringify(
      {
        ...identity,
        artifactId: artifact.id,
        digest: artifact.digest,
        applicationPassed: true,
      },
      null,
      2,
    ),
  );
  console.log("WORKROOM_EXACT_APPLICATION_BUILD_READY");
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
