import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const approvedAssets = [
  {
    path: "/brand/premium/20261014/premium-material-dark-640-v1.avif",
    bytes: 15739,
    sha256: "8333208385a212c5c8928fcd6eec3b0041c2aa50d8c35395c21153a5d555c0d9",
    mimeType: "image/avif",
    width: 640,
    height: 215,
    theme: "dark",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-dark-master-v1.png",
    sourceSha256:
      "52dda29af044c5eee58fc6b0afa869374c55668da1488bc4407115c6ff657529",
  },
  {
    path: "/brand/premium/20261014/premium-material-dark-640-v1.webp",
    bytes: 98528,
    sha256: "5459a41bebdc017e811941a849cb4d748eabab1632d599f3a338dba6a649deda",
    mimeType: "image/webp",
    width: 640,
    height: 215,
    theme: "dark",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-dark-master-v1.png",
    sourceSha256:
      "52dda29af044c5eee58fc6b0afa869374c55668da1488bc4407115c6ff657529",
  },
  {
    path: "/brand/premium/20261014/premium-material-dark-1280-v1.avif",
    bytes: 55231,
    sha256: "9d2a9ffc5617bf4e6a2196b9c7b975ff48e9bd239320df0aa9cc4bcda8e41405",
    mimeType: "image/avif",
    width: 1280,
    height: 430,
    theme: "dark",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-dark-master-v1.png",
    sourceSha256:
      "52dda29af044c5eee58fc6b0afa869374c55668da1488bc4407115c6ff657529",
  },
  {
    path: "/brand/premium/20261014/premium-material-dark-1280-v1.webp",
    bytes: 410556,
    sha256: "a4ea92e1a46b34f3ed17da90fd6f9b9887f63596a81e73e06ce916ceca6ee25c",
    mimeType: "image/webp",
    width: 1280,
    height: 430,
    theme: "dark",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-dark-master-v1.png",
    sourceSha256:
      "52dda29af044c5eee58fc6b0afa869374c55668da1488bc4407115c6ff657529",
  },
  {
    path: "/brand/premium/20261014/premium-material-light-640-v1.avif",
    bytes: 15876,
    sha256: "23c058dbfe5d3190e032ee3e75f537c1ac2981d08a67ee65e6c3c1ec6ee80b11",
    mimeType: "image/avif",
    width: 640,
    height: 215,
    theme: "light",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-light-master-v1.png",
    sourceSha256:
      "f9e5097be7748e50142cc6d4e2363a4d4f075ac2572175a87b56428b6b525e08",
  },
  {
    path: "/brand/premium/20261014/premium-material-light-640-v1.webp",
    bytes: 97886,
    sha256: "eb1c6d4ff68572662fce1691ea11cbb3d1301f0bfed10f31525cc02bdd291b5d",
    mimeType: "image/webp",
    width: 640,
    height: 215,
    theme: "light",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-light-master-v1.png",
    sourceSha256:
      "f9e5097be7748e50142cc6d4e2363a4d4f075ac2572175a87b56428b6b525e08",
  },
  {
    path: "/brand/premium/20261014/premium-material-light-1280-v1.avif",
    bytes: 55025,
    sha256: "37e225ecb462751733227a8da4999de322977548b665ff1c17b01924d02498fe",
    mimeType: "image/avif",
    width: 1280,
    height: 430,
    theme: "light",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-light-master-v1.png",
    sourceSha256:
      "f9e5097be7748e50142cc6d4e2363a4d4f075ac2572175a87b56428b6b525e08",
  },
  {
    path: "/brand/premium/20261014/premium-material-light-1280-v1.webp",
    bytes: 404668,
    sha256: "d2c02f15cfbd3c1a278e368a41567f921ba6f58d102324ffec02ca20f50ddbf7",
    mimeType: "image/webp",
    width: 1280,
    height: 430,
    theme: "light",
    purpose: "decorative-heading-material",
    alt: "유리와 금속의 곡면에 은은한 금빛이 비치는 장식",
    sourceMaster:
      "docs/design/generated-masters/premium-material-2026-10-14/premium-material-light-master-v1.png",
    sourceSha256:
      "f9e5097be7748e50142cc6d4e2363a4d4f075ac2572175a87b56428b6b525e08",
  },
];
const preserved = {
  "public/brand/assets.manifest.json":
    "96ef1731f792d3e7bbf306cf44f0042e2809a8851185affda61160179d14e624",
  "public/brand/identity.manifest.json":
    "8df270c14d28f2515b81468de58d9cd7459c4f22fae1628da2876034ce08d787",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyPremiumMaterialAssets(root) {
  const errors = [];
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "public/brand/premium.manifest.json"),
        "utf8",
      ),
    );
    if (
      manifest.schemaVersion !== 1 ||
      manifest.assetVersion !== "2026.10.14-premium-material-v1"
    )
      errors.push("Premium material manifest version mismatch");
    if (
      JSON.stringify(manifest.preservedManifests) !== JSON.stringify(preserved)
    )
      errors.push("Premium material preservation bindings changed");
    if (!Array.isArray(manifest.assets) || manifest.assets.length !== 8)
      errors.push("Exact eight premium material derivatives required");
    const actual = new Map(
      (manifest.assets ?? []).map((asset) => [asset.path, asset]),
    );
    if (actual.size !== 8) errors.push("Duplicate premium material paths");
    for (const approved of approvedAssets) {
      const entry = actual.get(approved.path);
      if (!entry || JSON.stringify(entry) !== JSON.stringify(approved))
        errors.push("Premium material metadata changed: " + approved.path);
      const relative = "public" + approved.path;
      const absolute = path.join(root, relative);
      const info = await lstat(absolute);
      const bytes = await readFile(absolute);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        bytes.length !== approved.bytes ||
        digest(bytes) !== approved.sha256
      )
        errors.push("Premium material derivative changed: " + approved.path);
      const source = await readFile(path.join(root, approved.sourceMaster));
      if (digest(source) !== approved.sourceSha256)
        errors.push(
          "Premium material source changed: " + approved.sourceMaster,
        );
    }
    const copies = manifest.adminPublicCopies;
    if (
      !Array.isArray(copies) ||
      copies.length !== 8 ||
      new Set(copies.map((copy) => copy.path)).size !== 8
    )
      errors.push("Exact eight administrator material copies required");
    for (const approved of approvedAssets) {
      const relative = "apps/admin/public" + approved.path;
      const copy = copies?.find((candidate) => candidate.path === relative);
      if (
        !copy ||
        copy.source !== approved.path ||
        copy.sha256 !== approved.sha256 ||
        copy.bytes !== approved.bytes ||
        Object.keys(copy).sort().join(",") !== "bytes,path,sha256,source"
      )
        errors.push(
          "Premium administrator copy metadata mismatch: " + approved.path,
        );
      const bytes = await readFile(path.join(root, relative));
      const info = await lstat(path.join(root, relative));
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        digest(bytes) !== approved.sha256 ||
        bytes.length !== approved.bytes
      )
        errors.push("Premium administrator copy changed: " + approved.path);
    }
    for (const [relative, expected] of Object.entries(preserved)) {
      if (digest(await readFile(path.join(root, relative))) !== expected)
        errors.push("Preserved asset collection changed: " + relative);
    }
  } catch {
    errors.push(
      "Premium material source, manifest or derivative is unavailable",
    );
  }
  return errors;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await verifyPremiumMaterialAssets(root);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Verified eight premium material derivatives, eight administrator copies and both preserved asset manifests.",
    );
}
