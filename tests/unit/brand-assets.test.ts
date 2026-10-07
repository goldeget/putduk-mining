import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { SemiconductorTowerScene } from "@/components/brand/semiconductor-tower-scene";

const themeState = vi.hoisted(() => ({ value: "dark" as "light" | "dark" }));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => themeState.value,
}));

const towerPaths = new Set(
  [640, 960, 1280, 1536].flatMap((width) =>
    ["avif", "webp"].map(
      (format) =>
        `/brand/scenes/semiconductor-tower/semiconductor-tower-${width}-v1.${format}`,
    ),
  ),
);

const waferLightPaths = new Set(
  [640, 960, 1280, 1536].flatMap((width) =>
    ["avif", "webp"].map(
      (format) =>
        `/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-${width}-v1.${format}`,
    ),
  ),
);

const goldPaths = new Set(
  [320, 640, 960, 1536].flatMap((width) =>
    ["avif", "webp"].map(
      (format) =>
        `/brand/scenes/gold-category/gold-category-${width}-v1.${format}`,
    ),
  ),
);

const desktopTowerPaths = new Set(
  [960, 1280, 1536, 1920].flatMap((width) =>
    ["avif", "webp"].map(
      (format) =>
        `/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-${width}-v1.${format}`,
    ),
  ),
);
const desktopWaferLightPaths = new Set(
  [960, 1280, 1536, 1920].flatMap((width) =>
    ["avif", "webp"].map(
      (format) =>
        `/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-${width}-v1.${format}`,
    ),
  ),
);
const desktopPaths = new Set([...desktopTowerPaths, ...desktopWaferLightPaths]);

const loginProfiles = [
  {
    family: "login-wafer-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1672,
    theme: "dark",
    alt: "짙은 푸른 유리 공장 안에서 원형 웨이퍼와 금빛 수직 광선이 빛나는 세로 로그인 장면",
    sourceMaster:
      "docs/design/generated-masters/login-wafer-dark-2026-10-06/login-wafer-dark-master-v1.png",
    sourceSha256:
      "573ec7a687b170af257e52ba5f5806bbed4d2f8593b1c349e46547c5d77a4b41",
    assetVersion: "2026.10.06-login-wafer-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 Login reconstruction for a02-m00001: portrait navy glass factory, circular wafer and vertical gold beam; complete 941x1672 composition, responsive encoding only, no crop, recoloring or upscale; Login artwork only, no raster UI, product mapping or economic approval.",
  },
  {
    family: "login-semiconductor-dark",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    theme: "dark",
    alt: "짙은 푸른 반도체 공장 안에서 메모리 타워와 로봇 팔이 빛나고 오른쪽이 비워진 로그인 장면",
    sourceMaster:
      "docs/design/generated-masters/login-semiconductor-dark-2026-10-06/login-semiconductor-dark-master-v1.png",
    sourceSha256:
      "319553645fbb289fcd8f366a7280c3b5744fb898463023c04c78e7ed78c6ebde",
    assetVersion: "2026.10.06-login-semiconductor-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 Login reconstruction for a02-m00015: wide navy factory, semiconductor tower, robots, circular wafer and clear right form space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Login artwork only, no raster UI, product mapping or economic approval.",
  },
  {
    family: "login-semiconductor-light",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    theme: "light",
    alt: "밝은 유리 반도체 공장 안에서 메모리 타워와 로봇 팔이 빛나고 오른쪽이 비워진 로그인 장면",
    sourceMaster:
      "docs/design/generated-masters/login-semiconductor-light-2026-10-06/login-semiconductor-light-master-v1.png",
    sourceSha256:
      "34faa37064e52ea0635bdc57da6addeebff0d3fbdc75873056684fc8f3c3eb1f",
    assetVersion: "2026.10.06-login-semiconductor-light-v1",
    reviewScope:
      "User-delegated 2026-10-06 Login reconstruction for a02-m00031: wide white glass factory, semiconductor tower, robots, circular wafer and clear right form space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Login artwork only, no raster UI, product mapping or economic approval. Mobile Light reuse is responsive adaptation; no supplied Mobile Light reference acceptance.",
  },
] as const;
const loginPaths = new Set<string>(
  loginProfiles.flatMap(({ family, widths }) =>
    widths.flatMap((width) =>
      ["avif", "webp"].map(
        (format) => `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
      ),
    ),
  ),
);

const giftPaths = new Set(
  [480, 960, 1280, 1920].flatMap((width) =>
    ["avif", "webp"].map(
      (format) =>
        `/brand/scenes/home-event-gift/home-event-gift-${width}-v1.${format}`,
    ),
  ),
);
const giftProvenance = {
  sourceMaster:
    "docs/design/generated-masters/home-event-gift-2026-10-06/home-event-gift-master-v1.png",
  sourceSha256:
    "d75203b5a1413c915f5b3e75176bb15ee2f4a27848c6fa247e79a8268bb2ae48",
  assetVersion: "2026.10.06-home-event-gift-v1",
  reviewScope:
    "User-delegated 2026-10-06 HOME event banner reconstruction from a02-m00017/a02-m00005: three gold gift boxes clustered at the right with left navy negative space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; HOME artwork only, no UI copy, numbers, returns, actual rewards, product mapping or economic approval.",
  theme: "dark",
  alt: "짙은 푸른 공간의 오른쪽에 금빛 리본을 두른 세 선물 상자가 빛나는 홈 이벤트 장면",
} as const;

const miningProfiles = [
  {
    family: "mining-semiconductor-mobile-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1671,
    sourceMaster:
      "docs/design/generated-masters/mining-semiconductor-mobile-dark-2026-10-06/mining-semiconductor-mobile-dark-master-v1.png",
    sourceSha256:
      "00bf415bfdf3fd8c79e05d36ba47e1e0a3617414d6d824f140923dd15a1f2d41",
    assetVersion: "2026.10.06-mining-semiconductor-mobile-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 exact Mining a02-m00004 (duplicate a02-m00011) reconstruction: portrait navy semiconductor factory, memory tower, circular wafer, two robot arms and gold beam; complete 941x1671 composition, responsive encoding only, no crop, recoloring or upscale; Mining artwork only, no raster UI or copy, product mapping, actual holdings, mining yield, catalog publication or economic approval.",
    theme: "dark",
    alt: "짙은 푸른 반도체 공장 안에서 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 채굴 장면",
  },
  {
    family: "mining-semiconductor-desktop-dark",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    sourceMaster:
      "docs/design/generated-masters/mining-semiconductor-desktop-dark-2026-10-06/mining-semiconductor-desktop-dark-master-v1.png",
    sourceSha256:
      "e907aade8cf2879131125bdce5743a439c0399c2526102af0f0603b16e8ffeac",
    assetVersion: "2026.10.06-mining-semiconductor-desktop-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 exact Mining a02-m00018 reconstruction: wide navy semiconductor factory, memory tower, circular wafer and two robot arms at the left, clear right space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Mining artwork only, no raster UI or copy, product mapping, actual holdings, mining yield, catalog publication or economic approval.",
    theme: "dark",
    alt: "짙은 푸른 반도체 공장 안에서 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나고 오른쪽이 비워진 넓은 채굴 장면",
  },
  {
    family: "mining-semiconductor-desktop-light",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    sourceMaster:
      "docs/design/generated-masters/mining-semiconductor-desktop-light-2026-10-06/mining-semiconductor-desktop-light-master-v1.png",
    sourceSha256:
      "ed3a5b8276cc839199bb4cfe638bb030af0b4cfa5bb29a236bc9e607e45504cd",
    assetVersion: "2026.10.06-mining-semiconductor-desktop-light-v1",
    reviewScope:
      "User-delegated 2026-10-06 exact Mining a02-m00032 reconstruction: wide white semiconductor factory, memory tower, circular wafer and two robot arms at the left, clear right space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Mining artwork only, no raster UI or copy, product mapping, actual holdings, mining yield, catalog publication or economic approval. Mobile Light reuse is responsive adaptation; no supplied Mobile Light reference acceptance.",
    theme: "light",
    alt: "밝은 유리 반도체 공장 안에서 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나고 오른쪽이 비워진 넓은 채굴 장면",
  },
] as const;
const miningPaths = new Set<string>(
  miningProfiles.flatMap(({ family, widths }) =>
    widths.flatMap((width) =>
      ["avif", "webp"].map(
        (format) => `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
      ),
    ),
  ),
);

