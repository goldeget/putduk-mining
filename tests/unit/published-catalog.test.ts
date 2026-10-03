import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presentPublishedCatalogRead } from "@/domain/products/published-catalog";
import { getPublishedCatalog } from "@/lib/product/published-catalog";

const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getVerifiedIdentity: mocks.identity,
}));

const now = "2026-10-03T12:00:00.000Z";
const catalogId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const approvalId = "00000000-0000-4000-8000-000000000003";
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
    category: "GOLD",
    name_ko: "검토된 테스트 테마",
    name_en: "Reviewed Test Theme",
    description_ko: "단위 테스트용 승인 snapshot입니다.",
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
        name: "Operator-reviewed public reference",
        url: "https://example.com/source",
        accessed_on: "2026-09-28",
      },
    ],
    content_digest: "a".repeat(64),
    approved_by: approvalId,
    approved_at: "2026-09-29T00:00:00.000Z",
    published_at: "2026-09-30T00:00:00.000Z",
    created_at: "2026-09-28T00:00:00.000Z",
    mining_products: [product()],
    ...overrides,
  };
}

function firstAvailability(row: unknown) {
  const result = presentPublishedCatalogRead(row, null, now);
  expect(result.state).toBe("loaded");
  if (result.state !== "loaded") throw new Error("expected loaded catalog");
  return result.products[0]!.availability;
}

describe("published catalog read projection", () => {
  it("keeps empty and a failed query distinct", () => {
    expect(presentPublishedCatalogRead(null, null, now).state).toBe("empty");
    expect(
      presentPublishedCatalogRead(null, { code: "42501" }, now),
    ).toMatchObject({
      state: "error",
      reason: "query_failed",
      products: [],
      catalog: null,
    });
    expect(presentPublishedCatalogRead(undefined, null, now).state).toBe(
      "error",
    );
  });

  it("preserves dated publication/source/effective evidence without economic fields", () => {
    const result = presentPublishedCatalogRead(
      catalog({
        methodology: "PRIVATE-METHODOLOGY",
        source_references: [
          {
            name: "Source",
            url: "https://example.com/source",
            private_map: "PRIVATE-MAP",
          },
        ],
        mining_products: [
          product({
            display_profile: { reward_rate: "PRIVATE-RATE" },
            rule_payload: "PRIVATE-FORMULA",
          }),
        ],
      }),
      null,
      now,
    );
    expect(result.state).toBe("loaded");
    if (result.state !== "loaded") throw new Error("expected loaded catalog");
    expect(result.catalog).toMatchObject({
      id: catalogId,
      version: 2,
      snapshotDate: "2026-09-28",
      approvedAt: "2026-09-29T00:00:00.000Z",
      publishedAt: "2026-09-30T00:00:00.000Z",
      contentDigest: "a".repeat(64),
    });
    expect(result.observedAt).toBe(now);
    expect(result.products[0]!.availability.availableFrom).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE-|approved_by|rule_payload|display_profile/,
    );
    expect(JSON.stringify(result)).not.toContain(approvalId);
  });

  it.each([
    { status: "DRAFT" },
    { status: "APPROVED" },
    { status: "RETIRED" },
    { approved_by: null, approved_at: null },
    { approved_by: "invalid" },
    { approved_at: "2026-10-01T00:00:00.000Z" },
    { published_at: "2026-10-04T00:00:00.000Z" },
    { published_at: null },
    { source_references: [] },
    { source_references: [{ name: "Unsafe", url: "javascript:alert(1)" }] },
    { snapshot_date: "2026-02-31" },
    { content_digest: "not-a-digest" },
    { version: 2_147_483_648 },
    { source_references: [{ name: "Malformed", url: "not a URL" }] },
    {
      source_references: [
        { name: "Credentials", url: "https://user:password@example.com" },
      ],
    },
  ])("fails closed for invalid/unapproved catalog metadata %j", (overrides) => {
    expect(
      presentPublishedCatalogRead(catalog(overrides), null, now),
    ).toMatchObject({
      state: "error",
      reason: "invalid_catalog",
      catalog: null,
      products: [],
    });
  });

  it("compares instants with offsets rather than timestamp strings", () => {
    expect(
      presentPublishedCatalogRead(
        catalog({ published_at: "2026-10-03T20:00:00+09:00" }),
        null,
        now,
      ).state,
    ).toBe("loaded");
    expect(
      presentPublishedCatalogRead(
        catalog({ published_at: "2026-10-03T08:00:00-05:00" }),
        null,
        now,
      ).state,
    ).toBe("error");
  });

  it("keeps a published empty snapshot's evidence", () => {
    expect(
      presentPublishedCatalogRead(catalog({ mining_products: [] }), null, now),
    ).toMatchObject({
      state: "loaded",
      catalog: { id: catalogId },
      products: [],
    });
  });

  it("does not salvage valid items from a malformed snapshot or duplicate order", () => {
    for (const rows of [
      [product(), product({ id: "invalid" })],
      [
        product(),
        product({
          id: "00000000-0000-4000-8000-000000000005",
          code: "OTHER",
          slug: "other",
        }),
      ],
    ]) {
      expect(
        presentPublishedCatalogRead(
          catalog({ mining_products: rows }),
          null,
          now,
        ),
      ).toMatchObject({
        state: "error",
        reason: "invalid_products",
        products: [],
      });
    }
  });

  it("sorts the actual operator display order", () => {
    const result = presentPublishedCatalogRead(
      catalog({
        mining_products: [
          product({
            id: "00000000-0000-4000-8000-000000000005",
            code: "OTHER",
            slug: "other",
            display_order: 2,
          }),
          product(),
        ],
      }),
      null,
      now,
    );
    if (result.state !== "loaded") throw new Error("expected loaded catalog");
    expect(result.products.map((row) => row.displayOrder)).toEqual([1, 2]);
  });

  it("applies inclusive start and exclusive end; missing windows never mean available", () => {
    expect(
      firstAvailability(
        catalog({
          mining_products: [
            product({
              product_availability: [availability({ available_from: now })],
            }),
          ],
        }),
      ).state,
    ).toBe("available");
    expect(
      firstAvailability(
        catalog({
          mining_products: [
            product({
              product_availability: [availability({ available_to: now })],
            }),
          ],
        }),
      ).state,
    ).toBe("unavailable");
    expect(
      firstAvailability(
        catalog({ mining_products: [product({ product_availability: [] })] }),
      ).state,
    ).toBe("unavailable");
  });

  it.each(["PAUSED", "RETIRED", "SCHEDULED"])(
    "never promotes an active %s window to available",
    (status) => {
      expect(
        firstAvailability(
          catalog({
            mining_products: [
              product({ product_availability: [availability({ status })] }),
            ],
          }),
        ).state,
      ).toBe(status.toLowerCase());
    },
  );

  it("keeps a future AVAILABLE window scheduled", () => {
    expect(
      firstAvailability(
        catalog({
          mining_products: [
            product({
              product_availability: [
                availability({ available_from: "2026-10-04T00:00:00.000Z" }),
              ],
            }),
          ],
        }),
      ).state,
    ).toBe("scheduled");
  });

  it("does not guess segment membership", () => {
    expect(
      firstAvailability(
        catalog({
          mining_products: [
            product({
              product_availability: [
                availability({ segment_key: "qualified-segment" }),
              ],
            }),
          ],
        }),
      ).state,
    ).toBe("unavailable");
  });

  it("rejects overlapping active general windows and malformed windows", () => {
    for (const rows of [
      [
        availability(),
        availability({
          id: "00000000-0000-4000-8000-000000000005",
          status: "PAUSED",
          available_from: "2026-10-02T00:00:00.000Z",
        }),
      ],
      [availability({ available_to: "2026-09-01T00:00:00.000Z" })],
    ]) {
      expect(
        presentPublishedCatalogRead(
          catalog({
            mining_products: [product({ product_availability: rows })],
          }),
          null,
          now,
        ),
      ).toMatchObject({
        state: "error",
        reason: "invalid_products",
        products: [],
      });
    }
  });
});

