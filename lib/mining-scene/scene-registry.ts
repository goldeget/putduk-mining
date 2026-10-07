import type {
  AmbientPreset,
  ApprovedSceneDefinition,
  ApprovedMasterVariant,
  ParticleEmphasis,
  PendingSceneDefinition,
  SceneDefinition,
  SceneFamilyKey,
  ScenePoint,
  ProductCategory,
} from "@/lib/mining-scene/types";

/**
 * 패밀리별 Scene 정의.
 * MiningLiveStage 는 이 표를 스위치하지 않는다.
 * 인간의 후속 시각 선택 위임에 따라 clean memory master만 승인했다.
 * 다른 13개 패밀리는 VISUAL_MASTER_REQUIRED 를 유지한다.
 * 이 승인은 상품 선택, 경제 정책이나 실행 상태의 승인이 아니다.
 */

export type SceneEconomicPolicy = "NONE" | "DECISION_REQUIRED";

export type SceneRegistryRow<K extends SceneFamilyKey = SceneFamilyKey> = {
  readonly familyKey: K;
  readonly version: 1;
  readonly economicPolicy: K extends "ETF_BASKET"
    ? "DECISION_REQUIRED"
    : "NONE";
  readonly definition: SceneDefinition & { readonly familyKey: K };
};

export type SceneRegistry = {
  readonly [K in SceneFamilyKey]: SceneRegistryRow<K>;
};

function unitPoint(point: ScenePoint): ScenePoint {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1
  ) {
    throw new Error("SCENE_POINT_OUT_OF_RANGE");
  }
  return { x: point.x, y: point.y };
}

function pendingScene<K extends SceneFamilyKey>(
  familyKey: K,
  anchor: ScenePoint,
  extractionTarget: ScenePoint,
  particle: ParticleEmphasis,
  ambient: AmbientPreset,
): PendingSceneDefinition & { readonly familyKey: K } {
  return {
    familyKey,
    version: 1,
    packStatus: "VISUAL_MASTER_REQUIRED",
    master: null,
    responsiveSources: [],
    productionAssetActive: false,
    anchor: unitPoint(anchor),
    extractionTarget: unitPoint(extractionTarget),
    particle,
    ambient,
    reducedMotion: "static",
    performance: {
      maxParticles: 0,
      renderer: "none",
      webgl: false,
      timerAdvancesValue: false,
    },
  };
}

function row<K extends SceneFamilyKey>(
  familyKey: K,
  economicPolicy: K extends "ETF_BASKET" ? "DECISION_REQUIRED" : "NONE",
  anchor: ScenePoint,
  extractionTarget: ScenePoint,
  particle: ParticleEmphasis,
  ambient: AmbientPreset,
): SceneRegistryRow<K> {
  return {
    familyKey,
    version: 1,
    economicPolicy,
    definition: pendingScene(
      familyKey,
      anchor,
      extractionTarget,
      particle,
      ambient,
    ),
  };
}

