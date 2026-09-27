import { expect, test } from "@playwright/test";

test.describe("authenticated job keeps the public admin boundary", () => {
  for (const path of ["/admin", "/administrator", "/manage", "/backoffice"]) {
    test(`${path} stays an ordinary 404`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }
});
