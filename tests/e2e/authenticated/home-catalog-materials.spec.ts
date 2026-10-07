import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { catalogReceiptSchema } from "../../../domain/products/catalog-command";
import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { confirmOperatorStepUp } from "./helpers/admin-money-ui";
import { execLocalAdminSql } from "./helpers/local-db";
import { awaitPaintedImages } from "./helpers/painted-images";
import { assertViewportFits } from "./helpers/viewport-geometry";
import {
  observeSuccessfulProductsLogin,
  settleBrowserClassifications,
  type CancelledSuccessfulLoginRedirect,
} from "./helpers/successful-login-cancellation";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";
import { expectSettledRoute } from "./helpers/settled-route";

const categories = [
  "KR_STOCK",
  "US_STOCK",
  "GOLD",
  "SILVER",
  "CRYPTO",
] as const;
type Category = (typeof categories)[number];
const featuredOrders: Category[][] = [
  ["KR_STOCK", "US_STOCK", "GOLD"],
  ["SILVER", "CRYPTO", "GOLD"],
];
const sourcePaths = [
  "app/(product)/home/page.tsx",
  "app/(product)/home/home.module.css",
  "components/product/published-catalog-view.tsx",
  "components/product/published-catalog-view.module.css",
  "components/product/catalog-hero-scene.tsx",
  "components/brand/catalog-material-artwork.tsx",
  "components/brand/gold-category-artwork.tsx",
  "public/brand/catalog-materials.manifest.json",
  "tests/e2e/authenticated/catalog-materials.spec.ts",
  "tests/e2e/authenticated/home-catalog-materials.spec.ts",
  "tests/e2e/authenticated/helpers/viewport-geometry.ts",
  "tests/e2e/authenticated/helpers/painted-images.ts",
  "tests/e2e/authenticated/helpers/successful-login-cancellation.ts",
];
const memberOrigin = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`;
const heroFamilies = [
  "products-semiconductor-hero",
  "semiconductor-wafer-light",
  "semiconductor-tower-desktop",
  "semiconductor-wafer-light-desktop",
];

function materialFamily(category: Category) {
  return category === "GOLD"
    ? "gold-category"
    : category === "SILVER"
      ? "silver"
      : category === "CRYPTO"
        ? "digital-asset"
        : "semiconductor";
}
async function sourceHashes() {
  return Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
}

/** Test actual painted fragments, not the component's CSS selector spelling. */
async function expectCopyContained(copy: Locator, container: Locator) {
  const outer = await container.boundingBox();
  expect(outer).not.toBeNull();
  const fragments = await copy.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
  });
  expect(fragments.length).toBeGreaterThan(0);
  for (const rect of fragments) {
    expect(rect.left).toBeGreaterThanOrEqual(outer!.x - 1);
    expect(rect.right).toBeLessThanOrEqual(outer!.x + outer!.width + 1);
    expect(rect.top).toBeGreaterThanOrEqual(outer!.y - 1);
    expect(rect.bottom).toBeLessThanOrEqual(outer!.y + outer!.height + 1);
  }
}
async function expectControlPainted(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const geometry = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const center = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    const main = element.closest("main")?.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      hit: Boolean(center && (center === element || element.contains(center))),
      withinMain: Boolean(
        main && box.left >= main.left - 1 && box.right <= main.right + 1,
      ),
      withinViewport:
        box.left >= -1 &&
        box.right <= innerWidth + 1 &&
        box.top >= -1 &&
        box.bottom <= innerHeight + 1,
      icons: [...element.querySelectorAll("svg")].map((icon) => {
        const rect = icon.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= box.left - 1 &&
          rect.right <= box.right + 1 &&
          rect.top >= box.top - 1 &&
          rect.bottom <= box.bottom + 1
        );
      }),
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.hit).toBe(true);
  expect(geometry.withinMain).toBe(true);
  expect(geometry.withinViewport).toBe(true);
  expect(geometry.icons.every(Boolean)).toBe(true);
  await expectCopyContained(control, control);
}
async function expectNativeMaterial(
  page: Page,
  card: Locator,
  category: Category,
) {
  await card.scrollIntoViewIfNeeded();
  const image = card.locator("picture img");
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute("alt", "");
  await awaitPaintedImages(page);
  const decoded = await image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const before = element.currentSrc;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      path: new URL(element.currentSrc, location.href).pathname,
      stable: before === element.currentSrc,
      width: element.naturalWidth,
      height: element.naturalHeight,
      complete: element.complete,
    };
  });
  expect(decoded.complete && decoded.stable).toBe(true);
  expect(decoded.width).toBeGreaterThan(0);
  expect(decoded.height).toBeGreaterThan(0);
  expect(decoded.path).toContain(`/${materialFamily(category)}/`);
  return decoded;
}
type ScreenshotRecord = {
  screenshot: string;
  sha256: string;
  publication: number;
  route: string;
  width: number;
  theme: string;
  text_scale: number;
  scroll_position: string;
  state: string;
  decoded_image_sources: Awaited<ReturnType<typeof awaitPaintedImages>>;
};
async function capture(
  page: Page,
  info: TestInfo,
  records: ScreenshotRecord[],
  metadata: Omit<
    ScreenshotRecord,
    "screenshot" | "sha256" | "decoded_image_sources"
  >,
) {
  const decoded = await awaitPaintedImages(page);
  const file = `native-publication-${metadata.publication}-${metadata.route.slice(1)}-${metadata.width}-${metadata.theme}-text-${metadata.text_scale}-${metadata.state}-${metadata.scroll_position}.png`;
  const path = info.outputPath(file);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  records.push({
    ...metadata,
    screenshot: file,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    decoded_image_sources: decoded,
  });
}
async function captureAllMainScroll(
  page: Page,
  info: TestInfo,
  records: ScreenshotRecord[],
  metadata: Omit<
    ScreenshotRecord,
    "screenshot" | "sha256" | "decoded_image_sources" | "scroll_position"
  >,
) {
  const main = page.getByRole("main");
  const { range, step } = await main.evaluate((element) => ({
    range: element.scrollHeight - element.clientHeight,
    step: Math.max(1, Math.floor(element.clientHeight * 0.7)),
  }));
  const positions = [0];
  for (let top = step; top < range; top += step) positions.push(top);
  if (range > 16) positions.push(range);
  for (const [index, top] of positions.entries()) {
    await main.evaluate(
      (element, top) => element.scrollTo({ top, behavior: "instant" }),
      top,
    );
    await capture(page, info, records, {
      ...metadata,
      scroll_position:
        top === 0 ? "top" : top === range ? "bottom" : `middle-${index}`,
    });
  }
}

test("two real approved catalogs expose all five native Home categories, intrinsic hero copy and accessible background recovery", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(900_000);
  const beforeSources = await sourceHashes();
  const operator = await createConfirmedMember("home-material-operator");
  const member = await createConfirmedMember("home-material-member");
  await grantAdminRole(operator.userId);
  const secret = await completeAdminLoginWithTotp(
    page,
    operator.email,
    operator.password,
  );
  const context = await browser.newContext({ baseURL: memberOrigin });
  const memberPage = await context.newPage();
  const successfulLogin = observeSuccessfulProductsLogin(
    memberPage,
    `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
  );
  const cancelledSuccessfulLoginRedirects: CancelledSuccessfulLoginRedirect[] =
    [];
  const pendingClassifications: Promise<void>[] = [];
  type Failure = {
    type: string;
    path?: string;
    status?: number;
    error?: string;
    prefetch?: boolean;
    navigation?: boolean;
  };
  const browserErrors: Failure[] = [],
    cancelledPrefetches: Failure[] = [],
    injectedImageFailures: Failure[] = [];
  const injectedPaths = new Set<string>();
  let injectFailure = false;
  let controlledImagePhase = false;
  const isHeroImage = (url: URL) =>
    url.origin === memberOrigin &&
    heroFamilies.some((family) =>
      url.pathname.startsWith(`/brand/scenes/${family}/`),
    ) &&
    /\.(avif|webp)$/.test(url.pathname);
  memberPage.on("pageerror", (error) =>
    browserErrors.push({ type: `pageerror:${error.name}` }),
  );
  memberPage.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    const path = location
      ? new URL(location, memberOrigin).pathname
      : undefined;
    // Only this explicitly injected HTTP image failure belongs to the negative
    // case. Unknown console errors stay failures; no body/header values are saved.
    if (
      controlledImagePhase &&
      path &&
      injectedPaths.has(path) &&
      /^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/.test(
        message.text(),
      )
    )
      injectedImageFailures.push({
        type: "controlled-image-console",
        path,
        status: 503,
      });
    else
      browserErrors.push({ type: "console:error", ...(path ? { path } : {}) });
  });
  memberPage.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    const record = {
      type: "http:error",
      path: url.pathname,
      status: response.status(),
    };
    if (
      controlledImagePhase &&
      response.status() === 503 &&
      isHeroImage(url) &&
      injectedPaths.has(url.pathname)
    )
      injectedImageFailures.push(record);
    else browserErrors.push(record);
  });
  memberPage.on("requestfailed", (request) => {
    const url = new URL(request.url()),
      error = request.failure()?.errorText ?? "unknown";
    const prefetch = request.headers()["next-router-prefetch"] === "1",
      navigation = request.isNavigationRequest();
    const record = {
      type: "request:failed",
      path: url.pathname,
      error,
      prefetch,
      navigation,
    };
    if (
      error === "net::ERR_ABORTED" &&
      prefetch &&
      !navigation &&
      request.method() === "GET" &&
      url.origin === memberOrigin
    )
      cancelledPrefetches.push(record);
    else
      pendingClassifications.push(
        successfulLogin.classifyFailed(request).then((classified) => {
          if (classified) cancelledSuccessfulLoginRedirects.push(classified);
          else browserErrors.push(record);
        }),
      );
  });
  // Interception only controls decorative image availability. No route command,
  // catalog response, publication, financial or member context is intercepted.
  await memberPage.route("**/brand/scenes/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (injectFailure && request.method() === "GET" && isHeroImage(url)) {
      injectedPaths.add(url.pathname);
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Controlled local image availability check",
      });
    } else await route.continue();
  });
  const catalogs: string[] = [],
    publications = [],
    records: ScreenshotRecord[] = [],
    geometryRecords = [],
    recoveryRecords = [];
  let ledgerTransactions: string | null = null;
  try {
    for (const [publicationIndex, featured] of featuredOrders.entries()) {
      const publication = publicationIndex + 1,
        catalog = randomUUID();
      catalogs.push(catalog);
      const ordered = [
        ...featured,
        ...categories.filter((category) => !featured.includes(category)),
      ];
      const products = ordered.map((category, index) => ({
        id: randomUUID(),
        category,
        order: index + 1,
        featured: featured.includes(category),
        name: `${category} 로컬 화면 검증 상품 ${publication}`,
        description: `${category} 카테고리 화면 검증 자료입니다. 실제 운영 상품, 가격 또는 수익 추천이 아닙니다.`,
      }));
      // Insert DRAFT content only. Actual AAL2 preview/approve/scheduled-publication
      // commands below create its authority and availability; no ledger seed.
      execLocalAdminSql(
        `begin;
        insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
        values(:'catalog'::uuid,(select max(version)+1 from public.product_catalog_versions),current_date,
          'LOCAL_BROWSER_TEST_ONLY: neutral Home and product material rendering, no operating recommendation',
          '[{"name":"Local material review source","url":"https://putduk.test/material-source"}]',
          app_private.funding_engine_digest(jsonb_build_object('local_home_material_catalog',:'catalog')),'LOCAL_BROWSER_TEST_ONLY');
        insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order,is_featured)
        select p.id::uuid,:'catalog'::uuid,(select id from public.asset_worlds order by id limit 1),
          'LOCAL_'||upper(left(replace(p.id,'-',''),26)),'local-'||p.id,p.category::public.product_category,
          p.name,p.category||' local visual fixture',p.description,p."order",p.featured
        from jsonb_to_recordset(:'products'::jsonb) p(id text,category text,name text,description text,"order" integer,featured boolean);
        commit;`,
        { catalog, products: JSON.stringify(products) },
      );
      await page.goto(`${ADMIN_ORIGIN}/catalog?catalog=${catalog}`);
      await expect(
        page.getByRole("link", { name: "Local material review source" }),
      ).toHaveAttribute("href", "https://putduk.test/material-source");
      for (const product of products)
        await expect(
          page.getByText(product.name, { exact: true }),
        ).toBeVisible();
      const review = page.locator("section").filter({
        has: page.getByRole("heading", { name: "공개 전 확인", exact: true }),
      });
      const receipts = [];
      let publishAt = "";
      for (const label of ["검토 내용 확인", "상품 승인", "공개 예약"]) {
        await review
          .getByLabel("검토 사유", { exact: true })
          .fill(`홈과 상품의 실제 로컬 화면을 확인하기 위한 ${label}입니다.`);
        if (label === "검토 내용 확인") {
          const now = new Date();
          const scheduled = new Date(
            Math.ceil((now.getTime() + 120_000) / 60_000) * 60_000 -
              now.getTimezoneOffset() * 60_000,
          )
            .toISOString()
            .slice(0, 16);
          await review.getByLabel("공개 시간", { exact: true }).fill(scheduled);
        }
        // All review edits precede a fresh single-use actual TOTP grant.
        await confirmOperatorStepUp(review, secret);
        const responsePromise = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/v1/admin/catalog/command" &&
            response.request().method() === "POST",
        );
        await review.getByRole("button", { name: label, exact: true }).click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const payload = (await response.json()) as {
          data: { receipt: unknown; confirmed: boolean };
        };
        expect(payload.data.confirmed).toBe(true);
        const receipt = catalogReceiptSchema.parse(payload.data.receipt);
        expect(receipt.catalogId).toBe(catalog);
        expect(receipt.state).toBe(
          label === "검토 내용 확인"
            ? "PREVIEWED"
            : label === "상품 승인"
              ? "APPROVED"
              : "PUBLISHED",
        );
        publishAt = receipt.publishAt;
        receipts.push(receipt);
      }
      await expect
        .poll(() => Date.now(), { timeout: 130_000 })
        .toBeGreaterThanOrEqual(Date.parse(publishAt));
      publications.push({ publication, catalog, featured, products, receipts });
      if (publication === 1)
        await successfulLogin.withLoginToProducts(() =>
          loginAsMember(memberPage, member, "/products"),
        );
      for (const route of ["/products", "/home"] as const) {
        await memberPage.goto(route);
        await expectSettledRoute(memberPage, route);
        await dismissGuidedQuestIfPresent(memberPage);
        if (route === "/products") {
          const rows = memberPage
            .getByRole("region", { name: "공개 상품", exact: true })
            .locator("details");
          await expect(rows).toHaveCount(5);
          for (const product of products) {
            const row = rows.filter({ hasText: product.name });
            await expect(row).toHaveAttribute("data-availability", "available");
            await row.locator("summary").focus();
            await memberPage.keyboard.press("Enter");
            await expect(row).toHaveAttribute("open", "");
            await expect(
              row.getByText(product.description, { exact: true }),
            ).toBeVisible();
            await memberPage.keyboard.press("Enter");
            await expect(row).not.toHaveAttribute("open", "");
          }
        } else {
          const recommendations = memberPage.getByRole("region", {
            name: "추천 상품",
            exact: true,
          });
          const cards = recommendations.locator("a[data-category]");
          await expect(cards).toHaveCount(3);
          expect(
            await cards.evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("data-category")),
            ),
          ).toEqual(featured);
          for (const category of featured) {
            const product = products.find(
              (product) => product.category === category,
            )!;
            const card = cards.filter({ hasText: product.name });
            await expect(card).toHaveAttribute("href", "/products");
            await expect(
              card.getByText("제공 중", { exact: true }),
            ).toBeVisible();
          }
        }
        for (const width of [320, 390, 834, 1440]) {
          await memberPage.setViewportSize({
            width,
            height: width === 834 ? 1112 : 900,
          });
          await memberPage
            .getByRole("main")
            .evaluate((element) =>
              element.scrollTo({ top: 0, behavior: "instant" }),
            );
          await awaitPaintedImages(memberPage);
          for (const theme of ["dark", "light"] as const) {
            await memberPage
              .getByRole("combobox", { name: "화면 테마" })
              .first()
              .selectOption(theme);
            await expect(memberPage.locator("html")).toHaveAttribute(
              "data-theme",
              theme,
            );
            await awaitPaintedImages(memberPage);
            for (const scale of [100, 200]) {
              await memberPage.evaluate((scale) => {
                document.documentElement.style.fontSize = `${(16 * scale) / 100}px`;
              }, scale);
              await memberPage.evaluate(() => document.fonts.ready);
              await assertViewportFits(
                memberPage,
                info,
                `native-${publication}-${route.slice(1)}-${width}-${theme}-${scale}`,
              );
              const materials = [];
              if (route === "/products") {
                const hero = memberPage.locator(
                  "section[aria-labelledby=catalog-hero-title]",
                );
                const title = hero.getByRole("heading", { level: 2 });
                const copy = title.locator("..");
                await title.scrollIntoViewIfNeeded();
                await expectCopyContained(title, hero);
                await expectCopyContained(copy.locator("p").last(), hero);
                const action = hero.getByRole("link", {
                  name: "상품 선택",
                  exact: true,
                });
                await expect(action).toHaveAttribute(
                  "href",
                  "/products/allocation",
                );
                await expectControlPainted(action);
                if (width <= 390 && scale === 200) {
                  const ratio = await copy.evaluate((element) => {
                    const hero = element.closest("section")!;
                    const padding = getComputedStyle(hero);
                    return (
                      element.getBoundingClientRect().width /
                      (hero.clientWidth -
                        parseFloat(padding.paddingLeft) -
                        parseFloat(padding.paddingRight))
                    );
                  });
                  expect(ratio).toBeGreaterThanOrEqual(0.9);
                }
                const region = memberPage.getByRole("region", {
                  name: "공개 상품",
                  exact: true,
                });
                const rows = region.locator("details");
                if (width === 1440 && scale === 100) {
                  const tracks = await rows.evaluateAll((elements) => {
                    const firstElement = elements[0];
                    if (!firstElement)
                      throw new Error("CATALOG_TRACKS_MISSING");
                    const grid = firstElement.parentElement!,
                      css = getComputedStyle(grid),
                      box = grid.getBoundingClientRect();
                    const rects = elements.map((element) =>
                      element.getBoundingClientRect(),
                    );
                    const firstRect = rects[0];
                    if (!firstRect)
                      throw new Error("CATALOG_TRACK_BOUNDS_MISSING");
                    return {
                      tops: rects.map((rect) => rect.top),
                      first:
                        firstRect.left -
                        (box.left + parseFloat(css.paddingLeft)),
                      last:
                        box.right -
                        parseFloat(css.paddingRight) -
                        rects.at(-1)!.right,
                      count: rects.length,
                    };
                  });
                  expect(tracks.count).toBe(5);
                  expect(
                    Math.max(...tracks.tops) - Math.min(...tracks.tops),
                  ).toBeLessThanOrEqual(1);
                  expect(Math.abs(tracks.first)).toBeLessThanOrEqual(1);
                  expect(Math.abs(tracks.last)).toBeLessThanOrEqual(1);
                  geometryRecords.push({
                    publication,
                    route,
                    width,
                    theme,
                    scale,
                    tracks,
                  });
                }
                for (const product of products)
                  materials.push({
                    category: product.category,
                    ...(await expectNativeMaterial(
                      memberPage,
                      rows.filter({ hasText: product.name }).locator("summary"),
                      product.category,
                    )),
                  });
              } else {
                const recommendations = memberPage.getByRole("region", {
                  name: "추천 상품",
                  exact: true,
                });
                for (const category of featured)
                  materials.push({
                    category,
                    ...(await expectNativeMaterial(
                      memberPage,
                      recommendations.locator(`a[data-category="${category}"]`),
                      category,
                    )),
                  });
                const event = memberPage
                  .getByRole("region", { name: "이벤트", exact: true })
                  .getByRole("link");
                await expectControlPainted(event);
                await expectCopyContained(event.locator("h2"), event);
                await expectCopyContained(event.locator("h2 + p"), event);
                const eventState = {
                  title: (await event.locator("h2").innerText()).trim(),
                  copy: (await event.locator("h2 + p").innerText()).trim(),
                  href: await event.getAttribute("href"),
                };
                expect(eventState.title.length).toBeGreaterThan(0);
                expect(eventState.copy.length).toBeGreaterThan(0);
                expect(eventState.href).toMatch(/^\/events(?:\/[a-z0-9-]+)?$/);
                if (width <= 390 && scale === 200) {
                  const ratio = await event
                    .locator("h2")
                    .locator("..")
                    .evaluate((element) => {
                      const link = element.closest("a")!;
                      const padding = getComputedStyle(link);
                      return (
                        element.getBoundingClientRect().width /
                        (link.clientWidth -
                          parseFloat(padding.paddingLeft) -
                          parseFloat(padding.paddingRight))
                      );
                    });
                  expect(ratio).toBeGreaterThanOrEqual(0.9);
                }
                geometryRecords.push({
                  publication,
                  route,
                  width,
                  theme,
                  scale,
                  event: eventState,
                });
              }
              geometryRecords.push({
                publication,
                route,
                width,
                theme,
                scale,
                materials,
              });
              await captureAllMainScroll(memberPage, info, records, {
                publication,
                route,
                width,
                theme,
                text_scale: scale,
                state: "healthy",
              });
            }
          }
        }
      }
    }

    // Separate explicit negative matrix. Healthy network checks above are not
    // softened to excuse missing images or unknown aborted requests.
    await memberPage.goto("/products");
    await expectSettledRoute(memberPage, "/products");
    for (const width of [320, 390, 834, 1440]) {
      await memberPage.setViewportSize({
        width,
        height: width === 834 ? 1112 : 900,
      });
      for (const theme of ["dark", "light"] as const) {
        for (const scale of [100, 200]) {
          await memberPage.evaluate((scale) => {
            document.documentElement.style.fontSize = `${(16 * scale) / 100}px`;
          }, scale);
          const themeSelect = memberPage
            .getByRole("combobox", { name: "화면 테마" })
            .first();
          await themeSelect.selectOption(theme === "dark" ? "light" : "dark");
          const hero = memberPage.locator(
            "section[aria-labelledby=catalog-hero-title]",
          );
          await hero.scrollIntoViewIfNeeded();
          await awaitPaintedImages(memberPage);
          const search = memberPage.getByRole("searchbox", {
            name: "상품 검색",
            exact: true,
          });
          await search.fill("로컬");
          const start = injectedImageFailures.length;
          controlledImagePhase = true;
          injectFailure = true;
          await themeSelect.selectOption(theme);
          await expect(memberPage.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          const scene = hero.locator("[data-catalog-hero-state]");
          await expect(scene).toHaveAttribute(
            "data-catalog-hero-state",
            "unavailable",
          );
          const status = scene.getByRole("status"),
            retry = status.getByRole("button", {
              name: "배경 다시 불러오기",
              exact: true,
            });
          await expect(
            status.getByText("상품 배경을 불러오지 못했어요.", { exact: true }),
          ).toBeVisible();
          await expectControlPainted(retry);
          await expectCopyContained(status.locator("p"), hero);
          await expectCopyContained(retry, hero);
          await assertViewportFits(
            memberPage,
            info,
            `native-recovery-${width}-${theme}-${scale}`,
          );
          await expect(search).toHaveValue("로컬");
          const failed = injectedImageFailures
            .slice(start)
            .filter((failure) => failure.type === "http:error");
          expect(
            failed.some((failure) => failure.path?.endsWith(".avif")),
          ).toBe(true);
          expect(
            failed.some((failure) => failure.path?.endsWith(".webp")),
          ).toBe(true);
          await capture(memberPage, info, records, {
            publication: 2,
            route: "/products",
            width,
            theme,
            text_scale: scale,
            scroll_position: "recovery",
            state: "controlled-unavailable",
          });
          await retry.focus();
          await expect(retry).toBeFocused();
          injectFailure = false;
          const restoredResponse = memberPage.waitForResponse(
            (response) =>
              response.status() === 200 && isHeroImage(new URL(response.url())),
          );
          await memberPage.keyboard.press("Enter");
          await restoredResponse;
          await expect(scene).toHaveAttribute(
            "data-catalog-hero-state",
            "responsive",
          );
          await expect(retry).toHaveCount(0);
          await awaitPaintedImages(memberPage);
          const image = scene.locator("picture img");
          expect(
            await image.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0,
            ),
          ).toBe(true);
          await expect(search).toHaveValue("로컬");
          await expect(
            memberPage
              .getByRole("region", { name: "공개 상품", exact: true })
              .locator("details"),
          ).toHaveCount(5);
          controlledImagePhase = false;
          await assertViewportFits(
            memberPage,
            info,
            `native-restored-${width}-${theme}-${scale}`,
          );
          await capture(memberPage, info, records, {
            publication: 2,
            route: "/products",
            width,
            theme,
            text_scale: scale,
            scroll_position: "recovery",
            state: "restored-responsive",
          });
          recoveryRecords.push({
            width,
            theme,
            text_scale: scale,
            injected_responses: failed,
            restored_by_native_keyboard: true,
            search_preserved: true,
          });
        }
      }
    }
    await settleBrowserClassifications(pendingClassifications);
    ledgerTransactions = execLocalAdminSql(
      "select count(*) from public.ledger_transactions where member_user_id=:'member'::uuid;",
      { member: member.userId },
    );
    expect(ledgerTransactions).toBe("0");
    expect(await sourceHashes()).toEqual(beforeSources);
    expect(browserErrors).toEqual([]);
  } finally {
    await settleBrowserClassifications(pendingClassifications);
    successfulLogin.dispose();
    // Preserve partial failures and their exact SHA as well as successful views.
    await writeFile(
      info.outputPath("home-catalog-materials-render-index.json"),
      JSON.stringify(
        {
          fixture_scope:
            "LOCAL_BROWSER_TEST_ONLY; DRAFT content becomes authoritative only through actual AAL2 commands",
          source_hashes_before: beforeSources,
          source_hashes_after: await sourceHashes(),
          runtime_archive_binding:
            "Root must bind its exact prebuild source archive separately; local file hashes alone do not establish deployed source",
          publications,
          records,
          geometryRecords,
          recoveryRecords,
          browserErrors,
          cancelledPrefetches,
          cancelledSuccessfulLoginRedirects,
          injectedImageFailures,
          ledger_transactions: ledgerTransactions,
          visual_qa_complete: false,
        },
        null,
        2,
      ) + "\n",
    );
    injectFailure = false;
    for (const catalog of catalogs)
      execLocalAdminSql(
        "update public.product_catalog_versions set status='RETIRED' where id=:'catalog'::uuid and proposed_by='LOCAL_BROWSER_TEST_ONLY' and status='PUBLISHED';",
        { catalog },
      );
    await context.close();
  }
});
