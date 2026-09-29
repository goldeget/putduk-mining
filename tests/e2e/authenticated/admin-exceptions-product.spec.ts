import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

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

const OUTPUT_DIR = path.join("test-results", "admin-exceptions-product");
const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

function trackHydration(page: Page) {
  const hydration: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("react.dev/link/hydration-mismatch") ||
      text.includes("hydration-mismatch") ||
      text.includes("Hydration failed because") ||
      text.includes("A tree hydrated but some attributes") ||
      /Text content did not match/i.test(text)
    ) {
      hydration.push(text.slice(0, 500));
    }
  });
  return hydration;
}

async function waitForHydratedControls(page: Page) {
  await page.waitForFunction(
    () => {
      const hydrated = (node: Element) =>
        Object.getOwnPropertyNames(node).some(
          (key) =>
            key.startsWith("__reactFiber") ||
            key.startsWith("__reactProps") ||
            key.startsWith("__reactContainer"),
        );
      const main = document.querySelector("main") ?? document.body;
      if (hydrated(main)) return true;
      return Array.from(main.querySelectorAll("*")).some(hydrated);
    },
    undefined,
    { timeout: 60_000 },
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shoot(page: Page, fileName: string) {
  await waitForHydratedControls(page);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    fullPage: true,
    path: path.join(OUTPUT_DIR, fileName),
  });
}

