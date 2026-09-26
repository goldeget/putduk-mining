import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "public", "brand", "assets.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const failures = [];
const requiredVersion = "2026.09.27-v1";
const allowedMimes = new Set([
  "image/avif",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
]);

if (manifest.schemaVersion !== 1) failures.push("schemaVersion must be 1");
if (manifest.assetVersion !== requiredVersion) {
  failures.push(`assetVersion must be ${requiredVersion}`);
}
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
  failures.push("manifest must contain assets");
}

for (const asset of manifest.assets ?? []) {
  const relative = asset.path?.replace(/^\//, "");
  if (!relative || relative.includes("..")) {
    failures.push(`unsafe asset path: ${String(asset.path)}`);
    continue;
  }

  const absolute = path.join(root, "public", relative);
  try {
    const [contents, info] = await Promise.all([
      readFile(absolute),
      stat(absolute),
    ]);
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== asset.sha256) failures.push(`hash mismatch: ${asset.path}`);
    if (info.size !== asset.bytes)
      failures.push(`byte mismatch: ${asset.path}`);
  } catch {
    failures.push(`missing asset: ${asset.path}`);
  }

  if (!allowedMimes.has(asset.mimeType)) {
    failures.push(`unsupported MIME ${asset.mimeType}: ${asset.path}`);
  }
  if (typeof asset.alt !== "string" || asset.alt.trim().length < 4) {
    failures.push(`missing accessible alt text: ${asset.path}`);
  }
}

const expectedReferenceHashes = new Map([
  [
    "docs/design/visual-references/putduk-brand-master-reference.png",
    "c3b9363be5f5c0cb212e87ae5d7b49fcf5ba5105858367f40e91ef6999077512",
  ],
  [
    "docs/design/visual-references/putduk-rank-master-reference.png",
    "b91a1e9bc64456a6d7c73861c7cfa8512eb976867fb112cdecdd083648a80f96",
  ],
]);

for (const [relative, expected] of expectedReferenceHashes) {
  try {
    const contents = await readFile(path.join(root, relative));
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== expected)
      failures.push(`canonical reference changed: ${relative}`);
  } catch {
    failures.push(`missing canonical reference: ${relative}`);
  }
}

const expectedMasterHashes = new Map([
  [
    "docs/design/generated-masters/putduk-miner-master-v1.png",
    "5efb45738d0cdd72bfb2cc3a24a31d6034eeb33277daa375bf05ab51b8eb1fea",
  ],
  [
    "docs/design/generated-masters/putduk-orbital-earth-master-v1.png",
    "97258f8bbcaab9ba88c16d832c37c336e464afd9d09b7a42e6da4103da093d1b",
  ],
  [
    "docs/design/generated-masters/ranks/rank-01/planet-master-v1.png",
    "bec995da794ab7fd9c9c9336e363f25afda9423f80a86d5b77ddb835763785b4",
  ],
  [
    "docs/design/generated-masters/ranks/rank-02/planet-master-v1.png",
    "bf49055c7dcccabb7f6f0e38db0d20302ed22cdca0c82ea25b3a6b35e192e6be",
  ],
  [
    "docs/design/generated-masters/ranks/rank-03/planet-master-v1.png",
    "7850fef221106b88653e6c616e0cd9b7de5751606071fe78d65379b362b1ec95",
  ],
  [
    "docs/design/generated-masters/ranks/rank-04/planet-master-v1.png",
    "44223317d5652f0f8a3af58b871e5b9a376d01246e79199a73149077c2ad74e7",
  ],
  [
    "docs/design/generated-masters/ranks/rank-05/planet-master-v1.png",
    "75a976baaf4f7edaac4e6fd0e4af64a3e15e21cd46585aa723ec69413b50a026",
  ],
  [
    "docs/design/generated-masters/ranks/rank-06/planet-master-v1.png",
    "73cb455e6415283bb50604897ab7af8a234031c737e707d220db1b9d4f0ecc08",
  ],
]);

for (const [relative, expected] of expectedMasterHashes) {
  try {
    const contents = await readFile(path.join(root, relative));
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== expected)
      failures.push(`generated master changed: ${relative}`);
  } catch {
    failures.push(`missing generated master: ${relative}`);
  }
}

for (let index = 1; index <= 6; index += 1) {
  const rank = `rank-${String(index).padStart(2, "0")}`;
  for (const size of [128, 256, 512]) {
    for (const format of ["avif", "webp"]) {
      const expectedPath = `/ranks/${rank}/planet-${size}-v1.${format}`;
      if (!manifest.assets.some((asset) => asset.path === expectedPath)) {
        failures.push(`rank derivative missing from manifest: ${expectedPath}`);
      }
    }
  }
}

const requiredPwa = [
  "/brand/pwa/putduk-pwa-dark-192.png",
  "/brand/pwa/putduk-pwa-dark-512.png",
  "/brand/pwa/putduk-pwa-light-192.png",
  "/brand/pwa/putduk-pwa-light-512.png",
  "/brand/pwa/putduk-pwa-maskable-512.png",
];
for (const expectedPath of requiredPwa) {
  if (!manifest.assets.some((asset) => asset.path === expectedPath)) {
    failures.push(`PWA asset missing from manifest: ${expectedPath}`);
  }
}

const wordmarks = [
  "public/brand/wordmark/putduk-wordmark-dark.svg",
  "public/brand/wordmark/putduk-wordmark-light.svg",
];
for (const relative of wordmarks) {
  const source = await readFile(path.join(root, relative), "utf8");
  if (!source.includes("퍼뜩"))
    failures.push(`wordmark must contain 퍼뜩: ${relative}`);
}

if (failures.length > 0) {
  console.error(
    "PUTDUK brand asset verification failed:\n" +
      failures.map((value) => `- ${value}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `Verified ${manifest.assets.length} PUTDUK brand assets (${manifest.assetVersion}).`,
);
