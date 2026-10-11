import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedIdentity } from "@/lib/auth/session";
import { readMemberSceneBinding } from "@/lib/product/read-member-scene-binding.server";

const owner = "11111111-1111-4111-8111-111111111111";
const catalogId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const allocationId = "44444444-4444-4444-8444-444444444444";
const publicationDigest = "a".repeat(64);
const contentDigest = "b".repeat(64);
const now = "2026-10-07T12:00:00.000Z";
const effective = "2026-10-07T10:00:00.123456Z";

function state(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    revision: "3",
    allocationId,
    catalogId,
    catalogDigest: publicationDigest,
    effectiveAt: effective,
    products: [{ productId, allocationBps: "10000" }],
    availableProducts: [
      { productId, nameKo: "실제 조회 이름", available: true },
    ],
    currentCatalog: { id: catalogId, digest: publicationDigest },
    runtimeReady: true,
    ...extra,
  };
}
function catalog() {
  return {
    id: catalogId,
    version: 7,
    status: "PUBLISHED",
    snapshot_date: "2026-10-06",
    source_references: [
      { name: "검토된 출처", url: "https://example.com/review" },
    ],
    content_digest: contentDigest,
    approved_by: owner,
    approved_at: "2026-10-07T08:00:00.000Z",
    published_at: "2026-10-07T09:00:00.000Z",
    created_at: "2026-10-06T00:00:00.000Z",
    mining_products: [
      {
        id: productId,
        code: "000660",
        slug: "reviewed-memory-theme",
        category: "KR_STOCK",
        name_ko: "조회된 메모리 테마",
        name_en: "Reviewed Memory Theme",
        description_ko: "조회된 상품 설명",
        display_order: 1,
        is_featured: false,
        trial_available: false,
        created_at: "2026-10-06T00:00:00.000Z",
        product_availability: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            status: "AVAILABLE",
            available_from: "2026-10-07T09:00:00.000Z",
            available_to: null as string | null,
            segment_key: null,
            created_at: "2026-10-07T09:00:00.000Z",
          },
        ],
      },
    ],
  };
}

let first: ReturnType<typeof state>;
let second: ReturnType<typeof state>;
let source: ReturnType<typeof catalog> | null;
let sourceError: unknown;
const claims = vi.fn();
const rpc = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const from = vi.fn();
let identity: VerifiedIdentity;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  first = state();
  second = state();
  source = catalog();
  sourceError = null;
  let reads = 0;
  rpc.mockImplementation(async () => ({
    data: structuredClone(reads++ === 0 ? first : second),
    error: null,
  }));
  claims.mockResolvedValue({ data: { claims: { sub: owner } }, error: null });
  const query = {
    select,
    eq,
    maybeSingle: vi.fn(async () => ({ data: source, error: sourceError })),
  };
  select.mockReturnValue(query);
  eq.mockReturnValue(query);
  from.mockReturnValue(query);
  identity = {
    userId: owner,
    supabase: { auth: { getClaims: claims }, rpc, from },
  } as unknown as VerifiedIdentity;
});
afterEach(() => vi.useRealTimers());

