import { readFile, stat } from "node:fs/promises";
import { realpathSync as nodeRealpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const realpathSync = nodeRealpathSync.native;
// Unit-fixture I/O only. Existing assertions still hash every returned byte.
// A cache hit requires the current canonical path and filesystem fingerprint.
const repository = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const fingerprint = (value) =>
  [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
export function createBrandFixtureReader(root) {
  const base = realpathSync(root);
  if (
    base !== repository &&
    !(
      dirname(base) === realpathSync(tmpdir()) &&
      basename(base).startsWith("putduk-brand-reader-unit-")
    )
  )
    throw Error("BRAND_UNIT_ROOT_REJECTED");
  const cache = new Map();
  async function read(file, encoding) {
    const full = realpathSync(file);
    const local = relative(base, full).replaceAll("\\", "/");
    if (
      !local ||
      isAbsolute(local) ||
      local.startsWith("../") ||
      !(
        local === "scripts/build-brand-assets.py" ||
        local.startsWith("public/") ||
        local.startsWith("docs/design/generated-masters/")
      )
    )
      throw Error("BRAND_UNIT_PATH_REJECTED");
    const before = fingerprint(await stat(full, { bigint: true }));
    let entry = cache.get(full);
    if (!entry || entry.fingerprint !== before) {
      const bytes = await readFile(full);
      if (fingerprint(await stat(full, { bigint: true })) !== before)
        throw Error("BRAND_UNIT_FILE_CHANGED_DURING_READ");
      entry = { fingerprint: before, bytes };
      cache.set(full, entry);
    }
    if (encoding !== undefined && encoding !== "utf8")
      throw Error("BRAND_UNIT_ENCODING_REJECTED");
    return encoding ? entry.bytes.toString(encoding) : Buffer.from(entry.bytes);
  }
  return { read };
}
const reader = createBrandFixtureReader(repository);
export const readBrandFixtureFile = (file, encoding) =>
  reader.read(file, encoding);
export async function primeBrandFixtureReads() {
  const manifest = JSON.parse(
    await reader.read(
      resolve(repository, "public/brand/assets.manifest.json"),
      "utf8",
    ),
  );
  const files = [
    ...new Set(
      manifest.assets.flatMap((asset) => [
        resolve(repository, "public", "." + asset.path),
        ...(asset.path.startsWith("/brand/scenes/global-pavilion/") &&
        asset.sourceMaster
          ? [resolve(repository, asset.sourceMaster)]
          : []),
      ]),
    ),
  ];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < files.length) await reader.read(files[next++]);
    }),
  );
}
