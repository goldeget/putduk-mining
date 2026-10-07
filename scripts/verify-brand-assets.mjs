import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyCatalogMaterialAssets } from "./verify-catalog-material-assets.mjs";
import { verifyMiningResponsiveAssets } from "./verify-mining-responsive-assets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "public", "brand", "assets.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const failures = [];
const requiredVersion = "2026.10.06-v17";
const aiHelpSource =
  "docs/design/generated-masters/ai-help-face-2026-10-03/putduk-ai-help-face-master-v1.png";
const aiHelpSourceHash =
  "d7aa8e5c8ddf1215ca3be650699a6c18fe168c9eefbba86a7204718f9d39ffd2";
const aiHelpVersion = "2026.10.03-ai-help-face-v1";
const aiHelpReviewScope =
  "Owner-approved batch 7 AI help launcher face; preserve the complete 1254x1254 composition with object-fit: contain; no scene, economic or other asset approval.";
const provenanceKeys = [
  "assetVersion",
  "sourceMaster",
  "sourceSha256",
  "reviewScope",
];
const approvedAiHelpPaths = new Map(
  [128, 256].flatMap((size) =>
    ["avif", "webp"].map((format) => [
      `/brand/mascot/putduk-ai-help-face-${size}-v1.${format}`,
      size,
    ]),
  ),
);
const sceneSource =
  "docs/design/generated-masters/semiconductor-memory-v3-clean-2026-10-03/semiconductor-memory-v3-clean-master-v1.png";
const sceneSourceHash =
  "5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd";
const sceneVersion = "2026.10.03-semiconductor-memory-v1";
const sceneReviewScope =
  "Owner-delegated 2026-10-03 visual selection: approved complete 1539x1022 clean semiconductor scene; responsive encoding only, no crop, recoloring or upscale; no product mapping, economic runtime or other family approval.";
const approvedScenePaths = new Map(
  [640, 960, 1280, 1539].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/semiconductor-memory/semiconductor-memory-${width}-v1.${format}`,
      { width, height: Math.round((1022 * width) / 1539) },
    ]),
  ),
);

const globalSource =
  "docs/design/generated-masters/global-pavilion-2026-10-06/global-pavilion-master-v1.png";
const globalSourceHash =
  "82c8d567d0da86ce72052d6415e198793198f9886e65a21d0eadd859b66e1a32";
const globalVersion = "2026.10.06-global-pavilion-v1";
const globalReviewScope =
  "User-delegated Phase 2 production-quality artwork from fully inspected Drive reference families: coherent city, networked Earth and material pavilion; complete 1536x1024 composition, no production copy, responsive encoding only; no economic approval or product-specific runtime mapping.";
const delegatedGlobalPaths = new Map(
  [640, 960, 1280, 1536].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/global-pavilion/global-pavilion-${width}-v1.${format}`,
      { width, height: Math.round((1024 * width) / 1536) },
    ]),
  ),
);

const lightSource =
  "docs/design/generated-masters/semiconductor-memory-light-2026-10-06/semiconductor-memory-light-master-v1.png";
const lightSourceHash =
  "113fdbc5c41772145f98f3357f27754fa1bd20602a5261c133becc0fa1126d52";
const lightVersion = "2026.10.06-semiconductor-memory-light-v1";
const lightReviewScope =
  "User-delegated Phase 2 native light companion from the unchanged clean memory master and fully inspected a02-m00032 light desktop reference; complete 1536x1024 composition, responsive encoding only, no crop, recoloring or upscale; presentation-only neutral mining backdrop, no economic or product mapping approval.";
const delegatedLightPaths = new Map(
  [640, 960, 1280, 1536].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-${width}-v1.${format}`,
      { width, height: Math.round((1024 * width) / 1536) },
    ]),
  ),
);

const towerSource =
  "docs/design/generated-masters/semiconductor-tower-2026-10-06/semiconductor-tower-master-v1.png";
const towerSourceHash =
  "b7efda2f71a34d07460a7d50e3650bfafc9028e4b4f3e7e10a96000a9b07c9ee";
const towerVersion = "2026.10.06-semiconductor-tower-v1";
const towerReviewScope =
  "User-delegated 2026-10-06 exact MOBILE HOME a02-m00005 reconstruction: navy semiconductor factory, robotic arm and six-layer HBM tower; complete 1536x1024 composition, responsive encoding only, no crop, recoloring or upscale; HOME hero presentation only, no broad screen acceptance, economic or product mapping approval.";
const delegatedTowerPaths = new Map(
  [640, 960, 1280, 1536].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/semiconductor-tower/semiconductor-tower-${width}-v1.${format}`,
      { width, height: Math.round((1024 * width) / 1536) },
    ]),
  ),
);

