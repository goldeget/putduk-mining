import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { allocationStateSchema } from "../../../domain/products/allocation-command";
import {
  browserJson,
  withAllocatedCatalogJourney,
} from "./helpers/catalog-allocated-journey-r10";
import { captureAllocatedMatrix } from "./helpers/catalog-allocated-matrix-r10";
import { execLocalAdminSql } from "./helpers/local-db";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

test("actual operator catalog approval and owner allocation retain receipts without a purchase debit", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360_000);
  await withAllocatedCatalogJourney(
    page,
    browser,
    info,
    true,
    async ({
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
    }) => {
      // Real paid allocation has no legacy trial session. Only the server's
      // versioned accepted status may make the scene run or say "채굴 중".
      await memberPage.goto("/mining", { waitUntil: "networkidle" });
      await expect(
        memberPage.locator('[data-ui-ready="/mining"]'),
      ).toHaveAttribute("data-ui-state", "loaded");
      await expect(
        memberPage.getByRole("heading", {
          name: "채굴 중",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        memberPage.getByRole("heading", {
          name: "채굴을 시작해 보세요",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        memberPage.getByRole("link", {
          name: "채굴 중 · 잔액 보기",
          exact: true,
        }),
      ).toHaveAttribute("href", "/wallet");
      const funded = memberPage.getByRole("region", {
        name: "확인된 실제 채굴 기록",
      });
      await expect(funded).toHaveAttribute(
        "data-funded-runtime-state",
        "confirmed",
      );
      await expect(funded.getByText("50%", { exact: true })).toBeVisible();
      const effectiveSpeed = memberPage.locator('[data-amount-weight="speed"]');
      await expect(
        effectiveSpeed.getByText("0.5배", { exact: true }),
      ).toBeVisible();
      await expect(
        effectiveSpeed.getByText("1배", { exact: true }),
      ).toHaveCount(0);
      await expect(
        funded.getByRole("heading", { name: "원금 유지 혜택", exact: true }),
      ).toBeVisible();
      await captureAllocatedMatrix(
        memberPage,
        info,
        "funded-mining-server-status",
      );
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
      await captureAllocatedMatrix(
        memberPage,
        info,
        "published-catalog-real-card",
      );
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
      expect(forgedOwner.payload.error?.code).toBe(
        "INVALID_ALLOCATION_REQUEST",
      );
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
    },
  );
});
