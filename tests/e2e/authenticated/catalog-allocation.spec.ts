import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  allocationReceiptSchema,
  allocationStateSchema,
} from "../../../domain/products/allocation-command";
import { catalogReceiptSchema } from "../../../domain/products/catalog-command";
import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { confirmOperatorStepUp } from "./helpers/admin-money-ui";
import { execLocalAdminSql } from "./helpers/local-db";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

async function browserJson(
  page: Page,
  path: string,
  body?: unknown,
  key?: string,
) {
  return page.evaluate(
    async ({ path, body, key }) => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        payload: (await response.json()) as {
          data?: unknown;
          error?: { code?: string };
        },
      };
    },
    { path, body, key },
  );
}

async function captureMatrix(page: Page, info: TestInfo, label: string) {
  const records = [];
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.evaluate((value) => {
        localStorage.setItem("putduk-theme", value);
        document.documentElement.dataset.theme = value;
        document.documentElement.style.colorScheme = value;
        window.dispatchEvent(new Event("putduk-theme-change"));
      }, theme);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.evaluate(() => document.fonts.ready);
      const main = page.getByRole("main");
      await expect(main).toHaveCount(1);
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
        await expect
          .poll(() => main.evaluate((element) => element.scrollTop))
          .toBe(top);
        const position =
          top === 0 ? "top" : top === range ? "bottom" : `middle-${index}`;
        const name = `${label}-${width}-${theme}-${position}`;
        const screenshot = `${name}.png`;
        const output = info.outputPath(screenshot);
        // A body-only attachment is discarded by the list reporter. Keep the
        // actual file so every accepted paid render can be reviewed afterwards.
        await page.screenshot({
          path: output,
          fullPage: true,
          animations: "disabled",
        });
        await info.attach(name, { path: output, contentType: "image/png" });
        records.push({
          label,
          route: new URL(page.url()).pathname,
          width,
          theme,
          screenshot,
          sha256: createHash("sha256")
            .update(await readFile(output))
            .digest("hex"),
          scroll_position: position,
          scroll_top: top,
          scroll_range: range,
          capture_step: step,
          manual_reference_comparison: "pending",
        });
      }
    }
  }
  await writeFile(
    info.outputPath(`${label}-render-index.json`),
    JSON.stringify({ records, visual_qa_complete: false }, null, 2) + "\n",
  );
}

function fixtureIds() {
  return {
    catalog: randomUUID(),
    product: randomUUID(),
    unpublishedCatalog: randomUUID(),
    unpublishedProduct: randomUUID(),
  };
}

function createDraftFixture(ids: ReturnType<typeof fixtureIds>) {
  execLocalAdminSql(
    `begin;
     insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
     values(:'catalog'::uuid,(select max(version)+1 from public.product_catalog_versions),current_date,
       'Local browser command regression; not an operating product recommendation',
       '[{"name":"Local browser regression source","url":"https://putduk.test/catalog-browser-fixture"}]',
       app_private.funding_engine_digest(jsonb_build_object('local_browser_catalog',:'catalog')),'LOCAL_BROWSER_TEST_ONLY');
     insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
     values(:'product'::uuid,:'catalog'::uuid,(select id from public.asset_worlds order by id limit 1),
       'LOCAL_'||upper(left(replace(:'product','-',''),26)),'local-'||:'product','GOLD','로컬 검증 상품',
       'Local browser fixture','실제 운영 상품이 아닌 승인 흐름 검증 자료입니다.',1);
     insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
     values(:'unpublished_catalog'::uuid,(select max(version)+1 from public.product_catalog_versions),current_date,
       'Unpublished negative local browser fixture',
       '[{"name":"Local unpublished source","url":"https://putduk.test/catalog-unpublished-fixture"}]',
       app_private.funding_engine_digest(jsonb_build_object('local_browser_catalog',:'unpublished_catalog')),'LOCAL_BROWSER_TEST_ONLY');
     insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
     values(:'unpublished_product'::uuid,:'unpublished_catalog'::uuid,(select id from public.asset_worlds order by id limit 1),
       'LOCAL_'||upper(left(replace(:'unpublished_product','-',''),26)),'local-'||:'unpublished_product','GOLD',
       '공개하지 않은 검증 상품','Unpublished local fixture','승인되지 않은 상품 선택 거부 검증 자료입니다.',1);
     commit;`,
    {
      catalog: ids.catalog,
      product: ids.product,
      unpublished_catalog: ids.unpublishedCatalog,
      unpublished_product: ids.unpublishedProduct,
    },
  );
}

