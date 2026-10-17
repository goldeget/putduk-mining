import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { readHistoricalRecoverySource } from "../../scripts/historical-recovery-unit-stage.mjs";

const probe = vi.hoisted(() => ({
  changedManifest: false,
  escapedSource: false,
}));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    statSync(...args: Parameters<typeof fs.statSync>) {
      const stat = fs.statSync(...args);
      if (
        probe.changedManifest &&
        String(args[0]).includes("principal-review-r2-ci-source.json")
      ) {
        return { ...stat, ctimeNs: BigInt(1), mtimeNs: BigInt(1) };
      }
      return stat;
    },
    readFileSync(...args: Parameters<typeof fs.readFileSync>) {
      if (
        probe.changedManifest &&
        String(args[0]).includes("principal-review-r2-ci-source.json")
      )
        return Buffer.from("changed frozen manifest");
      return fs.readFileSync(...args);
    },
    realpathSync(...args: Parameters<typeof fs.realpathSync>) {
      const path = fs.realpathSync(...args);
      if (
        probe.escapedSource &&
        String(args[0]).replaceAll("\\", "/").endsWith("/app/globals.css")
      )
        return resolve("..", "outside.css");
      return path;
    },
  };
});

describe("historical fixture cache and realpath rejection without editing frozen files", () => {
  it("rejects a frozen manifest changed after the generation cache was populated", () => {
    const root = resolve(".");
    readHistoricalRecoverySource(root, "app/globals.css", 197);
    probe.changedManifest = true;
    try {
      expect(() =>
        readHistoricalRecoverySource(root, "app/globals.css", 197),
      ).toThrow("MANIFEST_CHANGED");
    } finally {
      probe.changedManifest = false;
    }
    expect(
      readHistoricalRecoverySource(root, "app/globals.css", 197),
    ).toBeInstanceOf(Buffer);
  });
  it("rejects an actual resolved path outside the checkout, including after source caching", () => {
    const root = resolve(".");
    readHistoricalRecoverySource(root, "app/globals.css", 197);
    probe.escapedSource = true;
    try {
      expect(() =>
        readHistoricalRecoverySource(root, "app/globals.css", 197),
      ).toThrow("PATH_REJECTED");
    } finally {
      probe.escapedSource = false;
    }
  });
});
