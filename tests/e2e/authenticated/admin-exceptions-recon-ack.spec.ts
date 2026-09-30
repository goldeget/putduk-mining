import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  openAdminQueue,
} from "./helpers/admin-money-ui";

async function grantAdminRoleVerified(userId: string) {
  await grantAdminRole(userId);
  const db = createLocalServiceRoleClient();
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((row) => String(row.role));
  if (!roles.includes("ADMIN") && !roles.includes("SUPER_ADMIN")) {
    throw new Error(`ADMIN_ROLE_MISSING:${roles.join(",") || "none"}`);
  }
}

async function seedOpenMismatch() {
  const db = createLocalServiceRoleClient();
  const { data: run, error: runError } = await db
    .from("reconciliation_runs")
    .insert({
      request_id: randomUUID(),
      scope: "ADMIN_EXCEPTIONS_RECON_ACK",
      status: "SUCCEEDED",
      checked_count: 1,
      mismatch_count: 1,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError || !run) {
    throw new Error(runError?.message ?? "RECON_RUN_SEED_FAILED");
  }
  const { data: mismatch, error: mismatchError } = await db
    .from("reconciliation_mismatches")
    .insert({
      run_id: run.id,
      mismatch_type: "RECON_ACK_E2E",
      subject_type: "admin_exceptions_recon_ack",
      subject_id: randomUUID(),
      expected_value: { amount_atomic: "5000" },
      actual_value: { amount_atomic: "0" },
      status: "OPEN",
    })
    .select("id, expected_value, actual_value")
    .single();
  if (mismatchError || !mismatch) {
    throw new Error(mismatchError?.message ?? "MISMATCH_SEED_FAILED");
  }
  return mismatch;
}

async function readMismatch(id: string) {
  const db = createLocalServiceRoleClient();
  const { data, error } = await db
    .from("reconciliation_mismatches")
    .select(
      "id, status, resolution_reason, expected_value, actual_value, resolved_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function countRows(table: string) {
  const db = createLocalServiceRoleClient();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function moneySnapshot() {
  return {
    ledgerTransactions: await countRows("ledger_transactions"),
    ledgerEntries: await countRows("ledger_entries"),
    walletLedger: await countRows("wallet_ledger"),
    walletAccounts: await countRows("wallet_accounts"),
  };
}

async function readSuccessAudits(targetId: string) {
  const db = createLocalServiceRoleClient();
  const { data, error } = await db
    .from("audit_logs")
    .select("action, reason, metadata, target_id, request_id, actor_user_id")
    .eq("target_id", targetId)
    .eq("action", "RECONCILIATION_EXCEPTION_ACK")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function readConsumedAckRequestIds(userId: string) {
  const db = createLocalServiceRoleClient();
  const { data, error } = await db
    .from("admin_step_up_grants")
    .select("consume_request_id")
    .eq("user_id", userId)
    .eq("command_family", "RECONCILIATION_ACK")
    .not("consume_request_id", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.consume_request_id));
}

function mismatchCard(page: Page, mismatchId: string) {
  return page.locator("article.queue-card", {
    has: page.locator(`input[name="mismatchId"][value="${mismatchId}"]`),
  });
}

test.describe("대사 예외 확인 트랜잭션", () => {
  test("정상 확인은 상태를 바꾸고 같은 요청의 성공 감사 한 건만 남긴다", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const admin = await createConfirmedMember("recon-ack-ok");
    await grantAdminRoleVerified(admin.userId);
    const moneyBefore = await moneySnapshot();
    const secret = await completeAdminLoginWithTotp(
      page,
      admin.email,
      admin.password,
    );
    const seeded = await seedOpenMismatch();

    await page.goto(`${ADMIN_ORIGIN}/exceptions`);
    const form = mismatchCard(page, seeded.id).getByRole("form", {
      name: "대사 예외 확인",
    });
    await form.getByLabel("확인 결과").selectOption("ACCEPTED");
    await form
      .getByLabel("확인 사유")
      .fill("차이를 인정합니다. 원장 수리는 하지 않습니다.");
    await form.getByRole("checkbox").check();
    await confirmOperatorStepUp(form, secret);
    await form.getByRole("button", { name: "예외 확인 저장" }).click();
    await expect(form.getByRole("status")).toContainText(
      "자동으로 숫자를 고치지 않았습니다",
      { timeout: 60_000 },
    );

    const saved = await readMismatch(seeded.id);
    expect(saved?.status).toBe("ACCEPTED");
    expect(saved?.expected_value).toEqual(seeded.expected_value);
    expect(saved?.actual_value).toEqual(seeded.actual_value);
    expect(saved?.resolution_reason).toContain("원장 수리");

    const audits = await readSuccessAudits(seeded.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_user_id).toBe(admin.userId);
    expect(audits[0]?.request_id).toBeTruthy();
    expect(await readConsumedAckRequestIds(admin.userId)).toContain(
      audits[0]?.request_id,
    );
    expect(JSON.stringify(audits[0]?.metadata ?? {})).toContain(
      '"auto_repair":false',
    );
    expect(await moneySnapshot()).toEqual(moneyBefore);
  });

  test("이미 닫힌 예외는 실패하고 종료 사유를 덮어쓰지 않는다", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const admin = await createConfirmedMember("recon-ack-stale");
    await grantAdminRoleVerified(admin.userId);
    const moneyBefore = await moneySnapshot();
    const secret = await completeAdminLoginWithTotp(
      page,
      admin.email,
      admin.password,
    );
    const seeded = await seedOpenMismatch();

    await openAdminQueue(page, "/exceptions");
    const form = mismatchCard(page, seeded.id).getByRole("form", {
      name: "대사 예외 확인",
    });
    await form.getByLabel("확인 결과").selectOption("RESOLVED");
    await form
      .getByLabel("확인 사유")
      .fill("나중에 도착한 확인은 기존 처분을 유지해야 합니다.");
    await form.getByRole("checkbox").check();
    await confirmOperatorStepUp(form, secret);

    const db = createLocalServiceRoleClient();
    const { error } = await db
      .from("reconciliation_mismatches")
      .update({
        status: "RESOLVED",
        resolution_reason: "다른 세션에서 먼저 닫힘",
        resolved_at: new Date().toISOString(),
        resolved_by: admin.userId,
      })
      .eq("id", seeded.id)
      .eq("status", "OPEN");
    if (error) throw new Error(error.message);

    await form.getByRole("button", { name: "예외 확인 저장" }).click();
    await expect(form.getByRole("status")).toContainText(
      /이미 처리됐거나|목록에서 사라진/,
      { timeout: 60_000 },
    );

    const saved = await readMismatch(seeded.id);
    expect(saved?.status).toBe("RESOLVED");
    expect(saved?.resolution_reason).toBe("다른 세션에서 먼저 닫힘");
    expect(saved?.expected_value).toEqual(seeded.expected_value);
    expect(saved?.actual_value).toEqual(seeded.actual_value);
    expect(await readSuccessAudits(seeded.id)).toEqual([]);
    expect(await moneySnapshot()).toEqual(moneyBefore);
  });
});