/** 전체 master에서 HBM 중심(770,240), reactor 중심(770,710)의 정규화 좌표. */
export const SEMICONDUCTOR_MEMORY_APPROVED_SCENE = {
  familyKey: "SEMICONDUCTOR_MEMORY",
  version: 1,
  packStatus: "APPROVED",
  master: {
    sha256: "5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd",
    assetPath:
      "/brand/scenes/semiconductor-memory/semiconductor-memory-1539-v1.webp",
    width: 1539,
    height: 1022,
    altKo: "금빛과 푸른빛이 반사되는 반도체 시설과 중앙 추출 장치",
    lightVariant: {
      master: {
        sha256:
          "113fdbc5c41772145f98f3357f27754fa1bd20602a5261c133becc0fa1126d52",
        assetPath:
          "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1536-v1.webp",
        width: 1536,
        height: 1024,
        altKo: "밝은 전시장에 놓인 금빛 반도체와 정밀한 원형 장치",
      },
      responsiveSources: [
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-640-v1.avif",
          width: 640,
          height: 427,
          mimeType: "image/avif",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-640-v1.webp",
          width: 640,
          height: 427,
          mimeType: "image/webp",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-960-v1.avif",
          width: 960,
          height: 640,
          mimeType: "image/avif",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-960-v1.webp",
          width: 960,
          height: 640,
          mimeType: "image/webp",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1280-v1.avif",
          width: 1280,
          height: 853,
          mimeType: "image/avif",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1280-v1.webp",
          width: 1280,
          height: 853,
          mimeType: "image/webp",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1536-v1.avif",
          width: 1536,
          height: 1024,
          mimeType: "image/avif",
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1536-v1.webp",
          width: 1536,
          height: 1024,
          mimeType: "image/webp",
        },
      ],
    },
  },
  responsiveSources: [
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-640-v1.avif",
      width: 640,
      height: 425,
      mimeType: "image/avif",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-640-v1.webp",
      width: 640,
      height: 425,
      mimeType: "image/webp",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-960-v1.avif",
      width: 960,
      height: 638,
      mimeType: "image/avif",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-960-v1.webp",
      width: 960,
      height: 638,
      mimeType: "image/webp",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-1280-v1.avif",
      width: 1280,
      height: 850,
      mimeType: "image/avif",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-1280-v1.webp",
      width: 1280,
      height: 850,
      mimeType: "image/webp",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-1539-v1.avif",
      width: 1539,
      height: 1022,
      mimeType: "image/avif",
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/semiconductor-memory/semiconductor-memory-1539-v1.webp",
      width: 1539,
      height: 1022,
      mimeType: "image/webp",
    },
  ],
  productionAssetActive: true,
  anchor: unitPoint({ x: 0.5, y: 0.235 }),
  extractionTarget: unitPoint({ x: 0.5, y: 0.695 }),
  particle: "steady",
  ambient: "cool",
  reducedMotion: "static",
  performance: {
    maxParticles: 12,
    maxFps: 30,
    maxDpr: 1.5,
    renderer: "canvas-2d",
    webgl: false,
    timerAdvancesValue: false,
  },
} as const satisfies ApprovedSceneDefinition;

