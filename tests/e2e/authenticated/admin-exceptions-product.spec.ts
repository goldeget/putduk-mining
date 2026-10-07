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

async function countRows(table: string) {
  const db = createLocalServiceRoleClient();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function moneySnapshot() {
  const db = createLocalServiceRoleClient();
  const { data: ledgerRows, error: ledgerError } = await db
    .from("wallet_ledger")
    .select("id, amount_atomic, direction, entry_type")
    .order("id", { ascending: true });
  if (ledgerError) throw new Error(ledgerError.message);
  const { data: balances, error: balanceError } = await db
    .from("wallet_balance_snapshots")
    .select("wallet_account_id, balance_atomic, available_balance_atomic")
    .order("wallet_account_id", { ascending: true });
  if (balanceError) throw new Error(balanceError.message);
  return {
    ledgerTransactions: await countRows("ledger_transactions"),
    ledgerEntries: await countRows("ledger_entries"),
    walletLedger: ledgerRows ?? [],
    balances: balances ?? [],
  };
}

async function readExceptionAckAudits(targetId: string) {
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
    .select("command_family, consume_request_id")
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

    const admin = await createConfirmedMember("exc-admin");
    await grantAdminRoleVerified(admin.userId);
    const moneyBefore = await moneySnapshot();
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
    // 결과를 바꾸면 이전 확인과 작업 토큰이 해제되어야 한다.
    await expect(form.getByRole("checkbox")).not.toBeChecked();
    await expect(form.locator('input[name="stepUpToken"]')).toHaveValue("");
    await form.getByRole("checkbox").check();
    await confirmOperatorStepUp(form, secret);
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

    const audits = await readExceptionAckAudits(seeded.mismatch.id);
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const acceptedAudit = audits[audits.length - 1];
    expect(acceptedAudit?.action).toBe("RECONCILIATION_EXCEPTION_ACK");
    expect(acceptedAudit?.actor_user_id).toBe(admin.userId);
    expect(acceptedAudit?.reason).toContain("원장 수리");
    expect(JSON.stringify(acceptedAudit?.metadata ?? {})).toContain(
      '"auto_repair":false',
    );
    const consumedRequestIds = await readConsumedAckRequestIds(admin.userId);
    for (const row of audits) {
      expect(row.actor_user_id).toBe(admin.userId);
      expect(consumedRequestIds).toContain(row.request_id);
    }

    expect(await moneySnapshot()).toEqual(moneyBefore);

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

  test("failed jobs explain Korean evidence and safe review without financial mutations", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const admin = await createConfirmedMember("exc-job-guidance");
    await grantAdminRoleVerified(admin.userId);
    await completeAdminLoginWithTotp(page, admin.email, admin.password);
    const db = createLocalServiceRoleClient();
    const runId = randomUUID();
    const jobTypes = [
      "FINANCIAL_RECONCILIATION",
      "FUNDING_MINING_TICK_V1",
      "LOCAL_UI_REVIEW_PROBE",
    ];
    const ids = jobTypes.map(() => randomUUID());
    const rows = jobTypes.map((job_type, index) => ({
      id: ids[index],
      job_type,
      status: index === 1 ? "DEAD_LETTER" : "FAILED",
      attempts: index + 1,
      dead_lettered_at: index === 1 ? new Date().toISOString() : null,
      idempotency_key: `admin-job-guidance:${runId}:${ids[index]}`,
      payload: { fixtureRunId: runId, scope: "LOCAL_BROWSER_TEST_ONLY" },
    }));
    const { error } = await db.from("system_jobs").insert(rows);
    expect(error).toBeNull();
    const { data: queue, error: queueError } = await db
      .from("system_jobs")
      .select("id")
      .or("status.eq.FAILED,dead_lettered_at.not.is.null")
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(20);
    expect(queueError).toBeNull();
    const reviewIndices = ids.map((id) =>
      (queue ?? []).findIndex((job) => job.id === id),
    );
    expect(reviewIndices.every((index) => index >= 0)).toBe(true);
    const before = await moneySnapshot();
    const posts: string[] = [];
    const failures: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST")
        posts.push(new URL(request.url()).pathname);
    });
    page.on("pageerror", (error) => failures.push(error.name));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push("console:error");
    });
    try {
      await openAdminQueue(page, "/exceptions");
      const jobs = page.getByTestId("failed-jobs");
      const reconciliationJob = jobs.getByTestId(
        `failed-job-review-${reviewIndices[0]! + 1}`,
      );
      const miningJob = jobs.getByTestId(
        `failed-job-review-${reviewIndices[1]! + 1}`,
      );
      const unknownJob = jobs.getByTestId(
        `failed-job-review-${reviewIndices[2]! + 1}`,
      );
      await expect(jobs).toBeVisible();
      await expect(
        reconciliationJob.getByRole("heading", {
          name: "금액 기록 비교",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        miningJob.getByRole("heading", { name: "유료 채굴 갱신", exact: true }),
      ).toBeVisible();
      await expect(
        unknownJob.getByRole("heading", {
          name: "작업 종류 확인 필요",
          exact: true,
        }),
      ).toBeVisible();
      await expect(jobs).toContainText("자동 처리 중단");
      await expect(
        reconciliationJob.getByRole("link", { name: "금액 차이 보기" }),
      ).toHaveAttribute("href", "/exceptions#reconciliation-exceptions");
      await expect(
        miningJob.getByRole("link", { name: "회원 채굴 확인" }),
      ).toHaveAttribute("href", "/members");
      await expect(jobs.getByRole("button")).toHaveCount(1);
      await expect(jobs.locator("form")).toHaveCount(0);
      for (const value of [...jobTypes, ...ids])
        expect(await jobs.innerText()).not.toContain(value);

      for (const width of [320, 390, 834, 1440]) {
        await page.setViewportSize({
          width,
          height: width === 834 ? 1112 : 900,
        });
        for (const theme of ["dark", "light"] as const) {
          await applyTheme(page, theme);
          await openAdminQueue(page, "/exceptions");
          await expectNoHorizontalOverflow(page);
          const refresh = jobs.getByRole("button", {
            name: "목록 다시 불러오기",
          });
          await refresh.focus();
          await expect(refresh).toBeFocused();
          expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          );
          await shoot(page, `failed-jobs-${width}-${theme}.png`);
          if (width === 390) {
            await page.evaluate(() => {
              document.documentElement.style.fontSize = "200%";
            });
            await expectNoHorizontalOverflow(page);
            await shoot(page, `failed-jobs-${width}-${theme}-text-200.png`);
            await page.evaluate(() => {
              document.documentElement.style.fontSize = "";
            });
          }
        }
      }
      await jobs.getByRole("button", { name: "목록 다시 불러오기" }).click();
      await expect(
        miningJob.getByRole("heading", { name: "유료 채굴 갱신", exact: true }),
      ).toBeVisible();
      await miningJob.getByRole("link", { name: "회원 채굴 확인" }).click();
      await expect(page).toHaveURL(`${ADMIN_ORIGIN}/members`);
      await expect(page.getByLabel("이름·아이디·전화번호")).toBeVisible();
      const { data: retained, error: readError } = await db
        .from("system_jobs")
        .select("id,status,attempts,payload")
        .in("id", ids);
      expect(readError).toBeNull();
      expect(retained).toHaveLength(3);
      for (const row of rows) {
        expect(retained!.find((record) => record.id === row.id)).toMatchObject({
          status: row.status,
          attempts: row.attempts,
          payload: row.payload,
        });
      }
      expect(await moneySnapshot()).toEqual(before);
      expect(posts).toEqual([]);
      expect(failures).toEqual([]);
    } finally {
      // Service deletion is forbidden. Keep marked, unexecuted probes until the
      // disposable local database is reset through the repository's own path.
      const { error: cleanupError } = await db
        .from("system_jobs")
        .delete()
        .in("id", ids)
        .eq("payload->>fixtureRunId", runId);
      expect(cleanupError?.code).toBe("42501");
      const { count, error: remainingError } = await db
        .from("system_jobs")
        .select("id", { count: "exact", head: true })
        .in("id", ids)
        .eq("payload->>fixtureRunId", runId);
      expect(remainingError).toBeNull();
      expect(count).toBe(3);
    }
  });

  test("stale acknowledgement after concurrent close fails closed", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const admin = await createConfirmedMember("exc-stale");
    await grantAdminRoleVerified(admin.userId);
    const moneyBefore = await moneySnapshot();
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
    expect(await readExceptionAckAudits(concurrent.mismatch.id)).toEqual([]);
    expect(await moneySnapshot()).toEqual(moneyBefore);
  });
});
