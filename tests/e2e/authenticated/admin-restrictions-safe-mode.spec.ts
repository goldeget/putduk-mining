import { expect, test } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import {
  completeAdminLoginWithTotp,
  grantAdminRole,
  requiredEnv,
} from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  openAdminQueue,
  readConsumedStepUpFamilies,
} from "./helpers/admin-money-ui";

async function grantRole(
  userId: string,
  role: "ADMIN" | "VIEWER" | "SUPPORT_ADMIN",
) {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!url.startsWith("http://")) {
    throw new Error("Admin E2E is limited to local Supabase.");
  }
  const service = createLocalServiceRoleClient();
  const { error } = await service.from("user_roles").insert({
    user_id: userId,
    role,
    granted_by: userId,
  });
  if (error) throw new Error(error.message);
}

async function readSafeMode(component: string) {
  const service = createLocalServiceRoleClient();
  const { data, error } = await service
    .from("safe_mode_controls")
    .select("is_paused, reason, request_id, changed_by")
    .eq("component", component)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** 재시도·이전 실행으로 이미 정지된 상태를 풀어 적용 여정을 고정한다. */
async function clearSafeModePause(component: string) {
  const existing = await readSafeMode(component);
  if (!existing?.is_paused) return;
  const service = createLocalServiceRoleClient();
  // changed_by·request_id는 NOT NULL라 유지하고 pause만 해제한다.
  const { error } = await service
    .from("safe_mode_controls")
    .update({
      is_paused: false,
      reason: "e2e baseline: open before admin mutation",
      starts_at: new Date().toISOString(),
      review_at: null,
    })
    .eq("component", component);
  if (error) throw new Error(error.message);
}

async function readLatestSafeModeAudit(component: string) {
  const service = createLocalServiceRoleClient();
  const { data, error } = await service
    .from("audit_logs")
    .select("action, reason, request_id, actor_user_id, metadata")
    .eq("target_type", "SAFE_MODE")
    .eq("target_id", component)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

test.describe("admin restrictions · safe mode", () => {
  test("denies VIEWER mutation while allowing ADMIN with reason, step-up, and audit", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const viewer = await createConfirmedMember("restrict-viewer");
    await grantRole(viewer.userId, "VIEWER");
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await completeAdminLoginWithTotp(viewerPage, viewer.email, viewer.password);
    await openAdminQueue(viewerPage, "/restrictions");
    await expect(
      viewerPage.getByText("현재 역할로는 조회만 가능합니다"),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("button", { name: "안전 모드 적용" }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByText("안전 모드와 기능 플래그는 권한이 아닙니다"),
    ).toBeVisible();
    await viewerContext.close();

    // 성공 후 버튼이 「제한 해제」로 바뀌어도 폼을 잃지 않도록 aria-label로 고정한다.
    await clearSafeModePause("NOTIFICATION");
    const before = await readSafeMode("NOTIFICATION");
    expect(before?.is_paused ?? false).toBe(false);

    const admin = await createConfirmedMember("restrict-admin");
    await grantAdminRole(admin.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    // 로그인 TOTP(AAL2)만 수행한다. 추가 /mfa는 세션을 다시 묶고
    // 폼의 작업 확인(challengeAndVerify) 토큰과 어긋날 수 있다.
    const secret = await completeAdminLoginWithTotp(
      adminPage,
      admin.email,
      admin.password,
    );

    await openAdminQueue(adminPage, "/restrictions");
    const card = adminPage.locator("article.queue-card", {
      has: adminPage.locator('input[name="component"][value="NOTIFICATION"]'),
    });
    const applyForm = card.getByRole("form", { name: "알림 안전 모드" });
    await expect(
      applyForm.getByRole("button", { name: "안전 모드 적용" }),
    ).toBeVisible();
    await applyForm
      .getByLabel("확인 사유")
      .fill("알림 지연을 확인해 잠시 멈춥니다.");
    await applyForm
      .getByRole("checkbox", { name: /이 기능을 잠시 멈춥니다/ })
      .check();
    await applyForm.getByRole("button", { name: "안전 모드 적용" }).click();
    await expect(applyForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );

    const stillBefore = await readSafeMode("NOTIFICATION");
    expect(stillBefore?.is_paused ?? false).toBe(false);

    await confirmOperatorStepUp(applyForm, secret);
    // Bypass the client change event to exercise the server's input boundary:
    // an invalid date must not spend a valid one-time grant.
    const reviewTime = applyForm.getByLabel("검토 시각(한국 시간, 선택)");
    await reviewTime.evaluate((field: HTMLInputElement) => {
      field.value = "2000-01-01T00:00";
    });
    await applyForm.getByRole("button", { name: "안전 모드 적용" }).click();
    await expect(applyForm.getByRole("status")).toContainText(
      "검토 시각은 지금보다 이후여야 합니다",
    );
    expect((await readSafeMode("NOTIFICATION"))?.is_paused ?? false).toBe(
      false,
    );
    expect(await readConsumedStepUpFamilies(admin.userId)).not.toContain(
      "SAFE_MODE",
    );
    await reviewTime.evaluate((field: HTMLInputElement) => {
      field.value = "";
    });
    await applyForm.getByRole("button", { name: "안전 모드 적용" }).click();
    await expect(applyForm.getByRole("status")).toContainText(
      "알림 기능을 잠시 멈췄습니다",
      { timeout: 60_000 },
    );
    await expect(card.getByText("정지 중")).toBeVisible();
    await expect(
      applyForm.getByRole("button", { name: "제한 해제" }),
    ).toBeVisible();

    const after = await readSafeMode("NOTIFICATION");
    expect(after?.is_paused).toBe(true);
    expect(after?.reason).toContain("알림 지연");
    expect(after?.changed_by).toBe(admin.userId);
    expect(after?.request_id).toBeTruthy();

    const audit = await readLatestSafeModeAudit("NOTIFICATION");
    expect(audit?.action).toBe("SAFE_MODE_ENABLED");
    expect(audit?.actor_user_id).toBe(admin.userId);
    expect(audit?.request_id).toBe(after?.request_id);
    expect(await readConsumedStepUpFamilies(admin.userId)).toContain(
      "SAFE_MODE",
    );

    await adminContext.close();
  });
});
