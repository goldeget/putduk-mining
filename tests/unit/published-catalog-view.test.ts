import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProductsPage from "@/app/(product)/products/page";
import ProductsLoading from "@/app/(product)/products/loading";
import ProductsError from "@/app/(product)/products/error";
import { PublishedCatalogView } from "@/components/product/published-catalog-view";
import {
  presentPublishedCatalogRead,
  type PublishedCatalogRead,
  type PublishedProductAvailability,
} from "@/domain/products/published-catalog";

const mocks = vi.hoisted(() => ({
  requirePageUser: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/auth/session", () => ({
  requirePageUser: mocks.requirePageUser,
}));
vi.mock("@/lib/product/published-catalog", () => ({
  getPublishedCatalog: mocks.read,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));

const observedAt = "2026-10-03T12:00:00.000Z";
const approvalId = "00000000-0000-4000-8000-000000000003";

function publishedRead(): Extract<PublishedCatalogRead, { state: "loaded" }> {
  const read = presentPublishedCatalogRead(
    {
      id: "00000000-0000-4000-8000-000000000001",
      version: 7,
      status: "PUBLISHED",
      snapshot_date: "2026-09-28",
      source_references: [
        {
          name: "검토한 공개 자료",
          url: "https://catalog-test.invalid/source",
          accessed_on: "2026-09-29",
          snapshot_on: "2026-09-28",
          private_map: "PRIVATE-SOURCE-MAP",
        },
      ],
      content_digest: "a".repeat(64),
      approved_by: approvalId,
      approved_at: "2026-09-29T00:00:00.000Z",
      published_at: "2026-09-30T00:00:00.000Z",
      created_at: "2026-09-28T00:00:00.000Z",
      methodology: "PRIVATE-METHODOLOGY",
      mining_products: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          code: "TEST_PUBLIC_THEME",
          slug: "test-public-theme",
          category: "GOLD",
          name_ko: "운영자가 검토한 테마",
          name_en: "Approved theme",
          description_ko: "공개 자료에서 확인한 실제 설명이에요.",
          display_order: 1,
          is_featured: false,
          trial_available: false,
          created_at: "2026-09-28T00:00:00.000Z",
          display_profile: { reward_rate: "PRIVATE-REWARD-RATE" },
          rule_payload: "PRIVATE-FORMULA",
          product_availability: [
            {
              id: "00000000-0000-4000-8000-000000000004",
              status: "AVAILABLE",
              available_from: "2026-10-01T00:00:00.000Z",
              available_to: "2026-10-05T00:00:00.000Z",
              segment_key: null,
              created_at: "2026-09-28T00:00:00.000Z",
            },
          ],
        },
      ],
    },
    null,
    observedAt,
  );
  if (read.state !== "loaded") throw new Error("expected validated catalog");
  return read;
}

function markup(read: PublishedCatalogRead) {
  return renderToStaticMarkup(createElement(PublishedCatalogView, { read }));
}

beforeEach(() => {
  mocks.requirePageUser
    .mockReset()
    .mockResolvedValue({ userId: "verified-member" });
  mocks.read.mockReset();
  mocks.redirect.mockClear();
  mocks.refresh.mockClear();
});