describe("authenticated server catalog read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    mocks.identity.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  function reader(response: { data: unknown; error: unknown }) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(response),
    };
    const from = vi.fn().mockReturnValue(query);
    mocks.identity.mockResolvedValue({
      userId: approvalId,
      supabase: { from },
    });
    return { from, query };
  }

  it("does not read a catalog when identity is absent", async () => {
    const { from } = reader({ data: catalog(), error: null });
    mocks.identity.mockResolvedValue(null);
    expect((await getPublishedCatalog()).state).toBe("unauthenticated");
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the verified RLS client, one bounded published projection and the server cutoff", async () => {
    const { from, query } = reader({ data: catalog(), error: null });
    expect((await getPublishedCatalog()).state).toBe("loaded");
    expect(from).toHaveBeenCalledExactlyOnceWith("product_catalog_versions");
    expect(query.eq).toHaveBeenCalledWith("status", "PUBLISHED");
    expect(query.lte).toHaveBeenCalledWith("published_at", now);
    expect(query.order).toHaveBeenCalledWith("version", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
    const projection = query.select.mock.calls[0]![0] as string;
    expect(projection).toContain("mining_products(");
    expect(projection).toContain("product_availability(");
    expect(projection).not.toMatch(
      /\*|rule_payload|display_profile|methodology|world_id/,
    );
  });

  it("separates no published catalog from permission/network failure", async () => {
    reader({ data: null, error: null });
    expect((await getPublishedCatalog()).state).toBe("empty");
    const { query } = reader({ data: null, error: { code: "42501" } });
    expect(await getPublishedCatalog()).toMatchObject({
      state: "error",
      reason: "query_failed",
    });
    query.maybeSingle.mockRejectedValue(new Error("network failure"));
    expect(await getPublishedCatalog()).toMatchObject({
      state: "error",
      reason: "query_failed",
    });
  });

  it("rejects a malformed latest row without fetching an older fallback", async () => {
    const { query } = reader({
      data: catalog({ approved_by: null }),
      error: null,
    });
    expect(await getPublishedCatalog()).toMatchObject({
      state: "error",
      reason: "invalid_catalog",
      products: [],
    });
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });
});
