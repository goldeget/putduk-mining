import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drawProcessDecoration } from "@/components/mining-live/process-decoration";
import { findEconomicFieldPaths } from "@/lib/mining-scene/economic-field-guard";
import { PRODUCT_PROCESS_PACKS } from "@/lib/mining-scene/product-scene-assets";
import {
  processPathPoint,
  projectProcessProfile,
} from "@/lib/mining-scene/process-profile";
import {
  resolveCatalogProduct,
  resolveScene,
} from "@/lib/mining-scene/resolve-scene";
import { projectStageInput } from "@/lib/mining-scene/stage-input";
import {
  isApprovedSceneMasterImage,
  isApprovedResponsiveComposition,
} from "@/lib/mining-scene/types";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const packs = Object.values(PRODUCT_PROCESS_PACKS);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Asset = {
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mimeType: string;
};
type ManifestPack = {
  code: string;
  sourceMaster: string;
  masterSha256: string;
  bytes: number;
  assets: Asset[];
};
const manifest = JSON.parse(
  readFileSync(
    `${root}/public/brand/product-scenes/20261013/manifest.json`,
    "utf8",
  ),
) as { packs: ManifestPack[] };

describe("commissioned individual product scene packs", () => {
  it("registers precisely the nine requested codes with nine independent masters and process topologies", () => {
    expect(packs.map((pack) => pack.code)).toEqual([
      "005930",
      "AAPL",
      "MSFT",
      "XAU",
      "XAG",
      "BTC",
      "ETH",
      "BNB",
      "XRP",
    ]);
    expect(new Set(packs.map((pack) => pack.master.sha256)).size).toBe(9);
    expect(new Set(packs.map((pack) => pack.process.mode)).size).toBe(9);
    expect(
      new Set(packs.map((pack) => JSON.stringify(pack.process.paths))).size,
    ).toBe(9);
    for (const code of ["TSLA", "RKLB", "AMZN", "ETF", "LG", "5930", "UNKNOWN"])
      expect(
        resolveCatalogProduct({ code, category: "US_STOCK" }).scene,
      ).toBeNull();
  });
  it.each(packs)(
    "binds $code to its own bytes, paths, geometry and category without economic fields",
    (pack) => {
      const resolved = resolveCatalogProduct({
        code: pack.code,
        category: pack.category,
      });
      expect(resolved.visualStatus).toBe("MASTER_READY");
      expect(resolved.scene?.master).toEqual(pack.master);
      expect(resolved.scene?.performance.timerAdvancesValue).toBe(false);
      expect(resolved.scene?.performance.maxParticles).toBeLessThanOrEqual(8);
      const stage = projectStageInput(resolved);
      expect(stage.process).toEqual(pack.process);
      expect(stage.process).not.toBe(pack.process);
      expect(findEconomicFieldPaths(stage)).toEqual([]);
      for (const key of [
        "productCode",
        "running",
        "balance",
        "reward",
        "rate",
        "sessionId",
      ])
        expect(stage).not.toHaveProperty(key);
      expect(isApprovedSceneMasterImage(pack.master)).toBe(true);
      for (const source of pack.responsiveSources)
        expect(isApprovedResponsiveComposition(source)).toBe(true);
      expect(
        resolveCatalogProduct({
          code: pack.code,
          category: pack.category === "CRYPTO" ? "GOLD" : "CRYPTO",
        }).scene,
      ).toBeNull();
      const other = packs.find((item) => item.code !== pack.code)!;
      expect(
        isApprovedSceneMasterImage({
          ...pack.master,
          assetPath: other.master.assetPath,
        }),
      ).toBe(false);
      expect(
        isApprovedResponsiveComposition({
          ...pack.responsiveSources[0],
          composition: other.responsiveSources[0].composition,
        }),
      ).toBe(false);
      expect(
        resolveScene(
          { code: pack.code, category: pack.category },
          {
            ...resolved.presentation!,
            sceneFamilyKey: other.familyKey,
            sceneFamilyVersion: 1,
            profile: {
              ...resolved.presentation!.profile,
              masterVariant: other.variant,
            },
          },
        ).scene,
      ).toBeNull();
      const recorded = manifest.packs.find((item) => item.code === pack.code)!;
      const bytes = readFileSync(`${root}/${recorded.sourceMaster}`);
      expect(bytes.length).toBe(recorded.bytes);
      expect(sha(bytes)).toBe(pack.master.sha256);
      expect(recorded.masterSha256).toBe(pack.master.sha256);
      expect(recorded.assets).toHaveLength(6);
      for (const asset of recorded.assets) {
        const derivative = readFileSync(`${root}/public${asset.path}`);
        expect(derivative.length).toBe(asset.bytes);
        expect(sha(derivative)).toBe(asset.sha256);
        expect(
          pack.responsiveSources.find(
            (source) => source.assetPath === asset.path,
          ),
        ).toMatchObject({
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
        });
      }
    },
  );
  it("keeps existing memory/GPU visual definitions independent of the new process configuration", () => {
    for (const identity of [
      { code: "000660", category: "KR_STOCK" },
      { code: "NVDA", category: "US_STOCK" },
    ] as const) {
      const resolved = resolveCatalogProduct(identity);
      expect(resolved.visualStatus).toBe("MASTER_READY");
      expect(resolved.scene).not.toHaveProperty("process");
      expect(projectStageInput(resolved).process).toBeNull();
    }
  });
  it("rejects unreviewed geometry, behavior, economic fields and unbounded animation inputs", () => {
    const process = PRODUCT_PROCESS_PACKS.XAU.process;
    for (const invalid of [
      { ...process, reward: 5000 },
      { ...process, mode: "execute" },
      { ...process, palette: ["url(https://example.com)", "#ffffff"] },
      { ...process, cycleSeconds: 0 },
      { ...process, cycleSeconds: Infinity },
      { ...process, paths: [] },
      { ...process, paths: [{ ...process.paths[0], from: { x: 2, y: 0 } }] },
      {
        ...process,
        paths: [
          { ...process.paths[0], from: { x: 0, y: 0, productCode: "XAU" } },
        ],
      },
    ])
      expect(projectProcessProfile(invalid)).toBeNull();
    const valid = projectProcessProfile(process)!;
    expect(processPathPoint(valid.paths[0]!, 0)).toEqual(valid.paths[0]!.from);
    expect(processPathPoint(valid.paths[0]!, 1)).toEqual(valid.paths[0]!.to);
    expect(processPathPoint(valid.paths[0]!, NaN)).toEqual(
      valid.paths[0]!.from,
    );
  });
  it("draws distinct primitive grammar for the nine process modes on the same renderer", () => {
    const signatures = packs.map((pack) => {
      const calls: string[] = [];
      const context = Object.fromEntries(
        [
          "beginPath",
          "moveTo",
          "lineTo",
          "quadraticCurveTo",
          "stroke",
          "rect",
          "ellipse",
          "fill",
          "arc",
          "setTransform",
        ].map((method) => [
          method,
          (...args: number[]) =>
            calls.push(`${method}:${JSON.stringify(args)}`),
        ]),
      ) as unknown as CanvasRenderingContext2D;
      drawProcessDecoration(
        context,
        pack.process,
        1,
        8,
        (point) => point,
        { x: 0.5, y: 0.5 },
        0.1,
      );
      expect(context.globalAlpha).toBe(1);
      expect(context.shadowBlur).toBe(0);
      return calls.join(",");
    });
    // Paths and silhouettes both distinguish processes; shared primitives remain legitimate.
    expect(new Set(signatures).size).toBe(9);
  });
});