function ownerFinancialEvidence(userId: string) {
  return JSON.parse(
    execLocalAdminSql(
      `select jsonb_build_object(
        'ledgerTransactions',(select count(*) from public.ledger_transactions where member_user_id=:'member'::uuid),
        'wallet',(select coalesce(jsonb_agg(to_jsonb(w) order by w.currency),'[]') from public.wallet_balance_snapshots w where w.user_id=:'member'::uuid),
        'principalCredits',(select count(*) from public.money_source_movements where user_id=:'member'::uuid and source_bucket='PRINCIPAL'),
        'principalDebits',(select count(*) from public.money_source_movements where user_id=:'member'::uuid and source_bucket='PRINCIPAL' and movement_kind<>'CREDIT'),
        'allocations',(select count(*) from app_private.funding_allocation_originals where user_id=:'member'::uuid),
        'conditions',(select count(*) from app_private.funding_condition_originals where user_id=:'member'::uuid)
      );`,
      { member: userId },
    ),
  ) as {
    ledgerTransactions: number;
    wallet: unknown;
    principalCredits: number;
    principalDebits: number;
    allocations: number;
    conditions: number;
  };
}

test("actual operator catalog approval and owner allocation retain receipts without a purchase debit", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360_000);
  const ids = fixtureIds();
  const operator = await createConfirmedMember("catalog-operator");
  const owner = await createConfirmedMember("catalog-owner");
  const other = await createConfirmedMember("catalog-other-owner");
  await grantAdminRole(operator.userId);
  const secret = await completeAdminLoginWithTotp(
    page,
    operator.email,
    operator.password,
  );
  const memberOrigin = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`;
  const memberContext = await browser.newContext({ baseURL: memberOrigin });
  const otherContext = await browser.newContext({ baseURL: memberOrigin });
  const memberPage = await memberContext.newPage();
  const otherPage = await otherContext.newPage();
  createDraftFixture(ids);
  try {
    // A DRAFT has no member selection. No seed is approved or modified here.
    expect(
      execLocalAdminSql(
        `select count(*) from public.product_catalog_versions where status='PUBLISHED' and published_at<=clock_timestamp();`,
      ),
    ).toBe("0");
    await loginAsMember(memberPage, owner, "/products/allocation");
    await dismissGuidedQuestIfPresent(memberPage);
    await expect(
      memberPage.getByRole("heading", { name: "선택할 상품이 없어요" }),
    ).toBeVisible();
    await expect(
      memberPage.locator('[data-ui-ready="/products/allocation"]'),
    ).toHaveAttribute("data-ui-state", "empty");
    await captureMatrix(memberPage, info, "allocation-draft-empty");

    await page.goto(`${ADMIN_ORIGIN}/catalog?catalog=${ids.catalog}`);
    await expect(
      page.getByRole("heading", { name: "상품 검토", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Local browser regression source" }),
    ).toHaveAttribute("href", "https://putduk.test/catalog-browser-fixture");
    await expect(
      page.getByText("로컬 검증 상품", { exact: true }),
    ).toBeVisible();
    await captureMatrix(page, info, "catalog-source-review");
    await page.setViewportSize({ width: 390, height: 844 });
    const review = page.locator("section").filter({
      has: page.getByRole("heading", { name: "공개 전 확인", exact: true }),
    });
    const captured: { key: string; body: Record<string, unknown> }[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/v1/admin/catalog/command" &&
        request.method() === "POST"
      )
        captured.push({
          key: request.headers()["idempotency-key"] ?? "",
          body: JSON.parse(request.postData() ?? "{}") as Record<
            string,
            unknown
          >,
        });
    });
    for (const label of ["검토 내용 확인", "상품 승인", "공개 예약"]) {
      await review
        .getByLabel("검토 사유", { exact: true })
        .fill(`출처와 상품을 실제 확인한 로컬 ${label} 검증입니다.`);
      await confirmOperatorStepUp(review, secret);
      if (label === "검토 내용 확인") {
        const now = new Date();
        // The native datetime-local control has minute precision. Round forward
        // so all real step-up approvals still precede the scheduled publication.
        const publishMilliseconds =
          Math.ceil((now.getTime() + 120_000) / 60_000) * 60_000;
        const scheduled = new Date(
          publishMilliseconds - now.getTimezoneOffset() * 60_000,
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
      const payload = (await response.json()) as {
        data: { receipt: unknown; confirmed: boolean };
      };
      expect(payload.data.confirmed).toBe(true);
      const receipt = catalogReceiptSchema.parse(payload.data.receipt);
      expect(receipt.catalogId).toBe(ids.catalog);
      expect(receipt.state).toBe(
        label === "검토 내용 확인"
          ? "PREVIEWED"
          : label === "상품 승인"
            ? "APPROVED"
            : "PUBLISHED",
      );
      await expect(
        review.getByRole("button", { name: label, exact: true }),
      ).toHaveCount(0);
    }
    const publication = JSON.parse(
      execLocalAdminSql(
        `select app_private.product_catalog_receipt_json(r) from app_private.product_catalog_receipts r where catalog_id=:'catalog'::uuid and state='PUBLISHED';`,
        { catalog: ids.catalog },
      ),
    ) as unknown;
    const published = catalogReceiptSchema.parse(publication);
    const first = captured[0]!;
    const replay = await browserJson(
      page,
      "/api/v1/admin/catalog/command",
      first.body,
      first.key,
    );
    expect(replay.status).toBe(200);
    const replayPayload = replay.payload.data as { receipt: unknown };
    expect(catalogReceiptSchema.parse(replayPayload.receipt).state).toBe(
      "PREVIEWED",
    );
    expect(
      execLocalAdminSql(
        `select count(*) from app_private.product_catalog_receipts where catalog_id=:'catalog'::uuid;`,
        { catalog: ids.catalog },
      ),
    ).toBe("3");
    await captureMatrix(page, info, "catalog-published-receipt");
    await expect
      .poll(() => Date.now(), { timeout: 130_000 })
      .toBeGreaterThanOrEqual(Date.parse(published.publishAt));

    // The amount is read from the existing owner-approved policy, never invented.
    execLocalAdminSql(
      `select public.approve_deposit_request(
        public.create_deposit_request(:'member'::uuid,'KRW',
          (select (config->>'minimumPrincipalKrw')::bigint from app_private.economy_policy_published where effective_from<=clock_timestamp() and (effective_until is null or effective_until>clock_timestamp())),:'deposit_key'),
        :'operator'::uuid,
        (select (config->>'minimumPrincipalKrw')::bigint from app_private.economy_policy_published where effective_from<=clock_timestamp() and (effective_until is null or effective_until>clock_timestamp())),
        :'credit_key','Local browser confirmed principal fixture; no operating policy change',:'request'::uuid);`,
      {
        member: owner.userId,
        operator: operator.userId,
        deposit_key: `catalog-deposit-${ids.catalog}`,
        credit_key: `catalog-credit-${ids.catalog}`,
        request: randomUUID(),
      },
    );
    const before = ownerFinancialEvidence(owner.userId);
    expect(before.principalCredits).toBe(1);
    expect(before.principalDebits).toBe(0);
    await memberPage.reload({ waitUntil: "domcontentloaded" });
    await expect(
      memberPage.getByRole("checkbox", { name: "로컬 검증 상품", exact: true }),
    ).toBeEnabled();
    await memberPage
      .getByRole("checkbox", { name: "로컬 검증 상품", exact: true })
      .check();
    await memberPage.getByLabel("원금 비율", { exact: false }).fill("50");
    await memberPage
      .getByRole("checkbox", { name: "상품과 배분 비율을 확인했어요." })
      .check();
    const selectedResponse = memberPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/products/allocation" &&
        response.request().method() === "POST",
    );
    await memberPage
      .getByRole("button", { name: "배분 적용", exact: true })
      .click();
    const selected = await selectedResponse;
    expect(selected.status()).toBe(200);
    const selectedPayload = (await selected.json()) as {
      data: { receipt: unknown; confirmed: boolean };
    };
    expect(selectedPayload.data.confirmed).toBe(true);
    const allocation = allocationReceiptSchema.parse(
      selectedPayload.data.receipt,
    );
    expect(allocation.products).toEqual([
      { productId: ids.product, allocationBps: "5000" },
    ]);
    expect(allocation.revision).toBe("1");
    await expect(
      memberPage.getByText(
        "선택을 저장했습니다. 지금부터 선택한 비율을 적용해요.",
      ),
    ).toBeVisible();
    const after = ownerFinancialEvidence(owner.userId);
    expect(after.ledgerTransactions).toBe(before.ledgerTransactions);
    expect(after.wallet).toEqual(before.wallet);
    expect(after.principalDebits).toBe(0);
    expect(after.allocations).toBe(1);
    await captureMatrix(memberPage, info, "allocation-confirmed-owner");
    const memberRequest = selected.request();
    const memberReplay = await browserJson(
      memberPage,
      "/api/v1/products/allocation",
      JSON.parse(memberRequest.postData() ?? "{}"),
      memberRequest.headers()["idempotency-key"],
    );
    expect(memberReplay.status).toBe(200);
    expect(memberReplay.cache).toBe("private, no-store");
    expect((memberReplay.payload.data as { receipt: unknown }).receipt).toEqual(
      allocation,
    );
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

    // Real paid allocation has no legacy trial session. Only the server's
    // versioned accepted status may make the scene run or say "채굴 중".
    await memberPage.goto("/mining", { waitUntil: "networkidle" });
    await expect(
      memberPage.locator('[data-ui-ready="/mining"]'),
    ).toHaveAttribute("data-ui-state", "loaded");
    await expect(
      memberPage.getByRole("heading", {
        name: "실제 채굴 · 채굴 중",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("heading", {
        name: "첫 월드에서 채굴을 시작해 보세요",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("link", { name: "채굴 배분 확인", exact: true }),
    ).toHaveAttribute("href", "/products/allocation");
    const funded = memberPage.getByRole("region", {
      name: "확인된 실제 채굴 기록",
    });
    await expect(funded).toHaveAttribute(
      "data-funded-runtime-state",
      "confirmed",
    );
    await expect(funded.getByText("50%", { exact: true })).toBeVisible();
    await expect(
      funded.getByRole("heading", { name: "원금 유지 혜택", exact: true }),
    ).toBeVisible();
    await captureMatrix(memberPage, info, "funded-mining-server-status");
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

    await memberPage.goto("/home", { waitUntil: "networkidle" });
    const homeStatus = memberPage.getByRole("region", {
      name: "오늘의 채굴 상태",
    });
    await expect(
      homeStatus.getByRole("link", { name: "실제 채굴 보기", exact: true }),
    ).toHaveAttribute("href", "/mining");
    await expect(
      memberPage.getByRole("region", { name: "확인된 실제 채굴 기록" }),
    ).toHaveAttribute("data-funded-runtime-state", "confirmed");
    await expect(
      memberPage.getByText("현재 채굴 확정 누계", { exact: true }),
    ).toBeVisible();
    await captureMatrix(memberPage, info, "funded-home-server-status");
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

    await memberPage.goto("/products", { waitUntil: "networkidle" });
    const publicProducts = memberPage.getByRole("region", {
      name: "공개 상품",
    });
    await expect(
      publicProducts.getByText("로컬 검증 상품", { exact: true }),
    ).toBeVisible();
    await expect(
      publicProducts.locator('[data-catalog-artwork="GOLD"]'),
    ).toHaveCount(1);
    await publicProducts.getByText("자세히 보기", { exact: true }).click();
    await expect(publicProducts.locator("details[open]")).toHaveCount(1);
    await captureMatrix(memberPage, info, "published-catalog-real-card");
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

    await memberPage.goto("/wallet", { waitUntil: "networkidle" });
    await expect(
      memberPage.getByRole("heading", { name: "출금 가능 잔액", exact: true }),
    ).toBeVisible();
    await captureMatrix(memberPage, info, "funded-wallet-real-principal");
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

    const unavailable = await browserJson(
      memberPage,
      "/api/v1/products/allocation",
      {
        catalogId: ids.catalog,
        catalogDigest: published.snapshotDigest,
        expectedRevision: "1",
        products: [
          { productId: ids.unpublishedProduct, allocationBps: "5000" },
        ],
        confirmation: "CONFIRM_FUNDING_ALLOCATION",
      },
      `unavailable-${randomUUID()}`,
    );
    expect(unavailable.status).toBe(409);
    expect(unavailable.payload.error?.code).toBe("ALLOCATION_NOT_ELIGIBLE");
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

    await loginAsMember(otherPage, other, "/products/allocation");
    await dismissGuidedQuestIfPresent(otherPage);
    const otherRead = await browserJson(
      otherPage,
      "/api/v1/products/allocation",
    );
    expect(otherRead.status).toBe(200);
    const otherState = allocationStateSchema.parse(otherRead.payload.data);
    expect(otherState.revision).toBe("0");
    expect(otherState.allocationId).toBeNull();
    expect(otherState.products).toEqual([]);
    const forgedOwner = await browserJson(
      otherPage,
      "/api/v1/products/allocation",
      {
        catalogId: ids.catalog,
        catalogDigest: published.snapshotDigest,
        expectedRevision: "0",
        products: [{ productId: ids.product, allocationBps: "5000" }],
        confirmation: "CONFIRM_FUNDING_ALLOCATION",
        userId: owner.userId,
      },
      `forged-owner-${randomUUID()}`,
    );
    expect(forgedOwner.status).toBe(400);
    expect(forgedOwner.payload.error?.code).toBe("INVALID_ALLOCATION_REQUEST");
    expect(ownerFinancialEvidence(owner.userId)).toEqual(after);
    const ownerRead = await browserJson(
      memberPage,
      "/api/v1/products/allocation",
    );
    expect(
      allocationStateSchema.parse(ownerRead.payload.data).allocationId,
    ).toBe(allocation.allocationId);
    expect(
      execLocalAdminSql(
        `select status::text from public.product_catalog_versions where id='20000000-0000-4000-8000-000000000001';`,
      ),
    ).toBe("DRAFT");
    await info.attach("catalog-allocation-command-evidence", {
      body: Buffer.from(
        JSON.stringify({
          fixtureScope: "LOCAL_BROWSER_TEST_ONLY",
          catalogId: ids.catalog,
          catalogDigest: published.snapshotDigest,
          publishAt: published.publishAt,
          allocationId: allocation.allocationId,
          transitionId: allocation.transitionId,
          inputDigest: allocation.inputDigest,
          principalDebits: after.principalDebits,
          ledgerTransactionsUnchanged:
            before.ledgerTransactions === after.ledgerTransactions,
          seedStatus: "DRAFT",
        }),
      ),
      contentType: "application/json",
    });
  } finally {
    // Existing legal retirement affects only this exact marked test catalog.
    // All approved originals, audit/events and financial evidence are retained.
    const activeFixtureCount = execLocalAdminSql(
      `update public.product_catalog_versions set status='RETIRED' where id=:'catalog'::uuid and proposed_by='LOCAL_BROWSER_TEST_ONLY' and status='PUBLISHED';
       select count(*) from public.product_catalog_versions where id=:'catalog'::uuid and proposed_by='LOCAL_BROWSER_TEST_ONLY' and status='PUBLISHED';`,
      { catalog: ids.catalog },
    );
    expect(activeFixtureCount.trim().split(/\r?\n/).at(-1)).toBe("0");
    await memberContext.close();
    await otherContext.close();
  }
});
