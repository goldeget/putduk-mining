/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogBrowse } from "@/components/product/catalog-browse";
import type { PublishedCatalogProduct } from "@/domain/products/published-catalog";

const fixture = (
  id: string,
  category: PublishedCatalogProduct["category"],
  nameKo: string,
  nameEn: string,
  state: PublishedCatalogProduct["availability"]["state"] = "available",
): PublishedCatalogProduct => ({
  id,
  code: `PUBLIC_${id}`,
  slug: `public-${id}`,
  category,
  nameKo,
  nameEn,
  descriptionKo: `${nameKo}의 승인된 설명`,
  displayOrder: Number(id),
  isFeatured: false,
  trialAvailable: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  availability: {
    state,
    availableFrom: null,
    availableTo: null,
    recordedAt: null,
  },
});
let products: PublishedCatalogProduct[];
let host: HTMLDivElement;
let root: Root;
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  products = [
    fixture("1", "GOLD", "승인한 금 테마", "Approved gold"),
    fixture("2", "US_STOCK", "공개 미국 테마", "Published US", "paused"),
    fixture("3", "KR_STOCK", "공개 한국 테마", "Published Korea", "retired"),
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(rows = products) {
  await act(async () =>
    root.render(
      createElement(CatalogBrowse, {
        products: rows,
        heading: createElement("h1", null, "상품"),
        hero: createElement(
          "aside",
          { "data-actual-hero": "" },
          "기존 실제 상품 선택 안내",
        ),
      }),
    ),
  );
}
function names() {
  return [...host.querySelectorAll("details > summary strong")].map(
    (node) => node.textContent,
  );
}
async function search(value: string) {
  const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function category(value: string) {
  await act(async () =>
    host
      .querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!
      .click(),
  );
}

describe("public catalog browsing without financial commands", () => {
  it("retains the approved order, names and availability without inventing rates or ETF categories", async () => {
    await render();
    expect(names()).toEqual(products.map((product) => product.nameKo));
    expect(host.textContent).toContain("제공 중단");
    expect(host.textContent).toContain("제공 종료");
    expect(host.querySelector('input[value="ETF"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("3개 상품");
    expect(host.textContent).not.toMatch(
      /수익률|12\.8%|선택 완료|투자 추천|금액|L5/,
    );
  });
  it("combines real search and native category changes, and recovers by clearing the search", async () => {
    await render();
    await search("공개");
    expect(names()).toEqual(["공개 미국 테마", "공개 한국 테마"]);
    await category("US_STOCK");
    expect(names()).toEqual(["공개 미국 테마"]);
    await search("금");
    expect(names()).toEqual([]);
    expect(host.textContent).toContain("검색한 상품이 없어요");
    expect(host.textContent).not.toContain("공개된 상품이 아직 없어요");
    await search("");
    await category("ALL");
    expect(names()).toHaveLength(3);
    expect(host.querySelector('input[value="ALL"]')?.getAttribute("type")).toBe(
      "radio",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("normalizes case and fullwidth input against actual English names and codes", async () => {
    await render();
    await search("ＰＵＢＬＩＣ＿２");
    expect(names()).toEqual(["공개 미국 테마"]);
    await search("approved GOLD");
    expect(names()).toEqual(["승인한 금 테마"]);
  });
  it("keeps old rows out when a new server snapshot replaces the public products", async () => {
    await render();
    await category("US_STOCK");
    await render([fixture("4", "US_STOCK", "새 공개 상품", "New public")]);
    expect(names()).toEqual(["새 공개 상품"]);
    expect(host.textContent).not.toContain("공개 미국 테마");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1개 상품");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("links labels and native controls to the real results region without hidden money commands", async () => {
    await render();
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(
      host.querySelector(`label[for="${field.id}"]`)?.textContent,
    ).toContain("상품 검색");
    const region = document.getElementById(
      field.getAttribute("aria-controls")!,
    );
    expect(region?.getAttribute("aria-label")).toBe("공개 상품");
    expect(host.querySelector("fieldset legend")?.textContent).toBe(
      "상품 분류",
    );
    expect(
      host.querySelectorAll("form, button, a[href^='/api/']"),
    ).toHaveLength(0);
    for (const control of host.querySelectorAll('input[type="radio"]')) {
      expect(control.getAttribute("aria-controls")).toBe(region?.id);
    }
    field.focus();
    expect(document.activeElement).toBe(field);
  });
  it("uses the approved neutral GOLD image while leaving exact descriptions in native disclosure", async () => {
    await render();
    await category("GOLD");
    expect(
      host
        .querySelector(
          'img[src="/brand/scenes/gold-category/gold-category-320-v1.webp"]',
        )
        ?.getAttribute("alt"),
    ).toBe("");
    expect(host.querySelector("details summary")).not.toBeNull();
    expect(host.querySelector("details > div")?.textContent).toContain(
      "승인한 금 테마의 승인된 설명",
    );
    expect(host.querySelector("details")?.hasAttribute("open")).toBe(false);
  });
});