describe("owner-derived selected-product scene presentation", () => {
  it("joins exact current publication without conflating publication and content digests", async () => {
    const result = await readMemberSceneBinding(identity);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected binding");
    expect(result.source).toMatchObject({
      allocationId,
      allocationRevision: "3",
      catalogId,
      catalogVersion: 7,
      catalogPublicationDigest: publicationDigest,
      catalogContentDigest: contentDigest,
      effectiveAt: effective,
      observedAt: now,
    });
    expect(result.products[0]).toMatchObject({
      productId,
      code: "000660",
      nameKo: "조회된 메모리 테마",
      allocationBps: "10000",
      productComplete: false,
    });
    expect(result.products[0]!.scene.visualStatus).toBe("MASTER_READY");
    expect(result.runtimeBinding).toBe("UNCONFIRMED");
    expect(result.scope).toBe("CONFIRMED_ALLOCATION_ONLY");
    expect(result).not.toHaveProperty("running");
    expect(result).not.toHaveProperty("sessionReward");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(
      rpc.mock.calls.every(
        ([name, args]) =>
          name === "confirm_funding_allocation" &&
          args.p_operation === "READ" &&
          !Object.hasOwn(args, "p_user_id"),
      ),
    ).toBe(true);
    expect(from).toHaveBeenCalledExactlyOnceWith("product_catalog_versions");
    expect(eq.mock.calls).toEqual([
      ["id", catalogId],
      ["status", "PUBLISHED"],
    ]);
    expect(select.mock.calls[0]![0]).not.toMatch(
      /rule_payload|display_profile|methodology|app_private/,
    );
  });

  it("uses source identity without borrowing a family for a name or category", async () => {
    source!.mining_products[0]!.code = "UNMAPPED_PRODUCT";
    source!.mining_products[0]!.name_ko = "SK하이닉스 테마";
    const result = await readMemberSceneBinding(identity);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected binding");
    expect(result.products[0]!.scene.visualStatus).toBe("PRESENTATION_MISSING");
    expect(result.products[0]!.scene.productionAssetActive).toBe(false);
    expect(result.products[0]!.productComplete).toBe(false);
  });

  it("preserves null art for published products that lack an accepted master", async () => {
    source!.mining_products[0]!.code = "AAPL";
    source!.mining_products[0]!.category = "US_STOCK";
    const result = await readMemberSceneBinding(identity);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected binding");
    expect(result.products[0]!.scene.visualStatus).toBe("FAMILY_UNASSIGNED");
    expect(result.products[0]!.scene.scene).toBeNull();
  });

  it("uses the independent GPU scene only for an authoritative available NVDA product", async () => {
    source!.mining_products[0]!.code = "NVDA";
    source!.mining_products[0]!.category = "US_STOCK";
    const result = await readMemberSceneBinding(identity);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected binding");
    expect(result.products[0]!.scene.visualStatus).toBe("MASTER_READY");
    expect(result.products[0]!.scene.presentation?.profile.masterVariant).toBe(
      "product-nvda-gpu-v1",
    );
    expect(result.products[0]!.scene.scene?.familyKey).toBe("AI_GPU_COMPUTE");
    expect(result.products[0]!.productComplete).toBe(false);
  });

  it("does not invent a default product when the confirmed allocation is empty", async () => {
    first = state({ products: [] });
    expect((await readMemberSceneBinding(identity)).state).toBe("empty");
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    { currentCatalog: null },
    { catalogId: null },
    { catalogDigest: null },
    { currentCatalog: { id: owner, digest: publicationDigest } },
    { currentCatalog: { id: catalogId, digest: contentDigest } },
  ])(
    "closes stale publication binding without newer-version fallback: %j",
    async (extra) => {
      first = state(extra);
      expect((await readMemberSceneBinding(identity)).state).toBe("stale");
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each([
    { revision: "4" },
    { allocationId: owner },
    { products: [{ productId, allocationBps: "5000" }] },
    { effectiveAt: "2026-10-07T11:00:00.000Z" },
    { catalogDigest: contentDigest },
    { currentCatalog: { id: catalogId, digest: contentDigest } },
  ])(
    "discards concurrent allocation/publication changes: %j",
    async (extra) => {
      second = state(extra);
      expect(await readMemberSceneBinding(identity)).toMatchObject({
        state: "stale",
        products: [],
      });
    },
  );

  it("rejects a mismatched verified subject before any source read", async () => {
    claims.mockResolvedValue({
      data: { claims: { sub: productId } },
      error: null,
    });
    expect((await readMemberSceneBinding(identity)).state).toBe("unknown");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("discards a read if the authenticated subject changes before delivery", async () => {
    claims
      .mockResolvedValueOnce({ data: { claims: { sub: owner } }, error: null })
      .mockResolvedValueOnce({
        data: { claims: { sub: productId } },
        error: null,
      });
    expect(await readMemberSceneBinding(identity)).toMatchObject({
      state: "unknown",
      products: [],
    });
  });

  it("does not expose transport errors or mutate state on read failure", async () => {
    rpc.mockRejectedValueOnce(new Error("internal detail"));
    expect(await readMemberSceneBinding(identity)).toEqual({
      schemaVersion: 1,
      scope: "CONFIRMED_ALLOCATION_ONLY",
      runtimeBinding: "UNCONFIRMED",
      state: "unknown",
      products: [],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps absent exact catalogs unavailable", async () => {
    source = null;
    expect((await readMemberSceneBinding(identity)).state).toBe("unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not retry a catalog error with another projection or version", async () => {
    sourceError = { message: "unavailable" };
    expect((await readMemberSceneBinding(identity)).state).toBe("unknown");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it.each(["PAUSED", "RETIRED"])(
    "closes unavailable product state %s",
    async (status) => {
      source!.mining_products[0]!.product_availability[0]!.status = status;
      expect((await readMemberSceneBinding(identity)).state).toBe(
        "unavailable",
      );
    },
  );

  it("does not infer permission from a matching name when selected UUID is absent", async () => {
    source!.mining_products[0]!.id = owner;
    expect((await readMemberSceneBinding(identity)).state).toBe("unavailable");
  });

  it("evaluates availability again at delivery time", async () => {
    source!.mining_products[0]!.product_availability[0]!.available_to =
      "2026-10-07T12:00:01.000Z";
    claims.mockImplementation(async () => {
      if (claims.mock.calls.length === 2)
        vi.setSystemTime(new Date("2026-10-07T12:00:02.000Z"));
      return { data: { claims: { sub: owner } }, error: null };
    });
    expect((await readMemberSceneBinding(identity)).state).toBe("unavailable");
  });

  it("rejects malformed public catalog without inventing identity", async () => {
    source!.content_digest = "invalid";
    expect((await readMemberSceneBinding(identity)).state).toBe("unknown");
  });

  it("rejects a future allocation boundary", async () => {
    first = state({ effectiveAt: "2026-10-08T10:00:00.000Z" });
    second = structuredClone(first);
    expect((await readMemberSceneBinding(identity)).state).toBe("stale");
  });

  it("rejects a substituted catalog identity instead of rendering matching names", async () => {
    source!.id = owner;
    expect((await readMemberSceneBinding(identity)).state).toBe("stale");
  });

  it.each([
    { revision: "0" },
    { revision: "9223372036854775807" },
    { allocationId: null },
    { effectiveAt: null },
    {
      products: [
        { productId, allocationBps: "5000" },
        { productId, allocationBps: "5000" },
      ],
    },
    {
      products: [
        { productId, allocationBps: "10000" },
        { productId: owner, allocationBps: "1" },
      ],
    },
  ])("rejects unconfirmed selection source shape: %j", async (extra) => {
    first = state(extra);
    expect((await readMemberSceneBinding(identity)).state).toBe("unknown");
    expect(from).not.toHaveBeenCalled();
  });
});
