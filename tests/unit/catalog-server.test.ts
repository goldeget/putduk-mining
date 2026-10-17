import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/products/catalog/route";
import { catalogReviewSchema } from "@/domain/products/catalog-command";
import {
  presentServerCatalogRead,
  serverProductCategories,
} from "@/domain/products/catalog-server";
import {
  presentPublishedCatalogRead,
  productCategories,
} from "@/domain/products/published-catalog";
import {
  getPublishedCatalog,
  getServerPublishedCatalog,
} from "@/lib/product/published-catalog";

const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getVerifiedIdentity: mocks.identity,
}));

const now = "2026-10-03T12:00:00.000Z";
const catalogId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const operatorId = "00000000-0000-4000-8000-000000000003";
const availabilityId = "00000000-0000-4000-8000-000000000004";

function availability(overrides: Record<string, unknown> = {}) {
  return {
    id: availabilityId,
    status: "AVAILABLE",
    available_from: "2026-10-01T00:00:00.000Z",
    available_to: null,
    segment_key: null,
    created_at: "2026-09-28T00:00:00.000Z",
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    code: "TEST_THEME",
    slug: "test-theme",
    category: "ETF",
    name_ko: "합성 테스트 테마",
    name_en: "Synthetic Test Theme",
    description_ko: "실제 상품이 아닌 단위 테스트 자료입니다.",
    display_order: 1,
    is_featured: false,
    trial_available: false,
    created_at: "2026-09-28T00:00:00.000Z",
    product_availability: [availability()],
    ...overrides,
  };
}

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    id: catalogId,
    version: 2,
    status: "PUBLISHED",
    snapshot_date: "2026-09-28",
    source_references: [
      {
        name: "Synthetic public reference",
        url: "https://example.test/source",
      },
    ],
    content_digest: "a".repeat(64),
    approved_by: operatorId,
    approved_at: "2026-09-29T00:00:00.000Z",
    published_at: "2026-09-30T00:00:00.000Z",
    created_at: "2026-09-28T00:00:00.000Z",
    mining_products: [product()],
    ...overrides,
  };
}

function review(category: unknown) {
  return {
    catalogId,
    version: 1,
    status: "DRAFT",
    snapshotDate: "2026-09-28",
    methodology: "Synthetic reviewed fixture",
    sources: [{ name: "Test", url: "https://example.test/source" }],
    products: [
      {
        id: productId,
        code: "TEST_THEME",
        nameKo: "합성 테스트 테마",
        nameEn: "Synthetic Test Theme",
        descriptionKo: "Test only",
        category,
        displayOrder: 1,
      },
    ],
    sourceDigest: "b".repeat(64),
    expectedDigest: "c".repeat(64),
    latestReceipt: null,
    supported: true,
  };
}

