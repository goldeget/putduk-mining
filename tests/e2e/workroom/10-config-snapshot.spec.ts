import { test, expect } from "@playwright/test";
import {
  member,
  operator,
  login,
  started,
  adminLogin,
  adminOrigin,
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
    await admin.goto(`${adminOrigin}/workroom?tab=config`);
    await admin
      .getByRole("combobox", { name: "카테고리 상품" })
      .selectOption("usd");
    await admin
      .getByRole("combobox", { name: "움직임 패턴" })
      .selectOption("balanced");
    const direction = admin.getByRole("combobox", { name: "수익 방향" });
    const magnitude = admin.getByRole("spinbutton", {
      name: "수익률 크기 (%)",
    });
    const preview = admin.getByTestId("admin-workroom-preview");
    await admin.getByRole("spinbutton", { name: /^진행 시간/ }).fill("30");
    await admin.getByRole("spinbutton", { name: /^중간 변동 폭/ }).fill("1");
    await direction.selectOption("NEGATIVE");
    await magnitude.fill("7");
    await expect(preview).toHaveAttribute("data-start-value", "100");
    await expect(preview).toHaveAttribute("data-end-value", "93");
    await magnitude.fill("0");
    await expect(direction).toHaveValue("NEGATIVE");
    await expect(preview).toHaveAttribute("data-end-value", "100");
    await magnitude.fill("7");
    await expect(direction).toHaveValue("NEGATIVE");
    await expect(preview).toHaveAttribute("data-end-value", "93");
    await direction.selectOption("POSITIVE");
    await expect(preview).toHaveAttribute("data-end-value", "107");
    const position = admin.getByRole("slider", { name: "모의 경로 진행 위치" });
    await position.focus();
    await position.press("Home");
    await expect(preview).toHaveAttribute("data-current-value", "100");
    await position.press("End");
    await expect(preview).toHaveAttribute("data-current-value", "107");
    // Draft inspection must not alter the saved configuration or active round.
    const draftState = await state(page);
    expect(draftState.active).toEqual(frozen);
    expect(
      draftState.configs.find((row) => row.instrument === "usd")!.version,
    ).toBe(frozen.configVersion);
    await admin
      .getByRole("textbox", { name: "변경 사유", exact: true })
      .fill("Disposable version acceptance");
    await admin
      .getByRole("button", { name: "변경 내용 검토", exact: true })
      .click();
    const review = admin.getByRole("region", { name: "운영 변경 검토" });
    await expect(review.getByText("+7.00%", { exact: true })).toBeVisible();
    const saving = admin.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/workroom/command") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.operation === "CONFIG_SAVE",
    );
    await review
      .getByRole("button", { name: "확인하고 저장", exact: true })
      .click();
    const changed = await saving;
    expect(changed.status()).toBe(200);
    expect(changed.request().postDataJSON().input).toEqual({
      instrument: "usd",
      pattern: "balanced",
      roi: 7,
      duration: 30,
      amplitude: 1,
      expectedVersion: frozen.configVersion,
      reason: "Disposable version acceptance",
    });
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
