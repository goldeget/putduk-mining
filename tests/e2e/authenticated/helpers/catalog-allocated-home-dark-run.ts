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

/** SIMPLIFIED_TRACK: home first viewport is brand + one CTA + one balance. */
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
        .selectOption("dark");
      await expect(memberPage.locator("html")).toHaveAttribute(
        "data-theme",
        "dark",
      );
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
