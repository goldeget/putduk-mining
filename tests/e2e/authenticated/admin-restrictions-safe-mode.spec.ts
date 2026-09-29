import { expect, test } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
  nextTotpCode,
  requiredEnv,
} from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  formWithSubmit,
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

    const before = await readSafeMode("NOTIFICATION");

    const admin = await createConfirmedMember("restrict-admin");
    await grantAdminRole(admin.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const secret = await completeAdminLoginWithTotp(
      adminPage,
      admin.email,
      admin.password,
    );

    await adminPage.goto(
      `${ADMIN_ORIGIN}/mfa?returnTo=${encodeURIComponent("/restrictions")}`,
    );
    await adminPage
      .locator('input[inputmode="numeric"]')
      .fill(await nextTotpCode(secret));
    await adminPage.getByRole("button", { name: "인증 완료" }).click();
    await adminPage.waitForURL((url) => !url.pathname.includes("/mfa"), {
      timeout: 60_000,
    });

    await openAdminQueue(adminPage, "/restrictions");
    const card = adminPage.locator("article.queue-card", {
      has: adminPage.locator('input[name="component"][value="NOTIFICATION"]'),
    });
    const applyForm = formWithSubmit(card, "안전 모드 적용");
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
    expect(stillBefore?.is_paused ?? before?.is_paused ?? false).toBe(
      before?.is_paused ?? false,
    );

    await confirmOperatorStepUp(applyForm, secret);
    await applyForm.getByRole("button", { name: "안전 모드 적용" }).click();
    await expect(applyForm.getByRole("status")).toContainText(
      "알림 기능을 잠시 멈췄습니다",
      { timeout: 60_000 },
    );

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
