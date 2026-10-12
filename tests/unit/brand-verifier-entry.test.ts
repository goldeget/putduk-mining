import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
const url = new URL("../../scripts/verify-brand-assets.mjs", import.meta.url)
  .href;
const preload = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';fs.readFile=async()=>{throw Error('BRAND_ASSET_IO_SENTINEL')};fs.stat=async()=>{throw Error('BRAND_ASSET_IO_SENTINEL')};syncBuiltinESMExports();`;
describe("brand verifier keeps metadata import separate from full disk acceptance", () => {
  it("imports metadata without asset I/O, verification output or process exit", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        preload +
          `process.exit=()=>{throw Error('UNEXPECTED_PROCESS_EXIT')};const api=await import(${JSON.stringify(url)});console.log(typeof api.approvedSceneMetadataFailures+':'+typeof api.verifyBrandAssets)`,
      ],
      { encoding: "utf8" },
    );
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe("function:function");
    expect(child.stderr).toBe("");
  });
  describe("actual CLI acceptance fixture", () => {
    let child: SpawnSyncReturns<string>;
    beforeAll(() => {
      child = spawnSync(process.execPath, ["scripts/verify-brand-assets.mjs"], {
        encoding: "utf8",
      });
    });
    it("keeps the direct CLI on the full existing actual-disk verifier", () => {
      expect(child.status).toBe(0);
      expect(child.stdout).toContain("Verified 294 PUTDUK brand assets");
      expect(child.stdout).toContain(
        "24 catalog material plus 6 mobile Light mining derivatives",
      );
    });
  });
  it("fails the direct CLI when full-verification file access fails", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "data:text/javascript," + encodeURIComponent(preload),
        "scripts/verify-brand-assets.mjs",
      ],
      { encoding: "utf8" },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("BRAND_ASSET_IO_SENTINEL");
    expect(child.stdout).not.toContain("Verified");
  });
});
