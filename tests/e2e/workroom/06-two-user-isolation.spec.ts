import { test, expect } from "@playwright/test";
import { member, login, started, command, opened } from "./helpers";
test("another real browser identity cannot finish or read the first member round", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, await member());
  const first = await started(page);
  const context = await browser.newContext({ baseURL: baseURL! });
  const second = await context.newPage();
  try {
    await login(second, await member());
    const own = await opened(second);
    expect(own.active).toBeNull();
    expect(own.member?.id).not.toBe(first.state.member?.id);
    const denied = await command(second, "FINISH", {
      id: first.state.active!.id,
    });
    expect(denied.status()).toBe(404);
    expect((await opened(second)).member?.balance).toBe(100000);
  } finally {
    await context.close();
  }
});