async function applyTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate((selected) => {
    localStorage.setItem("putduk-theme", selected);
    document.documentElement.dataset.theme = selected;
    document.documentElement.style.colorScheme = selected;
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function clearProbeMismatches(resolvedBy: string) {
  const db = createLocalServiceRoleClient();
  const { error } = await db
    .from("reconciliation_mismatches")
    .update({
      status: "ACCEPTED",
      resolution_reason: "E2E 프로브 정리 · 자동 수리 없음",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq("subject_type", "admin_exceptions_probe")
    .in("status", ["OPEN", "INVESTIGATING"]);
  if (error) throw new Error(error.message);
}

async function seedOpenMismatch(probe: {
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  mismatchType?: string;
}) {
  const db = createLocalServiceRoleClient();
  const requestId = randomUUID();
  const { data: run, error: runError } = await db
    .from("reconciliation_runs")
    .insert({
      request_id: requestId,
      scope: "ADMIN_EXCEPTIONS_E2E",
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
  const subjectId = randomUUID();
  const { data: mismatch, error: mismatchError } = await db
    .from("reconciliation_mismatches")
    .insert({
      run_id: run.id,
      mismatch_type: probe.mismatchType ?? "WORKER_RUNTIME_PROBE_MISMATCH",
      subject_type: "admin_exceptions_probe",
      subject_id: subjectId,
      expected_value: probe.expected,
      actual_value: probe.actual,
      status: "OPEN",
    })
    .select("id, subject_id, expected_value, actual_value, status")
    .single();
  if (mismatchError || !mismatch) {
    throw new Error(mismatchError?.message ?? "MISMATCH_SEED_FAILED");
  }
  return { runId: run.id as string, mismatch };
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

async function countLedgerTransactions() {
  const db = createLocalServiceRoleClient();
  const { count, error } = await db
    .from("ledger_transactions")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function readLatestExceptionAckAudit(targetId: string) {
  const db = createLocalServiceRoleClient();
  const { data, error } = await db
    .from("audit_logs")
    .select("action, reason, metadata, target_id")
    .eq("target_id", targetId)
    .eq("action", "RECONCILIATION_EXCEPTION_ACK")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function mismatchCard(page: Page, mismatchId: string) {
  return page.locator("article.queue-card", {
    has: page.locator(`input[name="mismatchId"][value="${mismatchId}"]`),
  });
}

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

test.describe("admin exceptions product queue", () => {
  test("unsigned visitors keep the exceptions return path", async ({
    page,
  }) => {
    const hydration = trackHydration(page);
    await page.goto(`${ADMIN_ORIGIN}/exceptions`);
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page).toHaveURL(/exceptions/);
    await expect(
      page.getByRole("heading", { name: "정산·대사 예외", level: 1 }),
    ).toHaveCount(0);
    expect(hydration).toEqual([]);
  });

  test("rejects members without an admin role", async ({ page }) => {
    test.setTimeout(120_000);
    const member = await createConfirmedMember("exc-member");
    await page.goto(`${ADMIN_ORIGIN}/login`);
    await page.locator('input[name="email"]').fill(member.email);
    await page.locator('input[name="password"]').fill(member.password);
    await page.getByRole("button", { name: "보안 로그인" }).click();
    await expect(
      page.getByText("입력한 정보로 운영자 로그인을 완료할 수 없습니다."),
    ).toBeVisible({ timeout: 90_000 });
    await page.goto(`${ADMIN_ORIGIN}/exceptions`);
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "정산·대사 예외", level: 1 }),
    ).toHaveCount(0);
  });

  test("shows empty queue, seeded mismatch evidence, reason gate, and non-repairing ack", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const hydration = trackHydration(page);
    const ledgerBefore = await countLedgerTransactions();

    const admin = await createConfirmedMember("exc-admin");
    await grantAdminRoleVerified(admin.userId);
    await clearProbeMismatches(admin.userId);
    const secret = await completeAdminLoginWithTotp(
      page,
      admin.email,
      admin.password,
    );

    await openAdminQueue(page, "/exceptions");
    await expect(
      page.getByRole("heading", { name: "정산·대사 예외", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "대사 예외 없음" }),
    ).toBeVisible();
    await expect(
      page.getByText("열린 대사 차이가 없습니다", { exact: false }),
    ).toBeVisible();
    await shoot(page, "empty-light.png");

    const seeded = await seedOpenMismatch({
      expected: { ok: true, amount_atomic: "5000" },
      actual: { ok: false, amount_atomic: "0" },
    });

    await openAdminQueue(page, "/exceptions");
    const card = mismatchCard(page, seeded.mismatch.id);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText("기대 값")).toBeVisible();
    await expect(card.getByText("실제 값")).toBeVisible();
    await expect(card.getByText(/5000/)).toBeVisible();
    await expect(card.getByText(/false/)).toBeVisible();
    await expect(card.getByText("열림")).toBeVisible();
    await expect(
      card.getByText("자동으로 원장이나 잔액을 고치지 않습니다."),
    ).toBeVisible();

    const form = card.getByRole("form", { name: "대사 예외 확인" });
    const reason = form.getByLabel("확인 사유");
    await form.getByRole("button", { name: "예외 확인 저장" }).click();
    const reasonMessage = await reason.evaluate(
      (el: HTMLTextAreaElement) => el.validationMessage,
    );
    expect(reasonMessage.length).toBeGreaterThan(0);
    expect((await readMismatch(seeded.mismatch.id))?.status).toBe("OPEN");

    // 브라우저 검증을 우회해 서버 측 사유 길이 거부를 확인한다.
    await form.evaluate((node) => {
      (node as HTMLFormElement).noValidate = true;
    });
    await reason.fill("짧음");
    await form.getByRole("checkbox").check();
    await confirmOperatorStepUp(form, secret);
    await form.getByRole("button", { name: "예외 확인 저장" }).click();
    await expect(form.getByRole("status")).toContainText(/확인 사유|10자/, {
      timeout: 30_000,
    });
    expect((await readMismatch(seeded.mismatch.id))?.status).toBe("OPEN");

    // 복구: 충분한 사유로 조사 중 확인 — 증거는 남고 원장은 변하지 않는다.
    await form.evaluate((node) => {
      (node as HTMLFormElement).noValidate = false;
    });
    await reason.fill("조사 중으로 남깁니다. 자동 수리는 하지 않습니다.");
    await form.getByRole("checkbox").check();
    await confirmOperatorStepUp(form, secret);
    await form.getByLabel("확인 결과").selectOption("INVESTIGATING");
    await form.getByRole("button", { name: "예외 확인 저장" }).click();
    await expect(form.getByRole("status")).toContainText("조사 중", {
      timeout: 60_000,
    });

    const afterInvestigate = await readMismatch(seeded.mismatch.id);
    expect(afterInvestigate?.status).toBe("INVESTIGATING");
    expect(afterInvestigate?.expected_value).toEqual(
      seeded.mismatch.expected_value,
    );
    expect(afterInvestigate?.actual_value).toEqual(
      seeded.mismatch.actual_value,
    );
    expect(afterInvestigate?.resolved_at).toBeNull();

    await openAdminQueue(page, "/exceptions");
    const stillVisible = mismatchCard(page, seeded.mismatch.id);
    await expect(stillVisible).toBeVisible();
    await expect(
      stillVisible.locator("header.queue-card__head span"),
    ).toHaveText("조사 중");
    await expect(stillVisible.getByText(/5000/)).toBeVisible();
    await expect(stillVisible.getByText(/false/)).toBeVisible();

    const form2 = stillVisible.getByRole("form", { name: "대사 예외 확인" });
    await form2.getByLabel("확인 결과").selectOption("ACCEPTED");
    await form2
      .getByLabel("확인 사유")
      .fill("차이를 인정합니다. 원장 수리는 하지 않습니다.");
    await form2.getByRole("checkbox").check();
    await confirmOperatorStepUp(form2, secret);
    await form2.getByRole("button", { name: "예외 확인 저장" }).click();
    await expect(form2.getByRole("status")).toContainText(
      "자동으로 숫자를 고치지 않았습니다",
      { timeout: 60_000 },
    );

    const afterAccept = await readMismatch(seeded.mismatch.id);
    expect(afterAccept?.status).toBe("ACCEPTED");
    expect(afterAccept?.expected_value).toEqual(seeded.mismatch.expected_value);
    expect(afterAccept?.actual_value).toEqual(seeded.mismatch.actual_value);
    expect(afterAccept?.resolution_reason).toContain("원장 수리");

    const audit = await readLatestExceptionAckAudit(seeded.mismatch.id);
    expect(audit?.action).toBe("RECONCILIATION_EXCEPTION_ACK");
    expect(audit?.reason).toContain("원장 수리");
    expect(JSON.stringify(audit?.metadata ?? {})).toContain(
      '"auto_repair":false',
    );

    expect(await countLedgerTransactions()).toBe(ledgerBefore);

    await openAdminQueue(page, "/exceptions");
    await expect(mismatchCard(page, seeded.mismatch.id)).toHaveCount(0);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await openAdminQueue(page, "/exceptions");
      await expectNoHorizontalOverflow(page);
      await shoot(page, `queue-${viewport.name}.png`);
    }

    await applyTheme(page, "dark");
    await openAdminQueue(page, "/exceptions");
    await expect(
      page.getByRole("heading", { name: "정산·대사 예외", level: 1 }),
    ).toBeVisible();
    await shoot(page, "empty-dark.png");
    await applyTheme(page, "light");

    expect(hydration).toEqual([]);
  });

  test("stale acknowledgement after concurrent close fails closed", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const admin = await createConfirmedMember("exc-stale");
    await grantAdminRoleVerified(admin.userId);
    const secret = await completeAdminLoginWithTotp(
      page,
      admin.email,
      admin.password,
    );
    const concurrent = await seedOpenMismatch({
      expected: { race: "a" },
      actual: { race: "b" },
    });

    await openAdminQueue(page, "/exceptions");
    const raceCard = mismatchCard(page, concurrent.mismatch.id);
    const raceForm = raceCard.getByRole("form", { name: "대사 예외 확인" });
    await raceForm.getByLabel("확인 결과").selectOption("RESOLVED");
    await raceForm
      .getByLabel("확인 사유")
      .fill("동시 처리 검증용으로 조사 완료를 시도합니다.");
    await raceForm.getByRole("checkbox").check();
    await confirmOperatorStepUp(raceForm, secret);

    const db = createLocalServiceRoleClient();
    const { error } = await db
      .from("reconciliation_mismatches")
      .update({
        status: "RESOLVED",
        resolution_reason: "다른 세션에서 먼저 닫힘",
        resolved_at: new Date().toISOString(),
        resolved_by: admin.userId,
      })
      .eq("id", concurrent.mismatch.id)
      .in("status", ["OPEN", "INVESTIGATING"]);
    if (error) throw new Error(error.message);

    await raceForm.getByRole("button", { name: "예외 확인 저장" }).click();
    await expect(raceForm.getByRole("status")).toContainText(
      /이미 처리됐거나|목록에서 사라진/,
      { timeout: 60_000 },
    );
    const finalRow = await readMismatch(concurrent.mismatch.id);
    expect(finalRow?.status).toBe("RESOLVED");
    expect(finalRow?.resolution_reason).toBe("다른 세션에서 먼저 닫힘");
    expect(finalRow?.expected_value).toEqual(
      concurrent.mismatch.expected_value,
    );
    expect(finalRow?.actual_value).toEqual(concurrent.mismatch.actual_value);
  });
});
