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

function pinManifest(manifest) {
  const paths = Object.keys(manifest.sourceHashes);
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];
    manifest.sourceHashes[path] = indexSha256(path);
    if ((i + 1) % 250 === 0) {
      process.stderr.write(`pinned ${i + 1}/${paths.length}\n`);
    }
  }
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

const manifest = JSON.parse(readFileSync(`${ROOT}/${MAP}`, "utf8"));
pinManifest(manifest);
writeFileSync(`${ROOT}/${MAP}`, `${JSON.stringify(manifest, null, 2)}\n`);

const manifestSha256 = digest(readFileSync(`${ROOT}/${MAP}`));
const guardSource = readFileSync(`${ROOT}/${GUARD}`, "utf8");
const nextGuard = guardSource.replace(
  /const MANIFEST_SHA256 =\n  "[0-9a-f]{64}";/,
  `const MANIFEST_SHA256 =\n  "${manifestSha256}";`,
);
if (nextGuard === guardSource) {
  throw new Error("BACKEND201_MANIFEST_PIN_LITERAL_NOT_UPDATED");
}
writeFileSync(`${ROOT}/${GUARD}`, nextGuard);

console.log("BACKEND201_MANIFEST_PINNED", manifestSha256);
