/** Regenerate backend201 sourceHashes from the git index (Linux CI admission bytes). */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAP = "tests/e2e/fixtures/backend-successor-201-source.json";
const GUARD = "scripts/backend-successor-201-source.mjs";
const MAX_BUFFER = 128 * 1024 * 1024;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function indexSha256(path) {
  const result = spawnSync("git", ["show", `:${path}`], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git show :${path} failed (${result.status}): ${result.stderr?.toString("utf8") ?? ""}`,
    );
  }
  return digest(result.stdout);
}

function syncManifestDerivedFields(manifest) {
  for (const row of manifest.nativeFiles) {
    row.sourceSha256 = manifest.sourceHashes[row.path];
  }
  for (const path of Object.keys(manifest.browserConsumerHashes)) {
    manifest.browserConsumerHashes[path] = manifest.sourceHashes[path];
  }
  if (manifest.ciTarget?.configSha256) {
    manifest.ciTarget.configSha256 =
      manifest.sourceHashes["supabase/config.toml"];
  }
}

function pinManifestPaths(manifest, paths) {
  for (const path of paths) {
    if (!(path in manifest.sourceHashes)) {
      throw new Error(`BACKEND201_PATH_NOT_IN_ROSTER:${path}`);
    }
    manifest.sourceHashes[path] = indexSha256(path);
  }
  syncManifestDerivedFields(manifest);
}

function finalizeGuard(manifestSha256) {
  const guardSource = readFileSync(`${ROOT}/${GUARD}`, "utf8");
  const nextGuard = guardSource.replace(
    /const MANIFEST_SHA256 =\r?\n  "[0-9a-f]{64}";/,
    `const MANIFEST_SHA256 =\n  "${manifestSha256}";`,
  );
  if (nextGuard === guardSource) {
    if (guardSource.includes(`"${manifestSha256}"`)) return;
    throw new Error("BACKEND201_MANIFEST_PIN_LITERAL_NOT_UPDATED");
  }
  writeFileSync(`${ROOT}/${GUARD}`, nextGuard);
}

function writeManifest(manifest) {
  writeFileSync(`${ROOT}/${MAP}`, `${JSON.stringify(manifest, null, 2)}\n`);
  return digest(readFileSync(`${ROOT}/${MAP}`));
}

const args = process.argv.slice(2);
const finalizeOnly = args.includes("--finalize-only");
const pathArgs = args
  .filter((arg) => arg.startsWith("--path="))
  .map((arg) => arg.slice("--path=".length));

if (finalizeOnly && pathArgs.length) {
  throw new Error("BACKEND201_FINALIZE_ONLY_CONFLICTS_WITH_PATH");
}

const manifest = JSON.parse(readFileSync(`${ROOT}/${MAP}`, "utf8"));

if (finalizeOnly) {
  finalizeGuard(digest(readFileSync(`${ROOT}/${MAP}`)));
  console.log("BACKEND201_MANIFEST_FINALIZED", digest(readFileSync(`${ROOT}/${MAP}`)));
} else if (pathArgs.length) {
  pinManifestPaths(manifest, pathArgs);
  finalizeGuard(writeManifest(manifest));
  console.log("BACKEND201_PATHS_PINNED", pathArgs.length);
} else if (args.length === 0) {
  pinManifestPaths(manifest, Object.keys(manifest.sourceHashes));
  finalizeGuard(writeManifest(manifest));
  console.log("BACKEND201_MANIFEST_PINNED");
} else {
  throw new Error("BACKEND201_PIN_ARGS_UNRECOGNIZED");
}
