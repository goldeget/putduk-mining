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
  }) => {
    const operator = await createConfirmedMember("ws05-admin-op");
    await grantAdminRole(operator.userId);
    const secret = await completeAdminLoginWithTotp(
      page,
      operator.email,
      operator.password,
    );
    expect(secret.length).toBeGreaterThanOrEqual(16);
    await expect(page.getByText("오늘의 퍼뜩").first()).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
    await page.waitForURL(/\/login/);

    const member = await createConfirmedMember("ws05-admin-member");
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${ADMIN_ORIGIN}/login`);
    await memberPage.locator('input[name="email"]').fill(member.email);
    await memberPage.locator('input[name="password"]').fill(member.password);
    await memberPage.getByRole("button", { name: "보안 로그인" }).click();
    await expect(memberPage.getByRole("alert")).toContainText(
      "입력한 정보로 운영자 로그인을 완료할 수 없습니다.",
      { timeout: 30_000 },
    );
    await memberContext.close();
  });

  test("issues and single-consumes a step-up grant against the session registry", async ({
    page,
    request,
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

    const cookies = await page.context().cookies(ADMIN_ORIGIN);
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const issue = await request.post(
      `${ADMIN_ORIGIN}/api/v1/admin/session/step-up`,
      {
        headers: {
          Origin: ADMIN_ORIGIN,
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        data: { commandFamily: "DEPOSIT_CONFIRM" },
      },
    );
    expect(issue.status()).toBe(200);
    const issued = (await issue.json()) as { data?: { token?: string } };
    const token = issued.data?.token;
    expect(typeof token === "string" && token.length >= 16).toBe(true);

    const service = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SECRET_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: firstError } = await service.rpc("consume_admin_step_up", {
      p_user_id: operator.userId,
      p_token: token,
      p_command_family: "DEPOSIT_CONFIRM",
      p_request_id: randomUUID(),
    });
    expect(firstError).toBeNull();

    const { error: reuseError } = await service.rpc("consume_admin_step_up", {
      p_user_id: operator.userId,
      p_token: token,
      p_command_family: "DEPOSIT_CONFIRM",
      p_request_id: randomUUID(),
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
