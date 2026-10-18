import { randomUUID } from "node:crypto";

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { allocationReceiptSchema } from "../../../../domain/products/allocation-command";
import { catalogReceiptSchema } from "../../../../domain/products/catalog-command";
import { createConfirmedMember } from "../../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./admin-totp";
import { confirmOperatorStepUp } from "./admin-money-ui";
import { execLocalAdminSql } from "./local-db";
import { dismissGuidedQuestIfPresent, loginAsMember } from "./member-session";
import { captureAllocatedMatrix } from "./catalog-allocated-matrix-r10";

export async function browserJson(
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

type AllocatedJourney = {
  ids: ReturnType<typeof fixtureIds>;
  owner: Awaited<ReturnType<typeof createConfirmedMember>>;
  other: Awaited<ReturnType<typeof createConfirmedMember>>;
  memberPage: Page;
  otherPage: Page;
  before: ReturnType<typeof ownerFinancialEvidence>;
  after: ReturnType<typeof ownerFinancialEvidence>;
  published: ReturnType<typeof catalogReceiptSchema.parse>;
  allocation: ReturnType<typeof allocationReceiptSchema.parse>;
  ownerFinancialEvidence: typeof ownerFinancialEvidence;
};

/** Fresh UUIDs, actual operator AAL2, canonical deposit and member allocation.
 * Shared setup never fabricates published catalogs, allocations or balances.
 * workers:1 and isolated per-lane databases retain the financial boundary.
 */
export async function withAllocatedCatalogJourney(
  page: Page,
  browser: Browser,
  info: TestInfo,
  captureCore: boolean,
  verify: (journey: AllocatedJourney) => Promise<void>,
) {
  const journeyStartedAt = Date.now();
  const markStage = (
    stage:
      | "start"
      | "aal2-ready"
      | "draft-visible"
      | "catalog-published"
      | "publication-effective"
      | "allocation-confirmed"
      | "verification-complete"
      | "cleanup-complete",
  ) =>
    console.info(
      "[catalog-allocated-stage] " +
        JSON.stringify({ stage, elapsedMs: Date.now() - journeyStartedAt }),
    );
  markStage("start");
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
  markStage("aal2-ready");
  const memberOrigin = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`;
  const contexts: BrowserContext[] = [];
  let primaryFailed = false;
  let primaryFailure: unknown;
  try {
    const memberContext = await browser.newContext({ baseURL: memberOrigin });
    contexts.push(memberContext);
    const otherContext = await browser.newContext({ baseURL: memberOrigin });
    contexts.push(otherContext);
    const memberPage = await memberContext.newPage();
    const otherPage = await otherContext.newPage();
    createDraftFixture(ids);
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
    markStage("draft-visible");
    if (captureCore)
      await captureAllocatedMatrix(memberPage, info, "allocation-draft-empty");

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
    if (captureCore)
      await captureAllocatedMatrix(page, info, "catalog-source-review");
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
    markStage("catalog-published");
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
    if (captureCore)
      await captureAllocatedMatrix(page, info, "catalog-published-receipt");
    await expect
      .poll(() => Date.now(), { timeout: 130_000 })
      .toBeGreaterThanOrEqual(Date.parse(published.publishAt));
    markStage("publication-effective");

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
    if (captureCore)
      await captureAllocatedMatrix(
        memberPage,
        info,
        "allocation-confirmed-owner",
      );
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
    markStage("allocation-confirmed");

    await verify({
      ids,
      owner,
      other,
      memberPage,
      otherPage,
      before,
      after,
      published,
      allocation,
      ownerFinancialEvidence,
    });
    markStage("verification-complete");
  } catch (error) {
    primaryFailed = true;
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures: unknown[] = [];
    try {
      // Only our exact UUID+marker; retain originals, ledger, events and audit.
      const activeFixtureCount = execLocalAdminSql(
        `update public.product_catalog_versions set status='RETIRED' where id=:'catalog'::uuid and proposed_by='LOCAL_BROWSER_TEST_ONLY' and status='PUBLISHED';
         select count(*) from public.product_catalog_versions where id=:'catalog'::uuid and proposed_by='LOCAL_BROWSER_TEST_ONLY' and status='PUBLISHED';`,
        { catalog: ids.catalog },
      );
      expect(activeFixtureCount.trim().split(/\r?\n/).at(-1)).toBe("0");
    } catch (error) {
      cleanupFailures.push(error);
    }
    // Attempt both closes even after retirement or one context close fails.
    for (const context of contexts) {
      try {
        await context.close();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        primaryFailed ? [primaryFailure, ...cleanupFailures] : cleanupFailures,
        primaryFailed
          ? "Catalog journey failed; cleanup also failed"
          : "Catalog journey cleanup failed",
      );
    }
    markStage("cleanup-complete");
  }
}