const waferLightSource =
  "docs/design/generated-masters/semiconductor-wafer-light-2026-10-06/semiconductor-wafer-light-master-v1.png";
const waferLightSourceHash =
  "89651e191ac5031730531856cc3a4fe7f5b5d557e4c27bd3ec225fcde3f24848";
const waferLightVersion = "2026.10.06-semiconductor-wafer-light-v1";
const waferLightReviewScope =
  "User-delegated 2026-10-06 exact Light MOBILE HOME a02-m00027 reconstruction: white and blue glass semiconductor factory, broad low circular wafer and vertical gold beam with helix; complete 1536x1024 composition, responsive encoding only, no crop, recoloring or upscale; HOME hero presentation only, no broad screen acceptance, economic or product mapping approval.";
const delegatedWaferLightPaths = new Map(
  [640, 960, 1280, 1536].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-${width}-v1.${format}`,
      { width, height: Math.round((1024 * width) / 1536) },
    ]),
  ),
);

const goldSource =
  "docs/design/generated-masters/gold-category-2026-10-06/gold-category-master-v1.png";
const goldSourceHash =
  "b22dced3d82446e8a946f49f29bbd5d62fc57e2b465464d7c260755d0600cf7e";
const goldVersion = "2026.10.06-gold-category-v1";
const goldReviewScope =
  "User-delegated 2026-10-06 neutral GOLD category presentation artwork: navy factory and gold bars at the right; complete 1536x1024 composition, responsive encoding only, no crop, recoloring or upscale; GOLD artwork only, no SILVER mapping, actual holding, catalog publication, yield or economic approval.";
const delegatedGoldPaths = new Map(
  [320, 640, 960, 1536].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/gold-category/gold-category-${width}-v1.${format}`,
      { width, height: Math.round((1024 * width) / 1536) },
    ]),
  ),
);

const desktopTowerSourceMaster =
  "docs/design/generated-masters/semiconductor-tower-desktop-2026-10-06/semiconductor-tower-desktop-master-v1.png";
const desktopTowerSourceSha256 =
  "77fa85077eef2f0534d16a4900e4ada9ccc1fdcbb28c959775ca0ebcaf4b82f4";
const desktopTowerAssetVersion = "2026.10.06-semiconductor-tower-desktop-v1";
const desktopTowerReviewScope =
  "User-delegated 2026-10-06 exact desktop HOME a02-m00017 reconstruction: wide navy semiconductor factory, complete six-layer HBM tower and robots, left greeting negative space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; desktop HOME artwork only, no broad screen acceptance, product mapping or economic approval.";
const desktopTowerTheme = "dark";
const desktopTowerAlt =
  "짙은 푸른 반도체 공장 안에서 여섯 층 메모리 타워와 양쪽 로봇 팔이 빛나는 넓은 장면";
const desktopWaferLightSourceMaster =
  "docs/design/generated-masters/semiconductor-wafer-light-desktop-2026-10-06/semiconductor-wafer-light-desktop-master-v1.png";
const desktopWaferLightSourceSha256 =
  "fb2ef6a74cba862a69229d334e84ad27e1e7dd4709702967f76d6c4242c08548";
const desktopWaferLightAssetVersion =
  "2026.10.06-semiconductor-wafer-light-desktop-v1";
const desktopWaferLightReviewScope =
  "User-delegated 2026-10-06 Light desktop HOME responsive inference from mobile a02-m00027 intent: wide white and ice-blue glass factory, low thin circular wafer and gold beam; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; no supplied Light desktop reference acceptance; desktop HOME artwork only, no product mapping or economic approval.";
const desktopWaferLightTheme = "light";
const desktopWaferLightAlt =
  "밝은 유리 반도체 공장 안에서 낮고 얇은 원형 웨이퍼와 금빛 수직 광선이 빛나는 넓은 장면";
