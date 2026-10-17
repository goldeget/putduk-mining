import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

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

test("actual approved local catalog renders every material category and native disclosure at normal and enlarged text", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const operator = await createConfirmedMember("material-operator");
  const member = await createConfirmedMember("material-member");
  await grantAdminRole(operator.userId);
  const secret = await completeAdminLoginWithTotp(
    page,
    operator.email,
    operator.password,
  );
  const catalog = randomUUID();
  const categories = [
    "KR_STOCK",
    "US_STOCK",
    "GOLD",
    "SILVER",
    "CRYPTO",
  ] as const;
  const products = categories.map((category, index) => ({
    id: randomUUID(),
    category,
    order: index + 1,
    name: `${category} 로컬 화면 검증 상품`,
    description: `${category} 카테고리 화면 검증 자료입니다. 실제 운영 상품, 가격 또는 수익 추천이 아닙니다.`,
  }));
  // DRAFT fixtures have no member authority. Publication below uses actual
  // operator AAL2 commands, receipts and the existing scheduled boundary.
  execLocalAdminSql(
    `begin;
    insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
    values(:'catalog'::uuid,(select max(version)+1 from public.product_catalog_versions),current_date,
      'LOCAL_BROWSER_TEST_ONLY: neutral category material rendering, no operating recommendation',
      '[{"name":"Local material review source","url":"https://putduk.test/material-source"}]',
      app_private.funding_engine_digest(jsonb_build_object('local_material_catalog',:'catalog')),'LOCAL_BROWSER_TEST_ONLY');
    insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
    select p.id::uuid,:'catalog'::uuid,(select id from public.asset_worlds order by id limit 1),
      'LOCAL_'||upper(left(replace(p.id,'-',''),26)),'local-'||p.id,p.category::public.product_category,
      p.name,p.category||' local visual fixture',p.description,p."order"
    from jsonb_to_recordset(:'products'::jsonb) p(id text,category text,name text,description text,"order" integer);
    commit;`,
    { catalog, products: JSON.stringify(products) },
  );
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
  });
  const memberPage = await context.newPage();
  const successfulLogin = observeSuccessfulProductsLogin(
    memberPage,
    `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
  );
  const cancelledSuccessfulLoginRedirects: CancelledSuccessfulLoginRedirect[] =
    [];
  const pendingClassifications: Promise<void>[] = [];
  type BrowserFailure = {
    type: string;
    path?: string;
    status?: number;
    error?: string;
    prefetch?: boolean;
    navigation?: boolean;
  };
  const browserErrors: BrowserFailure[] = [];
  const cancelledPrefetches: BrowserFailure[] = [];
  memberPage.on("pageerror", (error) =>
    browserErrors.push({ type: `pageerror:${error.name}` }),
  );
  memberPage.on("console", (message) => {
    if (message.type() === "error")
      browserErrors.push({ type: "console:error" });
  });
  memberPage.on("response", (response) => {
    if (response.status() >= 400)
      browserErrors.push({
        type: "http:error",
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  memberPage.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const error = request.failure()?.errorText ?? "unknown";
    const prefetch = request.headers()["next-router-prefetch"] === "1";
    const navigation = request.isNavigationRequest();
    const record = {
      type: "request:failed",
      path: url.pathname,
      error,
      prefetch,
      navigation,
    };
    // Only a demonstrably cancelled same-origin Next prefetch is expected.
    // Navigation, assets, APIs and every unknown failure remain errors.
    if (
      error === "net::ERR_ABORTED" &&
      prefetch &&
      !navigation &&
      request.method() === "GET" &&
      url.origin === `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`
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
  try {
    await page.goto(`${ADMIN_ORIGIN}/catalog?catalog=${catalog}`);
    await expect(
      page.getByRole("link", { name: "Local material review source" }),
    ).toHaveAttribute("href", "https://putduk.test/material-source");
    for (const product of products)
      await expect(page.getByText(product.name, { exact: true })).toBeVisible();
    const review = page.locator("section").filter({
      has: page.getByRole("heading", { name: "공개 전 확인", exact: true }),
    });
    let publishAt = "";
    for (const label of ["검토 내용 확인", "상품 승인", "공개 예약"]) {
      await review
        .getByLabel("검토 사유", { exact: true })
        .fill(`모든 소재의 실제 로컬 화면을 확인하기 위한 ${label}입니다.`);
      await confirmOperatorStepUp(review, secret);
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
      const responsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/v1/admin/catalog/command" &&
          response.request().method() === "POST",
      );
      await review.getByRole("button", { name: label, exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        data: { receipt: unknown; confirmed: boolean };
      };
      expect(body.data.confirmed).toBe(true);
      const receipt = catalogReceiptSchema.parse(body.data.receipt);
      expect(receipt.catalogId).toBe(catalog);
      expect(receipt.state).toBe(
        label === "검토 내용 확인"
          ? "PREVIEWED"
          : label === "상품 승인"
            ? "APPROVED"
            : "PUBLISHED",
      );
      publishAt = receipt.publishAt;
    }
    await expect
      .poll(() => Date.now(), { timeout: 130_000 })
      .toBeGreaterThanOrEqual(Date.parse(publishAt));
    await successfulLogin.withLoginToProducts(() =>
      loginAsMember(memberPage, member, "/products"),
    );
    await dismissGuidedQuestIfPresent(memberPage);
    const region = memberPage.getByRole("region", { name: "공개 상품" });
    const rows = region.locator("details");
    await expect(rows).toHaveCount(5);
    for (const category of categories)
      await expect(
        region.locator(`[data-catalog-artwork="${category}"]`),
      ).toHaveCount(1);
    // Real native summary controls expose each exact live description.
    for (const product of products) {
      const row = rows.filter({ hasText: product.name });
      await row.locator("summary").focus();
      await memberPage.keyboard.press("Enter");
      await expect(row).toHaveAttribute("open", "");
      await expect(
        row.getByText(product.description, { exact: true }),
      ).toBeVisible();
      await memberPage.keyboard.press("Enter");
      await expect(row).not.toHaveAttribute("open", "");
    }
    const records = [];
    for (const width of [320, 390, 834, 1440]) {
      await memberPage.setViewportSize({
        width,
        height: width === 834 ? 1112 : 900,
      });
      for (const theme of ["dark", "light"]) {
        await memberPage
          .getByRole("combobox", { name: "화면 테마" })
          .first()
          .selectOption(theme);
        await expect(memberPage.locator("html")).toHaveAttribute(
          "data-theme",
          theme,
        );
        for (const scale of [100, 200]) {
          await memberPage.evaluate((scale) => {
            document.documentElement.style.fontSize = `${(16 * scale) / 100}px`;
          }, scale);
          await memberPage.evaluate(() => document.fonts.ready);
          await assertViewportFits(
            memberPage,
            info,
            `catalog-materials-${width}-${theme}-text-${scale}`,
          );
          const main = memberPage.getByRole("main");
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
            const images = await awaitPaintedImages(memberPage);
            const position =
              top === 0 ? "top" : top === range ? "bottom" : `middle-${index}`;
            const filename = `catalog-materials-${width}-${theme}-text-${scale}-${position}.png`;
            const output = info.outputPath(filename);
            await memberPage.screenshot({
              path: output,
              fullPage: true,
              animations: "disabled",
            });
            records.push({
              screenshot: filename,
              sha256: createHash("sha256")
                .update(await readFile(output))
                .digest("hex"),
              width,
              theme,
              text_scale: scale,
              scroll_position: position,
              decoded_image_sources: images,
            });
          }
          for (const product of products) {
            const row = rows.filter({ hasText: product.name });
            await row.locator("summary").scrollIntoViewIfNeeded();
            const image = row.locator("picture img");
            await expect(image).toHaveAttribute("alt", "");
            await expect
              .poll(() =>
                image.evaluate(
                  (element: HTMLImageElement) =>
                    element.complete && element.naturalWidth > 0,
                ),
              )
              .toBe(true);
            const family =
              product.category === "GOLD"
                ? "gold-category"
                : product.category === "SILVER"
                  ? "silver"
                  : product.category === "CRYPTO"
                    ? "digital-asset"
                    : "semiconductor";
            expect(
              await image.evaluate(
                (element: HTMLImageElement) =>
                  new URL(element.currentSrc, location.href).pathname,
              ),
            ).toContain(`/${family}/`);
          }
        }
      }
    }
    await settleBrowserClassifications(pendingClassifications);
    const ledgerTransactions = execLocalAdminSql(
      `select count(*) from public.ledger_transactions where member_user_id=:'member'::uuid;`,
      { member: member.userId },
    );
    // Preserve the complete matrix before either final assertion can fail.
    await writeFile(
      info.outputPath("catalog-materials-browser-errors.json"),
      JSON.stringify(
        {
          browserErrors,
          cancelledPrefetches,
          cancelledSuccessfulLoginRedirects,
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      info.outputPath("catalog-materials-render-index.json"),
      JSON.stringify(
        {
          fixture_scope: "LOCAL_BROWSER_TEST_ONLY",
          products,
          records,
          browserErrors,
          cancelledPrefetches,
          cancelledSuccessfulLoginRedirects,
          ledger_transactions: ledgerTransactions,
          visual_qa_complete: false,
        },
        null,
        2,
      ) + "\n",
    );
    expect(ledgerTransactions).toBe("0");
    expect(browserErrors).toEqual([]);
  } finally {
    await settleBrowserClassifications(pendingClassifications);
    successfulLogin.dispose();
    execLocalAdminSql(
      `update public.product_catalog_versions set status='RETIRED' where id=:'catalog'::uuid and proposed_by='LOCAL_BROWSER_TEST_ONLY' and status='PUBLISHED';`,
      { catalog },
    );
    await context.close();
  }
});
