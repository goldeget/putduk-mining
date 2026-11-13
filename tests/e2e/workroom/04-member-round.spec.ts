import { test, expect } from "@playwright/test";
import { member, login, command, state } from "./helpers";
test("real member starts and closes early using authoritative persisted points", async ({
  page,
}) => {
  await login(page, await member());
  await expect(
    page.getByText("체험 포인트 · 현금 전환 불가", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "참여할 체험 포인트" })
    .fill("1000");
  const startResponse = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/v1/workroom/command") ||
      response.request().method() !== "POST"
    )
      return false;
    return response.request().postDataJSON()?.operation === "START";
  });
  await page
    .getByRole("button", { name: "모니터링 시작", exact: true })
    .click();
  const startedResponse = await startResponse;
  expect(startedResponse.status()).toBe(200);
  expect(startedResponse.request().postDataJSON().input.acknowledged).toBe(
    true,
  );
  const round = (await startedResponse.json()).data;
  await expect(
    page.getByRole("heading", { name: "이번 모의 참여", exact: true }),
  ).toBeVisible();
  expect(round.member?.balance).toBe(99000);
  expect(round.active?.configVersion).toBeGreaterThan(0);
  const response = await command(page, "FINISH", {
    id: round.active!.id,
  });
  expect(response.status()).toBe(200);
  const current = await state(page);
  expect(current.active).toBeNull();
  expect(current.history[0]?.id).toBe(round.active!.id);
  expect(
    current.history[0]!.closedAt! - current.history[0]!.started,
  ).toBeLessThan(current.history[0]!.duration * 1000);
  expect(current.member?.balance).toBe(99000 + current.history[0]!.returned!);
});
