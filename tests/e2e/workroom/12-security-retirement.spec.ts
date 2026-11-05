import { test, expect } from "@playwright/test";
import { member, login, command, adminOrigin } from "./helpers";
test("HTTP auth, origin and legacy money retirement boundaries reject real requests", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/v1/workroom/state")).status()).toBe(401);
  expect(
    (await request.get(`${adminOrigin}/api/v1/admin/workroom/state`)).status(),
  ).toBe(401);
  await login(page, await member());
  const foreign = await page.request.post("/api/v1/workroom/command", {
    headers: {
      Origin: "https://foreign.invalid",
      "Idempotency-Key": "foreign-request-key",
    },
    data: { operation: "OPEN", input: {} },
  });
  expect(foreign.status()).toBe(403);
  const invalid = await command(page, "START", {
    instrument: "usd",
    stake: 1000,
    acknowledged: false,
    expectedVersion: 1,
  });
  expect(invalid.status()).toBe(400);
  for (const path of [
    "/api/v1/mining/command",
    "/api/v1/trial/convert",
    "/api/v1/products/allocation",
  ]) {
    const retired = await page.request.post(path, {
      headers: { Origin: new URL(page.url()).origin },
      data: {},
    });
    expect([404, 410]).toContain(retired.status());
  }
});