/** Product-specific NVDA GPU master; family default remains visually pending. */
export const NVDA_GPU_APPROVED_SCENE = {
  familyKey: "AI_GPU_COMPUTE",
  version: 1,
  packStatus: "APPROVED",
  master: {
    sha256: "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
    assetPath:
      "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1672.webp",
    width: 1672,
    height: 941,
    altKo: "GPU 연산 장치와 원형 추출 장치가 놓인 짙은 서버실",
    lightVariant: {
      master: {
        sha256:
          "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
        assetPath:
          "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1672.webp",
        width: 1672,
        height: 941,
        altKo: "GPU 연산 장치와 원형 추출 장치가 놓인 밝은 서버실",
      },
      responsiveSources: [
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-480.avif",
          width: 480,
          height: 720,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-480.webp",
          width: 480,
          height: 720,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-640.avif",
          width: 640,
          height: 960,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-640.webp",
          width: 640,
          height: 960,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-960.avif",
          width: 960,
          height: 1440,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-960.webp",
          width: 960,
          height: 1440,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-1024.avif",
          width: 1024,
          height: 1536,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "(max-width: 699px)",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-1024.webp",
          width: 1024,
          height: 1536,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
            anchor: {
              x: 0.5,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.5,
              y: 0.75,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-640.avif",
          width: 640,
          height: 360,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-640.webp",
          width: 640,
          height: 360,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-960.avif",
          width: 960,
          height: 540,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-960.webp",
          width: 960,
          height: 540,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1280.avif",
          width: 1280,
          height: 720,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1280.webp",
          width: 1280,
          height: 720,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1672.avif",
          width: 1672,
          height: 941,
          mimeType: "image/avif",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
        {
          media: "",
          assetPath:
            "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1672.webp",
          width: 1672,
          height: 941,
          mimeType: "image/webp",
          composition: {
            masterSha256:
              "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
            anchor: {
              x: 0.73,
              y: 0.5,
            },
            extractionTarget: {
              x: 0.73,
              y: 0.78,
            },
          },
        },
      ],
    },
  },
  responsiveSources: [
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-480.avif",
      width: 480,
      height: 720,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-480.webp",
      width: 480,
      height: 720,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-640.avif",
      width: 640,
      height: 960,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-640.webp",
      width: 640,
      height: 960,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-960.avif",
      width: 960,
      height: 1440,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-960.webp",
      width: 960,
      height: 1440,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-1024.avif",
      width: 1024,
      height: 1536,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "(max-width: 699px)",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-1024.webp",
      width: 1024,
      height: 1536,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
        anchor: {
          x: 0.5,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.5,
          y: 0.75,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-640.avif",
      width: 640,
      height: 360,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-640.webp",
      width: 640,
      height: 360,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-960.avif",
      width: 960,
      height: 540,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-960.webp",
      width: 960,
      height: 540,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1280.avif",
      width: 1280,
      height: 720,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1280.webp",
      width: 1280,
      height: 720,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1672.avif",
      width: 1672,
      height: 941,
      mimeType: "image/avif",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
    {
      media: "",
      assetPath:
        "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1672.webp",
      width: 1672,
      height: 941,
      mimeType: "image/webp",
      composition: {
        masterSha256:
          "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
        anchor: {
          x: 0.73,
          y: 0.5,
        },
        extractionTarget: {
          x: 0.73,
          y: 0.78,
        },
      },
    },
  ],
  productionAssetActive: true,
  anchor: {
    x: 0.73,
    y: 0.5,
  },
  extractionTarget: {
    x: 0.73,
    y: 0.78,
  },
  particle: "steady",
  ambient: "cool",
  reducedMotion: "static",
  performance: {
    maxParticles: 12,
    maxFps: 30,
    maxDpr: 1.5,
    renderer: "canvas-2d",
    webgl: false,
    timerAdvancesValue: false,
  },
} as const satisfies ApprovedSceneDefinition;

/** 명시 승인된 기본 시각 배경. 상품/카테고리/회원 상태에서 추론하지 않는다. */
export const DEFAULT_STAGE_BACKDROP = {
  definition: SEMICONDUCTOR_MEMORY_APPROVED_SCENE,
  accentToken: "--brand-primary",
  userCopyKo: "채굴 현황",
  a11yLabelKo: "현재 채굴 현황",
} as const;

export const SCENE_REGISTRY: SceneRegistry = {
  SEMICONDUCTOR_MEMORY: {
    familyKey: "SEMICONDUCTOR_MEMORY",
    version: 1,
    economicPolicy: "NONE",
    definition: SEMICONDUCTOR_MEMORY_APPROVED_SCENE,
  },
  SEMICONDUCTOR_FOUNDRY: row(
    "SEMICONDUCTOR_FOUNDRY",
    "NONE",
    { x: 0.48, y: 0.5 },
    { x: 0.52, y: 0.7 },
    "none",
    "still",
  ),
  SEMICONDUCTOR_COMPUTE: row(
    "SEMICONDUCTOR_COMPUTE",
    "NONE",
    { x: 0.5, y: 0.42 },
    { x: 0.5, y: 0.66 },
    "sparse",
    "cool",
  ),
  AI_GPU_COMPUTE: row(
    "AI_GPU_COMPUTE",
    "NONE",
    { x: 0.62, y: 0.48 },
    { x: 0.58, y: 0.64 },
    "steady",
    "cool",
  ),
  PRECIOUS_GOLD: row(
    "PRECIOUS_GOLD",
    "NONE",
    { x: 0.5, y: 0.58 },
    { x: 0.5, y: 0.74 },
    "sparse",
    "warm",
  ),
  PRECIOUS_SILVER: row(
    "PRECIOUS_SILVER",
    "NONE",
    { x: 0.46, y: 0.56 },
    { x: 0.5, y: 0.72 },
    "sparse",
    "cool",
  ),
  BLOCKCHAIN_HASH: row(
    "BLOCKCHAIN_HASH",
    "NONE",
    { x: 0.4, y: 0.5 },
    { x: 0.44, y: 0.68 },
    "steady",
    "neutral",
  ),
  CRYPTO_NETWORK: row(
    "CRYPTO_NETWORK",
    "NONE",
    { x: 0.56, y: 0.44 },
    { x: 0.5, y: 0.66 },
    "sparse",
    "cool",
  ),
  AUTO_MOBILITY: row(
    "AUTO_MOBILITY",
    "NONE",
    { x: 0.5, y: 0.6 },
    { x: 0.5, y: 0.78 },
    "none",
    "still",
  ),
  ENERGY_OIL: row(
    "ENERGY_OIL",
    "NONE",
    { x: 0.48, y: 0.62 },
    { x: 0.5, y: 0.8 },
    "none",
    "still",
  ),
  FINANCE_CAPITAL: row(
    "FINANCE_CAPITAL",
    "NONE",
    { x: 0.5, y: 0.4 },
    { x: 0.5, y: 0.6 },
    "none",
    "still",
  ),
  BIO_HEALTH: row(
    "BIO_HEALTH",
    "NONE",
    { x: 0.52, y: 0.48 },
    { x: 0.5, y: 0.7 },
    "none",
    "still",
  ),
  CONSUMER_RETAIL: row(
    "CONSUMER_RETAIL",
    "NONE",
    { x: 0.5, y: 0.52 },
    { x: 0.5, y: 0.7 },
    "none",
    "warm",
  ),
  ETF_BASKET: row(
    "ETF_BASKET",
    "DECISION_REQUIRED",
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    "none",
    "still",
  ),
};

export function getSceneRow<K extends SceneFamilyKey>(
  familyKey: K,
): SceneRegistryRow<K> {
  return SCENE_REGISTRY[familyKey];
}

/**
 * Reviewed product variants are independent from family defaults. New products
 * sharing a family need their own reviewed entry; a caller cannot borrow one by
 * supplying the same family or a known master hash.
 */
export const APPROVED_PRODUCT_MASTER_VARIANTS = {
  "semiconductor-memory-v1": {
    productCodes: ["000660"],
    category: "KR_STOCK",
    familyKey: "SEMICONDUCTOR_MEMORY",
    familyVersion: 1,
    definition: SEMICONDUCTOR_MEMORY_APPROVED_SCENE,
  },
  "product-nvda-gpu-v1": {
    productCodes: ["NVDA"],
    category: "US_STOCK",
    familyKey: "AI_GPU_COMPUTE",
    familyVersion: 1,
    definition: NVDA_GPU_APPROVED_SCENE,
  },
} as const satisfies Record<
  ApprovedMasterVariant,
  {
    readonly productCodes: readonly string[];
    readonly category: ProductCategory;
    readonly familyKey: SceneFamilyKey;
    readonly familyVersion: 1;
    readonly definition: ApprovedSceneDefinition;
  }
>;

export function getApprovedProductMasterVariant(
  variant: ApprovedMasterVariant,
  productCode: string,
  familyKey: SceneFamilyKey,
  familyVersion: number,
  productCategory: ProductCategory,
): ApprovedSceneDefinition | null {
  const row = APPROVED_PRODUCT_MASTER_VARIANTS[variant];
  if (
    !row ||
    !(row.productCodes as readonly string[]).includes(productCode) ||
    row.familyKey !== familyKey ||
    row.familyVersion !== familyVersion ||
    row.category !== productCategory
  )
    return null;
  return row.definition;
}
