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

  test("hold and destination register routes exist; legacy withdrawals is not the form path", async ({
    request,
  }) => {
    const hold = await request.post("/api/v1/withdrawals/hold", {
      data: {
        method: "KRW_BANK",
        destinationId: "00000000-0000-4000-8000-000000000001",
        amountKrw: "1000",
      },
      maxRedirects: 0,
    });
    // Unauthenticated callers are rejected before money mutation.
    expect([401, 400]).toContain(hold.status());

    const destinations = await request.post(
      "/api/v1/withdrawals/destinations",
      {
        data: {
          method: "KRW_BANK",
          accountHolder: "테스트",
          accountNumber: "1234567890",
          bankCode: "KB",
        },
        maxRedirects: 0,
      },
    );
    expect([401, 400, 503]).toContain(destinations.status());

    const legacy = await request.post("/api/v1/withdrawals", {
      data: { amountAtomic: "1000" },
      maxRedirects: 0,
    });
    // Legacy route may still exist for compatibility, but must not be the
    // authenticated form submit URL (asserted in unit source lock).
    expect([401, 400, 503]).toContain(legacy.status());
  });
});