const walletProfiles = [
  {
    family: "wallet-vault-mobile-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1672,
    sourceMaster:
      "docs/design/generated-masters/wallet-vault-mobile-dark-2026-10-06/wallet-vault-mobile-dark-master-v1.png",
    sourceSha256:
      "5469007a82de9d470e53cc5ff5d1d3ebf42b94c6da3c6f49ba1a03ad3c44a223",
    assetVersion: "2026.10.06-wallet-vault-mobile-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 Wallet a02-m00003 (duplicate a02-m00010) scene reconstruction: portrait navy semiconductor factory, gold-outlined vault door at the right and clear left space; complete 941x1672 composition, responsive encoding only, no crop, recoloring or upscale; Wallet artwork only, no raster UI or copy, actual balance, holdings, security assurance, yield, product mapping, catalog publication or economic approval.",
    theme: "dark",
    alt: "짙은 푸른 반도체 공장 오른쪽에 금빛 테두리의 금고 문이 빛나는 세로 지갑 장면",
  },
  {
    family: "wallet-vault-desktop-dark",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    sourceMaster:
      "docs/design/generated-masters/wallet-vault-desktop-dark-2026-10-06/wallet-vault-desktop-dark-master-v1.png",
    sourceSha256:
      "9b8b5fda9f6683f513642827bf0e4d59c7d897337a41cd7a202e179afc54a3b6",
    assetVersion: "2026.10.06-wallet-vault-desktop-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 Wallet a02-m00020 scene reconstruction: wide navy semiconductor factory, round gold vault door at the right and clear left space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Wallet artwork only, no raster UI or copy, actual balance, holdings, security assurance, yield, product mapping, catalog publication or economic approval.",
    theme: "dark",
    alt: "짙은 푸른 반도체 공장 오른쪽에 둥근 금고 문이 빛나고 왼쪽이 비워진 넓은 지갑 장면",
  },
  {
    family: "wallet-chip-mobile-light",
    widths: [480, 640, 940],
    nativeWidth: 940,
    nativeHeight: 1672,
    sourceMaster:
      "docs/design/generated-masters/wallet-chip-mobile-light-2026-10-06/wallet-chip-mobile-light-master-v1.png",
    sourceSha256:
      "697245fe23c40a2bc5acc1d1dd942be5cfdf05e17772aada8de2ec2c180fe268",
    assetVersion: "2026.10.06-wallet-chip-mobile-light-v1",
    reviewScope:
      "User-delegated 2026-10-06 Wallet a02-m00028 scene reconstruction: white and ice-blue glass semiconductor factory, gold chip and circuit rails at the right, clear left space; complete 940x1672 composition, responsive encoding only, no crop, recoloring or upscale; Wallet artwork only, no raster UI or copy, actual balance, holdings, security assurance, yield, product mapping, catalog publication or economic approval.",
    theme: "light",
    alt: "밝은 유리 반도체 공장 오른쪽에 금빛 반도체 칩과 회로가 빛나는 세로 지갑 장면",
  },
  {
    family: "wallet-chip-desktop-light",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    sourceMaster:
      "docs/design/generated-masters/wallet-chip-desktop-light-2026-10-06/wallet-chip-desktop-light-master-v1.png",
    sourceSha256:
      "9d644708c0045360c6e8e780b9d1d72f378dbd1c11a57dd45f9672d347b922a5",
    assetVersion: "2026.10.06-wallet-chip-desktop-light-v1",
    reviewScope:
      "User-delegated 2026-10-06 Wallet Responsive inference from a02-m00028; no supplied desktop Light wallet reference scene reconstruction: white and ice-blue glass semiconductor factory, gold chip and circuit rails at the right, clear left space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Wallet artwork only, no raster UI or copy, actual balance, holdings, security assurance, yield, product mapping, catalog publication or economic approval. Responsive adaptation only; no supplied desktop Light wallet reference acceptance.",
    theme: "light",
    alt: "밝은 유리 반도체 공장 오른쪽에 금빛 반도체 칩과 회로가 빛나고 왼쪽이 비워진 넓은 지갑 장면",
  },
] as const;
const walletPaths = new Set<string>(
  walletProfiles.flatMap(({ family, widths }) =>
    widths.flatMap((width) =>
      ["avif", "webp"].map(
        (format) => `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
      ),
    ),
  ),
);

const signupProfiles = [
  {
    family: "signup-semiconductor-mobile-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1672,
    sourceMaster:
      "docs/design/generated-masters/signup-semiconductor-mobile-dark-2026-10-06/signup-semiconductor-mobile-dark-master-v1.png",
    sourceSha256:
      "15a778ee8ee97a3a3a3199d97ed7c9de0394fc8874a1540cd934fc1138505ffe",
    assetVersion: "2026.10.06-signup-semiconductor-mobile-dark-v1",
    reviewScope:
      "User-delegated 2026-10-06 Signup a02-m00002 (duplicate a02-m00009) scene reconstruction: portrait navy semiconductor factory, six-layer gold memory tower above a circular wafer and two robot arms, dark lower negative space; complete 941x1672 composition, responsive encoding only, no crop, recoloring or upscale; Signup decoration only, no raster UI or copy, financial values, holdings, mining yield, catalog publication, economic approval or whole-screen acceptance. No supplied Signup Light reference acceptance.",
    theme: "dark",
    alt: "짙은 푸른 반도체 공장에서 금빛 메모리 타워와 원형 웨이퍼, 두 로봇 팔이 빛나는 세로 가입 장면",
  },
] as const;
const signupPaths = new Set<string>(
  signupProfiles.flatMap(({ family, widths }) =>
    widths.flatMap((width) =>
      ["avif", "webp"].map(
        (format) => `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
      ),
    ),
  ),
);

