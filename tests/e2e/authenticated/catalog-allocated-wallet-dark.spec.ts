import { expect, test } from "@playwright/test";

import { allocationStateSchema } from "../../../domain/products/allocation-command";
import {
  browserJson,
  withAllocatedCatalogJourney,
} from "./helpers/catalog-allocated-journey-r10";
import { captureAllocatedMatrix } from "./helpers/catalog-allocated-matrix-r10";

test("fresh allocated wallet dark retains all seven widths and four text scales without financial mutation", async ({
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
      await memberPage.goto("/wallet", { waitUntil: "networkidle" });
      await expect(
        memberPage.getByRole("heading", { name: "지갑", exact: true }),
      ).toBeVisible();
      await captureAllocatedMatrix(
        memberPage,
        info,
        "funded-wallet-real-principal",
        "dark",
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
