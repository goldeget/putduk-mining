import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { createLocalServiceRoleClient } from "./helpers/eligibility";

test.describe("admin Member 360 product states", () => {
  test("authorized empty, invalid lookup, and owned member evidence", async ({
    page,
  }, testInfo) => {
    const operator = await createConfirmedMember("admin-members-op");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(`${ADMIN_ORIGIN}/members`);
    await expect(
      page.getByRole("heading", { name: "회원 한 사람의 맥락" }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("조회할 회원을 선택하세요.")).toBeVisible();
    await expect(page.getByLabel("회원 식별자")).toBeVisible();

    await page.getByLabel("회원 식별자").fill("not-a-uuid");
    await page.getByRole("button", { name: "안전 조회" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "올바른 회원 식별자를 입력해 주세요.",
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("회원 식별자")).toHaveValue("not-a-uuid");

    const member = await createConfirmedMember("admin-members-target");
    await page.goto(`${ADMIN_ORIGIN}/members?id=${member.userId}`);
    const selectedIdentity = page.locator(".member-identity code");
    await expect(selectedIdentity).toHaveText(member.userId, {
      timeout: 60_000,
    });
    await expect(selectedIdentity).toBeVisible();
    await expect(page.getByText("채굴 · 정산")).toBeVisible();
    // 채굴 건수는 실패를 0으로 위장하지 않는다. SELECT 권한이 있으면 숫자다.
    const miningCard = page.locator(".member-module-grid article").filter({
      hasText: "채굴 · 정산",
    });
    await expect(miningCard.locator("strong")).toHaveText(
      /^(확인 필요|\d[\d,]*)$/,
    );
    await expect(
      page.getByRole("heading", { name: "계정 상태" }),
    ).toBeVisible();
    await expect(page.getByText("입금 기록 없음")).toBeVisible();
    await expect(page.getByText("출금 기록 없음")).toBeVisible();

    const sources = page.locator("#evidence-money-sources");
    const sourceValue = (label: string) =>
      sources
        .locator("dl > div")
        .filter({
          has: page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }),
        })
        .locator("dd");
    await expect(sourceValue("채굴 인정 원금")).toHaveText("0원");
    await expect(sourceValue("미확정 채굴 수익")).toHaveText("확인 필요");
    await expect(sourceValue("누적 채굴 수익")).toHaveText("확인 필요");
    await expect(sourceValue("확정 채굴 수익")).toHaveText("0원");
    const db = createLocalServiceRoleClient();
    const created = await db.rpc("create_deposit_request", {
      p_user_id: member.userId,
      p_currency: "KRW",
      p_amount_atomic: "3000",
      p_idempotency_key: `member-source-request-${randomUUID()}`,
    });
    expect(created.error).toBeNull();
    const approved = await db.rpc("approve_deposit_request", {
      p_deposit_request_id: created.data,
      p_operator_id: operator.userId,
      p_received_amount_atomic: "3000",
      p_ledger_idempotency_key: `member-source-credit-${randomUUID()}`,
      p_reason: "new source capture fixture bank transfer confirmed",
      p_request_id: randomUUID(),
    });
    expect(approved.error).toBeNull();
    const usdtId = randomUUID();
    const submitted = await db.from("usdt_manual_deposits").insert({
      id: usdtId,
      user_id: member.userId,
      network: "TRC20",
      tx_hash: randomUUID().replaceAll("-", "").repeat(2),
      sent_usdt_amount: "10.000001",
      deposit_address_snapshot: "TLOCALMONEYSOURCEFIXTURE000001",
      network_snapshot: "TRC20",
      idempotency_key: `member-source-usdt-${usdtId}`,
    });
    expect(submitted.error).toBeNull();
    const confirmed = await db.rpc("confirm_usdt_manual_deposit", {
      p_deposit_id: usdtId,
      p_credited_krw: "7000",
      p_actor: operator.userId,
      p_reason: "new source capture fixture manual USDT confirmed",
      p_idempotency_key: `member-source-usdt-credit-${usdtId}`,
    });
    expect(confirmed.error).toBeNull();
    await page.reload();
    await expect(sourceValue("채굴 인정 원금")).toHaveText("10,000원");
    await expect(sourceValue("누적 원화 원금 입금")).toHaveText("3,000원");
    await expect(sourceValue("누적 USDT 환산 원금")).toHaveText("7,000원");
    const capture = await db
      .from("money_source_movements")
      .select("id,source_bucket")
      .eq("user_id", member.userId);
    expect(capture.error).toBeNull();
    expect(capture.data).toHaveLength(2);
    expect(
      capture.data!.every((row) => row.source_bucket === "PRINCIPAL"),
    ).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    async function saveSources(state: string) {
      for (const width of [320, 390, 834, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["system", "light", "dark"]) {
          await page.getByLabel("화면 테마").selectOption(theme);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
            )
            .toBe(true);
          await sources.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath(
              `money-sources-${state}-${width}-${theme}.png`,
            ),
            fullPage: true,
          });
          await sources.screenshot({
            path: testInfo.outputPath(
              `money-source-panel-${state}-${width}-${theme}.png`,
            ),
          });
        }
      }
    }
    await saveSources("confirmed");
    const wallet = await db
      .from("wallet_accounts")
      .select("id")
      .eq("user_id", member.userId)
      .eq("currency", "KRW")
      .single();
    expect(wallet.error).toBeNull();
    const ambiguous = await db.from("wallet_ledger").insert({
      wallet_account_id: wallet.data!.id,
      user_id: member.userId,
      direction: "CREDIT",
      entry_type: "ADMIN_ADJUSTMENT",
      amount_atomic: "5000",
      idempotency_key: `unknown-source-${randomUUID()}`,
      reference_type: "local_ambiguous_history_fixture",
      reference_id: randomUUID(),
      reason: "unknown historical source fixture",
    });
    expect(ambiguous.error).toBeNull();
    await page.reload();
    await expect(sourceValue("채굴 인정 원금")).toHaveText("확인 필요");
    await expect(sourceValue("누적 원화 원금 입금")).toHaveText("확인 필요");
    await expect(sources.getByRole("status")).toContainText("자금 출처를 확인");
    await expect(
      sources.getByText("기록 시작 이후 확인된 입금", { exact: true }),
    ).toBeVisible();
    await saveSources("unresolved");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("증거 구역")).toBeVisible();
    await expect(page.getByRole("link", { name: "계정" })).toBeVisible();
  });

  test("unknown member uuid stays non-enumerating", async ({ page }) => {
    const operator = await createConfirmedMember("admin-members-miss");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(
      `${ADMIN_ORIGIN}/members?id=00000000-0000-4000-8000-000000000099`,
    );
    await expect(
      page.getByRole("heading", { name: "회원을 찾지 못했습니다." }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "다시 조회" })).toBeVisible();
  });
});