describe("the actual published-catalog screen", () => {
  it("shows an honest empty catalog, approved static Earth and one mining destination", () => {
    const html = markup({
      state: "empty",
      catalog: null,
      products: [],
      observedAt,
    });
    expect(html).toContain("공개된 상품이");
    expect(html).toContain("아직 없어요");
    expect(html).toContain("새 상품이 공개되면");
    expect(html).toContain('href="/mining"');
    expect(html).toContain("채굴 보기");
    expect(html.match(/<a\s/g)).toHaveLength(1);
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(html).toContain('data-ui-ready="/products"');
    expect(html).toContain('data-ui-state="empty"');
    expect(html).toContain(`data-observed-at="${observedAt}"`);
    expect(html).toContain(`dateTime="${observedAt}"`);
    expect(html).toContain("orbital-earth-960-v1.avif 960w");
    expect(html).toContain("orbital-earth-1600-v1.webp 1600w");
    expect(html).toContain('alt=""');
    expect(html).not.toMatch(
      /<canvas|<form|<details|coming soon|준비 중|KRW|USDT|선택 완료|채굴 시작/,
    );
  });

  it.each(["query_failed", "invalid_catalog", "invalid_products"] as const)(
    "keeps %s distinct from empty and uses the existing read recovery control",
    (reason) => {
      const html = markup({
        state: "error",
        reason,
        catalog: null,
        products: [],
        observedAt,
      });
      expect(html).toContain('data-ui-state="error"');
      expect(html).toContain('role="alert"');
      expect(html).toContain("상품을 불러오지 못했어요");
      expect(html).toContain("다시 확인");
      expect(html).toContain('<button class="button button--primary"');
      expect(html).not.toMatch(
        /아직 없어요|orbital-earth|query_failed|invalid_catalog|invalid_products|KRW|USDT/,
      );
    },
  );

  it("does not fabricate a read timestamp when invalid source observation caused the error", () => {
    const html = markup(
      presentPublishedCatalogRead(null, null, "invalid-time"),
    );
    expect(html).toContain("상품을 불러오지 못했어요");
    expect(html).not.toContain("확인한 시각");
    expect(html).not.toContain("Invalid Date");
  });

  it("renders approved names, native disclosure and dated publication evidence without private rules or activation", () => {
    const html = markup(publishedRead());
    expect(html).toContain('data-ui-state="loaded"');
    expect(html).toContain("운영자가 검토한 테마");
    expect(html).toContain("공개 자료에서 확인한 실제 설명이에요.");
    expect(html).toContain("제공 중");
    expect(html).toContain("자세히 보기");
    expect(html.match(/<details(?:\s|>)/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
    expect(html).toContain("자료 기준일");
    expect(html).toContain('dateTime="2026-09-28"');
    expect(html).toContain("승인일");
    expect(html).toContain('dateTime="2026-09-29T00:00:00.000Z"');
    expect(html).toContain("공개일");
    expect(html).toContain('dateTime="2026-09-30T00:00:00.000Z"');
    expect(html).toContain("제공 시작");
    expect(html).toContain('dateTime="2026-10-01T00:00:00.000Z"');
    expect(html).toContain("제공 종료");
    expect(html).toContain('href="https://catalog-test.invalid/source"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(새 창)");
    expect(html).not.toMatch(
      /PRIVATE-|approved_by|rule_payload|display_profile|<form|<button|\/api\/|선택 완료|채굴 시작|보장 수익|KRW|USDT/,
    );
    expect(html).not.toContain(approvalId);
  });

  it.each([
    ["available", "제공 중"],
    ["scheduled", "제공 예정"],
    ["paused", "제공 중단"],
    ["retired", "제공 종료"],
    ["unavailable", "제공 상태 확인 필요"],
  ] as const)(
    "preserves the supplied %s availability without making a selection",
    (state, label) => {
      const read = publishedRead();
      read.products[0]!.availability = {
        state,
        availableFrom: null,
        availableTo: null,
        recordedAt: null,
      } satisfies PublishedProductAvailability;
      const html = markup(read);
      expect(html).toContain(`data-availability="${state}"`);
      expect(html).toContain(label);
      expect(html).not.toMatch(
        /<button|<form|채굴 시작|선택 완료|제공 시작|제공 종료<\/dt/,
      );
    },
  );

  it("retains evidence for a published empty snapshot instead of inventing products", () => {
    const read = publishedRead();
    read.products = [];
    const html = markup(read);
    expect(html).toContain('data-ui-state="loaded"');
    expect(html).toContain("아직 없어요");
    expect(html).toContain("공개 정보와 출처");
    expect(html).not.toContain("운영자가 검토한 테마");
  });

  it("shows no catalog evidence in an unauthenticated view", () => {
    const html = markup({
      state: "unauthenticated",
      catalog: null,
      products: [],
      observedAt,
    });
    expect(html).toContain("로그인이 필요해요");
    expect(html).toContain('href="/login?next=%2Fproducts"');
    expect(html).not.toMatch(
      /data-ui-ready|orbital-earth|승인일|공개 정보|확인한 시각|아직 없어요/,
    );
  });

  it("loading and unexpected failure do not claim a finished read or expose the exception", () => {
    const loading = renderToStaticMarkup(createElement(ProductsLoading));
    expect(loading).toContain('data-ui-state="loading"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("상품을 확인하고 있어요");
    expect(loading).not.toMatch(
      /data-ui-ready|data-observed-at|아직 없어요|<details|KRW|USDT/,
    );
    const error = renderToStaticMarkup(
      createElement(ProductsError, {
        error: new Error("PRIVATE-SQL-CONNECTION"),
        retry: vi.fn(),
      }),
    );
    expect(error).toContain('data-ui-state="error"');
    expect(error).toContain("상품 화면을 열지 못했어요");
    expect(error).toContain("다시 확인");
    expect(error).not.toMatch(
      /PRIVATE-|data-ui-ready|data-observed-at|아직 없어요/,
    );
  });
});

describe("the authenticated products route", () => {
  it("uses the verified server boundary before reading and renders the actual read DTO", async () => {
    mocks.read.mockResolvedValue(publishedRead());
    const html = renderToStaticMarkup(await ProductsPage());
    expect(mocks.requirePageUser).toHaveBeenCalledExactlyOnceWith("/products");
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.requirePageUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.read.mock.invocationCallOrder[0]!,
    );
    expect(html).toContain("운영자가 검토한 테마");
  });

  it("does not read products when the page identity boundary rejects access", async () => {
    mocks.requirePageUser.mockRejectedValue(
      new Error("AUTH_BOUNDARY_REDIRECT"),
    );
    await expect(ProductsPage()).rejects.toThrow("AUTH_BOUNDARY_REDIRECT");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("redirects an expired read identity through the allowlisted same-origin products return path", async () => {
    mocks.read.mockResolvedValue({
      state: "unauthenticated",
      catalog: null,
      products: [],
      observedAt,
    });
    await expect(ProductsPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fproducts",
    );
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fproducts",
    );
  });
});