const productsProfiles = [
  {
    family: "products-semiconductor-hero",
    widths: [480, 640, 960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    sourceMaster:
      "docs/design/generated-masters/products-semiconductor-hero-2026-10-06/products-semiconductor-hero-master-v1.png",
    sourceSha256:
      "78867105c2a71d950883669727e17d15389f0eeb67ab0403242b72a5fe6ac18f",
    assetVersion: "2026.10.06-products-semiconductor-hero-v1",
    reviewScope:
      "User-delegated 2026-10-06 Products a02-m00006 hero scene reconstruction: wide navy circuit board, large unlettered black semiconductor chip with gold pins at the right and clear blue-circuit left space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Products hero decoration only, no raster UI or copy, financial values, holdings, price, yield, catalog publication, economic approval or whole-screen acceptance. Dark original direction; Light reuse is explicit responsive inference, not a supplied Light reference or independent Light artwork acceptance.",
    theme: "dark",
    alt: "짙은 푸른 회로판 오른쪽에 금빛 핀으로 둘러싸인 검은 반도체 칩이 놓이고 왼쪽이 비워진 넓은 상품 장면",
  },
] as const;
const productsPaths = new Set<string>(
  productsProfiles.flatMap(({ family, widths }) =>
    widths.flatMap((width) =>
      ["avif", "webp"].map(
        (format) => `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
      ),
    ),
  ),
);

const aiProfiles = [
  {
    family: "ai-partner-hero",
    widths: [480, 640, 960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    sourceMaster:
      "docs/design/generated-masters/ai-partner-hero-2026-10-06/ai-partner-hero-master-v1.png",
    sourceSha256:
      "00fd1510f896442af76a794ff0c0b390c401e7023ab145a041d7165a1f32951b",
    assetVersion: "2026.10.06-ai-partner-hero-v1",
    reviewScope:
      "User-delegated 2026-10-06 AI partner a02-m00022 hero scene reconstruction: wide navy industrial semiconductor factory and gold-lit towers, black and gold robot at the right with an open hand, clear dark left space for native HTML; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; AI page decoration only, no raster UI or copy, fake metrics, financial values, holdings, yield, autonomous command authority, catalog publication, economic approval or whole-screen acceptance. Dark original direction; Light reuse is explicit responsive inference, not a supplied Light reference or independent Light artwork acceptance.",
    theme: "dark",
    alt: "금빛으로 빛나는 짙은 반도체 공장 앞 오른쪽에 검은 로봇이 손을 펼치고 왼쪽이 비워진 넓은 AI 장면",
  },
] as const;
const aiPaths = new Set<string>(
  aiProfiles.flatMap(({ family, widths }) =>
    widths.flatMap((width) =>
      ["avif", "webp"].map(
        (format) => `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
      ),
    ),
  ),
);

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

// Only the independently verified32 new NVDA paths are absent from historical snapshots.
const nvdaPaths = new Set(
  (["dark", "light"] as const).flatMap((theme) =>
    (["portrait", "landscape"] as const).flatMap((orientation) =>
      (orientation === "portrait"
        ? [480, 640, 960, 1024]
        : [640, 960, 1280, 1672]
      ).flatMap((width) =>
        ["avif", "webp"].map(
          (format) =>
            `/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-${theme}-${orientation}-${width}.${format}`,
        ),
      ),
    ),
  ),
);

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
    expect(manifest.assetVersion).toBe("2026.10.06-v18");
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
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter((asset) => !asset.path.startsWith("/brand/scenes/"));
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
    expect(manifest.assets).toHaveLength(294);
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
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter(
        (asset) =>
          !asset.path.startsWith(prefix) &&
          !towerPaths.has(asset.path) &&
          !waferLightPaths.has(asset.path) &&
          !goldPaths.has(asset.path) &&
          !desktopPaths.has(asset.path) &&
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
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter(
        (asset) =>
          !approvedPaths.has(asset.path) &&
          !towerPaths.has(asset.path) &&
          !waferLightPaths.has(asset.path) &&
          !goldPaths.has(asset.path) &&
          !desktopPaths.has(asset.path),
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

  it("adds only the eight exact HOME tower derivatives while preserving every prior record and byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter(
        (asset) =>
          !towerPaths.has(asset.path) &&
          !waferLightPaths.has(asset.path) &&
          !goldPaths.has(asset.path) &&
          !desktopPaths.has(asset.path),
      );
    expect(prior).toHaveLength(112);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("8d52743dc225ab9b19ce812520fde3ce99d55025f618e8055e09c1010c446852");
    const pack = manifest.assets.filter((asset) => towerPaths.has(asset.path));
    expect(pack).toHaveLength(8);
    expect(new Set(pack.map((asset) => asset.path))).toEqual(towerPaths);
    const sourceMaster =
      "docs/design/generated-masters/semiconductor-tower-2026-10-06/semiconductor-tower-master-v1.png";
    const sourceSha256 =
      "b7efda2f71a34d07460a7d50e3650bfafc9028e4b4f3e7e10a96000a9b07c9ee";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(master.readUInt32BE(16)).toBe(1536);
    expect(master.readUInt32BE(20)).toBe(1024);
    expect(master[25]).toBe(2);
    for (const asset of [...prior, ...pack]) {
      const contents = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(contents.length).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
    for (const asset of pack) {
      const width = Number(/-(\d+)-v1\./.exec(asset.path)?.[1]);
      expect(asset).toMatchObject({
        sourceMaster,
        sourceSha256,
        assetVersion: "2026.10.06-semiconductor-tower-v1",
        width,
        height: Math.round((1024 * width) / 1536),
        mimeType: `image/${asset.path.split(".").at(-1)}`,
        theme: "dark",
      });
      expect(asset.reviewScope).toContain("exact MOBILE HOME a02-m00005");
      expect(asset.reviewScope).toContain("HOME hero presentation only");
    }
  });

  it("rejects foreign tower metadata and corrupted bytes through the actual disk verification contract", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/semiconductor-tower/semiconductor-tower-640-v1.avif",
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
      const variants=[asset,{...asset,sourceSha256:'0'.repeat(64)},
        {...asset,sourceMaster:'docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png'},
        {...asset,assetVersion:'2026.10.06-v6'},
        {...asset,width:641},{...asset,height:640},{...asset,theme:'light'},
        {...asset,mimeType:'image/png'},
        {...asset,path:'/brand/scenes/semiconductor-tower/semiconductor-tower-640-v1.png'},
        {...asset,path:'/brand/scenes/semiconductor-tower/semiconductor-tower-1539-v1.avif'},
        {...asset,reviewScope:'All screens and economic publication'},
        {...asset,productionEconomicRules:'forbidden'}];
      const contents=await readFile('./public'+asset.path);
      const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
      console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),
        provenance:variants.map(aiHelpMetadataFailures),
        integrity:[runtimeAssetIntegrityFailures(asset,contents),
          runtimeAssetIntegrityFailures({...asset,sha256:'0'.repeat(64)},contents),
          runtimeAssetIntegrityFailures({...asset,bytes:asset.bytes+1},contents),
          runtimeAssetIntegrityFailures(asset,corrupted)]}));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
      metadata: string[][];
      provenance: string[][];
      integrity: string[][];
    };
    expect(result.metadata[0]).toEqual([]);
    expect(result.metadata.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
    expect(result.provenance[0]).toEqual([]);
    // Only the exact eight tower paths may be exempted from foreign provenance.
    expect(result.provenance[8]!.length).toBeGreaterThan(0);
    expect(result.provenance[9]!.length).toBeGreaterThan(0);
    expect(result.integrity[0]).toEqual([]);
    expect(result.integrity.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
  });

  it("adds only the eight exact Light HOME wafer derivatives while preserving every prior record and byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter(
        (asset) =>
          !waferLightPaths.has(asset.path) &&
          !goldPaths.has(asset.path) &&
          !desktopPaths.has(asset.path),
      );
    expect(prior).toHaveLength(120);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("cd3bf1bea345ba0584caeaba7dc04f8a449333631037bd2b4ce25561daf644d0");
    const pack = manifest.assets.filter((asset) =>
      waferLightPaths.has(asset.path),
    );
    expect(pack).toHaveLength(8);
    expect(new Set(pack.map((asset) => asset.path))).toEqual(waferLightPaths);
    const sourceMaster =
      "docs/design/generated-masters/semiconductor-wafer-light-2026-10-06/semiconductor-wafer-light-master-v1.png";
    const sourceSha256 =
      "89651e191ac5031730531856cc3a4fe7f5b5d557e4c27bd3ec225fcde3f24848";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(master.readUInt32BE(16)).toBe(1536);
    expect(master.readUInt32BE(20)).toBe(1024);
    expect(master[25]).toBe(2);
    for (const asset of [...prior, ...pack]) {
      const contents = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(contents.length).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
    for (const asset of pack) {
      const width = Number(/-(\d+)-v1\./.exec(asset.path)?.[1]);
      expect(asset).toMatchObject({
        sourceMaster,
        sourceSha256,
        assetVersion: "2026.10.06-semiconductor-wafer-light-v1",
        width,
        height: Math.round((1024 * width) / 1536),
        mimeType: `image/${asset.path.split(".").at(-1)}`,
        theme: "light",
      });
      expect(asset.reviewScope).toContain("exact Light MOBILE HOME a02-m00027");
      expect(asset.reviewScope).toContain("HOME hero presentation only");
    }
  });

  it("rejects foreign Light HOME wafer metadata and corrupted bytes through the actual disk verification contract", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-640-v1.avif",
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
      const variants=[asset,{...asset,sourceSha256:'0'.repeat(64)},
        {...asset,sourceMaster:'docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png'},
        {...asset,assetVersion:'2026.10.06-v6'},
        {...asset,width:641},{...asset,height:640},{...asset,theme:'dark'},
        {...asset,mimeType:'image/png'},
        {...asset,path:'/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-640-v1.png'},
        {...asset,path:'/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-1539-v1.avif'},
        {...asset,reviewScope:'All screens and economic publication'},
        {...asset,productionEconomicRules:'forbidden'}];
      const contents=await readFile('./public'+asset.path);
      const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
      console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),
        provenance:variants.map(aiHelpMetadataFailures),
        integrity:[runtimeAssetIntegrityFailures(asset,contents),
          runtimeAssetIntegrityFailures({...asset,sha256:'0'.repeat(64)},contents),
          runtimeAssetIntegrityFailures({...asset,bytes:asset.bytes+1},contents),
          runtimeAssetIntegrityFailures(asset,corrupted)]}));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
      metadata: string[][];
      provenance: string[][];
      integrity: string[][];
    };
    expect(result.metadata[0]).toEqual([]);
    expect(result.metadata.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
    expect(result.provenance[0]).toEqual([]);
    // Only the exact eight Light HOME wafer paths may be exempted from foreign provenance.
    expect(result.provenance[8]!.length).toBeGreaterThan(0);
    expect(result.provenance[9]!.length).toBeGreaterThan(0);
    expect(result.integrity[0]).toEqual([]);
    expect(result.integrity.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
  });

  it("adds only the eight neutral GOLD category derivatives while preserving every prior record and byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter(
        (asset) => !goldPaths.has(asset.path) && !desktopPaths.has(asset.path),
      );
    expect(prior).toHaveLength(128);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("00b8caf188b9481d87204dea866dabd41ef2b0fbf86fb71d87b679898dff6d52");
    const pack = manifest.assets.filter((asset) => goldPaths.has(asset.path));
    expect(pack).toHaveLength(8);
    expect(new Set(pack.map((asset) => asset.path))).toEqual(goldPaths);
    const sourceMaster =
      "docs/design/generated-masters/gold-category-2026-10-06/gold-category-master-v1.png";
    const sourceSha256 =
      "b22dced3d82446e8a946f49f29bbd5d62fc57e2b465464d7c260755d0600cf7e";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(master.readUInt32BE(16)).toBe(1536);
    expect(master.readUInt32BE(20)).toBe(1024);
    expect(master[25]).toBe(2);
    for (const asset of [...prior, ...pack]) {
      const contents = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(contents.length).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
    for (const asset of pack) {
      const width = Number(/-(\d+)-v1\./.exec(asset.path)?.[1]);
      expect(asset).toMatchObject({
        sourceMaster,
        sourceSha256,
        assetVersion: "2026.10.06-gold-category-v1",
        width,
        height: Math.round((1024 * width) / 1536),
        mimeType: `image/${asset.path.split(".").at(-1)}`,
        theme: "dark",
      });
      expect(asset.reviewScope).toContain(
        "neutral GOLD category presentation artwork",
      );
      expect(asset.reviewScope).toContain(
        "GOLD artwork only, no SILVER mapping",
      );
    }
  });

  it("rejects foreign GOLD category metadata and corrupted bytes through the actual disk verification contract", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path === "/brand/scenes/gold-category/gold-category-640-v1.avif",
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
      const variants=[asset,{...asset,sourceSha256:'0'.repeat(64)},
        {...asset,sourceMaster:'docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png'},
        {...asset,assetVersion:'2026.10.06-v6'},
        {...asset,width:641},{...asset,height:640},{...asset,theme:'light'},
        {...asset,mimeType:'image/png'},
        {...asset,path:'/brand/scenes/gold-category/gold-category-640-v1.png'},
        {...asset,path:'/brand/scenes/gold-category/gold-category-1539-v1.avif'},
        {...asset,path:'/brand/scenes/silver-category/silver-category-640-v1.avif'},
        {...asset,reviewScope:'Actual GOLD holding and operating catalog approval'},
        {...asset,actualHolding:'confirmed'},{...asset,yield:99},
        {...asset,productionEconomicRules:'forbidden'}];
      const contents=await readFile('./public'+asset.path);
      const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
      console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),
        provenance:variants.map(aiHelpMetadataFailures),
        integrity:[runtimeAssetIntegrityFailures(asset,contents),
          runtimeAssetIntegrityFailures({...asset,sha256:'0'.repeat(64)},contents),
          runtimeAssetIntegrityFailures({...asset,bytes:asset.bytes+1},contents),
          runtimeAssetIntegrityFailures(asset,corrupted)]}));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
      metadata: string[][];
      provenance: string[][];
      integrity: string[][];
    };
    expect(result.metadata[0]).toEqual([]);
    expect(result.metadata.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
    expect(result.provenance[0]).toEqual([]);
    // Only the exact eight GOLD category paths may be exempted from foreign provenance.
    expect(result.provenance[8]!.length).toBeGreaterThan(0);
    expect(result.provenance[9]!.length).toBeGreaterThan(0);
    expect(result.integrity[0]).toEqual([]);
    expect(result.integrity.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
  });

  it("adds only the eight semiconductor-tower-desktop derivatives while preserving every prior record and byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter((asset) => !desktopPaths.has(asset.path));
    expect(prior).toHaveLength(136);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("79f0a6cdd82e6ea098c087c5f489faf6d937f078c6fd8bcac844cc8ed461665c");
    const pack = manifest.assets.filter((asset) =>
      desktopTowerPaths.has(asset.path),
    );
    expect(pack).toHaveLength(8);
    expect(new Set(pack.map((asset) => asset.path))).toEqual(desktopTowerPaths);
    const sourceMaster =
      "docs/design/generated-masters/semiconductor-tower-desktop-2026-10-06/semiconductor-tower-desktop-master-v1.png";
    const sourceSha256 =
      "77fa85077eef2f0534d16a4900e4ada9ccc1fdcbb28c959775ca0ebcaf4b82f4";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(master.readUInt32BE(16)).toBe(1983);
    expect(master.readUInt32BE(20)).toBe(793);
    expect(master[25]).toBe(2);
    for (const asset of [...prior, ...pack]) {
      const contents = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(contents.length).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
    for (const asset of pack) {
      const width = Number(/-(\d+)-v1\./.exec(asset.path)?.[1]);
      expect(asset).toMatchObject({
        sourceMaster,
        sourceSha256,
        assetVersion: "2026.10.06-semiconductor-tower-desktop-v1",
        width,
        height: Math.round((793 * width) / 1983),
        mimeType: `image/${asset.path.split(".").at(-1)}`,
        theme: "dark",
      });
      expect(asset.reviewScope).toContain(
        "exact desktop HOME a02-m00017 reconstruction",
      );
      expect(asset.reviewScope).toContain("desktop HOME artwork only");
    }
  });

  it("rejects foreign semiconductor-tower-desktop metadata and corrupted bytes through the actual disk verification contract", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-960-v1.avif",
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
      const variants=[asset,{...asset,sourceSha256:'0'.repeat(64)},
        {...asset,sourceMaster:'docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png'},
        {...asset,assetVersion:'2026.10.06-v6'},
        {...asset,width:961},{...asset,height:640},{...asset,theme:'light'},
        {...asset,mimeType:'image/png'},
        {...asset,path:'/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-960-v1.png'},
        {...asset,path:'/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-1539-v1.avif'},
        {...asset,path:'/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-640-v1.avif'},
        {...asset,reviewScope:'Actual GOLD holding and operating catalog approval'},
        {...asset,actualHolding:'confirmed'},{...asset,yield:99},
        {...asset,productionEconomicRules:'forbidden'}];
      const contents=await readFile('./public'+asset.path);
      const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
      console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),
        provenance:variants.map(aiHelpMetadataFailures),
        integrity:[runtimeAssetIntegrityFailures(asset,contents),
          runtimeAssetIntegrityFailures({...asset,sha256:'0'.repeat(64)},contents),
          runtimeAssetIntegrityFailures({...asset,bytes:asset.bytes+1},contents),
          runtimeAssetIntegrityFailures(asset,corrupted)]}));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
      metadata: string[][];
      provenance: string[][];
      integrity: string[][];
    };
    expect(result.metadata[0]).toEqual([]);
    expect(result.metadata.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
    expect(result.provenance[0]).toEqual([]);
    // Only the exact eight desktop scene paths may be exempted from foreign provenance.
    expect(result.provenance[8]!.length).toBeGreaterThan(0);
    expect(result.provenance[9]!.length).toBeGreaterThan(0);
    expect(result.integrity[0]).toEqual([]);
    expect(result.integrity.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
  });

  it("adds only the eight semiconductor-wafer-light-desktop derivatives while preserving every prior record and byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      )
      .filter((asset) => !desktopWaferLightPaths.has(asset.path));
    expect(prior).toHaveLength(144);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("276dd5899d05f9cbb8dedb50edabbe9b600d214eaa18bec3ab1a6082c11da7fb");
    const pack = manifest.assets.filter((asset) =>
      desktopWaferLightPaths.has(asset.path),
    );
    expect(pack).toHaveLength(8);
    expect(new Set(pack.map((asset) => asset.path))).toEqual(
      desktopWaferLightPaths,
    );
    const sourceMaster =
      "docs/design/generated-masters/semiconductor-wafer-light-desktop-2026-10-06/semiconductor-wafer-light-desktop-master-v1.png";
    const sourceSha256 =
      "fb2ef6a74cba862a69229d334e84ad27e1e7dd4709702967f76d6c4242c08548";
    const master = await readFile(path.join(process.cwd(), sourceMaster));
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      sourceSha256,
    );
    expect(master.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(master.readUInt32BE(16)).toBe(1983);
    expect(master.readUInt32BE(20)).toBe(793);
    expect(master[25]).toBe(2);
    for (const asset of [...prior, ...pack]) {
      const contents = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(contents.length).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
    for (const asset of pack) {
      const width = Number(/-(\d+)-v1\./.exec(asset.path)?.[1]);
      expect(asset).toMatchObject({
        sourceMaster,
        sourceSha256,
        assetVersion: "2026.10.06-semiconductor-wafer-light-desktop-v1",
        width,
        height: Math.round((793 * width) / 1983),
        mimeType: `image/${asset.path.split(".").at(-1)}`,
        theme: "light",
      });
      expect(asset.reviewScope).toContain(
        "Light desktop HOME responsive inference",
      );
      expect(asset.reviewScope).toContain(
        "no supplied Light desktop reference acceptance",
      );
    }
  });

  it("rejects foreign semiconductor-wafer-light-desktop metadata and corrupted bytes through the actual disk verification contract", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-960-v1.avif",
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
      const variants=[asset,{...asset,sourceSha256:'0'.repeat(64)},
        {...asset,sourceMaster:'docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png'},
        {...asset,assetVersion:'2026.10.06-v6'},
        {...asset,width:961},{...asset,height:640},{...asset,theme:'dark'},
        {...asset,mimeType:'image/png'},
        {...asset,path:'/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-960-v1.png'},
        {...asset,path:'/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-1539-v1.avif'},
        {...asset,path:'/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-640-v1.avif'},
        {...asset,reviewScope:'Actual GOLD holding and operating catalog approval'},
        {...asset,actualHolding:'confirmed'},{...asset,yield:99},
        {...asset,productionEconomicRules:'forbidden'}];
      const contents=await readFile('./public'+asset.path);
      const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
      console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),
        provenance:variants.map(aiHelpMetadataFailures),
        integrity:[runtimeAssetIntegrityFailures(asset,contents),
          runtimeAssetIntegrityFailures({...asset,sha256:'0'.repeat(64)},contents),
          runtimeAssetIntegrityFailures({...asset,bytes:asset.bytes+1},contents),
          runtimeAssetIntegrityFailures(asset,corrupted)]}));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
      metadata: string[][];
      provenance: string[][];
      integrity: string[][];
    };
    expect(result.metadata[0]).toEqual([]);
    expect(result.metadata.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
    expect(result.provenance[0]).toEqual([]);
    // Only the exact eight desktop scene paths may be exempted from foreign provenance.
    expect(result.provenance[8]!.length).toBeGreaterThan(0);
    expect(result.provenance[9]!.length).toBeGreaterThan(0);
    expect(result.integrity[0]).toEqual([]);
    expect(result.integrity.slice(1).every((errors) => errors.length > 0)).toBe(
      true,
    );
  });

  it("renders exact dark tower and light HOME wafer sources with consistent theme attributes", () => {
    for (const theme of ["dark", "light"] as const) {
      themeState.value = theme;
      const html = renderToStaticMarkup(
        createElement(SemiconductorTowerScene, {
          sizes: "(min-width: 980px) 1100px, 100vw",
          className: "home-art",
          priority: true,
        }),
      );
      const family =
        theme === "dark" ? "semiconductor-tower" : "semiconductor-wafer-light";
      expect(html).toContain(`data-scene-theme="${theme}"`);
      expect(html).toContain(`data-art-theme="${theme}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("home-art");
      expect(html).toContain('loading="eager"');
      expect(html).toContain('fetchPriority="high"');
      expect(html).toContain('alt=""');
      expect(html).not.toContain("semiconductor-memory-light-");
      expect(html).toContain('width="1536" height="1024"');
      expect(html).toContain('sizes="(min-width: 980px) 1100px, 100vw"');
      for (const width of [640, 960, 1280, 1536])
        for (const format of ["avif", "webp"])
          expect(html).toContain(
            `/brand/scenes/${family}/${family}-${width}-v1.${format} ${width}w`,
          );
    }
    themeState.value = "dark";
    const deferred = renderToStaticMarkup(
      createElement(SemiconductorTowerScene),
    );
    expect(deferred).toContain('loading="lazy"');
    expect(deferred).not.toContain('fetchPriority="high"');
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

  it("preserves the exact 152-entry pre-Login snapshot and every existing runtime byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter(
        (asset) => !loginPaths.has(asset.path) && !giftPaths.has(asset.path),
      );
    expect(prior).toHaveLength(152);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("346f9690ab9d1902dd4902d29fe5dd54e0531b3b3466bb73ccc58834ef28ddcf");
    for (const asset of prior) {
      const contents = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(contents.length).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  for (const profile of loginProfiles) {
    it(`binds exact full-frame ${profile.family} derivatives to the reviewed master`, async () => {
      const manifest = await loadManifest();
      const approvedPaths = new Set(
        profile.widths.flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/${profile.family}/${profile.family}-${width}-v1.${format}`,
          ),
        ),
      );
      const assets = manifest.assets.filter((asset) =>
        approvedPaths.has(asset.path),
      );
      expect(assets).toHaveLength(profile.widths.length * 2);
      const master = await readFile(
        path.join(process.cwd(), profile.sourceMaster),
      );
      expect(createHash("sha256").update(master).digest("hex")).toBe(
        profile.sourceSha256,
      );
      expect(master.readUInt32BE(16)).toBe(profile.nativeWidth);
      expect(master.readUInt32BE(20)).toBe(profile.nativeHeight);
      expect(master[25]).toBe(2);
      for (const asset of assets) {
        const width = Number(
          asset.path.split(`${profile.family}-`).at(-1)!.split("-v1.")[0],
        );
        expect(width).toBeLessThanOrEqual(profile.nativeWidth);
        expect(asset).toMatchObject({
          width,
          height: Math.round(
            (profile.nativeHeight * width) / profile.nativeWidth,
          ),
          mimeType: `image/${asset.path.split(".").at(-1)}`,
          theme: profile.theme,
          alt: profile.alt,
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          assetVersion: profile.assetVersion,
          reviewScope: profile.reviewScope,
        });
        const contents = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(contents.length).toBe(asset.bytes);
        expect(createHash("sha256").update(contents).digest("hex")).toBe(
          asset.sha256,
        );
      }
      if (profile.family === "login-wafer-dark")
        expect(
          [...approvedPaths].some((value) => value.includes("-960-")),
        ).toBe(false);
    });
    it(`rejects foreign ${profile.family} provenance, metadata and corrupted runtime bytes`, async () => {
      const manifest = await loadManifest();
      const asset = manifest.assets.find(
        (entry) =>
          entry.path ===
          `/brand/scenes/${profile.family}/${profile.family}-${profile.widths[0]}-v1.avif`,
      )!;
      const variants = [
        asset,
        { ...asset, sourceSha256: "0".repeat(64) },
        { ...asset, sourceMaster: "docs/design/generated-masters/foreign.png" },
        { ...asset, width: asset.width! + 1 },
        { ...asset, width: String(asset.width) },
        { ...asset, height: 1 },
        { ...asset, height: String(asset.height) },
        { ...asset, theme: "system" },
        { ...asset, mimeType: "image/png" },
        { ...asset, path: asset.path.replace(".avif", ".png") },
        {
          ...asset,
          path: `/brand/scenes/${profile.family}/${profile.family}-999-v1.avif`,
        },
        { ...asset, assetVersion: "2026.10.06-v17" },
        {
          ...asset,
          reviewScope: "Actual holdings, returns and whole UI acceptance",
        },
        { ...asset, economicRules: { yield: 99 } },
      ];
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import {readFile} from 'node:fs/promises';
        import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
        const variants=${JSON.stringify(variants)};
        const contents=await readFile('./public'+variants[0].path);
        const corrupted=Buffer.from(contents);corrupted[corrupted.length-1]^=1;
        console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),provenance:variants.map(aiHelpMetadataFailures),goodBytes:runtimeAssetIntegrityFailures(variants[0],contents),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupted)}));
      `,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.metadata[0]).toEqual([]);
      expect(result.provenance[0]).toEqual([]);
      expect(
        result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
      ).toBe(true);
      expect(result.goodBytes).toEqual([]);
      expect(result.badBytes.length).toBeGreaterThan(0);
    });
  }

  it("preserves all174 pre-Gift metadata records and actual runtime bytes", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      )
      .filter((asset) => !giftPaths.has(asset.path));
    expect(prior).toHaveLength(174);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("9bd2a7c31fb5aea479b6d67834a01381761b08b2cb2bbced42c6493141b09fc9");
    for (const asset of prior) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  it("binds the exact eight full-frame HOME gift derivatives to the reviewed RGB master", async () => {
    const manifest = await loadManifest();
    const assets = manifest.assets.filter((asset) => giftPaths.has(asset.path));
    expect(assets).toHaveLength(8);
    const master = await readFile(
      path.join(process.cwd(), giftProvenance.sourceMaster),
    );
    expect(createHash("sha256").update(master).digest("hex")).toBe(
      giftProvenance.sourceSha256,
    );
    expect(master.readUInt32BE(16)).toBe(1983);
    expect(master.readUInt32BE(20)).toBe(793);
    expect(master[25]).toBe(2);
    for (const asset of assets) {
      const width = Number(
        asset.path.split("home-event-gift-").at(-1)!.split("-v1.")[0],
      );
      expect(width).toBeLessThanOrEqual(1983);
      expect(asset).toMatchObject({
        ...giftProvenance,
        width,
        height: Math.round((793 * width) / 1983),
        mimeType: `image/${asset.path.split(".").at(-1)}`,
      });
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  it("rejects foreign HOME gift metadata, financial claims, unsupported paths and actual corruption", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(
      (entry) =>
        entry.path ===
        "/brand/scenes/home-event-gift/home-event-gift-480-v1.avif",
    )!;
    const variants = [
      asset,
      { ...asset, sourceSha256: "0".repeat(64) },
      { ...asset, sourceMaster: "docs/design/generated-masters/foreign.png" },
      { ...asset, width: 481 },
      { ...asset, width: "480" },
      { ...asset, height: 1 },
      { ...asset, mimeType: "image/png" },
      { ...asset, theme: "light" },
      { ...asset, path: asset.path.replace(".avif", ".png") },
      {
        ...asset,
        path: "/brand/scenes/home-event-gift/home-event-gift-2048-v1.avif",
      },
      { ...asset, reviewScope: "Actual reward, returns and UI approval" },
      { ...asset, economicRewards: { yield: 99 } },
    ];
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import {readFile} from 'node:fs/promises';
      import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
      const variants=${JSON.stringify(variants)};const bytes=await readFile('./public'+variants[0].path);const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
      console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),goodProvenance:aiHelpMetadataFailures(variants[0]),goodBytes:runtimeAssetIntegrityFailures(variants[0],bytes),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupt)}));
    `,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1)!);
    expect(result.metadata[0]).toEqual([]);
    expect(
      result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
    ).toBe(true);
    expect(result.goodProvenance).toEqual([]);
    expect(result.goodBytes).toEqual([]);
    expect(result.badBytes.length).toBeGreaterThan(0);
  });

  it("preserves the exact182 pre-Mining records and every runtime byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path) &&
          !miningPaths.has(asset.path),
      );
    expect(prior).toHaveLength(182);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("6ded1c20e9f8852d0c1827795f903e0c93cffb7fe4d376bc500fde46690a0bf9");
    for (const asset of prior) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  for (const profile of miningProfiles) {
    it(`binds exact full-frame ${profile.family} assets and native dimensions`, async () => {
      const manifest = await loadManifest();
      const paths = new Set(
        profile.widths.flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/${profile.family}/${profile.family}-${width}-v1.${format}`,
          ),
        ),
      );
      const assets = manifest.assets.filter((asset) => paths.has(asset.path));
      expect(assets).toHaveLength(profile.widths.length * 2);
      const master = await readFile(
        path.join(process.cwd(), profile.sourceMaster),
      );
      expect(createHash("sha256").update(master).digest("hex")).toBe(
        profile.sourceSha256,
      );
      expect(master.readUInt32BE(16)).toBe(profile.nativeWidth);
      expect(master.readUInt32BE(20)).toBe(profile.nativeHeight);
      expect(master[25]).toBe(2);
      for (const asset of assets) {
        const width = Number(
          asset.path.split(`${profile.family}-`).at(-1)!.split("-v1.")[0],
        );
        expect(width).toBeLessThanOrEqual(profile.nativeWidth);
        expect(asset).toMatchObject({
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          assetVersion: profile.assetVersion,
          reviewScope: profile.reviewScope,
          alt: profile.alt,
          theme: profile.theme,
          mimeType: `image/${asset.path.split(".").at(-1)}`,
          width,
          height: Math.round(
            (profile.nativeHeight * width) / profile.nativeWidth,
          ),
        });
        const bytes = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          asset.sha256,
        );
      }
      if (profile.family === "mining-semiconductor-mobile-dark") {
        expect(profile.nativeHeight).toBe(1671);
        expect([...paths].some((value) => value.includes("-960-"))).toBe(false);
      }
    });
    it(`rejects foreign ${profile.family} metadata, financial claims and actual corrupt bytes`, async () => {
      const manifest = await loadManifest();
      const asset = manifest.assets.find(
        (entry) =>
          entry.path ===
          `/brand/scenes/${profile.family}/${profile.family}-${profile.widths[0]}-v1.avif`,
      )!;
      const variants = [
        asset,
        { ...asset, sourceSha256: "0".repeat(64) },
        { ...asset, sourceMaster: "foreign.png" },
        { ...asset, width: asset.width! + 1 },
        { ...asset, width: String(asset.width) },
        { ...asset, height: 1 },
        { ...asset, height: String(asset.height) },
        { ...asset, theme: "system" },
        { ...asset, mimeType: "image/png" },
        { ...asset, path: asset.path.replace(".avif", ".png") },
        {
          ...asset,
          path: `/brand/scenes/${profile.family}/${profile.family}-2048-v1.avif`,
        },
        { ...asset, assetVersion: "2026.10.06-v17" },
        {
          ...asset,
          reviewScope: "Actual holdings, yields and entire screen acceptance",
        },
        { ...asset, miningYield: 99 },
      ];
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
 import {readFile} from 'node:fs/promises';import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
 const variants=${JSON.stringify(variants)};const bytes=await readFile('./public'+variants[0].path);const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),goodProvenance:aiHelpMetadataFailures(variants[0]),goodBytes:runtimeAssetIntegrityFailures(variants[0],bytes),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupt)}));
 `,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.metadata[0]).toEqual([]);
      expect(
        result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
      ).toBe(true);
      expect(result.goodProvenance).toEqual([]);
      expect(result.goodBytes).toEqual([]);
      expect(result.badBytes.length).toBeGreaterThan(0);
    });
  }
  it("preserves exact204 pre-Wallet records and every actual runtime byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path) &&
          !walletPaths.has(asset.path),
      );
    expect(prior).toHaveLength(204);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("c095ff7c01c012cabc1656da9d1a0859c535fd1f1f4811e639fe872e1b3f036c");
    for (const asset of prior) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  for (const profile of walletProfiles) {
    it(`binds exact full-frame ${profile.family} assets and native dimensions`, async () => {
      const manifest = await loadManifest();
      const paths = new Set(
        profile.widths.flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/${profile.family}/${profile.family}-${width}-v1.${format}`,
          ),
        ),
      );
      const assets = manifest.assets.filter((asset) => paths.has(asset.path));
      expect(assets).toHaveLength(profile.widths.length * 2);
      const master = await readFile(
        path.join(process.cwd(), profile.sourceMaster),
      );
      expect(createHash("sha256").update(master).digest("hex")).toBe(
        profile.sourceSha256,
      );
      expect(master.readUInt32BE(16)).toBe(profile.nativeWidth);
      expect(master.readUInt32BE(20)).toBe(profile.nativeHeight);
      expect(master[25]).toBe(2);
      for (const asset of assets) {
        const width = Number(
          asset.path.split(`${profile.family}-`).at(-1)!.split("-v1.")[0],
        );
        expect(width).toBeLessThanOrEqual(profile.nativeWidth);
        expect(asset).toMatchObject({
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          assetVersion: profile.assetVersion,
          reviewScope: profile.reviewScope,
          alt: profile.alt,
          theme: profile.theme,
          mimeType: `image/${asset.path.split(".").at(-1)}`,
          width,
          height: Math.round(
            (profile.nativeHeight * width) / profile.nativeWidth,
          ),
        });
        const bytes = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          asset.sha256,
        );
      }
      if (
        profile.family.startsWith("wallet-") &&
        profile.family.includes("mobile")
      ) {
        expect(profile.nativeHeight).toBe(1672);
        expect([...paths].some((value) => value.includes("-960-"))).toBe(false);
      }
    });
    it(`rejects foreign ${profile.family} metadata, financial claims and actual corrupt bytes`, async () => {
      const manifest = await loadManifest();
      const asset = manifest.assets.find(
        (entry) =>
          entry.path ===
          `/brand/scenes/${profile.family}/${profile.family}-${profile.widths[0]}-v1.avif`,
      )!;
      const variants = [
        asset,
        { ...asset, sourceSha256: "0".repeat(64) },
        { ...asset, sourceMaster: "foreign.png" },
        { ...asset, width: asset.width! + 1 },
        { ...asset, width: String(asset.width) },
        { ...asset, height: 1 },
        { ...asset, height: String(asset.height) },
        { ...asset, theme: "system" },
        { ...asset, mimeType: "image/png" },
        { ...asset, path: asset.path.replace(".avif", ".png") },
        {
          ...asset,
          path: `/brand/scenes/${profile.family}/${profile.family}-2048-v1.avif`,
        },
        { ...asset, assetVersion: "2026.10.06-v17" },
        {
          ...asset,
          reviewScope: "Actual holdings, yields and entire screen acceptance",
        },
        { ...asset, withdrawableBalance: 99 },
      ];
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
 import {readFile} from 'node:fs/promises';import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
 const variants=${JSON.stringify(variants)};const bytes=await readFile('./public'+variants[0].path);const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),goodProvenance:aiHelpMetadataFailures(variants[0]),goodBytes:runtimeAssetIntegrityFailures(variants[0],bytes),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupt)}));
 `,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.metadata[0]).toEqual([]);
      expect(
        result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
      ).toBe(true);
      expect(result.goodProvenance).toEqual([]);
      expect(result.goodBytes).toEqual([]);
      expect(result.badBytes.length).toBeGreaterThan(0);
    });
  }
  it("preserves exact232 pre-Signup records and every actual runtime byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) =>
          !aiPaths.has(asset.path) &&
          !productsPaths.has(asset.path) &&
          !signupPaths.has(asset.path),
      );
    expect(prior).toHaveLength(232);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("67dec18880a031d75b085f26a095b27ed5efb1e72ccfb7b0cacf30432b3ddbbe");
    for (const asset of prior) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  for (const profile of signupProfiles) {
    it(`binds exact full-frame ${profile.family} assets and native dimensions`, async () => {
      const manifest = await loadManifest();
      const paths = new Set(
        profile.widths.flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/${profile.family}/${profile.family}-${width}-v1.${format}`,
          ),
        ),
      );
      const assets = manifest.assets.filter((asset) => paths.has(asset.path));
      expect(assets).toHaveLength(profile.widths.length * 2);
      const master = await readFile(
        path.join(process.cwd(), profile.sourceMaster),
      );
      expect(createHash("sha256").update(master).digest("hex")).toBe(
        profile.sourceSha256,
      );
      expect(master.readUInt32BE(16)).toBe(profile.nativeWidth);
      expect(master.readUInt32BE(20)).toBe(profile.nativeHeight);
      expect(master[25]).toBe(2);
      for (const asset of assets) {
        const width = Number(
          asset.path.split(`${profile.family}-`).at(-1)!.split("-v1.")[0],
        );
        expect(width).toBeLessThanOrEqual(profile.nativeWidth);
        expect(asset).toMatchObject({
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          assetVersion: profile.assetVersion,
          reviewScope: profile.reviewScope,
          alt: profile.alt,
          theme: profile.theme,
          mimeType: `image/${asset.path.split(".").at(-1)}`,
          width,
          height: Math.round(
            (profile.nativeHeight * width) / profile.nativeWidth,
          ),
        });
        const bytes = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          asset.sha256,
        );
      }
      if (
        profile.family.startsWith("signup-") &&
        profile.family.includes("mobile")
      ) {
        expect(profile.nativeHeight).toBe(1672);
        expect([...paths].some((value) => value.includes("-960-"))).toBe(false);
      }
    });
    it(`rejects foreign ${profile.family} metadata, financial claims and actual corrupt bytes`, async () => {
      const manifest = await loadManifest();
      const asset = manifest.assets.find(
        (entry) =>
          entry.path ===
          `/brand/scenes/${profile.family}/${profile.family}-${profile.widths[0]}-v1.avif`,
      )!;
      const variants = [
        asset,
        { ...asset, sourceSha256: "0".repeat(64) },
        { ...asset, sourceMaster: "foreign.png" },
        { ...asset, width: asset.width! + 1 },
        { ...asset, width: String(asset.width) },
        { ...asset, height: 1 },
        { ...asset, height: String(asset.height) },
        { ...asset, theme: "system" },
        { ...asset, mimeType: "image/png" },
        { ...asset, path: asset.path.replace(".avif", ".png") },
        {
          ...asset,
          path: `/brand/scenes/${profile.family}/${profile.family}-2048-v1.avif`,
        },
        { ...asset, assetVersion: "2026.10.06-v17" },
        {
          ...asset,
          reviewScope: "Actual holdings, yields and entire screen acceptance",
        },
        { ...asset, signupBonus: 99 },
      ];
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
 import {readFile} from 'node:fs/promises';import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
 const variants=${JSON.stringify(variants)};const bytes=await readFile('./public'+variants[0].path);const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),goodProvenance:aiHelpMetadataFailures(variants[0]),goodBytes:runtimeAssetIntegrityFailures(variants[0],bytes),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupt)}));
 `,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.metadata[0]).toEqual([]);
      expect(
        result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
      ).toBe(true);
      expect(result.goodProvenance).toEqual([]);
      expect(result.goodBytes).toEqual([]);
      expect(result.badBytes.length).toBeGreaterThan(0);
    });
  }
  it("preserves exact238 pre-Products records and every actual runtime byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter(
        (asset) => !aiPaths.has(asset.path) && !productsPaths.has(asset.path),
      );
    expect(prior).toHaveLength(238);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("7b81de83b1d18e5c7971953e29eedab56ae4d34da180721102eabe2cb313deae");
    for (const asset of prior) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  for (const profile of productsProfiles) {
    it(`binds exact full-frame ${profile.family} assets and native dimensions`, async () => {
      const manifest = await loadManifest();
      const paths = new Set(
        profile.widths.flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/${profile.family}/${profile.family}-${width}-v1.${format}`,
          ),
        ),
      );
      const assets = manifest.assets.filter((asset) => paths.has(asset.path));
      expect(assets).toHaveLength(profile.widths.length * 2);
      const master = await readFile(
        path.join(process.cwd(), profile.sourceMaster),
      );
      expect(createHash("sha256").update(master).digest("hex")).toBe(
        profile.sourceSha256,
      );
      expect(master.readUInt32BE(16)).toBe(profile.nativeWidth);
      expect(master.readUInt32BE(20)).toBe(profile.nativeHeight);
      expect(master[25]).toBe(2);
      for (const asset of assets) {
        const width = Number(
          asset.path.split(`${profile.family}-`).at(-1)!.split("-v1.")[0],
        );
        expect(width).toBeLessThanOrEqual(profile.nativeWidth);
        expect(asset).toMatchObject({
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          assetVersion: profile.assetVersion,
          reviewScope: profile.reviewScope,
          alt: profile.alt,
          theme: profile.theme,
          mimeType: `image/${asset.path.split(".").at(-1)}`,
          width,
          height: Math.round(
            (profile.nativeHeight * width) / profile.nativeWidth,
          ),
        });
        const bytes = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          asset.sha256,
        );
      }
      if (
        profile.family.startsWith("products-") &&
        profile.family.includes("mobile")
      ) {
        expect(profile.nativeHeight).toBe(1672);
        expect([...paths].some((value) => value.includes("-960-"))).toBe(false);
      }
    });
    it(`rejects foreign ${profile.family} metadata, financial claims and actual corrupt bytes`, async () => {
      const manifest = await loadManifest();
      const asset = manifest.assets.find(
        (entry) =>
          entry.path ===
          `/brand/scenes/${profile.family}/${profile.family}-${profile.widths[0]}-v1.avif`,
      )!;
      const variants = [
        asset,
        { ...asset, sourceSha256: "0".repeat(64) },
        { ...asset, sourceMaster: "foreign.png" },
        { ...asset, width: asset.width! + 1 },
        { ...asset, width: String(asset.width) },
        { ...asset, height: 1 },
        { ...asset, height: String(asset.height) },
        { ...asset, theme: "system" },
        { ...asset, mimeType: "image/png" },
        { ...asset, path: asset.path.replace(".avif", ".png") },
        {
          ...asset,
          path: `/brand/scenes/${profile.family}/${profile.family}-2048-v1.avif`,
        },
        { ...asset, assetVersion: "2026.10.06-v17" },
        {
          ...asset,
          reviewScope: "Actual holdings, yields and entire screen acceptance",
        },
        { ...asset, catalogPrice: 99 },
      ];
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
 import {readFile} from 'node:fs/promises';import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
 const variants=${JSON.stringify(variants)};const bytes=await readFile('./public'+variants[0].path);const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),goodProvenance:aiHelpMetadataFailures(variants[0]),goodBytes:runtimeAssetIntegrityFailures(variants[0],bytes),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupt)}));
 `,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.metadata[0]).toEqual([]);
      expect(
        result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
      ).toBe(true);
      expect(result.goodProvenance).toEqual([]);
      expect(result.goodBytes).toEqual([]);
      expect(result.badBytes.length).toBeGreaterThan(0);
    });
  }
  it("preserves exact250 pre-AI records and every actual runtime byte", async () => {
    const manifest = await loadManifest();
    const prior = manifest.assets
      .filter((asset) => !nvdaPaths.has(asset.path))
      .filter((asset) => !aiPaths.has(asset.path));
    expect(prior).toHaveLength(250);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("3da7f3d415d9d1f898b428de365f35972e538fe1cdef16f9a81411ea6285cd99");
    for (const asset of prior) {
      const bytes = await readFile(
        path.join(process.cwd(), "public", asset.path),
      );
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
  for (const profile of aiProfiles) {
    it(`binds exact full-frame ${profile.family} assets and native dimensions`, async () => {
      const manifest = await loadManifest();
      const paths = new Set(
        profile.widths.flatMap((width) =>
          ["avif", "webp"].map(
            (format) =>
              `/brand/scenes/${profile.family}/${profile.family}-${width}-v1.${format}`,
          ),
        ),
      );
      const assets = manifest.assets.filter((asset) => paths.has(asset.path));
      expect(assets).toHaveLength(profile.widths.length * 2);
      const master = await readFile(
        path.join(process.cwd(), profile.sourceMaster),
      );
      expect(createHash("sha256").update(master).digest("hex")).toBe(
        profile.sourceSha256,
      );
      expect(master.readUInt32BE(16)).toBe(profile.nativeWidth);
      expect(master.readUInt32BE(20)).toBe(profile.nativeHeight);
      expect(master[25]).toBe(2);
      for (const asset of assets) {
        const width = Number(
          asset.path.split(`${profile.family}-`).at(-1)!.split("-v1.")[0],
        );
        expect(width).toBeLessThanOrEqual(profile.nativeWidth);
        expect(asset).toMatchObject({
          sourceMaster: profile.sourceMaster,
          sourceSha256: profile.sourceSha256,
          assetVersion: profile.assetVersion,
          reviewScope: profile.reviewScope,
          alt: profile.alt,
          theme: profile.theme,
          mimeType: `image/${asset.path.split(".").at(-1)}`,
          width,
          height: Math.round(
            (profile.nativeHeight * width) / profile.nativeWidth,
          ),
        });
        const bytes = await readFile(
          path.join(process.cwd(), "public", asset.path),
        );
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          asset.sha256,
        );
      }
      if (
        profile.family.startsWith("ai-") &&
        profile.family.includes("mobile")
      ) {
        expect(profile.nativeHeight).toBe(1672);
        expect([...paths].some((value) => value.includes("-960-"))).toBe(false);
      }
    });
    it(`rejects foreign ${profile.family} metadata, financial claims and actual corrupt bytes`, async () => {
      const manifest = await loadManifest();
      const asset = manifest.assets.find(
        (entry) =>
          entry.path ===
          `/brand/scenes/${profile.family}/${profile.family}-${profile.widths[0]}-v1.avif`,
      )!;
      const variants = [
        asset,
        { ...asset, sourceSha256: "0".repeat(64) },
        { ...asset, sourceMaster: "foreign.png" },
        { ...asset, width: asset.width! + 1 },
        { ...asset, width: String(asset.width) },
        { ...asset, height: 1 },
        { ...asset, height: String(asset.height) },
        { ...asset, theme: "system" },
        { ...asset, mimeType: "image/png" },
        { ...asset, path: asset.path.replace(".avif", ".png") },
        {
          ...asset,
          path: `/brand/scenes/${profile.family}/${profile.family}-2048-v1.avif`,
        },
        { ...asset, assetVersion: "2026.10.06-v17" },
        {
          ...asset,
          reviewScope: "Actual holdings, yields and entire screen acceptance",
        },
        { ...asset, autonomousTransfer: 99 },
      ];
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
 import {readFile} from 'node:fs/promises';import {approvedSceneMetadataFailures,aiHelpMetadataFailures,runtimeAssetIntegrityFailures} from './scripts/verify-brand-assets.mjs';
 const variants=${JSON.stringify(variants)};const bytes=await readFile('./public'+variants[0].path);const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 console.log(JSON.stringify({metadata:variants.map(approvedSceneMetadataFailures),goodProvenance:aiHelpMetadataFailures(variants[0]),goodBytes:runtimeAssetIntegrityFailures(variants[0],bytes),badBytes:runtimeAssetIntegrityFailures(variants[0],corrupt)}));
 `,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.metadata[0]).toEqual([]);
      expect(
        result.metadata.slice(1).every((errors: string[]) => errors.length > 0),
      ).toBe(true);
      expect(result.goodProvenance).toEqual([]);
      expect(result.goodBytes).toEqual([]);
      expect(result.badBytes.length).toBeGreaterThan(0);
    });
  }

  it("keeps the default manifest generator on the new snapshot and binds preserved review metadata to identical bytes", async () => {
    const source = await readFile(
      path.join(process.cwd(), "scripts/build-brand-assets.py"),
      "utf8",
    );
    expect(source).toContain('VERSION = "2026.10.06-v17"');
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
