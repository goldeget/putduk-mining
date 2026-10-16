import { readFileSync, unlinkSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../../e2e/fixtures/local-auth";
import {
  digestKyc,
  KYC_TEST_PDF,
  prepareRealKycEvidence,
} from "../../e2e/fixtures/kyc-evidence";
import { ensureOperatorActor } from "../../e2e/authenticated/helpers/eligibility";
import { requireKycHttpServices } from "../../e2e/authenticated/helpers/kyc-runtime-binding";
import { completeAdminLoginWithTotp } from "../../e2e/authenticated/helpers/admin-totp";
import { confirmOperatorStepUp } from "../../e2e/authenticated/helpers/admin-money-ui";
import {
  grantNamedAdminRole,
  kycCard,
  kycReviewForm,
  openKycQueue,
} from "../../e2e/authenticated/helpers/admin-kyc-ui";

test.beforeAll(async () => {
  await requireKycHttpServices();
  await ensureOperatorActor();
});
test.beforeEach(async () => {
  await requireKycHttpServices();
});

test("actual protected blob loss never becomes a view; explicit ACK retries once and links only acknowledged evidence to review", async ({
  page,
}) => {
  const member = await createConfirmedMember("kyc-runtime-evidence");
  const operator = await createConfirmedMember("kyc-runtime-reviewer");
  const prepared = await prepareRealKycEvidence(member);
  expect(prepared.submissionId).not.toBeNull();
  const submissionId = prepared.submissionId!;
  const db = createLocalServiceRoleClient();
  await grantNamedAdminRole(operator.userId, "ADMIN");
  const secret = await completeAdminLoginWithTotp(
    page,
    operator.email,
    operator.password,
  );
  await openKycQueue(page);
  const card = kycCard(page, prepared.caseId);
  const delivery = card.getByRole("form", {
    name: "제출 서류 원문 확인",
    exact: true,
  });
  const acknowledgment = card.getByRole("form", {
    name: "서류 내용 확인 기록",
    exact: true,
  });
  async function viewRows() {
    const result = await db
      .from("kyc_document_view_audit")
      .select("request_id,viewer_user_id")
      .eq("submission_id", submissionId);
    expect(result.error).toBeNull();
    return result.data!;
  }
  expect(await viewRows()).toHaveLength(0);
  const evidencePath = `**/api/kyc/evidence/${submissionId}`;
  await page.route(evidencePath, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(digestKyc(await response.body())).toBe(digestKyc(KYC_TEST_PDF));
    expect(response.headers()["kyc-delivery-receipt"]).toMatch(
      /^[a-f0-9-]{36}$/,
    );
    // Full upstream bytes verified, browser response intentionally lost.
    await route.abort("failed");
  });
  await delivery
    .getByLabel("열람 사유", { exact: true })
    .fill("합성 본인 확인 서류의 내용을 확인하기 위한 검증입니다.");
  await delivery.getByRole("checkbox").check();
  await confirmOperatorStepUp(delivery, secret);
  await delivery
    .getByRole("button", { name: "서류 받기", exact: true })
    .click();
  await expect(
    card.getByText(
      "서류 파일을 확인하지 못했습니다. 작업 확인 후 다시 시도해 주세요.",
    ),
  ).toBeVisible();
  expect(await viewRows()).toHaveLength(0);
  await expect(acknowledgment).toHaveCount(0);
  await page.unroute(evidencePath);

  await confirmOperatorStepUp(delivery, secret);
  const responseReady = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/kyc/evidence/${submissionId}` &&
      response.request().method() === "POST",
  );
  const downloadReady = page.waitForEvent("download");
  await delivery
    .getByRole("button", { name: "서류 받기", exact: true })
    .click();
  const response = await responseReady;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const receiptId = response.headers()["kyc-delivery-receipt"]!;
  const download = await downloadReady;
  const path = await download.path();
  expect(path).not.toBeNull();
  try {
    expect(digestKyc(readFileSync(path!))).toBe(digestKyc(KYC_TEST_PDF));
  } finally {
    if (path) unlinkSync(path);
  }
  await expect(
    card.getByText("서류 파일을 받았어요. 파일을 열어 내용을 확인해 주세요."),
  ).toBeVisible();
  expect(await viewRows()).toHaveLength(0);
  await expect(acknowledgment).toBeVisible();
  // Automation records a simulated explicit human assertion; it cannot prove eyesight.
  await acknowledgment.getByRole("checkbox").check();
  await confirmOperatorStepUp(acknowledgment, secret);
  const ackPath = `**/api/kyc/evidence/${submissionId}/acknowledge`;
  let acknowledgedReceipt = "";
  await page.route(ackPath, async (route) => {
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    const data = (await actual.json()).data;
    expect(data.state).toBe("ACKNOWLEDGED");
    acknowledgedReceipt = data.receiptId;
    await route.abort("failed");
  });
  await acknowledgment
    .getByRole("button", { name: "내용 확인 기록", exact: true })
    .click();
  await expect(
    card.getByText(
      "내용 확인 기록의 저장 결과를 확인하지 못했어요. 같은 기록으로 작업 확인 후 다시 시도해 주세요.",
    ),
  ).toBeVisible();
  expect(acknowledgedReceipt).toBe(receiptId);
  expect(await viewRows()).toHaveLength(1);
  await page.unroute(ackPath);
  await confirmOperatorStepUp(acknowledgment, secret);
  await acknowledgment
    .getByRole("button", { name: "내용 확인 기록", exact: true })
    .click();
  await expect(
    card.getByText(
      "파일 내용을 직접 확인했다는 기록을 저장했어요. 심사 결정은 별도로 진행해 주세요.",
    ),
  ).toBeVisible();
  const views = await viewRows();
  expect(views).toHaveLength(1);
  expect(views[0]!.viewer_user_id).toBe(operator.userId);
  const deliveryReceipt = await db
    .from("kyc_evidence_delivery_receipts")
    .select("ack_request_id,acknowledged_at,created_at,submission_id")
    .eq("id", receiptId)
    .single();
  expect(deliveryReceipt.error).toBeNull();
  expect(deliveryReceipt.data?.submission_id).toBe(submissionId);
  expect(deliveryReceipt.data?.ack_request_id).toBe(views[0]!.request_id);
  expect(
    Date.parse(deliveryReceipt.data!.acknowledged_at),
  ).toBeGreaterThanOrEqual(Date.parse(deliveryReceipt.data!.created_at));

  const review = kycReviewForm(card);
  // The reviewed ACK ID is supplied by case-scoped React context at submission,
  // not a DOM metadata/hidden field. Durable linkage below proves the caller.
  await review
    .getByRole("combobox", { name: /^결과/ })
    .selectOption("APPROVED");
  await review
    .getByLabel("결정 사유")
    .fill("합성 서류 확인 기록과 현재 신청이 일치하여 승인합니다.");
  await review.getByRole("checkbox").check();
  await confirmOperatorStepUp(review, secret);
  await review
    .getByRole("button", { name: "검토 결과 저장", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "본인 확인 검토 결과" }),
  ).toContainText("본인 확인 검토 결과를 저장했습니다", { timeout: 30_000 });
  expect(await viewRows()).toHaveLength(1);
  const linked = await db
    .from("audit_logs")
    .select("action,metadata,created_at")
    .eq("action", "KYC_REVIEW_EVIDENCE_LINKED")
    .eq("target_id", prepared.caseId)
    .eq("actor_user_id", operator.userId);
  expect(linked.error).toBeNull();
  expect(linked.data).toHaveLength(1);
  expect(linked.data![0]!.metadata).toMatchObject({
    delivery_receipt_id: receiptId,
    submission_id: submissionId,
    content_ack_request_id: views[0]!.request_id,
  });
  expect(Date.parse(linked.data![0]!.created_at)).toBeGreaterThanOrEqual(
    Date.parse(deliveryReceipt.data!.acknowledged_at),
  );
  const attempts = await db
    .from("audit_logs")
    .select("action,created_at,request_id")
    .eq("target_id", submissionId)
    .eq("actor_user_id", operator.userId);
  expect(attempts.error).toBeNull();
  expect(
    attempts.data!.filter(
      (row) => row.action === "KYC_EVIDENCE_ACCESS_ATTEMPT",
    ),
  ).toHaveLength(2);
  expect(
    attempts.data!.filter(
      (row) => row.action === "KYC_EVIDENCE_BYTES_PREPARED",
    ),
  ).toHaveLength(2);
});
