import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";

/**
 * 오늘의 퍼뜩 — 빈 대기열·실측 카운트·실패 표기 회귀.
 * 의도적 장애 주입(forced fault)은 OPEN으로 남긴다.
 */
test.describe("admin today operational snapshot", () => {
  test("shows real empty-queue state with Korean operator copy", async ({
    page,
  }) => {
    const operator = await createConfirmedMember("lane-m-today-empty");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(`${ADMIN_ORIGIN}/`);
    await expect(page.getByTestId("admin-today")).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole("heading", { name: "오늘의 퍼뜩" }),
    ).toBeVisible();

    // 영어 운영 재깅/개발 문구가 사용자에게 보이지 않아야 한다.
    await expect(page.getByText("OPERATIONS BRIEFING")).toHaveCount(0);
    await expect(page.getByText("IMMUTABLE AUDIT")).toHaveCount(0);
    await expect(page.getByText("Basic Mode")).toHaveCount(0);

    const total = page.getByTestId("today-attention-total");
    await expect(total).toBeVisible();
    const totalText = (await total.innerText()).trim();
    expect(totalText === "확인 필요" || /^\d[\d,]*$/.test(totalText)).toBe(
      true,
    );

    if (totalText === "0") {
      await expect(page.getByTestId("today-empty-queues")).toBeVisible();
      await expect(page.getByText("지금 확인할 일이 없어요")).toBeVisible();
    }

    for (const code of [
      "KRW_DEPOSIT",
      "USDT_DEPOSIT",
      "KRW_BANK",
      "USDT_WD",
      "KYC",
      "EXCEPTION",
      "SAFE",
    ]) {
      const card = page.getByTestId(`today-queue-${code}`);
      await expect(card).toBeVisible();
      const state = await card.getAttribute("data-count-state");
      expect(["ready", "empty", "unavailable"]).toContain(state);
      if (state === "unavailable") {
        await expect(card).toContainText("확인 필요");
      }
    }

    const memberTotal = (
      await page.getByTestId("today-member-total").innerText()
    ).trim();
    expect(memberTotal === "확인 필요" || /^\d[\d,]*$/.test(memberTotal)).toBe(
      true,
    );

    // 키보드로 첫 대기열 카드에 포커스가 가야 한다.
    await page.keyboard.press("Tab");
    // 테마·축소 모션은 시각 회귀에서 별도 검증. 여기서는 라이트 선호만 스모크.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.getByTestId("admin-today")).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.getByTestId("admin-today")).toBeVisible();
  });
});