describe("canonical six-category catalog and legacy boundary", () => {
  it.each(serverProductCategories)(
    "admits only native category %s",
    (category) => {
      const result = presentServerCatalogRead(
        catalog({ mining_products: [product({ category })] }),
        null,
        now,
      );
      expect(result).toMatchObject({
        state: "loaded",
        products: [{ id: productId, category }],
        legacyUi: {
          state: category === "ETF" ? "UI_PENDING" : "READY",
          pendingProductIds: category === "ETF" ? [productId] : [],
        },
      });
      expect(catalogReviewSchema.safeParse(review(category)).success).toBe(
        true,
      );
    },
  );

  it.each([
    "UNKNOWN",
    "ETF\n",
    "etf",
    "__proto__",
    "<script>alert(1)</script>",
    null,
    ["ETF"],
    { category: "ETF" },
  ])("rejects unknown or malformed categories %j", (category) => {
    expect(
      presentServerCatalogRead(
        catalog({ mining_products: [product({ category })] }),
        null,
        now,
      ),
    ).toMatchObject({
      state: "error",
      reason: "invalid_products",
      products: [],
    });
    expect(catalogReviewSchema.safeParse(review(category)).success).toBe(false);
  });

  it.each(productCategories)(
    "preserves the legacy five-category %s payload",
    (category) => {
      const data = catalog({ mining_products: [product({ category })] });
      const legacy = presentPublishedCatalogRead(data, null, now);
      const canonical = presentServerCatalogRead(data, null, now);
      expect(legacy.state).toBe("loaded");
      if (canonical.state !== "loaded") throw new Error("expected loaded");
      const { legacyUi, ...read } = canonical;
      expect(legacyUi).toEqual({ state: "READY", pendingProductIds: [] });
      expect(read).toEqual(legacy);
    },
  );

  it("keeps every mixed-snapshot product and digest, while leaving legacy decoding unchanged", () => {
    const otherId = "00000000-0000-4000-8000-000000000005";
    const data = catalog({
      mining_products: [
        product({
          id: otherId,
          code: "OTHER_THEME",
          slug: "other-theme",
          category: "GOLD",
          display_order: 2,
        }),
        product(),
      ],
    });
    const result = presentServerCatalogRead(data, null, now);
    expect(result).toMatchObject({
      state: "loaded",
      catalog: { id: catalogId, contentDigest: "a".repeat(64) },
      products: [
        { id: productId, category: "ETF" },
        { id: otherId, category: "GOLD" },
      ],
      legacyUi: { state: "UI_PENDING", pendingProductIds: [productId] },
    });
    expect(presentPublishedCatalogRead(data, null, now)).toMatchObject({
      state: "error",
      reason: "invalid_products",
      products: [],
    });
    expect(productCategories).toEqual([
      "KR_STOCK",
      "US_STOCK",
      "GOLD",
      "SILVER",
      "CRYPTO",
    ]);
  });

  it.each([
    { status: "DRAFT" },
    { status: "APPROVED" },
    { approved_by: null },
    { approved_by: "not-a-uuid" },
    { content_digest: "bad-digest" },
    { approved_at: "2026-10-01T00:00:00.000Z" },
    { published_at: "2026-10-04T00:00:00.000Z" },
    { created_at: "2026-10-01T00:00:00.000Z" },
    { source_references: [] },
    { source_references: [{ name: "Bad", url: "javascript:alert(1)" }] },
    {
      source_references: [
        { name: "Bad", url: "https://user:password@example.test" },
      ],
    },
  ])("shares approval/digest/time validation %j", (overrides) => {
    expect(
      presentServerCatalogRead(catalog(overrides), null, now),
    ).toMatchObject({
      state: "error",
      reason: "invalid_catalog",
      catalog: null,
      products: [],
    });
  });

  it.each([
    [{ available_from: now }, "available"],
    [{ available_to: now }, "unavailable"],
    [{ available_from: "2026-10-04T00:00:00.000Z" }, "scheduled"],
    [{ available_from: "2026-10-03T21:00:00+09:00" }, "available"],
    [{ status: "PAUSED" }, "paused"],
    [{ status: "RETIRED" }, "retired"],
    [{ segment_key: "unknown-segment" }, "unavailable"],
  ] as const)("shares exact availability window %j", (window, state) => {
    const read = presentServerCatalogRead(
      catalog({
        mining_products: [
          product({ product_availability: [availability(window)] }),
        ],
      }),
      null,
      now,
    );
    expect(read).toMatchObject({
      state: "loaded",
      products: [{ availability: { state } }],
    });
  });

  it("keeps snapshot rejection for duplicate products and overlapping windows", () => {
    for (const rows of [
      [product(), product()],
      [product({ product_availability: [availability(), availability()] })],
    ]) {
      expect(
        presentServerCatalogRead(catalog({ mining_products: rows }), null, now),
      ).toMatchObject({
        state: "error",
        reason: "invalid_products",
        products: [],
      });
    }
  });

  it("strips private operator, rule, display and source fields from the canonical DTO", () => {
    const read = presentServerCatalogRead(
      catalog({
        methodology: "PRIVATE-METHODOLOGY",
        source_references: [
          {
            name: "Test",
            url: "https://example.test/source",
            private_map: "PRIVATE-MAP",
          },
        ],
        mining_products: [
          product({
            rule_payload: "PRIVATE-FORMULA",
            display_profile: { reward_rate: "PRIVATE-RATE" },
            world_id: "PRIVATE-WORLD",
          }),
        ],
      }),
      null,
      now,
    );
    expect(read.state).toBe("loaded");
    expect(JSON.stringify(read)).not.toMatch(
      /PRIVATE-|approved_by|rule_payload|display_profile|methodology|world_id/,
    );
    expect(JSON.stringify(read)).not.toContain(operatorId);
  });
});

