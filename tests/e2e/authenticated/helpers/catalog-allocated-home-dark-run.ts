import {
  expect,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { allocationStateSchema } from "../../../../domain/products/allocation-command";
import {
  browserJson,
  withAllocatedCatalogJourney,
} from "./catalog-allocated-journey-r10";
import { captureAllocatedMatrix } from "./catalog-allocated-matrix-r10";
import { expectSettledRoute } from "./settled-route";

export async function runAllocatedHomeDark(
  page: Page,
  browser: Browser,
  info: TestInfo,
  widths: readonly number[],
) {
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
      await expect(
        homeStatus.getByRole("link", { name: "실제 채굴 보기", exact: true }),
      ).toHaveAttribute("href", "/mining");
      await expect(
        memberPage.getByRole("region", { name: "확인된 실제 채굴 기록" }),
      ).toHaveAttribute("data-funded-runtime-state", "confirmed");
      await expect(
        memberPage
          .getByRole("region", { name: "지갑과 체험 정보", exact: true })
          .getByText("현재 채굴 확정 누계", { exact: true }),
      ).toBeVisible();
      await memberPage
        .getByRole("combobox", { name: "화면 테마" })
        .first()
        .selectOption("dark");
      await expect(memberPage.locator("html")).toHaveAttribute(
        "data-theme",
        "dark",
      );
      const capacityProgress = memberPage.getByRole("progressbar", {
        name: "채굴 한도 사용률",
      });
      await expect(capacityProgress).toBeVisible();
      await expect(capacityProgress).toHaveAttribute("max", "10000");
      await expect(capacityProgress).toHaveAttribute("aria-valuetext", /사용$/);
      const homeProducts = memberPage.locator('ul[data-product-count="1"]');
      await expect(homeProducts.locator("li")).toHaveCount(1);
      const listBounds = await homeProducts.boundingBox();
      const cardBounds = await homeProducts.locator("li").boundingBox();
      expect(
        Math.abs(listBounds!.width - cardBounds!.width),
      ).toBeLessThanOrEqual(1);
      await captureAllocatedMatrix(
        memberPage,
        info,
        "funded-home-server-status",
        "dark",
        widths,
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
}
