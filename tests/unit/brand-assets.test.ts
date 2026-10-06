import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

type ManifestAsset = {
  path: string;
  mimeType: string;
  alt: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
  purpose?: string;
  theme?: string;
  assetVersion?: string;
  sourceMaster?: string;
  sourceSha256?: string;
  reviewScope?: string;
};

type AssetManifest = {
  schemaVersion: number;
  assetVersion: string;
  sourcePolicy: string;
  assets: ManifestAsset[];
};

async function loadManifest() {
  const source = await readFile(
    path.join(process.cwd(), "public", "brand", "assets.manifest.json"),
    "utf8",
  );
  return JSON.parse(source) as AssetManifest;
}

describe("PUTDUK brand asset contract", () => {
  it("keeps generated pixels separate from production copy", async () => {
    const manifest = await loadManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.assetVersion).toBe("2026.10.06-v5");
    expect(manifest.sourcePolicy).toContain(
      "generated pixels contain no production copy",
    );
    expect(manifest.sourcePolicy).toContain(
      "public files are optimized derivatives",
    );
    expect(manifest.assets.every((asset) => asset.alt.trim().length > 0)).toBe(
      true,
    );
  });

  it("contains six responsive neutral rank families", async () => {
    const manifest = await loadManifest();

    for (let index = 1; index <= 6; index += 1) {
      const rank = `rank-${String(index).padStart(2, "0")}`;
      for (const size of [128, 256, 512]) {
        expect(
          manifest.assets.some(
            (asset) =>
              asset.path === `/ranks/${rank}/planet-${size}-v1.avif` &&
              asset.width === size &&
              asset.height === size,
          ),
        ).toBe(true);
      }
    }
  });

  it("ships dark, light and maskable PWA assets", async () => {
    const manifest = await loadManifest();
    const pwa = manifest.assets.filter((asset) => asset.path.includes("/pwa/"));

    expect(
      pwa.some((asset) => asset.theme === "dark" && asset.width === 512),
    ).toBe(true);
    expect(
      pwa.some((asset) => asset.theme === "light" && asset.width === 512),
    ).toBe(true);
    expect(
      pwa.some((asset) => asset.purpose === "maskable" && asset.width === 512),
    ).toBe(true);
  });

  it("preserves the approved face master bytes separately from four complete-square runtime derivatives", async () => {
    const manifest = await loadManifest();
    const sourceMaster =
      "docs/design/generated-masters/ai-help-face-2026-10-03/putduk-ai-help-face-master-v1.png";
    const sourceSha256 =
      "d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(master.readUInt32BE(16)).toBe(1254);
    expect(master.readUInt32BE(20)).toBe(1254);
    expect(master[25]).toBe(6); // PNG truecolour with alpha.
    const faces = manifest.assets.filter((asset) =>
      asset.path.startsWith("/brand/mascot/putduk-ai-help-face-"),
    );
    expect(faces).toHaveLength(4);
    for (const size of [128, 256]) {
      for (const format of ["avif", "webp"]) {
        const relative = `/brand/mascot/putduk-ai-help-face-${size}-v1.${format}`;
        const asset = faces.find((entry) => entry.path === relative);
        expect(asset).toMatchObject({
          mimeType: `image/${format}`,
          width: size,
          height: size,
          theme: "system",
          assetVersion: "2026.10.03-ai-help-face-v1",
          sourceMaster,
          sourceSha256,
          reviewScope:
            "Owner-approved batch 7 AI help launcher face; preserve the complete 1254x1254 composition with object-fit: contain; no scene, economic or other asset approval.",
        });
        expect(asset?.alt).toContain("퍼뜩 AI 도움 얼굴");
        const contents = await readFile(
          path.join(process.cwd(), "public", relative),
        );
        expect(contents.length).toBe(asset?.bytes);
        expect(createHash("sha256").update(contents).digest("hex")).toBe(
          asset?.sha256,
        );
      }
    }
    expect(
      manifest.assets.some((asset) => asset.path.includes("generated-masters")),
    ).toBe(false);
  });

  it("retains every pre-existing manifest entry and runtime file digest", async () => {
    const manifest = await loadManifest();
    const legacy = manifest.assets.filter(
      (asset) =>
        !asset.path.startsWith("/brand/mascot/putduk-ai-help-face-") &&
        !asset.path.startsWith("/brand/scenes/"),
    );
    expect(legacy).toHaveLength(84);
    expect(
      createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
    ).toBe("cbc06ee00153921d52028561c7407fda604f2ca2e9144ce4157a600d8611b7d2");
    await Promise.all(
      legacy.map(async (asset) => {
        const contents = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(contents.length).toBe(asset.bytes);
        expect(createHash("sha256").update(contents).digest("hex")).toBe(
          asset.sha256,
        );
      }),
    );
  });

  it("adds only eight complete-composition derivatives from the approved clean master while preserving all 88 prior assets", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets.filter(
      (asset) => !asset.path.startsWith("/brand/scenes/"),
    );
    expect(prior).toHaveLength(88);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("e29fa4778a445da4fd99bedd551943573c0ba247b7b83b42ea5960b5c2f3893c");
    const sourceMaster =
      "docs/design/generated-masters/semiconductor-memory-v3-clean-2026-10-03/semiconductor-memory-v3-clean-master-v1.png";
    const sourceSha256 =
      "5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.readUInt32BE(16)).toBe(1539);
    expect(master.readUInt32BE(20)).toBe(1022);
    expect(master[25]).toBe(2); // PNG truecolour without alpha.
    const scenes = manifest.assets.filter((asset) =>
      asset.path.startsWith("/brand/scenes/semiconductor-memory/"),
    );
    expect(scenes).toHaveLength(8);
    expect(manifest.assets).toHaveLength(112);
    for (const width of [640, 960, 1280, 1539]) {
      for (const format of ["avif", "webp"]) {
        const relative = `/brand/scenes/semiconductor-memory/semiconductor-memory-${width}-v1.${format}`;
        const asset = scenes.find((entry) => entry.path === relative);
        expect(asset).toMatchObject({
          mimeType: `image/${format}`,
          width,
          height: Math.round((1022 * width) / 1539),
          theme: "system",
          assetVersion: "2026.10.03-semiconductor-memory-v1",
          sourceMaster,
          sourceSha256,
        });
        expect(asset?.reviewScope).toContain(
          "no product mapping, economic runtime or other family approval",
        );
        const contents = await readFile(
          path.join(process.cwd(), "public", relative),
        );
        expect(contents.length).toBe(asset?.bytes);
        expect(createHash("sha256").update(contents).digest("hex")).toBe(
          asset?.sha256,
        );
      }
    }
  });

  it("adds a source-locked global pavilion pack without changing any of the 96 prior records or bytes", async () => {
    const manifest = await loadManifest();
    const prefix = "/brand/scenes/global-pavilion/";
    const prior = manifest.assets.filter(
      (asset) =>
        !asset.path.startsWith(prefix) &&
        !/^\/brand\/scenes\/semiconductor-memory-light\/semiconductor-memory-light-(640|960|1280|1536)-v1\.(avif|webp)$/.test(
          asset.path,
        ),
    );
    expect(prior).toHaveLength(96);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("71a28aa4af200d846603803b12d01b476e5028497b8a2f28c0a4a795d363893f");
    const pack = manifest.assets.filter((asset) =>
      asset.path.startsWith(prefix),
    );
    expect(pack).toHaveLength(8);
    const sourceHash =
      "82c8d567d0da86ce72052d6415e198793198f9886e65a21d0eadd859b66e1a32";
    for (const asset of [...prior, ...pack]) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
      expect(bytes.length).toBe(asset.bytes);
    }
    const source = await readFile(
      path.join(process.cwd(), pack[0]!.sourceMaster!),
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(sourceHash);
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import {approvedSceneMetadataFailures} from './scripts/verify-brand-assets.mjs';
      const pack=${JSON.stringify(pack)};
      const variants=[...pack,{...pack[0],sourceSha256:'0'.repeat(64)},{...pack[0],width:1},{...pack[0],reviewScope:'Economic approval'},{...pack[0],path:'/brand/scenes/global-pavilion/unreviewed.png'}];
      console.log(JSON.stringify(variants.map(approvedSceneMetadataFailures)));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const errors = JSON.parse(output.trim().split("\n").at(-1)!);
    expect(errors.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => []));
    expect(errors.slice(8).every((row: string[]) => row.length > 0)).toBe(true);
  });

  it("rejects foreign hashes, recolored scope, unapproved families, dimensions and runtime PNGs through the scene verifier", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/semiconductor-memory/semiconductor-memory-640-v1.avif",
    )!;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
