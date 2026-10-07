import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const profileHash =
  "3a6fde14dfff6b211f9d309204a06fc52cc477d04d3af84fbbf9ec558ef3a7df";
const sha = (contents) => createHash("sha256").update(contents).digest("hex");

/** Independent closed-path verification; existing brand families stay untouched. */
export async function verifyMiningResponsiveAssets(root) {
  const failures = [];
  const profileBytes = await readFile(
    path.join(root, "scripts/mining-responsive-profiles.json"),
  );
  if (sha(profileBytes) !== profileHash)
    return ["reviewed mining responsive profiles changed"];
  const profiles = JSON.parse(profileBytes.toString("utf8"));
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "public/brand/mining-responsive.manifest.json"),
      "utf8",
    ),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.assetVersion !== "2026.10.07-mining-responsive-v1"
  )
    failures.push("mining responsive manifest version mismatch");
  const expected = new Map();
  for (const { family, ...profile } of profiles) {
    const master = await readFile(path.join(root, profile.sourceMaster));
    if (
      sha(master) !== profile.sourceSha256 ||
      master.readUInt32BE(16) !== 1086 ||
      master.readUInt32BE(20) !== 1448 ||
      master[25] !== 2
    )
      failures.push(`mining responsive master integrity failed: ${family}`);
    for (const width of [480, 640, 1086]) {
      for (const extension of ["avif", "webp"]) {
        expected.set(
          `/brand/scenes/${family}/${family}-${width}-v1.${extension}`,
          {
            ...profile,
            width,
            height: Math.round((1448 * width) / 1086),
            mimeType: `image/${extension}`,
          },
        );
      }
    }
  }
  const assets = manifest.assets;
  if (!Array.isArray(assets) || assets.length !== 6)
    return [
      ...failures,
      "mining responsive pack must contain exactly6 derivatives",
    ];
  for (const asset of assets) {
    const metadata = expected.get(asset.path);
    if (!metadata) {
      failures.push("unreviewed mining responsive path");
      continue;
    }
    if (assets.filter((other) => other.path === asset.path).length !== 1)
      failures.push(`duplicate mining responsive path: ${asset.path}`);
    for (const [key, value] of Object.entries(metadata)) {
      if (asset[key] !== value)
        failures.push(`mining responsive ${key} mismatch: ${asset.path}`);
    }
    const allowed = new Set([
      "path",
      "sha256",
      "bytes",
      ...Object.keys(metadata),
    ]);
    if (Object.keys(asset).some((key) => !allowed.has(key)))
      failures.push(`unreviewed mining responsive metadata: ${asset.path}`);
    const contents = await readFile(
      path.join(root, "public", asset.path.slice(1)),
    );
    if (sha(contents) !== asset.sha256 || contents.length !== asset.bytes)
      failures.push(
        `mining responsive runtime integrity failed: ${asset.path}`,
      );
  }
  for (const expectedPath of expected.keys()) {
    if (assets.filter((asset) => asset.path === expectedPath).length !== 1)
      failures.push(`missing mining responsive derivative: ${expectedPath}`);
  }
  return failures;
}
