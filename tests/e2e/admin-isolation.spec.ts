import { expect, test } from "@playwright/test";

test.describe("public application admin isolation", () => {
  for (const path of ["/admin", "/administrator", "/manage", "/backoffice"]) {
    test(`${path} is an ordinary 404`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }

  test("the former public admin command is an ordinary 404", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/admin/deposits/approve", {
      data: { confirmation: "APPROVE_DEPOSIT" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test("public landing does not contain admin navigation", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.locator('a[href^="/admin"], a[href*="admin.mining.putduk.com"]'),
    ).toHaveCount(0);
  });
});
