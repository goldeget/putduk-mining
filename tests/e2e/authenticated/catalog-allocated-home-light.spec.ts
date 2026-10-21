import { expect, test } from "@playwright/test";

import { allocationStateSchema } from "../../../domain/products/allocation-command";
import {
  browserJson,
  withAllocatedCatalogJourney,
} from "./helpers/catalog-allocated-journey-r10";
import { captureAllocatedMatrix } from "./helpers/catalog-allocated-matrix-r10";
import { expectSettledRoute } from "./helpers/settled-route";

test("fresh allocated home light retains all seven widths and four text scales without financial mutation", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360_000);
  await withAllocatedCatalogJourney(
    page,
    browser,
    info,
    false,
    async ({
      memberPage,
      after,
      allocation,
      owner,
      ownerFinancialEvidence,
    }) => {
      expect(ownerFinancialEvidence(owner.userId)).toEqual(after);
      await memberPage.goto("/home", { waitUntil: "networkidle" });
      const homeStatus = await expectSettledRoute(memberPage, "/home");
      await expect(homeStatus).toHaveAttribute(
        "data-launch-surface",
        "simplified-track",
      );
      await expect(
        homeStatus.getByRole("link", { name: "채굴 중", exact: true }),
      ).toHaveAttribute("href", "/mining");
      await expect(
        homeStatus.getByLabel("사용 가능 원화", { exact: true }),
      ).toBeVisible();
      await expect(
        memberPage.getByRole("region", { name: "추천 상품" }),
      ).toHaveCount(0);
      await expect(
        memberPage
          .getByRole("navigation", { name: "주요 메뉴", exact: true })
          .getByRole("link", { name: "상품", exact: true }),
      ).toHaveCount(0);
      await memberPage
        .getByRole("combobox", { name: "화면 테마" })
        .first()
        .selectOption("light");
      await expect(memberPage.locator("html")).toHaveAttribute(
        "data-theme",
        "light",
      );
      await captureAllocatedMatrix(
        memberPage,
        info,
        "funded-home-server-status",
        "light",
      );
      expect(ownerFinancialEvidence(owner.userId)).toEqual(after);

      const ownerRead = await browserJson(
        memberPage,
        "/api/v1/products/allocation",
      );
      expect(ownerRead.status).toBe(200);
      expect(
        allocationStateSchema.parse(ownerRead.payload.data).allocationId,
      ).toBe(allocation.allocationId);
      expect(ownerFinancialEvidence(owner.userId)).toEqual(after);
    },
  );
});
