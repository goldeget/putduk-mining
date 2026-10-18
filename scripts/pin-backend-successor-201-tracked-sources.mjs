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

function indexBytes(path) {
  const oidResult = spawnSync("git", ["rev-parse", `:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (oidResult.error) throw oidResult.error;
  if (oidResult.status !== 0) {
    throw new Error(
      `git rev-parse :${path} failed (${oidResult.status}): ${oidResult.stderr?.toString("utf8") ?? ""}`,
    );
  }
  const oid = oidResult.stdout.trim();
  const blobResult = spawnSync("git", ["cat-file", "blob", oid], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  });
  if (blobResult.error) throw blobResult.error;
  if (blobResult.status !== 0) {
    throw new Error(
      `git cat-file blob ${oid} failed (${blobResult.status}): ${blobResult.stderr?.toString("utf8") ?? ""}`,
    );
  }
  return blobResult.stdout;
}

function indexSha256(path) {
  return digest(indexBytes(path));
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

function manifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function writeManifest(manifest) {
  const bytes = manifestBytes(manifest);
  writeFileSync(`${ROOT}/${MAP}`, bytes);
  return digest(bytes);
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
  const manifestSha256 = indexSha256(MAP);
  finalizeGuard(manifestSha256);
  console.log("BACKEND201_MANIFEST_FINALIZED", manifestSha256);
} else if (pathArgs.length) {
  pinManifestPaths(manifest, pathArgs);
  const manifestSha256 = writeManifest(manifest);
  finalizeGuard(manifestSha256);
  console.log("BACKEND201_PATHS_PINNED", pathArgs.length, manifestSha256);
} else if (args.length === 0) {
  pinManifestPaths(manifest, Object.keys(manifest.sourceHashes));
  const manifestSha256 = writeManifest(manifest);
  finalizeGuard(manifestSha256);
  console.log("BACKEND201_MANIFEST_PINNED");
} else {
  throw new Error("BACKEND201_PIN_ARGS_UNRECOGNIZED");
}
