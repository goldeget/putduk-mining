import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  generateTotp,
  grantAdminRole,
  requiredEnv,
} from "./helpers/admin-totp";

test.describe("admin app-owned session and real TOTP", () => {
  test("enrolls TOTP, registers admin session, and rejects normal members", async ({
    page,
    browser,
  }, testInfo) => {
    const operator = await createConfirmedMember("ws05-admin-op");
    await grantAdminRole(operator.userId);
    const secret = await completeAdminLoginWithTotp(
      page,
      operator.email,
      operator.password,
    );
    expect(secret.length).toBeGreaterThanOrEqual(16);
    await expect(
      page.getByRole("heading", {
        name: "오늘의 퍼뜩",
        level: 1,
        exact: true,
      }),
    ).toBeVisible({ timeout: 60_000 });

    const menu = page.getByRole("button", { name: "운영 메뉴" });
    if (await menu.isVisible()) await menu.click();
    const logout = page.getByRole("button", { name: "이 기기 로그아웃" });
    await expect(logout).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("admin-session-logout-reachable.png"),
      fullPage: true,
    });
    await logout.click();
    await page.waitForURL(/\/login/, { timeout: 60_000 });

    const member = await createConfirmedMember("ws05-admin-member");
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${ADMIN_ORIGIN}/login`);
    await memberPage.locator('input[name="email"]').fill(member.email);
    await memberPage.locator('input[name="password"]').fill(member.password);
    await memberPage.getByRole("button", { name: "보안 로그인" }).click();
    // Next route announcer도 role=alert라서 로그인 오류 문구로 한정한다.
    await expect(
      memberPage.getByRole("alert").filter({
        hasText: "입력한 정보로 운영자 로그인을 완료할 수 없습니다.",
      }),
    ).toBeVisible({ timeout: 30_000 });
    await memberContext.close();
  });

  test("issues and single-consumes a step-up grant against the session registry", async ({
    page,
  }) => {
    const operator = await createConfirmedMember("ws05-admin-step");
    await grantAdminRole(operator.userId);
    const secret = await completeAdminLoginWithTotp(
      page,
      operator.email,
      operator.password,
    );

    // Fresh TOTP challenge refreshes AMR before grant issuance.
    await page.goto(`${ADMIN_ORIGIN}/mfa?returnTo=${encodeURIComponent("/")}`);
    await page.locator('input[inputmode="numeric"]').fill(generateTotp(secret));
    await page.getByRole("button", { name: "인증 완료" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/mfa"), {
      timeout: 60_000,
    });

    // 브라우저 fetch는 운영 UI와 동일하게 쿠키·Origin을 실어 보낸다.
    const issue = await page.evaluate(async () => {
      const response = await fetch("/api/v1/admin/session/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandFamily: "DEPOSIT_CONFIRM" }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { token?: string };
        error?: { code?: string };
      } | null;
      return {
        status: response.status,
        token: payload?.data?.token ?? null,
        errorCode: payload?.error?.code ?? null,
      };
    });
    expect(
      issue,
      `STEP_UP_ISSUE_FAILED:status=${issue.status};code=${issue.errorCode}`,
    ).toMatchObject({ status: 200 });
    const token = issue.token;
    expect(typeof token === "string" && token.length >= 16).toBe(true);

    const service = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SECRET_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: sessions, error: sessionError } = await service
      .from("admin_sessions")
      .select("id")
      .eq("user_id", operator.userId)
      .is("revoked_at", null);
    expect(sessionError).toBeNull();
    expect(sessions).toHaveLength(1);
    const adminSessionId = sessions?.[0]?.id;
    expect(typeof adminSessionId).toBe("string");

    const { error: firstError } = await service.rpc("consume_admin_step_up", {
      p_user_id: operator.userId,
      p_token: token,
      p_command_family: "DEPOSIT_CONFIRM",
      p_request_id: randomUUID(),
      p_admin_session_id: adminSessionId,
    });
    expect(firstError).toBeNull();

    const { error: reuseError } = await service.rpc("consume_admin_step_up", {
      p_user_id: operator.userId,
      p_token: token,
      p_command_family: "DEPOSIT_CONFIRM",
      p_request_id: randomUUID(),
      p_admin_session_id: adminSessionId,
    });
    expect(reuseError?.message ?? "").toContain("STEP_UP_REQUIRED");
  });

  test("session-expired and unauthorized UX routes remain reachable", async ({
    page,
  }) => {
    await page.goto(`${ADMIN_ORIGIN}/session-expired`);
    await expect(
      page.getByRole("heading", { name: "세션이 만료되었습니다" }),
    ).toBeVisible();
    await page.goto(`${ADMIN_ORIGIN}/unauthorized?code=STEP_UP_REQUIRED`);
    await expect(
      page.getByRole("heading", { name: "권한이 없습니다" }),
    ).toBeVisible();
    await page.goto(`${ADMIN_ORIGIN}/reauth?reason=step-up`);
    await expect(
      page.getByRole("heading", { name: "다시 확인해 주세요" }),
    ).toBeVisible();
  });
});
