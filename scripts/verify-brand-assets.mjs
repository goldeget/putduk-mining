import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "public", "brand", "assets.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const failures = [];
const requiredVersion = "2026.10.03-v3";
const aiHelpSource =
  "docs/design/generated-masters/ai-help-face-2026-10-03/putduk-ai-help-face-master-v1.png";
const aiHelpSourceHash =
  "d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2";
const aiHelpVersion = "2026.10.03-ai-help-face-v1";
const aiHelpReviewScope =
  "Owner-approved batch 7 AI help launcher face; preserve the complete 1254x1254 composition with object-fit: contain; no scene, economic or other asset approval.";
const provenanceKeys = [
  "assetVersion",
  "sourceMaster",
  "sourceSha256",
  "reviewScope",
];
const approvedAiHelpPaths = new Map(
  [128, 256].flatMap((size) =>
    ["avif", "webp"].map((format) => [
      `/brand/mascot/putduk-ai-help-face-${size}-v1.${format}`,
      size,
    ]),
  ),
);
const sceneSource =
  "docs/design/generated-masters/semiconductor-memory-v3-clean-2026-10-03/semiconductor-memory-v3-clean-master-v1.png";
const sceneSourceHash =
  "5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd";
const sceneVersion = "2026.10.03-semiconductor-memory-v1";
const sceneReviewScope =
  "Owner-delegated 2026-10-03 visual selection: approved complete 1539x1022 clean semiconductor scene; responsive encoding only, no crop, recoloring or upscale; no product mapping, economic runtime or other family approval.";
const approvedScenePaths = new Map(
  [640, 960, 1280, 1539].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/semiconductor-memory/semiconductor-memory-${width}-v1.${format}`,
      { width, height: Math.round((1022 * width) / 1539) },
    ]),
  ),
);

/** Reviewed metadata belongs only to the approved face and scene packs. */
export function aiHelpMetadataFailures(asset) {
  const size = approvedAiHelpPaths.get(asset.path);
  if (!size)
    return !approvedScenePaths.has(asset.path) &&
      provenanceKeys.some((key) => key in asset)
      ? [`unapproved provenance path: ${asset.path}`]
      : [];
  const errors = [];
  const expected = {
    assetVersion: aiHelpVersion,
    sourceMaster: aiHelpSource,
    sourceSha256: aiHelpSourceHash,
    reviewScope: aiHelpReviewScope,
  };
  for (const [key, value] of Object.entries(expected))
    if (asset[key] !== value)
      errors.push(`AI help ${key} mismatch: ${asset.path}`);
  if (asset.width !== size || asset.height !== size)
    errors.push(`AI help square dimensions mismatch: ${asset.path}`);
  if (asset.theme !== "system")
    errors.push(`AI help theme mismatch: ${asset.path}`);
  if (asset.mimeType !== `image/${asset.path.split(".").at(-1)}`)
    errors.push(`AI help MIME mismatch: ${asset.path}`);
  const allowedKeys = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowedKeys.has(key)))
    errors.push(`unapproved AI help metadata: ${asset.path}`);
  return errors;
}

export function approvedSceneMetadataFailures(asset) {
  const dimensions = approvedScenePaths.get(asset.path);
  if (!dimensions)
    return asset.path?.startsWith("/brand/scenes/")
      ? [`unapproved scene path: ${asset.path}`]
      : [];
  const errors = [];
  const expected = {
    assetVersion: sceneVersion,
    sourceMaster: sceneSource,
    sourceSha256: sceneSourceHash,
    reviewScope: sceneReviewScope,
    theme: "system",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  for (const [key, value] of Object.entries(expected))
    if (asset[key] !== value)
      errors.push(`scene ${key} mismatch: ${asset.path}`);
  const allowedKeys = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowedKeys.has(key)))
    errors.push(`unapproved scene metadata: ${asset.path}`);
  return errors;
}
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
  failures.push(...aiHelpMetadataFailures(asset));
  failures.push(...approvedSceneMetadataFailures(asset));
  const relative = asset.path?.replace(/^\//, "");
  if (
    !relative ||
    !/^\/(brand|ranks)\//.test(asset.path) ||
    relative.includes("..") ||
    relative.includes("\\")
  ) {
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
  [aiHelpSource, aiHelpSourceHash],
  [sceneSource, sceneSourceHash],
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

for (const expectedPath of approvedAiHelpPaths.keys()) {
  if (
    manifest.assets.filter((asset) => asset.path === expectedPath).length !== 1
  )
    failures.push(
      `AI help derivative must appear exactly once: ${expectedPath}`,
    );
}
for (const expectedPath of approvedScenePaths.keys()) {
  if (
    manifest.assets.filter((asset) => asset.path === expectedPath).length !== 1
  )
    failures.push(`scene derivative must appear exactly once: ${expectedPath}`);
}

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
