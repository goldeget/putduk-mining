import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const baseline = "9ccc287c5c05b998a9ad345392e9ff07a03a5836";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const manifest = JSON.parse(
  readFileSync("docs/quality/WORKROOM-BROWSER-DISPOSITION.json", "utf8"),
);
const paths = git(
  "ls-tree",
  "-r",
  "--name-only",
  baseline,
  "tests/e2e",
  "tests/typography",
  "tests/runtime-acceptance",
)
  .trim()
  .split("\n")
  .filter((path) => path.endsWith(".spec.ts"))
  .sort();
if (
  manifest.baseline !== baseline ||
  JSON.stringify(manifest.rows.map((row) => row.path).sort()) !==
    JSON.stringify(paths)
)
  throw Error("WORKROOM_BROWSER_DISPOSITION_ROSTER");
const digest = (text) =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
for (const row of manifest.rows) {
  if (
    digest(git("show", `${baseline}:${row.path}`)) !== row.sha256 ||
    digest(readFileSync(row.path, "utf8")) !== row.sha256 ||
    !row.reason ||
    !row.replacements.length ||
    row.executionStatus !== "REQUIRES_FRESH_SUCCESSOR_ACCEPTANCE_NOT_A_PASS"
  )
    throw Error("WORKROOM_BROWSER_DISPOSITION_UNREVIEWED:" + row.path);
}
console.log(
  `WORKROOM_BROWSER_DISPOSITION_VERIFIED ${paths.length} historical files; no historical browser pass claimed.`,
);
