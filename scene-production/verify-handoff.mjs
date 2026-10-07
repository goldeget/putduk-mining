import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { root, read } from "./source-contract.mjs";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const split = (s) => (s ? s.split("\n") : []);
const expectedOrigin = "https://github.com/goldeget/putduk-mining.git";
if (git("remote", "get-url", "origin") !== expectedOrigin)
  throw Error("BLOCKED_TARGET_SCOPE");
const inventory = JSON.parse(
  read("scene-production/product-catalog-inventory.json"),
);
const sourceMap = JSON.parse(
  read("scene-production/evidence/catalog-source-map.json"),
);
const currentHead = git("rev-parse", "HEAD");
const branch = git("branch", "--show-current");
if (branch !== "parallel/product-scene-production")
  throw Error("WRONG_LANE_BRANCH");
const base = inventory.base_sha;
if (git("merge-base", base, currentHead) !== base)
  throw Error("BASE_NOT_ANCESTOR");
git("fsck", "--full");
if (/^\?/m.test(git("rev-list", "--objects", "--all", "--missing=print")))
  throw Error("MISSING_REACHABLE_OBJECT");
for (const [name, sha] of Object.entries(sourceMap.freeze))
  if (git("rev-parse", name) !== sha)
    throw Error("FROZEN_BRANCH_MOVED " + name);
const committed = split(git("diff", "--name-only", "origin/develop...HEAD"));
const pending = [
  ...split(git("diff", "--name-only")),
  ...split(git("diff", "--cached", "--name-only")),
  ...split(git("ls-files", "--others", "--exclude-standard")),
];
if ([...committed, ...pending].some((p) => !p.startsWith("scene-production/")))
  throw Error("PATH_BOUNDARY_VIOLATION");
const allPaths = split(
  git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "scene-production",
  ),
)
  .filter((p, i, a) => a.indexOf(p) === i)
  .sort();
for (const file of allPaths.filter((f) => f.endsWith(".json")))
  JSON.parse(readFileSync(root + file, "utf8"));
const report = {
  checked_at: new Date().toISOString(),
  branch,
  exact_head: currentHead,
  base_sha: base,
  origin_develop_sha: git("rev-parse", "origin/develop"),
  commits: split(git("log", "--reverse", "--format=%H %s", base + "..HEAD")),
  path_boundary: "PASS_SCENE_PRODUCTION_ONLY",
  committed_changed_paths: committed,
  pending_changed_paths: pending,
  all_package_paths: allPaths,
  json_parse: "PASS_ALL_PACKAGE_JSON",
  integrity: "PASS_FSCK_NO_MISSING_REACHABLE_OBJECT",
  frozen_branch_heads: sourceMap.freeze,
};
if (process.argv.includes("--remote")) {
  // Identity above is checked immediately before this exact-repository network operation.
  const refs = split(
    git(
      "ls-remote",
      "--heads",
      "origin",
      branch,
      ...Object.keys(sourceMap.freeze),
      "develop",
    ),
  );
  report.remote_refs = refs;
  for (const [name, sha] of Object.entries(sourceMap.freeze))
    if (!refs.includes(sha + "\trefs/heads/" + name))
      throw Error("REMOTE_FROZEN_BRANCH_MOVED " + name);
  if (!refs.includes(currentHead + "\trefs/heads/" + branch))
    throw Error("REMOTE_FEATURE_HEAD_MISMATCH");
  report.remote_feature_head = "PASS";
}
if (process.argv.includes("--write-evidence")) {
  writeFileSync(
    root + "scene-production/evidence/changed-paths.txt",
    allPaths.join("\n") + "\n",
  );
  writeFileSync(
    root + "scene-production/evidence/path-boundary.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report, null, 2));
