import { test, expect } from "@playwright/test";
import { member, login, started, command, state } from "./helpers";
test("real member starts and closes early using authoritative persisted points", async ({
  page,
}) => {
  await login(page, await member());
  const round = await started(page);
  expect(round.state.member?.balance).toBe(99000);
  expect(round.state.active?.configVersion).toBeGreaterThan(0);
  const response = await command(page, "FINISH", {
    id: round.state.active!.id,
  });
  expect(response.status()).toBe(200);
  const current = await state(page);
  expect(current.active).toBeNull();
  expect(current.history[0]?.id).toBe(round.state.active!.id);
  expect(
    current.history[0]!.closedAt! - current.history[0]!.started,
  ).toBeLessThan(current.history[0]!.duration * 1000);
  expect(current.member?.balance).toBe(99000 + current.history[0]!.returned!);
});