describe("authenticated canonical catalog GET", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    mocks.identity.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  function reader(data: unknown, error: unknown = null) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    };
    const from = vi.fn().mockReturnValue(query);
    mocks.identity.mockResolvedValue({ userId: productId, supabase: { from } });
    return { from, query };
  }

  it("requires verified identity before any RLS query and returns private 401", async () => {
    const { from } = reader(catalog());
    mocks.identity.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses one bounded RLS projection without private fields or another identity lookup", async () => {
    const { from, query } = reader(catalog());
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      data: {
        state: "loaded",
        products: [{ category: "ETF" }],
        legacyUi: { state: "UI_PENDING", pendingProductIds: [productId] },
      },
    });
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledExactlyOnceWith("product_catalog_versions");
    expect(query.eq).toHaveBeenCalledWith("status", "PUBLISHED");
    expect(query.lte).toHaveBeenCalledWith("published_at", now);
    expect(query.order).toHaveBeenCalledWith("version", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    const projection = query.select.mock.calls[0]![0] as string;
    expect(projection).toContain("mining_products(");
    expect(projection).not.toMatch(
      /\*|rule_payload|display_profile|methodology|world_id/,
    );
  });

  it("preserves the exact SSR query projection for legacy consumers", async () => {
    const legacy = reader(
      catalog({ mining_products: [product({ category: "GOLD" })] }),
    );
    expect((await getPublishedCatalog()).state).toBe("loaded");
    const canonical = reader(catalog());
    expect((await getServerPublishedCatalog()).state).toBe("loaded");
    expect(canonical.query.select.mock.calls).toEqual(
      legacy.query.select.mock.calls,
    );
    expect(canonical.from).toHaveBeenCalledOnce();
  });

  it("keeps an empty approved publication distinct from a failed read", async () => {
    reader(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { state: "empty", catalog: null, products: [] },
    });
    reader(null, { message: "PRIVATE-DB-ERROR" });
    const failed = await GET();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("PRIVATE-DB-ERROR");
  });

  it.each([
    catalog({ approved_by: null }),
    catalog({ mining_products: [product({ category: "MALICIOUS" })] }),
  ])(
    "never retries an older snapshot for malformed latest data",
    async (data) => {
      const { query } = reader(data);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(query.maybeSingle).toHaveBeenCalledOnce();
      expect(await response.json()).toMatchObject({
        error: { code: "CATALOG_READ_UNAVAILABLE" },
      });
    },
  );

  it("contains thrown authentication/network errors without leaking them", async () => {
    const { from, query } = reader(catalog());
    mocks.identity.mockRejectedValueOnce(new Error("PRIVATE-AUTH-ERROR"));
    const authFailure = await GET();
    expect(authFailure.status).toBe(503);
    expect(await authFailure.text()).not.toContain("PRIVATE-AUTH-ERROR");
    expect(from).not.toHaveBeenCalled();
    query.maybeSingle.mockRejectedValueOnce(new Error("PRIVATE-NETWORK-ERROR"));
    const queryFailure = await GET();
    expect(queryFailure.status).toBe(503);
    expect(await queryFailure.text()).not.toContain("PRIVATE-NETWORK-ERROR");
  });
});
