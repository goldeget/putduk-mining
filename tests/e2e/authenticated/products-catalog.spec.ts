import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const OUTPUT = path.join("test-results", "products-catalog");

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

async function capture(page: Page, name: string) {
  await expect(page.locator('[data-ui-ready="/products"]')).toHaveAttribute(
    "data-ui-state",
    "empty",
  );
  await expectNoOverflow(page);
  const projectOutput = path.join(OUTPUT, test.info().project.name);
  mkdirSync(projectOutput, { recursive: true });
  await page.screenshot({
    path: path.join(projectOutput, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test("unsigned visitors cannot read a catalog through the products route", async ({
  page,
  request,
}) => {
  const response = await request.get("/products", { maxRedirects: 0 });
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await page.goto("/products");
  await expect(page).toHaveURL(/\/login\?next=%2Fproducts$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/products");
  await expect(page.locator('[data-ui-ready="/products"]')).toHaveCount(0);
});

test("the actual draft-only catalog stays unpublished with accessible responsive empty UX", async ({
  page,
}) => {
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (
      /hydration-mismatch|Hydration failed|Text content did not match|A tree hydrated but/i.test(
        message.text(),
      )
    )
      hydration.push(message.text().slice(0, 400));
  });
  const localCatalog = await createLocalServiceRoleClient()
    .from("product_catalog_versions")
    .select("id, status, published_at");
  expect(localCatalog.error).toBeNull();
  const catalogRows = localCatalog.data ?? [];
  expect(catalogRows.some((catalog) => catalog.status === "DRAFT")).toBe(true);
  expect(
    catalogRows.filter(
      (catalog) =>
        catalog.status === "PUBLISHED" &&
        catalog.published_at &&
        Date.parse(catalog.published_at) <= Date.now(),
    ),
  ).toEqual([]);
  const member = await createConfirmedMember("products-catalog");
  await loginAsMember(page, member, "/products");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "상품", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /공개된 상품이\s*아직 없어요/ }),
  ).toBeVisible();
  const view = page.locator('[data-ui-ready="/products"]');
  await expect(view).toHaveAttribute("data-ui-state", "empty");
  await expect(view).toHaveAttribute("data-observed-at", /^\d{4}-\d{2}-\d{2}T/);
  await expect(view.locator("details")).toHaveCount(0);
  await expect(
    view.getByRole("button", { name: /선택|시작|승인/ }),
  ).toHaveCount(0);
  const primaryNavigation = page.locator("nav.product-navigation:visible");
  await expect(primaryNavigation).toHaveCount(1);
  await expect(
    primaryNavigation.getByRole("link", { name: "상품", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const miningLink = view.getByRole("link", { name: "채굴 보기", exact: true });
  await expect(miningLink).toHaveAttribute("href", "/mining");
  await miningLink.focus();
  await expect(miningLink).toBeFocused();
  await expect(view.locator("picture img")).toBeVisible();
  await page.waitForFunction(() => {
    const image = document.querySelector(
      '[data-ui-ready="/products"] picture img',
    );
    return (
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0
    );
  });

  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 844 });
    await capture(page, `products-empty-${width}-default`);
  }
  for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.evaluate((selected) => {
      localStorage.setItem("putduk-theme", selected);
      document.documentElement.dataset.theme = selected;
      document.documentElement.style.colorScheme = selected;
    }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await capture(page, `products-empty-390-${theme}-reduced-motion`);
  }
  await page.evaluate(() =>
    document.documentElement.style.setProperty("zoom", "2"),
  );
  await capture(page, "products-empty-390-css-zoom-200");
  await page.evaluate(() =>
    document.documentElement.style.removeProperty("zoom"),
  );
  await miningLink.click();
  await expect(page).toHaveURL(/\/mining$/);
  expect(hydration).toEqual([]);
  writeFileSync(
    path.join(OUTPUT, `evidence-${test.info().project.name}.json`),
    JSON.stringify(
      {
        hydration,
        catalogState: "EMPTY_FROM_REAL_DRAFT_ONLY_DATABASE",
        publishedFixture: "NOT_ACTIVATED",
        zoom: "CSS_200_PERCENT_REFLOW_ONLY_NATIVE_BROWSER_ZOOM_OPEN",
      },
      null,
      2,
    ),
  );
});
