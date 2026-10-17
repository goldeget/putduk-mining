import { execFileSync } from "node:child_process";

const REPOSITORY = "goldeget/putduk-mining";

export function collectCiSourceEvidence(env = process.env, readGit) {
  const git =
    readGit ??
    ((...args) => execFileSync("git", args, { encoding: "utf8" }).trim());
  if (
    !/^https:\/\/github\.com\/goldeget\/putduk-mining(?:\.git)?$/.test(
      git("remote", "get-url", "origin"),
    ) ||
    (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== REPOSITORY)
  )
    throw new Error(
      "BLOCKED_TARGET_SCOPE: execution report repository mismatch",
    );
  const checkoutSha = git("rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(checkoutSha))
    throw new Error("Invalid execution checkout SHA");
  const parents = git("cat-file", "-p", checkoutSha)
    .split(/\r?\n\r?\n/, 1)[0]
    .split(/\r?\n/)
    .flatMap((line) => {
      const parent = /^parent ([0-9a-f]{40})$/.exec(line)?.[1];
      return parent ? [parent] : [];
    });
  const worktreeClean = !git(
    "status",
    "--porcelain",
    "--untracked-files=normal",
  );
  const isCi = env.GITHUB_ACTIONS === "true";
  if (
    isCi &&
    (!worktreeClean ||
      checkoutSha !== env.GITHUB_SHA ||
      !/^[0-9a-f]{40}$/.test(env.CI_HEAD_SHA ?? "") ||
      (env.CI_HEAD_SHA !== checkoutSha && !parents.includes(env.CI_HEAD_SHA)) ||
      !/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? "") ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
      !["push", "pull_request"].includes(env.GITHUB_EVENT_NAME))
  )
    throw new Error(
      "Execution evidence requires a clean exact CI checkout and candidate/run metadata",
    );
  return {
    repository: REPOSITORY,
    sourceSha: checkoutSha,
    parents,
    worktreeClean,
    scope: isCi ? "CI" : "local",
    ...(isCi
      ? {
          candidateSha: env.CI_HEAD_SHA,
          runId: env.GITHUB_RUN_ID,
          attempt: Number(env.GITHUB_RUN_ATTEMPT),
          event: env.GITHUB_EVENT_NAME,
        }
      : {}),
  };
}
