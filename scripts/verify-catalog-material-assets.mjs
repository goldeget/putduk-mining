import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const profileHash =
  "cf305a321f8ebda27006e65d0efcb61388e448c88980b0e935d45875cda02560";
const sha = (contents) => createHash("sha256").update(contents).digest("hex");

/** Independent closed-path verification; existing brand families stay untouched. */
export async function verifyCatalogMaterialAssets(root) {
  const failures = [];
  const profileBytes = await readFile(
    path.join(root, "scripts/catalog-material-profiles.json"),
  );
  if (sha(profileBytes) !== profileHash)
    return ["reviewed catalog material profiles changed"];
  const profiles = JSON.parse(profileBytes.toString("utf8"));
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "public/brand/catalog-materials.manifest.json"),
      "utf8",
    ),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.assetVersion !== "2026.10.06-catalog-materials-v1"
  )
    failures.push("catalog material manifest version mismatch");
  const expected = new Map();
  for (const { family, ...profile } of profiles) {
    const master = await readFile(path.join(root, profile.sourceMaster));
    if (
      sha(master) !== profile.sourceSha256 ||
      master.readUInt32BE(16) !== 1536 ||
      master.readUInt32BE(20) !== 1024 ||
      master[25] !== 2
    )
      failures.push(`catalog material master integrity failed: ${family}`);
    for (const width of [320, 640, 960, 1536]) {
      for (const extension of ["avif", "webp"]) {
        expected.set(
          `/brand/catalog-materials/${family}/${family}-${width}-v1.${extension}`,
          {
            ...profile,
            width,
            height: Math.round((1024 * width) / 1536),
            mimeType: `image/${extension}`,
          },
        );
      }
    }
  }
  const assets = manifest.assets;
  if (!Array.isArray(assets) || assets.length !== 24)
    return [
      ...failures,
      "catalog material pack must contain exactly24 derivatives",
    ];
  for (const asset of assets) {
    const metadata = expected.get(asset.path);
    if (!metadata) {
      failures.push("unreviewed catalog material path");
      continue;
    }
    if (assets.filter((other) => other.path === asset.path).length !== 1)
      failures.push(`duplicate catalog material path: ${asset.path}`);
    for (const [key, value] of Object.entries(metadata)) {
      if (asset[key] !== value)
        failures.push(`catalog material ${key} mismatch: ${asset.path}`);
    }
    const allowed = new Set([
      "path",
      "sha256",
      "bytes",
      ...Object.keys(metadata),
    ]);
    if (Object.keys(asset).some((key) => !allowed.has(key)))
      failures.push(`unreviewed catalog material metadata: ${asset.path}`);
    const contents = await readFile(
      path.join(root, "public", asset.path.slice(1)),
    );
    if (sha(contents) !== asset.sha256 || contents.length !== asset.bytes)
      failures.push(`catalog material runtime integrity failed: ${asset.path}`);
  }
  for (const expectedPath of expected.keys()) {
    if (assets.filter((asset) => asset.path === expectedPath).length !== 1)
      failures.push(`missing catalog material derivative: ${expectedPath}`);
  }
  return failures;
}
