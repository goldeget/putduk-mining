import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  manifest: "",
  bytes: new Map<string, Buffer>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const cache = new Map<string, ReturnType<typeof actual.readFile>>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const name = String(args[0]).replaceAll("\\", "/");
      if (name.endsWith("/public/brand/identity.manifest.json"))
        return io.manifest;
      const replacement = io.bytes.get(name);
      if (replacement) return replacement;
      const key = name + ":" + JSON.stringify(args[1]);
      if (!cache.has(key)) cache.set(key, actual.readFile(...args));
      return cache.get(key)!;
    },
  };
});

type Copy = { path: string; memberPath: string; bytes: number; sha256: string };
type Manifest = { adminPublicCopies: Copy[] };
const root = process.cwd();
const original = JSON.parse(
  readFileSync(path.join(root, "public/brand/identity.manifest.json"), "utf8"),
) as Manifest;
const apple =
  "apps/admin/public/brand/identity/20261014/pwa/putduk-pwa-maskable-512.png";
const memberApple =
  "public/brand/identity/20261014/pwa/putduk-pwa-maskable-512.png";
const rosterFailure = "five exact current admin icon delivery copies required";
let verify: (root: string) => Promise<string[]>;

beforeAll(async () => {
  const verifierModule = await vi.importActual<{
    verifyCanonicalBrandIdentity: (root: string) => Promise<string[]>;
  }>(path.join(root, "scripts/verify-canonical-brand-identity.mjs"));
  verify = verifierModule.verifyCanonicalBrandIdentity;
});

beforeEach(() => {
  io.manifest = JSON.stringify(original);
  io.bytes.clear();
});

function changeManifest(change: (manifest: Manifest) => void) {
  const manifest = structuredClone(original);
  change(manifest);
  io.manifest = JSON.stringify(manifest);
}

function corrupt(relative: string) {
  const full = path.join(root, relative);
  const bytes = Buffer.from(readFileSync(full));
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  io.bytes.set(full.replaceAll("\\", "/"), bytes);
}

describe("native brand verifier checks the five real admin deliveries", () => {
  it("accepts the current five files with their real approved bytes", async () => {
    await expect(verify(root)).resolves.toEqual([]);
  });

  it("rejects the previous four-copy roster with the opaque Apple icon missing", async () => {
    changeManifest((manifest) => {
      manifest.adminPublicCopies = manifest.adminPublicCopies.filter(
        (row) => row.path !== apple,
      );
    });
    expect(await verify(root)).toContain(rosterFailure);
  });

  it("rejects a duplicate approved copy replacing the required opaque icon", async () => {
    changeManifest((manifest) => {
      const index = manifest.adminPublicCopies.findIndex(
        (row) => row.path === apple,
      );
      manifest.adminPublicCopies[index] = {
        ...manifest.adminPublicCopies.find((row) => row.path !== apple)!,
      };
    });
    expect(await verify(root)).toContain(rosterFailure);
  });

  it("rejects a different canonical member path paired with an approved admin destination", async () => {
    changeManifest((manifest) => {
      manifest.adminPublicCopies.find((row) => row.path === apple)!.memberPath =
        "/brand/identity/20261014/favicon/favicon.svg";
    });
    expect(await verify(root)).toContain("admin identity copy path rejected");
  });

  it("rejects changed admin file bytes despite unchanged path and metadata", async () => {
    corrupt(apple);
    expect(await verify(root)).toContain(
      `admin/member identity copy mismatch: ${apple}`,
    );
  });

  it("compares the actual member bytes with admin bytes, not only manifest hashes", async () => {
    corrupt(memberApple);
    expect(await verify(root)).toContain(
      `admin/member identity copy mismatch: ${apple}`,
    );
  });
});
