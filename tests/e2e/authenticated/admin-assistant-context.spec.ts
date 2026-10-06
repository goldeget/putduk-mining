import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { grantNamedAdminRole } from "./helpers/admin-kyc-ui";
import { createLocalServiceRoleClient } from "./helpers/eligibility";

test("operational explanations use real records, masked member choice, source navigation and no money writes", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const phone = `+8210${String(BigInt(`0x${suffix}`) % 100000000n).padStart(8, "0")}`;
  const member = await createConfirmedMember("assistant-context-member", {
    legalName: `운영검증${suffix}`,
    phoneE164: phone,
  });
  const operator = await createConfirmedMember("assistant-context-operator");
  await grantAdminRole(operator.userId);
  const db = createLocalServiceRoleClient();
  const depositId = randomUUID();
  const fixture = await db.from("usdt_manual_deposits").insert({
    id: depositId,
    user_id: member.userId,
    network: "TRC20",
    tx_hash: randomUUID().replaceAll("-", "").repeat(2),
    sent_usdt_amount: "10.000001",
    deposit_address_snapshot: "TLOCALASSISTANTCONTEXT000001",
    network_snapshot: "TRC20",
    idempotency_key: `assistant-context-${depositId}`,
  });
  expect(fixture.error).toBeNull();
  const wallet = await db
    .from("wallet_accounts")
    .select("id")
    .eq("user_id", member.userId)
    .eq("currency", "KRW")
    .single();
  expect(wallet.error).toBeNull();
  const ledgerBefore = await db
    .from("wallet_ledger")
    .select("id", { count: "exact", head: true })
    .eq("wallet_account_id", wallet.data!.id);
  expect(ledgerBefore.error).toBeNull();
  await completeAdminLoginWithTotp(page, operator.email, operator.password);
  await page.goto(`${ADMIN_ORIGIN}/assistant`);
  const panel = page.getByRole("region", { name: "무엇부터 확인할까요?" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "기록 확인", exact: true }).click();
  const report = panel.getByRole("article", { name: "운영 기록 설명" });
  await expect(report).toBeVisible();
  for (const name of ["확인된 사실", "가능성", "권장 행동", "확인 불가"])
    await expect(
      report.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await expect(report).toContainText("조회 시각");
  await expect(report).toContainText("지원 문의 집계");
  const actualPending = await db
    .from("usdt_manual_deposits")
    .select("id", { count: "exact", head: true })
    .eq("status", "SUBMITTED");
  expect(actualPending.error).toBeNull();
  await expect(
    report.getByRole("region", { name: "확인된 사실", exact: true }),
  ).toContainText(
    `USDT 입금 대기 ${actualPending.count!.toLocaleString("ko-KR")}건`,
  );
  for (const topic of [
    "deposits",
    "withdrawals",
    "jobs",
    "security",
    "audit",
  ]) {
    await panel
      .getByRole("combobox", { name: "확인할 업무", exact: true })
      .selectOption(topic);
    await expect(report).toHaveCount(0);
    await panel.getByRole("button", { name: "기록 확인", exact: true }).click();
    await expect(report).toBeVisible();
  }
  await panel
    .getByRole("combobox", { name: "확인할 업무", exact: true })
    .selectOption("member");
  await panel
    .getByLabel("회원 이름·아이디·전화번호", { exact: true })
    .fill(phone);
  await panel.getByRole("button", { name: "회원 찾기", exact: true }).click();
  const choices = panel.getByRole("list", { name: "설명할 회원 선택" });
  await expect(choices.getByRole("button")).toHaveCount(1);
  expect(await choices.innerText()).not.toContain(phone);
  expect(await choices.innerText()).not.toContain(member.userId);
  await choices.getByRole("button").click();
  await panel.getByRole("button", { name: "기록 확인", exact: true }).click();
  await expect(report).toContainText("회원 기록 한눈에");
  for (const topic of ["wallet-ledger", "mining"]) {
    await panel
      .getByRole("combobox", { name: "확인할 업무", exact: true })
      .selectOption(topic);
    await panel.getByRole("button", { name: "기록 확인", exact: true }).click();
    await expect(report).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["system", "light", "dark"]) {
      await page.getByLabel("화면 테마").selectOption(theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
      await report.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`assistant-context-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await report
    .getByRole("link", { name: "회원 상세 열기 →", exact: true })
    .click();
  await expect(page.locator(".member-identity code")).toHaveText(
    member.userId,
    { timeout: 60_000 },
  );
  const audit = await db
    .from("audit_logs")
    .select("target_id,metadata,reason")
    .eq("actor_user_id", operator.userId)
    .eq("action", "ADMIN_ASSISTANT_CONTEXT_READ");
  expect(audit.error).toBeNull();
  expect(audit.data!.length).toBeGreaterThanOrEqual(9);
  expect(audit.data!.some((row) => row.target_id === member.userId)).toBe(true);
  expect(JSON.stringify(audit.data)).not.toContain(phone);
  const ledgerAfter = await db
    .from("wallet_ledger")
    .select("id", { count: "exact", head: true })
    .eq("wallet_account_id", wallet.data!.id);
  expect(ledgerAfter.error).toBeNull();
  expect(ledgerAfter.count).toBe(ledgerBefore.count);
  const untouched = await db
    .from("usdt_manual_deposits")
    .select("status,credited_krw")
    .eq("id", depositId)
    .single();
  expect(untouched.error).toBeNull();
  expect(untouched.data).toEqual({ status: "SUBMITTED", credited_krw: null });
});

test("context enforces origin and the existing restricted assistant role boundary", async ({
  page,
}) => {
  const support = await createConfirmedMember("assistant-context-support");
  await grantNamedAdminRole(support.userId, "SUPPORT_ADMIN");
  await completeAdminLoginWithTotp(page, support.email, support.password);
  await page.goto(`${ADMIN_ORIGIN}/assistant`);
  await expect(page.locator('[data-ui-ready="/assistant"]')).toHaveAttribute(
    "data-ui-state",
    "unauthorized",
  );
  await expect(
    page.getByRole("region", { name: "무엇부터 확인할까요?" }),
  ).toHaveCount(0);
  const denied = await page.evaluate(async () => {
    const response = await fetch("/api/v1/admin/assistant/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "dashboard" }),
    });
    return { status: response.status, payload: await response.json() };
  });
  expect(denied.status).toBe(403);
  expect(denied.payload.error.code).toBe("ROLE_FORBIDDEN");
  expect(denied.payload.data).toBeUndefined();
  const wrongOrigin = await page.request.post(
    `${ADMIN_ORIGIN}/api/v1/admin/assistant/context`,
    {
      data: { topic: "dashboard" },
      headers: { Origin: "https://outside.invalid" },
    },
  );
  expect(wrongOrigin.status()).toBe(403);
  expect((await wrongOrigin.json()).error.code).toBe("ORIGIN_DENIED");
});
