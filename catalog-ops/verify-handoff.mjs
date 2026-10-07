import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const expectedRemote = "https://github.com/goldeget/putduk-mining.git";
assert.equal(git("remote", "get-url", "origin"), expectedRemote);
assert.equal(git("branch", "--show-current"), "parallel/catalog-product-ops");
// The cloud checkout has a narrow fetch refspec; push need not create a local
// tracking ref. Read only the exact authorized feature ref for live evidence.
const remoteBranchHead = git(
  "ls-remote",
  "--exit-code",
  "origin",
  "refs/heads/parallel/catalog-product-ops",
).split(/\s+/)[0];
assert.match(remoteBranchHead, /^[a-f0-9]{40}$/);
if (process.argv.includes("--require-pushed"))
  assert.equal(remoteBranchHead, git("rev-parse", "HEAD"));
if (process.argv.includes("--require-clean"))
  assert.equal(git("status", "--porcelain"), "");
const base = JSON.parse(
  readFileSync(new URL("product-candidates.json", import.meta.url), "utf8"),
).base_sha;
const paths = git("diff", "--name-only", `${base}...HEAD`)
  .split("\n")
  .filter(Boolean);
const stagedAndUnstaged = git("diff", "--name-only", base)
  .split("\n")
  .filter(Boolean);
const untracked = git("ls-files", "--others", "--exclude-standard")
  .split("\n")
  .filter(Boolean);
const allPaths = [
  ...new Set([...paths, ...stagedAndUnstaged, ...untracked]),
].sort();
assert.ok(allPaths.length > 0);
assert.ok(
  allPaths.every((p) => p.startsWith("catalog-ops/")),
  JSON.stringify(allPaths),
);
const freezes = {
  "parallel/admin-release": "f9b454a7c1b86dde1099b6e5a264092118258ead",
  "parallel/launch-ops-content": "ba9ed931f756488ce4f67f945cffad9552842c09",
  "parallel/product-scene-production":
    "505e20c097be8de1b5d02bc65a2dcbd054fe56d1",
};
for (const [ref, sha] of Object.entries(freezes)) {
  assert.equal(git("rev-parse", ref), sha);
  assert.equal(git("rev-parse", `origin/${ref}`), sha);
  assert.equal(
    git("ls-remote", "--exit-code", "origin", `refs/heads/${ref}`).split(
      /\s+/,
    )[0],
    sha,
  );
}
const continuationStart = "8f68be2005e16f1ac257626b3418cd3b8a96f1e3";
git("merge-base", "--is-ancestor", continuationStart, "HEAD");
const research = JSON.parse(
  readFileSync(
    new URL("evidence/research-sources.json", import.meta.url),
    "utf8",
  ),
);
git("diff", "--check");
git("fsck", "--full");
const missing = git("rev-list", "--objects", "--all", "--missing=print")
  .split("\n")
  .filter((p) => p.startsWith("?"));
assert.deepEqual(missing, []);
console.log(
  JSON.stringify(
    {
      status: "PASS",
      current_branch: git("branch", "--show-current"),
      exact_head: git("rev-parse", "HEAD"),
      base_sha: base,
      remote_branch_head: remoteBranchHead,
      commits: git("log", "--reverse", "--format=%H %s", `${base}..HEAD`).split(
        "\n",
      ),
      changed_path_count: allPaths.length,
      path_boundary: "catalog-ops/** ONLY",
      frozen_branches: "ALL_EXACT",
      reachable_missing_objects: 0,
      clean_worktree: git("status", "--porcelain").length === 0,
      production: "NOT_TOUCHED",
      research: {
        assessment_completed: research.assessment_completed,
        all_identities_verified: research.completed,
        counts: research.status_counts,
      },
      continuation_start_sha: continuationStart,
      new_commits: git(
        "log",
        "--reverse",
        "--format=%H %s",
        `${continuationStart}..HEAD`,
      ).split("\n"),
      registration: "BLOCKED_COMMAND_NOT_FOUND",
    },
    null,
    2,
  ),
);
