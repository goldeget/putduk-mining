/** Additive WORKROOM candidate admission; historical backend manifests stay immutable. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGitBlobs } from "./ci-workroom-git-blobs.mjs";
import {
  canonicalSourceBytes as canonical,
  canonicalPolicy,
} from "./ci-workroom-source-bytes.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = "9ccc287c5c05b998a9ad345392e9ff07a03a5836";
const manifestPath = "docs/quality/WORKROOM-SOURCE-MANIFEST.json";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function requireCondition(value, reason) {
  if (!value) throw Error("WORKROOM_SOURCE_" + reason);
}
function paths() {
  return [
    ...new Set(
      git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        .toString("utf8")
        .split("\0")
        .filter((p) => p && p !== manifestPath),
    ),
  ].sort();
}
function hashes(names) {
  return Object.fromEntries(
    names.map((name) => {
      requireCondition(
        !name.startsWith("/") &&
          !name.split("/").some((part) => part === ".." || part === ".") &&
          !name.includes("\\"),
        "PATH_REJECTED",
      );
      const path = resolve(root, name);
      requireCondition(
        lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
        "FILE_REJECTED",
      );
      return [name, hash(canonical(name, readFileSync(path)))];
    }),
  );
}
const origin = git("remote", "get-url", "origin").toString().trim();
requireCondition(
  origin === "https://github.com/goldeget/putduk-mining.git",
  "ORIGIN_MISMATCH",
);
const baselineMigrations = git(
  "ls-tree",
  "-r",
  "--name-only",
  baseline,
  "supabase/migrations",
)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);
requireCondition(baselineMigrations.length === 201, "BASELINE_MIGRATION_COUNT");
const historicalAdmissions = [
  "scripts/backend-successor-201-source.mjs",
  "tests/e2e/fixtures/backend-successor-201-source.json",
];
const historicalBlobs = readGitBlobs(root, baseline, [
  ...baselineMigrations,
  ...historicalAdmissions,
]);
for (const name of baselineMigrations) {
  requireCondition(
    hash(readFileSync(resolve(root, name))) === hash(historicalBlobs.get(name)),
    "HISTORICAL_MIGRATION_CHANGED",
  );
}
for (const name of historicalAdmissions) {
  requireCondition(
    hash(readFileSync(resolve(root, name))) === hash(historicalBlobs.get(name)),
    "HISTORICAL_ADMISSION_CHANGED",
  );
}
const names = paths();
const migrationNames = names.filter(
  (name) => name.startsWith("supabase/migrations/") && name.endsWith(".sql"),
);
requireCondition(
  migrationNames.length === 204 &&
    JSON.stringify(
      migrationNames.filter((name) => !baselineMigrations.includes(name)),
    ) ===
      JSON.stringify([
        "supabase/migrations/20261104065015_workroom_practice_isolation.sql",
        "supabase/migrations/20261111065929_workroom_direct_deposit_cash.sql",
        "supabase/migrations/20261111165640_workroom_bank_instructions_member_directory.sql",
      ]),
  "EXACT_204_ADDITIVE_MIGRATION_REQUIRED",
);
if (process.argv.includes("--record")) {
  const manifest = {
    version: 1,
    repository: "goldeget/putduk-mining",
    baseline,
    canonicalText: "LF",
    canonicalPolicy,
    excludedSelf: manifestPath,
    preservedMigrations: baselineMigrations,
    sourceHashes: hashes(names),
  };
  writeFileSync(
    resolve(root, manifestPath),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `WORKROOM_SOURCE_RECORDED ${names.length} files; 201 historical migrations preserved.`,
  );
} else {
  const manifest = JSON.parse(
    readFileSync(resolve(root, manifestPath), "utf8"),
  );
  requireCondition(
    manifest.version === 1 &&
      manifest.canonicalPolicy === canonicalPolicy &&
      manifest.baseline === baseline &&
      manifest.repository === "goldeget/putduk-mining",
    "MANIFEST_IDENTITY",
  );
  requireCondition(
    JSON.stringify(manifest.preservedMigrations) ===
      JSON.stringify(baselineMigrations),
    "HISTORY_ROSTER",
  );
  requireCondition(
    JSON.stringify(Object.keys(manifest.sourceHashes).sort()) ===
      JSON.stringify(names),
    "ROSTER_CHANGED",
  );
  const current = hashes(names);
  const modifiedPaths = names.filter(
    (name) => manifest.sourceHashes[name] !== current[name],
  );
  if (modifiedPaths.length)
    console.error(
      JSON.stringify({
        state: "WORKROOM_SOURCE_CONTENT_CHANGED",
        modifiedPaths,
      }),
    );
  requireCondition(modifiedPaths.length === 0, "CONTENT_CHANGED");
  if (process.argv.includes("--require-clean"))
    requireCondition(
      git("status", "--porcelain", "--untracked-files=all").toString() === "",
      "CLEAN_CHECKOUT_REQUIRED",
    );
  console.log(
    `WORKROOM_SOURCE_VERIFIED ${names.length} files; baseline ${baseline}; historical money data not inspected or mutated.`,
  );
}