const delegatedDesktopPaths = new Map(
  [
    [
      "semiconductor-tower-desktop",
      {
        sourceMaster: desktopTowerSourceMaster,
        sourceSha256: desktopTowerSourceSha256,
        assetVersion: desktopTowerAssetVersion,
        reviewScope: desktopTowerReviewScope,
        theme: desktopTowerTheme,
        alt: desktopTowerAlt,
      },
    ],
    [
      "semiconductor-wafer-light-desktop",
      {
        sourceMaster: desktopWaferLightSourceMaster,
        sourceSha256: desktopWaferLightSourceSha256,
        assetVersion: desktopWaferLightAssetVersion,
        reviewScope: desktopWaferLightReviewScope,
        theme: desktopWaferLightTheme,
        alt: desktopWaferLightAlt,
      },
    ],
  ].flatMap(([family, provenance]) =>
    [960, 1280, 1536, 1920].flatMap((width) =>
      ["avif", "webp"].map((format) => [
        `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
        {
          ...provenance,
          width,
          height: Math.round((793 * width) / 1983),
          mimeType: `image/${format}`,
        },
      ]),
    ),
  ),
);

const delegatedLoginProfiles = [
  {
    family: "login-wafer-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1672,
    provenance: {
      sourceMaster:
        "docs/design/generated-masters/login-wafer-dark-2026-10-06/login-wafer-dark-master-v1.png",
      sourceSha256:
        "573ec7a687b170af257e52ba5f5806bbed4d2f8593b1c349e46547c5d77a4b41",
      assetVersion: "2026.10.06-login-wafer-dark-v1",
      reviewScope:
        "User-delegated 2026-10-06 Login reconstruction for a02-m00001: portrait navy glass factory, circular wafer and vertical gold beam; complete 941x1672 composition, responsive encoding only, no crop, recoloring or upscale; Login artwork only, no raster UI, product mapping or economic approval.",
      theme: "dark",
      alt: "짙은 푸른 유리 공장 안에서 원형 웨이퍼와 금빛 수직 광선이 빛나는 세로 로그인 장면",
    },
  },
  {
    family: "login-semiconductor-dark",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
      sourceMaster:
        "docs/design/generated-masters/login-semiconductor-dark-2026-10-06/login-semiconductor-dark-master-v1.png",
      sourceSha256:
        "319553645fbb289fcd8f366a7280c3b5744fb898463023c04c78e7ed78c6ebde",
      assetVersion: "2026.10.06-login-semiconductor-dark-v1",
      reviewScope:
        "User-delegated 2026-10-06 Login reconstruction for a02-m00015: wide navy factory, semiconductor tower, robots, circular wafer and clear right form space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Login artwork only, no raster UI, product mapping or economic approval.",
      theme: "dark",
      alt: "짙은 푸른 반도체 공장 안에서 메모리 타워와 로봇 팔이 빛나고 오른쪽이 비워진 로그인 장면",
    },
  },
  {
    family: "login-semiconductor-light",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
      sourceMaster:
        "docs/design/generated-masters/login-semiconductor-light-2026-10-06/login-semiconductor-light-master-v1.png",
      sourceSha256:
        "34faa37064e52ea0635bdc57da6addeebff0d3fbdc75873056684fc8f3c3eb1f",
      assetVersion: "2026.10.06-login-semiconductor-light-v1",
      reviewScope:
        "User-delegated 2026-10-06 Login reconstruction for a02-m00031: wide white glass factory, semiconductor tower, robots, circular wafer and clear right form space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; Login artwork only, no raster UI, product mapping or economic approval. Mobile Light reuse is responsive adaptation; no supplied Mobile Light reference acceptance.",
      theme: "light",
      alt: "밝은 유리 반도체 공장 안에서 메모리 타워와 로봇 팔이 빛나고 오른쪽이 비워진 로그인 장면",
    },
  },
];
const delegatedLoginPaths = new Map(
  delegatedLoginProfiles.flatMap(
    ({ family, widths, nativeWidth, nativeHeight, provenance }) =>
      widths.flatMap((width) =>
        ["avif", "webp"].map((format) => [
          `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
          {
            ...provenance,
            width,
            height: Math.round((nativeHeight * width) / nativeWidth),
            mimeType: `image/${format}`,
          },
        ]),
      ),
  ),
);
const delegatedGiftProvenance = {
  sourceMaster:
    "docs/design/generated-masters/home-event-gift-2026-10-06/home-event-gift-master-v1.png",
  sourceSha256:
    "d75203b5a1413c915f5b3e75176bb15ee2f4a27848c6fa247e79a8268bb2ae48",
  assetVersion: "2026.10.06-home-event-gift-v1",
  reviewScope:
    "User-delegated 2026-10-06 HOME event banner reconstruction from a02-m00017/a02-m00005: three gold gift boxes clustered at the right with left navy negative space; complete 1983x793 composition, responsive encoding only, no crop, recoloring or upscale; HOME artwork only, no UI copy, numbers, returns, actual rewards, product mapping or economic approval.",
  theme: "dark",
  alt: "짙은 푸른 공간의 오른쪽에 금빛 리본을 두른 세 선물 상자가 빛나는 홈 이벤트 장면",
};
const delegatedGiftPaths = new Map(
  [480, 960, 1280, 1920].flatMap((width) =>
    ["avif", "webp"].map((format) => [
      `/brand/scenes/home-event-gift/home-event-gift-${width}-v1.${format}`,
      {
        ...delegatedGiftProvenance,
        width,
        height: Math.round((793 * width) / 1983),
        mimeType: `image/${format}`,
      },
    ]),
  ),
);
const delegatedMiningProfiles = [
  {
    family: "mining-semiconductor-mobile-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1671,
    provenance: {
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
  },
  {
    family: "mining-semiconductor-desktop-dark",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
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
  },
  {
    family: "mining-semiconductor-desktop-light",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
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
  },
];
const delegatedWalletProfiles = [
  {
    family: "wallet-vault-mobile-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1672,
    provenance: {
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
  },
  {
    family: "wallet-vault-desktop-dark",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
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
  },
  {
    family: "wallet-chip-mobile-light",
    widths: [480, 640, 940],
    nativeWidth: 940,
    nativeHeight: 1672,
    provenance: {
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
  },
  {
    family: "wallet-chip-desktop-light",
    widths: [960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
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
  },
];
const delegatedSignupProfiles = [
  {
    family: "signup-semiconductor-mobile-dark",
    widths: [480, 640, 941],
    nativeWidth: 941,
    nativeHeight: 1672,
    provenance: {
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
  },
];
const delegatedProductsProfiles = [
  {
    family: "products-semiconductor-hero",
    widths: [480, 640, 960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
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
  },
];
const delegatedAIProfiles = [
  {
    family: "ai-partner-hero",
    widths: [480, 640, 960, 1280, 1536, 1920],
    nativeWidth: 1983,
    nativeHeight: 793,
    provenance: {
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
  },
];
const delegatedAIPaths = new Map(
  delegatedAIProfiles.flatMap(
    ({ family, widths, nativeWidth, nativeHeight, provenance }) =>
      widths.flatMap((width) =>
        ["avif", "webp"].map((format) => [
          `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
          {
            ...provenance,
            width,
            height: Math.round((nativeHeight * width) / nativeWidth),
            mimeType: `image/${format}`,
          },
        ]),
      ),
  ),
);
export function delegatedAIMetadataFailures(asset) {
  const expected = delegatedAIPaths.get(asset.path);
  if (!expected)
    return delegatedAIProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
      ? [`unreviewed AI path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `AI ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed AI metadata: ${asset.path}`);
  return errors;
}

const delegatedProductsPaths = new Map(
  delegatedProductsProfiles.flatMap(
    ({ family, widths, nativeWidth, nativeHeight, provenance }) =>
      widths.flatMap((width) =>
        ["avif", "webp"].map((format) => [
          `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
          {
            ...provenance,
            width,
            height: Math.round((nativeHeight * width) / nativeWidth),
            mimeType: `image/${format}`,
          },
        ]),
      ),
  ),
);
export function delegatedProductsMetadataFailures(asset) {
  const expected = delegatedProductsPaths.get(asset.path);
  if (!expected)
    return delegatedProductsProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
      ? [`unreviewed Products path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `Products ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed Products metadata: ${asset.path}`);
  return errors;
}

const delegatedSignupPaths = new Map(
  delegatedSignupProfiles.flatMap(
    ({ family, widths, nativeWidth, nativeHeight, provenance }) =>
      widths.flatMap((width) =>
        ["avif", "webp"].map((format) => [
          `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
          {
            ...provenance,
            width,
            height: Math.round((nativeHeight * width) / nativeWidth),
            mimeType: `image/${format}`,
          },
        ]),
      ),
  ),
);
export function delegatedSignupMetadataFailures(asset) {
  const expected = delegatedSignupPaths.get(asset.path);
  if (!expected)
    return delegatedSignupProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
      ? [`unreviewed Signup path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `Signup ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed Signup metadata: ${asset.path}`);
  return errors;
}

const delegatedWalletPaths = new Map(
  delegatedWalletProfiles.flatMap(
    ({ family, widths, nativeWidth, nativeHeight, provenance }) =>
      widths.flatMap((width) =>
        ["avif", "webp"].map((format) => [
          `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
          {
            ...provenance,
            width,
            height: Math.round((nativeHeight * width) / nativeWidth),
            mimeType: `image/${format}`,
          },
        ]),
      ),
  ),
);
export function delegatedWalletMetadataFailures(asset) {
  const expected = delegatedWalletPaths.get(asset.path);
  if (!expected)
    return delegatedWalletProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
      ? [`unreviewed Wallet path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `Wallet ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed Wallet metadata: ${asset.path}`);
  return errors;
}

const delegatedMiningPaths = new Map(
  delegatedMiningProfiles.flatMap(
    ({ family, widths, nativeWidth, nativeHeight, provenance }) =>
      widths.flatMap((width) =>
        ["avif", "webp"].map((format) => [
          `/brand/scenes/${family}/${family}-${width}-v1.${format}`,
          {
            ...provenance,
            width,
            height: Math.round((nativeHeight * width) / nativeWidth),
            mimeType: `image/${format}`,
          },
        ]),
      ),
  ),
);
export function delegatedMiningMetadataFailures(asset) {
  const expected = delegatedMiningPaths.get(asset.path);
  if (!expected)
    return delegatedMiningProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
      ? [`unreviewed Mining path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `Mining ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed Mining metadata: ${asset.path}`);
  return errors;
}

export function delegatedGiftMetadataFailures(asset) {
  const expected = delegatedGiftPaths.get(asset.path);
  if (!expected)
    return asset.path?.startsWith("/brand/scenes/home-event-gift/")
      ? [`unreviewed HOME gift path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `HOME gift ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed HOME gift metadata: ${asset.path}`);
  return errors;
}

export function delegatedLoginMetadataFailures(asset) {
  const expected = delegatedLoginPaths.get(asset.path);
  if (!expected)
    return delegatedLoginProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
      ? [`unreviewed Login scene path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `Login scene ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed Login scene metadata: ${asset.path}`);
  return errors;
}

export function delegatedDesktopMetadataFailures(asset) {
  const expected = delegatedDesktopPaths.get(asset.path);
  if (!expected)
    return [
      "/brand/scenes/semiconductor-tower-desktop/",
      "/brand/scenes/semiconductor-wafer-light-desktop/",
    ].some((prefix) => asset.path?.startsWith(prefix))
      ? [`unreviewed desktop scene path: ${asset.path}`]
      : [];
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `desktop scene ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unreviewed desktop scene metadata: ${asset.path}`);
  return errors;
}

export function delegatedGoldMetadataFailures(asset) {
  const dimensions = delegatedGoldPaths.get(asset.path);
  if (!dimensions)
    return asset.path?.startsWith("/brand/scenes/gold-category/")
      ? [`unapproved GOLD category path: ${asset.path}`]
      : [];
  const expected = {
    assetVersion: goldVersion,
    sourceMaster: goldSource,
    sourceSha256: goldSourceHash,
    reviewScope: goldReviewScope,
    theme: "dark",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `GOLD category ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unapproved GOLD category metadata: ${asset.path}`);
  return errors;
}

export function delegatedWaferLightMetadataFailures(asset) {
  const dimensions = delegatedWaferLightPaths.get(asset.path);
  if (!dimensions)
    return asset.path?.startsWith("/brand/scenes/semiconductor-wafer-light/")
      ? [`unapproved wafer light scene path: ${asset.path}`]
      : [];
  const expected = {
    assetVersion: waferLightVersion,
    sourceMaster: waferLightSource,
    sourceSha256: waferLightSourceHash,
    reviewScope: waferLightReviewScope,
    theme: "light",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `wafer light scene ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unapproved wafer light scene metadata: ${asset.path}`);
  return errors;
}

export function delegatedTowerMetadataFailures(asset) {
  const dimensions = delegatedTowerPaths.get(asset.path);
  if (!dimensions)
    return asset.path?.startsWith("/brand/scenes/semiconductor-tower/")
      ? [`unapproved tower scene path: ${asset.path}`]
      : [];
  const expected = {
    assetVersion: towerVersion,
    sourceMaster: towerSource,
    sourceSha256: towerSourceHash,
    reviewScope: towerReviewScope,
    theme: "dark",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `tower scene ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unapproved tower scene metadata: ${asset.path}`);
  return errors;
}

export function delegatedLightMetadataFailures(asset) {
  const dimensions = delegatedLightPaths.get(asset.path);
  if (!dimensions)
    return asset.path?.startsWith("/brand/scenes/semiconductor-memory-light/")
      ? [`unapproved light scene path: ${asset.path}`]
      : [];
  const expected = {
    assetVersion: lightVersion,
    sourceMaster: lightSource,
    sourceSha256: lightSourceHash,
    reviewScope: lightReviewScope,
    theme: "light",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `light scene ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unapproved light scene metadata: ${asset.path}`);
  return errors;
}

/** Used by the real disk verifier and corruption regressions. */
export function runtimeAssetIntegrityFailures(
  asset,
  contents,
  fileSize = contents.length,
) {
  const errors = [];
  if (createHash("sha256").update(contents).digest("hex") !== asset.sha256)
    errors.push(`hash mismatch: ${asset.path}`);
  if (fileSize !== asset.bytes || contents.length !== asset.bytes)
    errors.push(`byte mismatch: ${asset.path}`);
  return errors;
}

export function delegatedGlobalMetadataFailures(asset) {
  const dimensions = delegatedGlobalPaths.get(asset.path);
  if (!dimensions) return [];
  const expected = {
    assetVersion: globalVersion,
    sourceMaster: globalSource,
    sourceSha256: globalSourceHash,
    reviewScope: globalReviewScope,
    theme: "system",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  const errors = Object.entries(expected)
    .filter(([key, value]) => asset[key] !== value)
    .map(([key]) => `global pavilion ${key} mismatch: ${asset.path}`);
  const allowed = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowed.has(key)))
    errors.push(`unapproved global pavilion metadata: ${asset.path}`);
  return errors;
}

/** Reviewed metadata belongs only to the approved face and scene packs. */
export function aiHelpMetadataFailures(asset) {
  const size = approvedAiHelpPaths.get(asset.path);
  if (!size)
    return !approvedScenePaths.has(asset.path) &&
      !delegatedGlobalPaths.has(asset.path) &&
      !delegatedLightPaths.has(asset.path) &&
      !delegatedTowerPaths.has(asset.path) &&
      !delegatedWaferLightPaths.has(asset.path) &&
      !delegatedGoldPaths.has(asset.path) &&
      !delegatedDesktopPaths.has(asset.path) &&
      !delegatedLoginPaths.has(asset.path) &&
      !delegatedGiftPaths.has(asset.path) &&
      !delegatedAIPaths.has(asset.path) &&
      !delegatedProductsPaths.has(asset.path) &&
      !delegatedSignupPaths.has(asset.path) &&
      !delegatedWalletPaths.has(asset.path) &&
      !delegatedMiningPaths.has(asset.path) &&
      provenanceKeys.some((key) => key in asset)
      ? [`unapproved provenance path: ${asset.path}`]
      : [];
  const errors = [];
  const expected = {
    assetVersion: aiHelpVersion,
    sourceMaster: aiHelpSource,
    sourceSha256: aiHelpSourceHash,
    reviewScope: aiHelpReviewScope,
  };
  for (const [key, value] of Object.entries(expected))
    if (asset[key] !== value)
      errors.push(`AI help ${key} mismatch: ${asset.path}`);
  if (asset.width !== size || asset.height !== size)
    errors.push(`AI help square dimensions mismatch: ${asset.path}`);
  if (asset.theme !== "system")
    errors.push(`AI help theme mismatch: ${asset.path}`);
  if (asset.mimeType !== `image/${asset.path.split(".").at(-1)}`)
    errors.push(`AI help MIME mismatch: ${asset.path}`);
  const allowedKeys = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowedKeys.has(key)))
    errors.push(`unapproved AI help metadata: ${asset.path}`);
  return errors;
}

export function approvedSceneMetadataFailures(asset) {
  if (
    delegatedAIProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
  )
    return delegatedAIMetadataFailures(asset);
  if (
    delegatedProductsProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
  )
    return delegatedProductsMetadataFailures(asset);
  if (
    delegatedSignupProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
  )
    return delegatedSignupMetadataFailures(asset);
  if (
    delegatedWalletProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
  )
    return delegatedWalletMetadataFailures(asset);
  if (
    delegatedMiningProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
  )
    return delegatedMiningMetadataFailures(asset);
  if (asset.path?.startsWith("/brand/scenes/home-event-gift/"))
    return delegatedGiftMetadataFailures(asset);
  if (
    delegatedLoginProfiles.some(({ family }) =>
      asset.path?.startsWith(`/brand/scenes/${family}/`),
    )
  )
    return delegatedLoginMetadataFailures(asset);
  if (
    asset.path?.startsWith("/brand/scenes/semiconductor-tower-desktop/") ||
    asset.path?.startsWith("/brand/scenes/semiconductor-wafer-light-desktop/")
  )
    return delegatedDesktopMetadataFailures(asset);
  if (asset.path?.startsWith("/brand/scenes/gold-category/"))
    return delegatedGoldMetadataFailures(asset);
  if (asset.path?.startsWith("/brand/scenes/semiconductor-wafer-light/"))
    return delegatedWaferLightMetadataFailures(asset);
  if (asset.path?.startsWith("/brand/scenes/semiconductor-tower/"))
    return delegatedTowerMetadataFailures(asset);
  if (asset.path?.startsWith("/brand/scenes/semiconductor-memory-light/"))
    return delegatedLightMetadataFailures(asset);
  if (delegatedGlobalPaths.has(asset.path))
    return delegatedGlobalMetadataFailures(asset);
  const dimensions = approvedScenePaths.get(asset.path);
  if (!dimensions)
    return asset.path?.startsWith("/brand/scenes/")
      ? [`unapproved scene path: ${asset.path}`]
      : [];
  const errors = [];
  const expected = {
    assetVersion: sceneVersion,
    sourceMaster: sceneSource,
    sourceSha256: sceneSourceHash,
    reviewScope: sceneReviewScope,
    theme: "system",
    mimeType: `image/${asset.path.split(".").at(-1)}`,
    ...dimensions,
  };
  for (const [key, value] of Object.entries(expected))
    if (asset[key] !== value)
      errors.push(`scene ${key} mismatch: ${asset.path}`);
  const allowedKeys = new Set([
    "path",
    "bytes",
    "sha256",
    "mimeType",
    "alt",
    "width",
    "height",
    "theme",
    ...provenanceKeys,
  ]);
  if (Object.keys(asset).some((key) => !allowedKeys.has(key)))
    errors.push(`unapproved scene metadata: ${asset.path}`);
  return errors;
}
const allowedMimes = new Set([
  "image/avif",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
]);

if (manifest.schemaVersion !== 1) failures.push("schemaVersion must be 1");
if (manifest.assetVersion !== requiredVersion) {
  failures.push(`assetVersion must be ${requiredVersion}`);
}
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
  failures.push("manifest must contain assets");
}

for (const asset of manifest.assets ?? []) {
  failures.push(...aiHelpMetadataFailures(asset));
  failures.push(...approvedSceneMetadataFailures(asset));
  const relative = asset.path?.replace(/^\//, "");
  if (
    !relative ||
    !/^\/(brand|ranks)\//.test(asset.path) ||
    relative.includes("..") ||
    relative.includes("\\")
  ) {
    failures.push(`unsafe asset path: ${String(asset.path)}`);
    continue;
  }

  const absolute = path.join(root, "public", relative);
  try {
    const [contents, info] = await Promise.all([
      readFile(absolute),
      stat(absolute),
    ]);
    failures.push(...runtimeAssetIntegrityFailures(asset, contents, info.size));
  } catch {
    failures.push(`missing asset: ${asset.path}`);
  }

  if (!allowedMimes.has(asset.mimeType)) {
    failures.push(`unsupported MIME ${asset.mimeType}: ${asset.path}`);
  }
  if (typeof asset.alt !== "string" || asset.alt.trim().length < 4) {
    failures.push(`missing accessible alt text: ${asset.path}`);
  }
}

const expectedReferenceHashes = new Map([
  [
    "docs/design/visual-references/putduk-brand-master-reference.png",
    "c3b9363be5f5c0cb212e87ae5d7b49fcf5ba5105858367f40e91ef6999077512",
  ],
  [
    "docs/design/visual-references/putduk-rank-master-reference.png",
    "b91a1e9bc64456a6d7c73861c7cfa8512eb976867fb112cdecdd083648a80f96",
  ],
]);

for (const [relative, expected] of expectedReferenceHashes) {
  try {
    const contents = await readFile(path.join(root, relative));
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== expected)
      failures.push(`canonical reference changed: ${relative}`);
  } catch {
    failures.push(`missing canonical reference: ${relative}`);
  }
}

const expectedMasterHashes = new Map([
  ...delegatedAIProfiles.map(({ provenance }) => [
    provenance.sourceMaster,
    provenance.sourceSha256,
  ]),
  ...delegatedProductsProfiles.map(({ provenance }) => [
    provenance.sourceMaster,
    provenance.sourceSha256,
  ]),
  ...delegatedSignupProfiles.map(({ provenance }) => [
    provenance.sourceMaster,
    provenance.sourceSha256,
  ]),
  ...delegatedWalletProfiles.map(({ provenance }) => [
    provenance.sourceMaster,
    provenance.sourceSha256,
  ]),
  ...delegatedMiningProfiles.map(({ provenance }) => [
    provenance.sourceMaster,
    provenance.sourceSha256,
  ]),
  [delegatedGiftProvenance.sourceMaster, delegatedGiftProvenance.sourceSha256],
  [aiHelpSource, aiHelpSourceHash],
  [sceneSource, sceneSourceHash],
  [globalSource, globalSourceHash],
  [lightSource, lightSourceHash],
  [towerSource, towerSourceHash],
  [waferLightSource, waferLightSourceHash],
  [goldSource, goldSourceHash],
  [desktopTowerSourceMaster, desktopTowerSourceSha256],
  [desktopWaferLightSourceMaster, desktopWaferLightSourceSha256],
  ...delegatedLoginProfiles.map(({ provenance }) => [
    provenance.sourceMaster,
    provenance.sourceSha256,
  ]),
  [
    "docs/design/generated-masters/putduk-miner-master-v1.png",
    "5efb45738d0cdd72bfb2cc3a24a31d6034eeb33277daa375bf05ab51b8eb1fea",
  ],
  [
    "docs/design/generated-masters/putduk-orbital-earth-master-v1.png",
    "97258f8bbcaab9ba88c16d832c37c336e464afd9d09b7a42e6da4103da093d1b",
  ],
  [
    "docs/design/generated-masters/ranks/rank-01/planet-master-v1.png",
    "bec995da794ab7fd9c9c9336e363f25afda9423f80a86d5b77ddb835763785b4",
  ],
  [
    "docs/design/generated-masters/ranks/rank-02/planet-master-v1.png",
    "bf49055c7dcccabb7f6f0e38db0d20302ed22cdca0c82ea25b3a6b35e192e6be",
  ],
  [
    "docs/design/generated-masters/ranks/rank-03/planet-master-v1.png",
    "7850fef221106b88653e6c616e0cd9b7de5751606071fe78d65379b362b1ec95",
  ],
  [
    "docs/design/generated-masters/ranks/rank-04/planet-master-v1.png",
    "44223317d5652f0f8a3af58b871e5b9a376d01246e79199a73149077c2ad74e7",
  ],
  [
    "docs/design/generated-masters/ranks/rank-05/planet-master-v1.png",
    "75a976baaf4f7edaac4e6fd0e4af64a3e15e21cd46585aa723ec69413b50a026",
  ],
  [
    "docs/design/generated-masters/ranks/rank-06/planet-master-v1.png",
    "73cb455e6415283bb50604897ab7af8a234031c737e707d220db1b9d4f0ecc08",
  ],
]);

for (const expectedPath of approvedAiHelpPaths.keys()) {
  if (
    manifest.assets.filter((asset) => asset.path === expectedPath).length !== 1
  )
    failures.push(
      `AI help derivative must appear exactly once: ${expectedPath}`,
    );
}
for (const expectedPath of [
  ...approvedScenePaths.keys(),
  ...delegatedGlobalPaths.keys(),
  ...delegatedLightPaths.keys(),
  ...delegatedTowerPaths.keys(),
  ...delegatedWaferLightPaths.keys(),
  ...delegatedGoldPaths.keys(),
  ...delegatedDesktopPaths.keys(),
  ...delegatedLoginPaths.keys(),
  ...delegatedGiftPaths.keys(),
  ...delegatedAIPaths.keys(),
  ...delegatedProductsPaths.keys(),
  ...delegatedSignupPaths.keys(),
  ...delegatedWalletPaths.keys(),
  ...delegatedMiningPaths.keys(),
]) {
  if (
    manifest.assets.filter((asset) => asset.path === expectedPath).length !== 1
  )
    failures.push(`scene derivative must appear exactly once: ${expectedPath}`);
}

for (const [relative, expected] of expectedMasterHashes) {
  try {
    const contents = await readFile(path.join(root, relative));
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== expected)
      failures.push(`generated master changed: ${relative}`);
  } catch {
    failures.push(`missing generated master: ${relative}`);
  }
}

for (let index = 1; index <= 6; index += 1) {
  const rank = `rank-${String(index).padStart(2, "0")}`;
  for (const size of [128, 256, 512]) {
    for (const format of ["avif", "webp"]) {
      const expectedPath = `/ranks/${rank}/planet-${size}-v1.${format}`;
      if (!manifest.assets.some((asset) => asset.path === expectedPath)) {
        failures.push(`rank derivative missing from manifest: ${expectedPath}`);
      }
    }
  }
}

const requiredPwa = [
  "/brand/pwa/putduk-pwa-dark-192.png",
  "/brand/pwa/putduk-pwa-dark-512.png",
  "/brand/pwa/putduk-pwa-light-192.png",
  "/brand/pwa/putduk-pwa-light-512.png",
  "/brand/pwa/putduk-pwa-maskable-512.png",
];
for (const expectedPath of requiredPwa) {
  if (!manifest.assets.some((asset) => asset.path === expectedPath)) {
    failures.push(`PWA asset missing from manifest: ${expectedPath}`);
  }
}

const wordmarks = [
  "public/brand/wordmark/putduk-wordmark-dark.svg",
  "public/brand/wordmark/putduk-wordmark-light.svg",
];
for (const relative of wordmarks) {
  const source = await readFile(path.join(root, relative), "utf8");
  if (!source.includes("퍼뜩"))
    failures.push(`wordmark must contain 퍼뜩: ${relative}`);
}

failures.push(...(await verifyCatalogMaterialAssets(root)));
failures.push(...(await verifyMiningResponsiveAssets(root)));

if (failures.length > 0) {
  console.error(
    "PUTDUK brand asset verification failed:\n" +
      failures.map((value) => `- ${value}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `Verified ${manifest.assets.length} PUTDUK brand assets (${manifest.assetVersion}) and 24 catalog material plus 6 mobile Light mining derivatives.`,
);
