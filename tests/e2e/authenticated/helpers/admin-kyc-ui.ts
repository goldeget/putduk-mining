import { createHash, randomUUID } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

import { createLocalServiceRoleClient } from "../../fixtures/local-auth";
import { openAdminQueue } from "./admin-money-ui";
import { ADMIN_ORIGIN } from "./admin-totp";

export function kycCard(page: Page, caseId: string) {
  return page.locator("article.queue-card", {
    has: page.locator(`input[name="caseId"][value="${caseId}"]`),
  });
}

export function kycReviewForm(card: Locator) {
  return card.getByRole("form", { name: "본인 확인 검토" });
}

export async function openKycQueue(page: Page) {
  await openAdminQueue(page, "/kyc");
  await expect(
    page.getByRole("heading", { level: 1, name: "본인 확인 검토" }),
  ).toBeVisible();
}

/** 빈 대기열 검증용. 열린 건만 반려 처리한다. 원장·잔액은 건드리지 않는다. */
export async function closeOpenKycQueueForEmptyProof() {
  const client = createLocalServiceRoleClient();
  const { error } = await client
    .from("kyc_cases")
    .update({
      status: "REJECTED",
      decision_reason: "lane-f empty-queue fixture close",
      decided_at: new Date().toISOString(),
    })
    .in("status", ["PENDING", "IN_REVIEW", "ON_HOLD", "REQUIRES_RESUBMISSION"]);
  if (error) throw new Error(error.message);
}

/** 서비스 롤로 대기 KYC 건과 서류 메타만 준비. 원문 바이트는 넣지 않는다. */
export async function seedOpenKycCase(input: {
  userId: string;
  riskLevel?: "UNASSESSED" | "LOW" | "MEDIUM" | "HIGH";
  withDocument?: boolean;
}): Promise<{
  caseId: string;
  documentPath: string | null;
  contentHash: string | null;
}> {
  const client = createLocalServiceRoleClient();
  const { data: caseId, error: openError } = await client.rpc("open_kyc_case", {
    p_user_id: input.userId,
    p_request_id: randomUUID(),
  });
  if (openError || !caseId) {
    throw new Error(openError?.message ?? "KYC_OPEN_FAILED");
  }

  if (input.riskLevel && input.riskLevel !== "UNASSESSED") {
    const { error: riskError } = await client
      .from("kyc_cases")
      .update({ risk_level: input.riskLevel })
      .eq("id", caseId);
    if (riskError) throw new Error(riskError.message);
  }

  let documentPath: string | null = null;
  let contentHash: string | null = null;
  if (input.withDocument !== false) {
    documentPath = `kyc/${input.userId}/${caseId}/id_card.bin`;
    contentHash = createHash("sha256")
      .update(`synthetic-kyc-${caseId}`)
      .digest("hex");
    const { error: submitError } = await client.rpc("submit_kyc_documents", {
      p_case_id: caseId,
      p_user_id: input.userId,
      p_document_kind: "id_card",
      p_protected_storage_path: documentPath,
      p_content_sha256: contentHash,
      p_request_id: randomUUID(),
    });
    if (submitError) throw new Error(submitError.message);
  }

  return { caseId: String(caseId), documentPath, contentHash };
}

export async function readKycCase(caseId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("kyc_cases")
    .select("id, status, decision_reason, risk_level, reviewed_by")
    .eq("id", caseId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "KYC_CASE_MISSING");
  }
  return data;
}

export async function grantNamedAdminRole(
  userId: string,
  role: "ADMIN" | "SUPER_ADMIN" | "SUPPORT_ADMIN" | "VIEWER" | "CONTENT_ADMIN",
) {
  const client = createLocalServiceRoleClient();
  const { error } = await client.from("user_roles").insert({
    user_id: userId,
    role,
    granted_by: userId,
  });
  if (error) throw new Error(error.message);
}

export async function assertKycPageMasksSecrets(
  page: Page,
  forbidden: string[],
) {
  const body = await page.locator("main").innerText();
  for (const secret of forbidden) {
    if (!secret) continue;
    expect(body).not.toContain(secret);
  }
  await expect(page.locator("img[src*='kyc']")).toHaveCount(0);
  await expect(page.locator("a[href*='storage']")).toHaveCount(0);
}

export { ADMIN_ORIGIN };
