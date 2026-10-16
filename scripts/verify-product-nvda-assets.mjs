import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const prefix = "/brand/scenes/product-nvda-gpu-v1/";
const version = "2026.10.07-product-nvda-gpu-v1";
const reviewScope =
  "Owner-delegated V7 native GPT visual selection: reviewed NVDA GPU computation scene, four independent dark/light portrait/landscape originals; full composition with responsive encoding only, no crop, recoloring or upscale; NVDA US_STOCK presentation only, no publication, availability, mining state, economic or PRODUCT COMPLETE approval.";
const profiles = [
  {
    theme: "dark",
    orientation: "portrait",
    sourceMaster:
      "docs/design/generated-masters/product-nvda-gpu-2026-10-07/product-nvda-gpu-v1-dark-portrait-master.png",
    sourceSha256:
      "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
    width: 1024,
    height: 1536,
    widths: [480, 640, 960, 1024],
    alt: "짙은 서버실의 GPU 연산 장치와 푸른 원형 추출 장치",
  },
  {
    theme: "dark",
    orientation: "landscape",
    sourceMaster:
      "docs/design/generated-masters/product-nvda-gpu-2026-10-07/product-nvda-gpu-v1-dark-landscape-master.png",
    sourceSha256:
      "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
    width: 1672,
    height: 941,
    widths: [640, 960, 1280, 1672],
    alt: "짙은 서버실의 GPU 연산 장치와 푸른 원형 추출 장치",
  },
  {
    theme: "light",
    orientation: "portrait",
    sourceMaster:
      "docs/design/generated-masters/product-nvda-gpu-2026-10-07/product-nvda-gpu-v1-light-portrait-master.png",
    sourceSha256:
      "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
    width: 1024,
    height: 1536,
    widths: [480, 640, 960, 1024],
    alt: "밝은 서버실의 GPU 연산 장치와 푸른 원형 추출 장치",
  },
  {
    theme: "light",
    orientation: "landscape",
    sourceMaster:
      "docs/design/generated-masters/product-nvda-gpu-2026-10-07/product-nvda-gpu-v1-light-landscape-master.png",
    sourceSha256:
      "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
    width: 1672,
    height: 941,
    widths: [640, 960, 1280, 1672],
    alt: "밝은 서버실의 GPU 연산 장치와 푸른 원형 추출 장치",
  },
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = new Map(
  profiles.flatMap((profile) =>
    profile.widths.flatMap((width) =>
      ["avif", "webp"].map((format) => [
        `${prefix}product-nvda-gpu-v1-${profile.theme}-${profile.orientation}-${width}.${format}`,
        {
          assetVersion: version,
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          reviewScope,
          alt: profile.alt,
          theme: profile.theme,
          width,
          height: Math.round((width * profile.height) / profile.width),
          mimeType: `image/${format}`,
        },
      ]),
    ),
  ),
);

/** Closed exact path, provenance and dimension checks shared with corruption regressions. */
export function productNvdaMetadataFailures(asset) {
  if (!asset.path?.startsWith(prefix)) return [];
  const metadata = expected.get(asset.path);
  if (!metadata) return [`unreviewed NVDA path: ${asset.path}`];
  const errors = Object.entries(metadata)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `NVDA ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    ...Object.keys(metadata),
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed NVDA metadata: ${asset.path}`);
  return errors;
}

/** Read dimensions directly from generated AVIF/WebP headers, without a decoder dependency. */
export function productNvdaEncodedDimensions(contents, mimeType) {
  if (mimeType === "image/avif") {
    const offset = contents.indexOf(Buffer.from("ispe"));
    if (offset < 4 || offset + 16 > contents.length) return null;
    return {
      width: contents.readUInt32BE(offset + 8),
      height: contents.readUInt32BE(offset + 12),
    };
  }
  if (
    mimeType === "image/webp" &&
    contents.toString("ascii", 0, 4) === "RIFF" &&
    contents.toString("ascii", 8, 12) === "WEBP"
  ) {
    const offset = contents.indexOf(Buffer.from("VP8L"), 12);
    if (
      offset < 12 ||
      offset + 13 > contents.length ||
      contents[offset + 8] !== 0x2f
    )
      return null;
    const bits = contents.readUInt32LE(offset + 9);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export async function verifyProductNvdaAssets(root) {
  const failures = [];
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "public/brand/assets.manifest.json"),
      "utf8",
    ),
  );
  const assets = manifest.assets.filter((asset) =>
    asset.path?.startsWith(prefix),
  );
  if (assets.length !== expected.size)
    failures.push("NVDA pack must contain exactly32 derivatives");
  for (const profile of profiles) {
    const master = await readFile(path.join(root, profile.sourceMaster));
    if (
      sha(master) !== profile.sourceSha256 ||
      master.readUInt32BE(16) !== profile.width ||
      master.readUInt32BE(20) !== profile.height
    )
      failures.push(`NVDA master integrity failed: ${profile.sourceMaster}`);
  }
  for (const asset of assets) {
    failures.push(...productNvdaMetadataFailures(asset));
    if (!expected.has(asset.path)) continue;
    const bytes = await readFile(
      path.join(root, "public", asset.path.slice(1)),
    );
    if (sha(bytes) !== asset.sha256 || bytes.length !== asset.bytes)
      failures.push(`NVDA runtime integrity failed: ${asset.path}`);
    const dimensions = productNvdaEncodedDimensions(bytes, asset.mimeType);
    if (
      !dimensions ||
      dimensions.width !== asset.width ||
      dimensions.height !== asset.height
    )
      failures.push(`NVDA encoded dimension mismatch: ${asset.path}`);
  }
  for (const assetPath of expected.keys())
    if (assets.filter((asset) => asset.path === assetPath).length !== 1)
      failures.push(`NVDA derivative must appear exactly once: ${assetPath}`);
  return failures;
}
