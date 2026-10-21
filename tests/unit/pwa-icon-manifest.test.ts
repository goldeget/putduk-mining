import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/design/fonts", () => ({
  putdukFont: { variable: "font-test" },
}));
vi.mock("@/components/system/pwa-registrar", () => ({ PwaRegistrar: "pwa" }));
vi.mock("@/components/system/analytics-beacon", () => ({
  AnalyticsBeacon: "analytics",
}));
vi.mock("@/components/system/web-vitals-beacon", () => ({
  WebVitalsBeacon: "vitals",
}));
vi.mock("@/components/system/theme-runtime", () => ({ ThemeRuntime: "theme" }));
vi.mock("@/components/support/support-runtime", () => ({
  SupportRuntime: "support",
}));

const opaqueIcon = "/brand/identity/20261014/pwa/putduk-pwa-maskable-512.png";
const deliveryRevision = "?v=20261020-icon1";
const opaqueSha =
  "ee3dc22230154bdddc8fdf72f097240daba21d16c95b45f0cdb18461a802e271";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function manifestFor(origin: string) {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  vi.resetModules();
  return (await import("@/app/manifest")).default();
}

describe("public website and member install identity", () => {
  it("describes the apex as the official browser website with its own name", async () => {
    const manifest = await manifestFor("https://putduk.com");
    expect(manifest).toMatchObject({
      id: "/",
      name: "퍼뜩 공식 홈페이지",
      short_name: "퍼뜩",
      start_url: "/",
      scope: "/",
      display: "browser",
      orientation: "any",
    });
    expect(
      manifest.icons?.every((icon) => icon.src.endsWith(deliveryRevision)),
    ).toBe(true);
  });

  it("preserves the member app identity and launch path while supporting tablets and rotation", async () => {
    const manifest = await manifestFor("https://mining.putduk.com");
    expect(manifest).toMatchObject({
      id: "/",
      name: "퍼뜩 채굴",
      short_name: "퍼뜩 채굴",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src:
            "/brand/identity/20261014/pwa/putduk-pwa-dark-192.png" +
            deliveryRevision,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src:
            "/brand/identity/20261014/pwa/putduk-pwa-dark-512.png" +
            deliveryRevision,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: opaqueIcon + deliveryRevision,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        }),
      ]),
    );
    expect(
      manifest.icons?.every((icon) => icon.src.endsWith(deliveryRevision)),
    ).toBe(true);
  });

  it("does not select the public website identity from an unreviewed origin", async () => {
    expect(await manifestFor("https://putduk.com.evil.invalid")).toMatchObject({
      name: "퍼뜩 채굴",
      display: "standalone",
      scope: "/",
      orientation: "any",
    });
  });

  it.each(["https://putduk.com", "https://mining.putduk.com"])(
    "declares a scalable favicon and the approved opaque Apple icon on %s",
    async (origin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
      vi.resetModules();
      const { metadata } = await import("@/app/layout");
      expect(metadata.icons).toMatchObject({
        icon: expect.arrayContaining([
          expect.objectContaining({
            url:
              "/brand/identity/20261014/favicon/favicon.svg" + deliveryRevision,
            sizes: "any",
            type: "image/svg+xml",
          }),
          expect.objectContaining({
            url:
              "/brand/identity/20261014/favicon/favicon-32.png" +
              deliveryRevision,
            sizes: "32x32",
            type: "image/png",
          }),
        ]),
        shortcut:
          "/brand/identity/20261014/favicon/favicon.ico" + deliveryRevision,
        apple: [
          {
            url: opaqueIcon + deliveryRevision,
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });
    },
  );

  it("gives the admin login the same opaque Apple icon without adding a member manifest", async () => {
    const { metadata } = await import("../../apps/admin/app/layout");
    expect(metadata.icons).toMatchObject({
      icon: expect.arrayContaining([
        expect.objectContaining({
          url:
            "/brand/identity/20261014/favicon/favicon.svg" + deliveryRevision,
          sizes: "any",
          type: "image/svg+xml",
        }),
        expect.objectContaining({
          url:
            "/brand/identity/20261014/favicon/favicon-32.png" +
            deliveryRevision,
          sizes: "32x32",
          type: "image/png",
        }),
      ]),
      shortcut:
        "/brand/identity/20261014/favicon/favicon.ico" + deliveryRevision,
      apple: [
        {
          url: opaqueIcon + deliveryRevision,
          sizes: "512x512",
          type: "image/png",
        },
      ],
    });
    expect(metadata.manifest).toBeUndefined();
  });

  it("ships the exact existing opaque artwork to admin and records its provenance", async () => {
    const member = await readFile(
      path.join(process.cwd(), "public", opaqueIcon),
    );
    const adminPath = `apps/admin/public${opaqueIcon}`;
    const admin = await readFile(path.join(process.cwd(), adminPath));
    const identity = JSON.parse(
      await readFile(
        path.join(process.cwd(), "public/brand/identity.manifest.json"),
        "utf8",
      ),
    );
    expect(createHash("sha256").update(member).digest("hex")).toBe(opaqueSha);
    expect(member.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect([member.readUInt32BE(16), member.readUInt32BE(20)]).toEqual([
      512, 512,
    ]);
    expect(admin).toEqual(member);
    expect(identity.adminPublicCopies).toContainEqual({
      path: adminPath,
      memberPath: opaqueIcon,
      sha256: opaqueSha,
      bytes: 10616,
    });
  });
});