import { approvedSceneMetadataFailures } from './scripts/verify-brand-assets.mjs';
const approved = ${JSON.stringify(asset)};
const variants = [approved,
{...approved, sourceSha256:'9c0ae9234b747d71e7ea81bfb43190cad7fd4ac1358c1b673bdc4ed13c3a881c'},
{...approved, sourceMaster:'docs/design/visual-references/putduk-brand-master-reference.png'},
{...approved, reviewScope:'Recolored scene and economic publication'},
{...approved, assetVersion:'2026.10.03-ai-help-face-v1'},
{...approved, height:640},
{...approved, mimeType:'image/png'},
{...approved, path:'/brand/scenes/semiconductor-memory/semiconductor-memory-640-v1.png'},
{...approved, path:'/brand/scenes/precious-gold/gold-640-v1.avif'},
{...approved, productionEconomicRules:'forbidden'}];
console.log(JSON.stringify(variants.map(approvedSceneMetadataFailures)));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const results = JSON.parse(output.trim().split("\n").at(-1)!) as string[][];
    expect(results[0]).toEqual([]);
    expect(results.slice(1).every((errors) => errors.length > 0)).toBe(true);
  });

  it("adds the exact light companion paths while retaining all 104 prior entries and bytes", async () => {
    const manifest = await loadManifest();
    const approvedPaths = new Set(
      [640, 960, 1280, 1536].flatMap((width) =>
        ["avif", "webp"].map(
          (format) =>
            `/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-${width}-v1.${format}`,
        ),
      ),
    );
    const prior = manifest.assets.filter(
      (asset) => !approvedPaths.has(asset.path),
    );
    expect(prior).toHaveLength(104);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("bd4887df3347bc9a120d7dae412ee2a157613ec10f2d56311c7d7db3909f5262");
    const pack = manifest.assets.filter((asset) =>
      approvedPaths.has(asset.path),
    );
    expect(new Set(pack.map((asset) => asset.path))).toEqual(approvedPaths);
    expect(pack).toHaveLength(8);
    const sourceMaster =
      "docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png";
    const sourceHash =
      "113fdbc5c41772145f98f3357f27754fa1bd20602a5261c133becc0fa1126d52";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(sourceHash);
    expect(master.readUInt32BE(16)).toBe(1536);
    expect(master.readUInt32BE(20)).toBe(1024);
    expect(master[25]).toBe(2);
    for (const asset of [...prior, ...pack]) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
      expect(bytes.length).toBe(asset.bytes);
    }
    for (const asset of pack) {
      const width = Number(/-(\d+)-v1\./.exec(asset.path)?.[1]);
      expect(asset).toMatchObject({
        assetVersion: "2026.10.06-semiconductor-memory-light-v1",
        width,
        height: Math.round((1024 * width) / 1536),
        theme: "light",
        mimeType: `image/${asset.path.split(".").at(-1)}`,
        sourceMaster,
        sourceSha256: sourceHash,
      });
      expect(asset.reviewScope).toContain(
        "no economic or product mapping approval",
      );
    }
  });

  it("rejects wrong light sources, dimensions, theme, paths and actual runtime byte corruption", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-640-v1.avif",
    )!;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import {readFile} from 'node:fs/promises';
      import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
      const asset=${JSON.stringify(asset)};
      const metadata=[asset,{...asset,sourceSha256:'0'.repeat(64)},
        {...asset,sourceMaster:'docs/design/generated-masters/semiconductor-memory-v3-clean-2026-10-03/semiconductor-memory-v3-clean-master-v1.png'},
        {...asset,width:641},{...asset,height:640},{...asset,theme:'system'},
        {...asset,path:'/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-640-v1.png'},
        {...asset,path:'/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1539-v1.avif'},
        {...asset,reviewScope:'Economic and product approval'},
        {...asset,productionEconomicRules:'forbidden'}];
      const contents=await readFile('./public'+asset.path);
      const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
      console.log(JSON.stringify({metadata:metadata.map(approvedSceneMetadataFailures),
        faceGate:aiHelpMetadataFailures(asset),
        integrity:[runtimeAssetIntegrityFailures(asset,contents),
          runtimeAssetIntegrityFailures({...asset,sha256:'0'.repeat(64)},contents),
          runtimeAssetIntegrityFailures({...asset,bytes:asset.bytes+1},contents),
          runtimeAssetIntegrityFailures(asset,corrupted)]}));
    `,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
      metadata: string[][];
      faceGate: string[];
      integrity: string[][];
    };
    expect(result.metadata[0]).toEqual([]);
    expect(result.metadata.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
    expect(result.faceGate).toEqual([]);
    expect(result.integrity[0]).toEqual([]);
    expect(result.integrity.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
  });

  it("rejects widened or foreign face provenance through the actual verification contract", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) => entry.path === "/brand/mascot/putduk-ai-help-face-128-v1.avif",
    )!;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { aiHelpMetadataFailures } from './scripts/verify-brand-assets.mjs';
const approved = ${JSON.stringify(asset)};
const variants = [approved,
{...approved, sourceMaster:'docs/design/generated-masters/putduk-miner-master-v1.png'},
{...approved, sourceSha256:'0'.repeat(64)},
{...approved, assetVersion:'2026.09.27-v1'},
{...approved, reviewScope:'All product flows and economic approval'},
{...approved, privateEconomicRules:'not permitted'},
{...approved, purpose:'economic-approval'},
{...approved, mimeType:'image/png'},
{...approved, width:127},
{...approved, path:'/brand/mascot/putduk-miner-384-v1.avif'},
{...approved, sourceMaster:undefined}];
console.log(JSON.stringify(variants.map(aiHelpMetadataFailures)));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const results = JSON.parse(output.trim().split("\n").at(-1)!) as string[][];
    expect(results[0]).toEqual([]);
    expect(results.slice(1).every((errors) => errors.length > 0)).toBe(true);
  });

  it("keeps the default manifest generator on the new snapshot and binds preserved review metadata to identical bytes", async () => {
    const source = await readFile(
      path.join(process.cwd(), "scripts/build-brand-assets.py"),
      "utf8",
    );
    expect(source).toContain('VERSION = "2026.10.06-v5"');
    expect(source).toContain('root.rglob("*")');
    expect(source).toContain('prior.get("sha256") == record["sha256"]');
    for (const key of [
      "assetVersion",
      "sourceMaster",
      "sourceSha256",
      "reviewScope",
    ])
      expect(source).toContain(`"${key}"`);
    expect(source).toContain("record[key] = prior[key]");
    expect(source).toContain("def build_manifest(*, write: bool = True)");
  });
});
