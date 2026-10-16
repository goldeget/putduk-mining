import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const masterPath =
  "docs/design/generated-masters/first-world-20261013/first-world-master-v1.png";
const masterHash =
  "9348e218d5d544fd53375342dbeb88ae1914403b7cad631730e1d63c1b652032";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyPublicLandingAssets(root) {
  const failures = [];
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "public/brand/landing-assets.manifest.json"),
        "utf8",
      ),
    );
    if (
      manifest.schemaVersion !== 1 ||
      manifest.assetVersion !== "2026.10.13-first-world-v1" ||
      manifest.sourceMaster !== masterPath ||
      manifest.sourceSha256 !== masterHash ||
      manifest.sourceWidth !== 1536 ||
      manifest.sourceHeight !== 1024
    )
      failures.push("landing source identity changed");
    if (digest(await readFile(path.join(root, masterPath))) !== masterHash)
      failures.push("landing lossless master bytes changed");
    const expected = [640, 960, 1536]
      .flatMap((width) =>
        ["avif", "webp"].map(
          (format) =>
            `/brand/scenes/first-world/first-world-${width}-v1.${format}`,
        ),
      )
      .sort();
    const rows = manifest.assets;
    if (
      !Array.isArray(rows) ||
      JSON.stringify(rows.map((row) => row.path).sort()) !==
        JSON.stringify(expected)
    )
      return [
        ...failures,
        "landing derivative roster must contain exactly six unique assets",
      ];
    for (const row of rows) {
      const match = row.path.match(
        /^\/brand\/scenes\/first-world\/first-world-(640|960|1536)-v1\.(avif|webp)$/,
      );
      if (!match) {
        failures.push("landing asset path rejected");
        continue;
      }
      const width = Number(match[1]),
        format = match[2];
      const contents = await readFile(path.join(root, "public", row.path));
      const info = await stat(path.join(root, "public", row.path));
      if (
        row.width !== width ||
        row.height !== Math.round((width * 1024) / 1536) ||
        row.mimeType !== `image/${format}` ||
        row.bytes !== contents.byteLength ||
        info.size !== row.bytes ||
        digest(contents) !== row.sha256
      )
        failures.push(`landing asset integrity failed: ${row.path}`);
      if (row.bytes > (format === "avif" ? 160000 : 350000))
        failures.push(
          `landing derivative exceeds its reviewed transfer budget: ${row.path}`,
        );
    }
  } catch (error) {
    failures.push(
      `landing asset verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return [...failures, ...(await verifyPublicWorldAssets(root))];
}

export async function verifyPublicWorldAssets(root) {
  const failures = [];
  const masters = {
    korea: "71d7eb33a655772741e19bd396986eaab892c8442bfd0100ab871130a9485e3b",
    usa: "a36b4c7adb8dd65408e1d607cd955d5580a317f7c59b8b009e9cf8c973691ffd",
    gold: "6ffc641a4e1ef91e6ac1ddbfbbf8ce271fdba36515bea06614f22d9987a4e709",
    silver: "84c4eb4e688c2b2ef1fc8f8d5680c23eb8abbdfee3b9256cd24fa1c80d649928",
    digital: "39a1c47c85239602dfd72a7eda925003eb661eb568444283b92960a3cb47c656",
  };
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "public/brand/world-assets.manifest.json"),
        "utf8",
      ),
    );
    if (
      manifest.schemaVersion !== 1 ||
      manifest.assetVersion !== "2026.10.13-world-collection-v1" ||
      !Array.isArray(manifest.worlds) ||
      JSON.stringify(manifest.worlds.map((world) => world.key).sort()) !==
        JSON.stringify(Object.keys(masters).sort())
    )
      return ["five-world source roster changed"];
    for (const world of manifest.worlds) {
      const master = `docs/design/generated-masters/world-collection-20261013/${world.key}-master-v1.png`;
      if (
        world.sourceMaster !== master ||
        world.sourceSha256 !== masters[world.key] ||
        world.width !== 1536 ||
        world.height !== 1024 ||
        digest(await readFile(path.join(root, master))) !== masters[world.key]
      )
        failures.push(`world master identity changed: ${world.key}`);
      const expected = [320, 640, 960]
        .flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/world-collection/${world.key}-${width}-v1.${format}`,
          ),
        )
        .sort();
      if (
        !Array.isArray(world.assets) ||
        JSON.stringify(world.assets.map((row) => row.path).sort()) !==
          JSON.stringify(expected)
      ) {
        failures.push(`world derivative roster changed: ${world.key}`);
        continue;
      }
      for (const row of world.assets) {
        const match = row.path.match(
          /^\/brand\/scenes\/world-collection\/(korea|usa|gold|silver|digital)-(320|640|960)-v1\.(avif|webp)$/,
        );
        if (!match || match[1] !== world.key) {
          failures.push("world derivative path rejected");
          continue;
        }
        const contents = await readFile(path.join(root, "public", row.path));
        const width = Number(match[2]),
          format = match[3];
        if (
          row.width !== width ||
          row.height !== Math.round((width * 1024) / 1536) ||
          row.mimeType !== `image/${format}` ||
          contents.byteLength !== row.bytes ||
          digest(contents) !== row.sha256 ||
          !row.alt
        )
          failures.push(`world derivative integrity failed: ${row.path}`);
        if (row.bytes > (format === "avif" ? 160000 : 350000))
          failures.push(
            `world derivative transfer budget exceeded: ${row.path}`,
          );
      }
    }
  } catch (error) {
    failures.push(
      `world asset verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return failures;
}
