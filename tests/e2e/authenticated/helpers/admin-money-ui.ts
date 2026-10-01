import { createHash } from "node:crypto";

import { expect, type Locator, type Page } from "@playwright/test";

import { createLocalServiceRoleClient } from "../../fixtures/local-auth";
import { ADMIN_ORIGIN, nextTotpCode } from "./admin-totp";

export function withdrawalCard(page: Page, withdrawalId: string) {
  return page.locator("article.queue-card", {
    has: page.locator(`input[name="withdrawalId"][value="${withdrawalId}"]`),
  });
}

export function formWithSubmit(card: Locator, buttonName: string) {
  return card.locator("form").filter({ hasText: buttonName });
}

export async function openAdminQueue(page: Page, path: string) {
  await page.goto(`${ADMIN_ORIGIN}${path}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 60_000,
  });
}

export async function confirmOperatorStepUp(form: Locator, secret: string) {
  const code = await nextTotpCode(secret);
  await form
    .locator("label")
    .filter({ hasText: "인증 앱 코드 (작업 확인)" })
    .locator("input")
    .fill(code);
  await form.getByRole("button", { name: "작업 확인" }).click();
  await expect(
    form.getByText(
      "이번 작업을 한 번 실행할 수 있습니다. 다음 작업에는 다시 확인해 주세요.",
    ),
  ).toBeVisible({
    timeout: 30_000,
  });
}

export async function setStepUpToken(form: Locator, token: string) {
  await form.locator('input[name="stepUpToken"]').evaluate((element, value) => {
    (element as HTMLInputElement).value = value;
  }, token);
}

export async function issueCommandFamilyToken(
  page: Page,
  commandFamily: string,
) {
  return page.evaluate(async (family) => {
    const response = await fetch("/api/v1/admin/session/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandFamily: family }),
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
  }, commandFamily);
}

export async function expireOpenStepUpGrants(userId: string) {
  const client = createLocalServiceRoleClient();
  const issuedAt = new Date(Date.now() - 120_000).toISOString();
  const expiresAt = new Date(Date.now() - 60_000).toISOString();
  const { error } = await client
    .from("admin_step_up_grants")
    .update({ issued_at: issuedAt, expires_at: expiresAt })
    .eq("user_id", userId)
    .is("consumed_at", null);
  if (error) {
    throw new Error(error.message);
  }
}

export async function readExternalSends(withdrawalId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("withdrawal_external_sends")
    .select(
      "id, bank_reference, network, tx_hash, actual_krw_amount, actual_usdt_amount, conversion_evidence",
    )
    .eq("withdrawal_id", withdrawalId);
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function readWithdrawalLedger(withdrawalId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("withdrawal_requests")
    .select("status, finalize_ledger_transaction_id")
    .eq("id", withdrawalId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "WITHDRAWAL_MISSING");
  }
  const { count, error: ledgerError } = await client
    .from("ledger_transactions")
    .select("id", { count: "exact", head: true })
    .eq("reference_type", "withdrawal_request")
    .eq("reference_id", withdrawalId)
    .eq("category", "WITHDRAWAL");
  if (ledgerError) {
    throw new Error(ledgerError.message);
  }
  return {
    status: String(data.status),
    finalizeId:
      typeof data.finalize_ledger_transaction_id === "string"
        ? data.finalize_ledger_transaction_id
        : null,
    withdrawalLedgerCount: count ?? 0,
  };
}

export async function readStepUpGrantState(token: string) {
  const client = createLocalServiceRoleClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await client
    .from("admin_step_up_grants")
    .select("consumed_at, command_family")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("STEP_UP_GRANT_MISSING");
  }
  return {
    consumed: data.consumed_at != null,
    commandFamily: String(data.command_family),
  };
}

export async function readConsumedStepUpFamilies(userId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("admin_step_up_grants")
    .select("command_family, consumed_at")
    .eq("user_id", userId)
    .not("consumed_at", "is", null);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => String(row.command_family));
}
