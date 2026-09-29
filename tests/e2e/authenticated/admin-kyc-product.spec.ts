import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { completeAdminLoginWithTotp } from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  issueCommandFamilyToken,
  setStepUpToken,
} from "./helpers/admin-money-ui";
import {
  assertKycPageMasksSecrets,
  closeOpenKycQueueForEmptyProof,
  grantNamedAdminRole,
  kycCard,
  kycReviewForm,
  openKycQueue,
  readKycCase,
  seedOpenKycCase,
} from "./helpers/admin-kyc-ui";

async function fillKycReview(
  form: ReturnType<typeof kycReviewForm>,
  decision: "APPROVED" | "REJECTED",
  reason: string,
) {
  await form.getByLabel("결과").selectOption(decision);
  await form.getByLabel("결정 사유").fill(reason);
  await form.getByRole("checkbox").check();
}

async function submitKycWithStepUp(
  form: ReturnType<typeof kycReviewForm>,
  secret: string,
) {
  // 출금 E2E와 동일: 이미 채워진 폼에 step-up만 한 뒤 바로 제출한다.
  await confirmOperatorStepUp(form, secret);
  await expect
    .poll(async () => form.locator('input[name="stepUpToken"]').inputValue())
    .toMatch(/^.{16,}$/);
  await expect(form.getByRole("checkbox")).toBeChecked();
  await form.getByRole("button", { name: "검토 결과 저장" }).click();
  await expect(form.getByRole("status")).toContainText(
    "본인 확인 검토 결과를 저장했습니다",
    { timeout: 30_000 },
  );
}

