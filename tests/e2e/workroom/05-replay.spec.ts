import { test, expect } from "@playwright/test";
import { member, login, started, command, state } from "./helpers";
test("HTTP retry returns original receipt and key mismatch cannot debit twice", async ({
  page,
}) => {
  await login(page, await member());
  const round = await started(page);
  const retry = await command(page, "START", round.input, round.key);
  expect(retry.status()).toBe(200);
  expect((await retry.json()).data).toEqual(round.state);
  const mismatch = await command(
    page,
    "START",
    { ...round.input, stake: 2000 },
    round.key,
  );
  expect(mismatch.status()).toBe(409);
  expect((await state(page)).member?.balance).toBe(99000);
});
