import { test, expect } from "@playwright/test";
import {
  member,
  operator,
  login,
  started,
  adminLogin,
  adminCommand,
  state,
  command,
} from "./helpers";
test("admin configuration version changes preserve a running member snapshot and reject stale starts", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, await member());
  const round = await started(page);
  const frozen = round.state.active!;
  const context = await browser.newContext({ baseURL: baseURL! });
  const admin = await context.newPage();
  try {
    await adminLogin(admin, await operator());
    const changed = await adminCommand(admin, "CONFIG_SAVE", {
      instrument: "usd",
      pattern: "balanced",
      roi: 7,
      duration: 30,
      amplitude: 1,
      expectedVersion: frozen.configVersion,
      reason: "Disposable version acceptance",
    });
    expect(changed.status()).toBe(200);
    const current = await state(page);
    expect(current.active).toEqual(frozen);
    expect(
      current.configs.find((row) => row.instrument === "usd")!.version,
    ).toBe(frozen.configVersion + 1);
    expect((await command(page, "FINISH", { id: frozen.id })).status()).toBe(
      200,
    );
    expect((await command(page, "START", round.input)).status()).toBe(409);
  } finally {
    await context.close();
  }
});