test.describe("admin KYC product queue", () => {
  test("shows empty queue, then masks evidence and requires audit reason", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await closeOpenKycQueueForEmptyProof();

    const operator = await createConfirmedMember("lane-f-kyc-empty");
    await grantNamedAdminRole(operator.userId, "ADMIN");
    const secret = await completeAdminLoginWithTotp(
      page,
      operator.email,
      operator.password,
    );
    expect(secret.length).toBeGreaterThanOrEqual(16);

    await openKycQueue(page);
    await expect(
      page.getByRole("heading", { name: "대기 건 없음" }),
    ).toBeVisible();
    await expect(
      page.getByText("지금 검토할 본인 확인 건이 없습니다."),
    ).toBeVisible();

    const member = await createConfirmedMember("lane-f-kyc-member");
    const seeded = await seedOpenKycCase({
      userId: member.userId,
      riskLevel: "MEDIUM",
      withDocument: true,
    });

    await openKycQueue(page);
    const card = kycCard(page, seeded.caseId);
    await expect(card.getByRole("heading", { name: "검토 중" })).toBeVisible();
    await expect(card.getByText("보통")).toBeVisible();
    await expect(card.getByText(/1건 \(원문 비공개\)/)).toBeVisible();

    await assertKycPageMasksSecrets(page, [
      seeded.documentPath ?? "",
      seeded.contentHash ?? "",
      "id_card",
      member.userId,
    ]);
    await expect(
      card.getByRole("link", { name: member.userId.slice(0, 8) }),
    ).toBeVisible();

    const form = kycReviewForm(card);
    await fillKycReview(form, "APPROVED", "짧음");
    await confirmOperatorStepUp(form, secret);
    await form.getByRole("button", { name: "검토 결과 저장" }).click();
    await expect(form.getByRole("status")).toContainText(
      "결정 사유는 10자 이상 적어 주세요",
    );
    expect((await readKycCase(seeded.caseId)).status).not.toBe("APPROVED");
  });

  test("approves and rejects with step-up after missing-token retry", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const operator = await createConfirmedMember("lane-f-kyc-ops");
    await grantNamedAdminRole(operator.userId, "ADMIN");
    const secret = await completeAdminLoginWithTotp(
      page,
      operator.email,
      operator.password,
    );

    const approveMember = await createConfirmedMember("lane-f-kyc-ok");
    const rejectMember = await createConfirmedMember("lane-f-kyc-no");
    const approve = await seedOpenKycCase({
      userId: approveMember.userId,
      withDocument: true,
    });
    const reject = await seedOpenKycCase({
      userId: rejectMember.userId,
      withDocument: true,
    });

    await openKycQueue(page);

    const approveForm = kycReviewForm(kycCard(page, approve.caseId));
    await fillKycReview(
      approveForm,
      "APPROVED",
      "서류 요약과 회원 상태가 일치해 승인합니다.",
    );
    await approveForm.getByRole("button", { name: "검토 결과 저장" }).click();
    await expect(approveForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect((await readKycCase(approve.caseId)).status).not.toBe("APPROVED");

    await submitKycWithStepUp(approveForm, secret);
    const approved = await readKycCase(approve.caseId);
    expect(approved.status).toBe("APPROVED");
    expect(approved.decision_reason).toContain("승인합니다");
    expect(approved.reviewed_by).toBe(operator.userId);

    await openKycQueue(page);
    const rejectForm = kycReviewForm(kycCard(page, reject.caseId));
    await fillKycReview(
      rejectForm,
      "REJECTED",
      "제출 내용이 부족해 반려합니다. 재신청이 필요합니다.",
    );
    await submitKycWithStepUp(rejectForm, secret);
    const rejected = await readKycCase(reject.caseId);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decision_reason).toContain("반려합니다");
  });

  test("rejects a step-up token bound to the wrong command family", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const operator = await createConfirmedMember("lane-f-kyc-family");
    await grantNamedAdminRole(operator.userId, "ADMIN");
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    const member = await createConfirmedMember("lane-f-kyc-family-m");
    const seeded = await seedOpenKycCase({
      userId: member.userId,
      withDocument: true,
    });

    await openKycQueue(page);
    const form = kycReviewForm(kycCard(page, seeded.caseId));
    await fillKycReview(
      form,
      "APPROVED",
      "잘못된 작업 확인 토큰은 거절되어야 합니다.",
    );

    const wrongFamily = await issueCommandFamilyToken(page, "DEPOSIT_CONFIRM");
    expect(wrongFamily.token && wrongFamily.token.length >= 16).toBe(true);
    await setStepUpToken(form, wrongFamily.token!);
    await form.getByRole("button", { name: "검토 결과 저장" }).click();
    await expect(form.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect((await readKycCase(seeded.caseId)).status).not.toBe("APPROVED");
  });

  test("denies SUPPORT_ADMIN review while keeping page readable", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const member = await createConfirmedMember("lane-f-kyc-support-m");
    const seeded = await seedOpenKycCase({
      userId: member.userId,
      withDocument: true,
    });

    const support = await createConfirmedMember("lane-f-kyc-support");
    await grantNamedAdminRole(support.userId, "SUPPORT_ADMIN");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await completeAdminLoginWithTotp(page, support.email, support.password);
      await openKycQueue(page);
      const card = kycCard(page, seeded.caseId);
      await expect(card).toBeVisible();
      const form = kycReviewForm(card);
      await fillKycReview(
        form,
        "APPROVED",
        "지원 역할로는 승인할 수 없어야 합니다.",
      );
      // HIGH_IMPACT 역할 거절은 step-up보다 먼저 닫힌다.
      await form.getByRole("button", { name: "검토 결과 저장" }).click();
      await expect(form.getByRole("status")).toContainText(
        "현재 역할로는 이 작업을 할 수 없습니다",
      );
      expect((await readKycCase(seeded.caseId)).status).not.toBe("APPROVED");
    } finally {
      await context.close();
    }
  });

  test("covers keyboard focus, themes, and responsive widths without secret leak", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const operator = await createConfirmedMember("lane-f-kyc-a11y");
    await grantNamedAdminRole(operator.userId, "ADMIN");
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    const member = await createConfirmedMember("lane-f-kyc-a11y-m");
    const seeded = await seedOpenKycCase({
      userId: member.userId,
      withDocument: true,
    });

    await openKycQueue(page);
    const form = kycReviewForm(kycCard(page, seeded.caseId));

    await form.getByLabel("결과").focus();
    await expect(form.getByLabel("결과")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel("결정 사유")).toBeFocused();

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(
        page.getByRole("heading", { level: 1, name: "본인 확인 검토" }),
      ).toBeVisible();
      await assertKycPageMasksSecrets(page, [
        seeded.documentPath ?? "",
        seeded.contentHash ?? "",
      ]);
    }

    for (const width of [390, 834, 1440] as const) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth + 1;
      });
      expect(overflow).toBe(false);
      await expect(
        form.getByRole("button", { name: "검토 결과 저장" }),
      ).toBeVisible();
    }
  });
});
