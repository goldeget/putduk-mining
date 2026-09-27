import { expect, test } from "@playwright/test";

/**
 * WS-04 phone / copy / isolation smoke for Agent D.
 * Does not claim PRODUCT COMPLETE. Asserts contract-facing UX boundaries
 * visible on existing public surfaces.
 */

test.describe("WS-04 phone signup copy contract", () => {
  test("signup labels phone as availability surface, never SMS ownership verification", async ({
    page,
  }) => {
    await page.goto("/signup");

    await expect(page.getByLabel("휴대전화")).toBeVisible();
    await expect(page.getByText("휴대폰 인증")).toHaveCount(0);
    await expect(
      page.getByText(/SMS\s*인증|소유\s*확인|본인\s*인증\s*완료/),
    ).toHaveCount(0);
    await expect(page.getByText(/verified_phone_at|SMS verified/i)).toHaveCount(
      0,
    );
  });
});

test.describe("WS-04 wallet isolation and admin command denial", () => {
  test("wallet and withdrawal surfaces require login with safe return paths", async ({
    page,
  }) => {
    await page.goto("/wallet");
    await expect(page).toHaveURL(/\/login\?next=%2Fwallet/);

    await page.goto("/wallet/withdraw");
    await expect(page).toHaveURL(/\/login\?next=%2Fwallet%2Fwithdraw/);
  });

  test("public origin rejects reserved admin aliases and former admin money command", async ({
    request,
  }) => {
    for (const path of ["/admin", "/administrator", "/manage", "/backoffice"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    }

    const approve = await request.post("/api/v1/admin/deposits/approve", {
      data: { confirmation: "APPROVE_DEPOSIT" },
      maxRedirects: 0,
    });
    expect(approve.status()).toBe(404);
  });
});
