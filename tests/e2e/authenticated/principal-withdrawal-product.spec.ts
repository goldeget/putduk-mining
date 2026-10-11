import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

import {
  sameWithdrawalLogicalOriginal,
  validateWithdrawalLogicalRecord,
} from "../../../lib/wallet/withdrawal-logical-record";
import { formatAtomicAmount } from "../../../domain/wallet/format-amount";
import { type WithdrawalLogicalRecord } from "../../../lib/wallet/withdrawal-logical-record";
import { createConfirmedMember } from "../fixtures/local-auth";
import {
  confirmOperatorStepUp,
  formWithSubmit,
  openAdminQueue,
  readExternalSends,
  readWithdrawalLedger,
  withdrawalCard,
} from "./helpers/admin-money-ui";
import { requireWithdrawalDataKey } from "./helpers/journey";
import { loginAsMember } from "./helpers/member-session";
import {
  allocateSignedMember,
  cancelLogicalOnly,
  creditPublishedMinimum,
  expectAcceptedNativeBoundary,
  expectCurrentAcceptedCause,
  expectFirstHoldSelection,
  financialSnapshot,
  nativeBoundaryEvidence,
  preparePrincipalMember,
  preparePrincipalOperator,
  prepareSignedPrincipal,
  principalBody,
  readPrincipalFacts,
  recoverPrincipalRecord,
  releaseAgeEvidence,
  requirePrincipalIntegratedCandidate,
  signedJson,
  type PrincipalMethod,
  type PrincipalOperator,
} from "./helpers/principal-product-fixture";
import { expectSettledRoute } from "./helpers/settled-route";
import {
  capturePrincipalPresentation,
  writePrincipalPresentationReport,
} from "./helpers/principal-presentation-evidence";
import { captureRedactedWithdrawalEvidence } from "./helpers/withdrawal-evidence";

type MemberFixture = Awaited<ReturnType<typeof preparePrincipalMember>>;
type HoldTuple = {
  key: string;
  body: { method: PrincipalMethod; amountKrw: string; destinationId: string };
};

function principalSection(page: Page, method: PrincipalMethod) {
  return page
    .locator(
      `section[aria-labelledby="${method === "KRW_BANK" ? "principal-withdrawal-heading" : "principal-crypto-withdrawal-heading"}"]`,
    )
    .filter({ visible: true });
}

async function expectRenderedPrincipalFacts(
  page: Page,
  source: {
    eligible_principal_atomic: string;
    held_principal_atomic: string;
  },
) {
  for (const method of ["KRW_BANK", "USDT_ADDRESS"] as const) {
    const section = principalSection(page, method);
    for (const [label, atomic] of [
      ["현재 인정 원금", source.eligible_principal_atomic],
      ["보류 중 원금", source.held_principal_atomic],
    ] as const) {
      await expect(
        section.getByText(label, { exact: true }).locator("..").locator("dd"),
      ).toHaveText(formatAtomicAmount(atomic, "KRW"));
    }
  }
}

async function fillPrincipal(section: Locator, member: MemberFixture) {
  await expect(section.getByLabel("회수할 원금 (원)")).toBeEnabled();
  await section.getByLabel("회수할 원금 (원)").fill(member.amountKrw);
  await section.getByRole("combobox").selectOption(member.destinationId);
  await expect(
    section.getByRole("checkbox", {
      name: "원금 회수임을 확인하고 요청합니다.",
    }),
  ).not.toBeChecked();
}

function holdTuple(route: Route): HoldTuple {
  const body = route.request().postDataJSON() as HoldTuple["body"];
  return { key: route.request().headers()["idempotency-key"] ?? "", body };
}

function confirmedId(record: WithdrawalLogicalRecord) {
  expect(record.v).toBe(3);
  expect(record.withdrawalId).toBeTruthy();
  if (!record.withdrawalId) throw new Error("ACTUAL_PRINCIPAL_HOLD_REQUIRED");
  return record.withdrawalId;
}

async function acknowledgeHeld(
  page: Page,
  ownerId: string,
  record: WithdrawalLogicalRecord,
) {
  if (record.v !== 3) throw new Error("PRINCIPAL_SOURCE_REQUIRED");
  const result = await signedJson(
    page,
    "/api/v1/withdrawals/intents",
    "PATCH",
    {
      action: "CONFIRM",
      withdrawalId: record.withdrawalId,
      recordVersion: 3,
      confirmationId: record.source.confirmationId,
    },
    record.key,
  );
  expect(result.status).toBe(200);
  const checked = validateWithdrawalLogicalRecord(
    (result.payload.data as { record: unknown }).record,
    ownerId,
  );
  expect(checked.state).toBe("CONFIRMED");
  expect(sameWithdrawalLogicalOriginal(record, checked)).toBe(true);
}

async function requestPrincipalViaUi(
  page: Page,
  member: MemberFixture,
  method: PrincipalMethod,
) {
  const section = principalSection(page, method);
  await fillPrincipal(section, member);
  await section
    .getByRole("checkbox", { name: "원금 회수임을 확인하고 요청합니다." })
    .check();
  const wait = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/withdrawals/hold" &&
      r.request().method() === "POST",
  );
  await section
    .getByRole("button", { name: "원금 회수 확인 후 요청", exact: true })
    .click();
  const response = await wait;
  expect(response.status()).toBe(201);
  const id = (await response.json()).data.withdrawalId as string;
  await expect(section.getByRole("status")).toContainText(
    "원금 회수 요청을 접수했어요.",
  );
  // The API and actual immutable source, not optimistic UI copy, establish the hold.
  const record = await recoverPrincipalRecord(
    page,
    member.member.userId,
    response.request().headers()["idempotency-key"],
  );
  expect(confirmedId(record)).toBe(id);
  await acknowledgeHeld(page, member.member.userId, record);
  return { id, record };
}

async function cancelNativeViaAdmin(
  operator: PrincipalOperator,
  id: string,
  method: PrincipalMethod,
) {
  await openAdminQueue(
    operator.page,
    method === "KRW_BANK" ? "/withdrawals/krw-bank" : "/withdrawals/usdt",
  );
  const card = withdrawalCard(operator.page, id);
  await expect(card).toBeVisible();
  const form = formWithSubmit(card, "취소 · 보류 해제");
  await form
    .getByLabel("취소 사유")
    .fill("로컬 원금 브라우저 검증: 외부 송금 전 원본 보류 취소");
  await form.getByRole("checkbox", { name: /운영 취소입니다/ }).check();
  await confirmOperatorStepUp(form, operator.secret);
  await form
    .getByRole("button", { name: "취소 · 보류 해제", exact: true })
    .click();
  await expect(
    card.getByRole("status").filter({ visible: true }).last(),
  ).toContainText("출금을 취소하고 보류 금액을 해제했습니다.");
}

async function recordAndFinalizeViaAdmin(
  operator: PrincipalOperator,
  member: MemberFixture,
  id: string,
  method: PrincipalMethod,
) {
  await openAdminQueue(
    operator.page,
    method === "KRW_BANK" ? "/withdrawals/krw-bank" : "/withdrawals/usdt",
  );
  const card = withdrawalCard(operator.page, id);
  await expect(card).toBeVisible();
  const sendLabel =
    method === "KRW_BANK" ? "계좌 송금 기록" : "USDT 외부 송금 기록";
  const send = formWithSubmit(card, sendLabel);
  if (method === "KRW_BANK") {
    await send
      .getByLabel("은행 이체 참조(증빙)")
      .fill(`LOCAL_PRINCIPAL_${id.slice(0, 8)}`);
    await send.getByLabel("실제 보낸 원화").fill(member.amountKrw);
    await send.getByRole("checkbox", { name: /계좌로 실제 송금/ }).check();
  } else {
    await send.getByLabel("네트워크").fill("TRC20");
    await send
      .getByLabel("거래 해시")
      .fill(`localprincipal${id.replaceAll("-", "")}`);
    // Established admin browser fixture quantity, manually recorded. No FX/quote or USDT wallet is inferred.
    await send.getByLabel("실제 보낸 USDT").fill("4.25");
    await send
      .locator('textarea[name="conversionEvidence"]')
      .fill(
        "LOCAL TEST ONLY: 수동 송금 기록 검증. 실제 체인 송금이나 환율을 주장하지 않음.",
      );
    await send.getByRole("checkbox", { name: /KRW 잔액 기준 출금/ }).check();
  }
  const before = nativeBoundaryEvidence(member.member.userId, id, "HOLD");
  await send.getByRole("button", { name: sendLabel, exact: true }).click();
  await expect(send.getByRole("status")).toContainText("인증 앱으로 다시 확인");
  expect(nativeBoundaryEvidence(member.member.userId, id, "HOLD")).toEqual(
    before,
  );
  await confirmOperatorStepUp(send, operator.secret);
  await send.getByRole("button", { name: sendLabel, exact: true }).click();
  await expect(send.getByRole("status")).toContainText(
    method === "KRW_BANK"
      ? "계좌 송금을 기록했습니다"
      : "USDT 외부 송금을 기록했습니다",
  );
  const sends = await readExternalSends(id);
  expect(sends).toHaveLength(1);
  if (method === "USDT_ADDRESS") {
    expect(sends[0]?.network).toBe("TRC20");
    expect(String(sends[0]?.actual_usdt_amount)).toMatch(/^4\.25(?:0*)$/);
  }
  await operator.page.reload();
  const recorded = withdrawalCard(operator.page, id);
  await expect(
    recorded.getByRole("button", { name: "취소 · 보류 해제" }),
  ).toHaveCount(0);
  await expect(
    recorded.getByRole("button", { name: "거절 · 보류 해제" }),
  ).toHaveCount(0);
  const finalLabel = method === "KRW_BANK" ? "원장 확정" : "원장 확정 (재시도)";
  const finalize = formWithSubmit(recorded, finalLabel);
  await finalize.getByRole("checkbox", { name: /원장만 확정합니다/ }).check();
  const beforeFinal = financialSnapshot(member.member.userId);
  await finalize.getByRole("button", { name: finalLabel, exact: true }).click();
  await expect(finalize.getByRole("status")).toContainText(
    "인증 앱으로 다시 확인",
  );
  expect(financialSnapshot(member.member.userId)).toEqual(beforeFinal);
  await confirmOperatorStepUp(finalize, operator.secret);
  await finalize.getByRole("button", { name: finalLabel, exact: true }).click();
  await expect(finalize.getByRole("status")).toContainText(
    method === "KRW_BANK"
      ? "출금 원장을 확정했습니다"
      : "USDT 출금 원장을 확정했습니다",
  );
  const actualFinal = expectAcceptedNativeBoundary(
    member.member.userId,
    id,
    "FINALIZE",
  );
  expect(actualFinal.proof.status).toBe("COMPLETED");
  expect(actualFinal.proof.journals).toBe(2);
  expect(actualFinal.proof.sends).toBe(1);
  expect(actualFinal.proof.sameFinalCapacity).toBe(true);
  expect(actualFinal.current.source.eligible_principal_atomic).toBe(
    beforeFinal.source.eligible_principal_atomic,
  );
  expect(actualFinal.current.source.held_principal_atomic).toBe("0");
  expect(actualFinal.current.source.recovered_principal_atomic).toBe(
    member.amountKrw,
  );
  expect(actualFinal.current.cycle).toEqual(member.initial.cycle);
  await confirmOperatorStepUp(finalize, operator.secret);
  await finalize.getByRole("button", { name: finalLabel, exact: true }).click();
  await expect(finalize.getByRole("status")).toContainText(
    "출금 원장은 이미 확정되어 있습니다",
  );
  expect(financialSnapshot(member.member.userId)).toEqual(actualFinal.current);
  expect(nativeBoundaryEvidence(member.member.userId, id, "FINALIZE")).toEqual(
    actualFinal.proof,
  );
  expect((await readWithdrawalLedger(id)).finalizeId).toBe(
    actualFinal.proof.journal,
  );
}

// This spec signs actual member/admin cookies and enrolls a real TOTP factor.
// Keep those out of traces/video/automatic failure shots. Deliberate redacted
// withdrawal captures below never visit auth/MFA or copy header/storage data.
test.use({ trace: "off", video: "off", screenshot: "off" });

test.describe("signed member principal source-v3 product", () => {
  test.describe.configure({ mode: "serial" });
  let operator: PrincipalOperator;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(360_000); // Existing canonical catalog fixture budget; no config/CI timeout changes.
    requireWithdrawalDataKey();
    requirePrincipalIntegratedCandidate();
    operator = await preparePrincipalOperator(browser);
  });
  test.afterAll(async () => {
    await operator?.context.close();
  });

  test("explicit member consent, logical cleanup, real lost HOLD reply/reload/replay, and native CANCEL stay distinct", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000);
    const member = await preparePrincipalMember(page, operator, "KRW_BANK");
    const section = principalSection(page, "KRW_BANK");
    await fillPrincipal(section, member);
    const beforeConsent = financialSnapshot(member.member.userId);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (
        ["/api/v1/withdrawals/intents", "/api/v1/withdrawals/hold"].includes(
          new URL(r.url()).pathname,
        ) &&
        r.method() === "POST"
      )
        mutations.push(new URL(r.url()).pathname);
    });
    await expect(
      section.getByRole("button", {
        name: "원금 회수 확인 후 요청",
        exact: true,
      }),
    ).toBeDisabled();
    await section.getByLabel("회수할 원금 (원)").press("Enter");
    await readPrincipalFacts(page, member.member.userId, "KRW_BANK");
    expect(mutations).toEqual([]);
    expect(financialSnapshot(member.member.userId)).toEqual(beforeConsent);
    await captureRedactedWithdrawalEvidence(
      page,
      info.outputPath("principal-no-consent.png"),
    );
    const falseConsent = await signedJson(
      page,
      "/api/v1/withdrawals/intents",
      "POST",
      {
        ...principalBody(member, "KRW_BANK"),
        confirmation: { version: 1, source: "PRINCIPAL", confirmed: false },
      },
    );
    expect(falseConsent.status).toBe(400);
    expect(falseConsent.payload.error?.code).toBe("INVALID_WITHDRAWAL_REQUEST");
    expect(financialSnapshot(member.member.userId)).toEqual(beforeConsent);
    const injectedOwner = await signedJson(
      page,
      "/api/v1/withdrawals/intents",
      "POST",
      { ...principalBody(member, "KRW_BANK"), ownerId: randomUUID() },
    );
    expect(injectedOwner.status).toBe(400);
    expect(injectedOwner.payload.error?.code).toBe(
      "INVALID_WITHDRAWAL_REQUEST",
    );
    expect(financialSnapshot(member.member.userId)).toEqual(beforeConsent);

    // Omitted confirmation remains v2. Deposit principal never substitutes for a verified mining reward.
    const ordinaryBody = { ...principalBody(member, "KRW_BANK") };
    Reflect.deleteProperty(ordinaryBody, "confirmation");
    const ordinary = await signedJson(
      page,
      "/api/v1/withdrawals/intents",
      "POST",
      ordinaryBody,
    );
    expect(ordinary.status).toBe(201);
    const v2 = validateWithdrawalLogicalRecord(
      (ordinary.payload.data as { record: unknown }).record,
      member.member.userId,
    );
    expect(v2.v).toBe(2);
    expect("source" in v2).toBe(false);
    const noPrincipalFallback = await signedJson(
      page,
      "/api/v1/withdrawals/hold",
      "POST",
      {
        method: v2.method,
        destinationId: v2.destinationId,
        amountKrw: v2.amountKrw,
      },
      v2.key,
    );
    expect(noPrincipalFallback.status).toBe(409);
    expect(noPrincipalFallback.payload.error?.code).toBe(
      "WITHDRAWAL_SOURCE_UNAVAILABLE",
    );
    expect(financialSnapshot(member.member.userId)).toEqual(beforeConsent);
    expect(
      (
        await signedJson(
          page,
          "/api/v1/withdrawals/intents",
          "PATCH",
          { action: "CANCEL" },
          v2.key,
        )
      ).status,
    ).toBe(200);

    const unsubmitted = await prepareSignedPrincipal(
      page,
      member.member.userId,
      principalBody(member, "KRW_BANK"),
    );
    expect(unsubmitted.withdrawalId).toBeNull();
    const afterOriginal = financialSnapshot(member.member.userId);
    expect(afterOriginal.nativeRequests).toBe(beforeConsent.nativeRequests);
    expect(afterOriginal.ledgerCount).toBe(beforeConsent.ledgerCount);
    expect(afterOriginal.source).toEqual(beforeConsent.source);
    const wrongPatch = await signedJson(
      page,
      "/api/v1/withdrawals/intents",
      "PATCH",
      { action: "CANCEL", recordVersion: 3, confirmationId: randomUUID() },
      unsubmitted.key,
    );
    expect(wrongPatch.status).toBe(409);
    expect(wrongPatch.payload.error?.code).toBe(
      "WITHDRAWAL_RECONCILIATION_REQUIRED",
    );
    expect(financialSnapshot(member.member.userId)).toEqual(afterOriginal);
    const other = await createConfirmedMember("principal-http-other-owner");
    const otherContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    try {
      const otherPage = await otherContext.newPage();
      await loginAsMember(otherPage, other);
      const crossOwner = await signedJson(
        otherPage,
        "/api/v1/withdrawals/intents",
        "GET",
        undefined,
        unsubmitted.key,
      );
      expect(crossOwner.status).toBe(503);
      expect(crossOwner.payload.error?.code).toBe(
        "WITHDRAWAL_RECONCILIATION_REQUIRED",
      );
      expect(financialSnapshot(member.member.userId)).toEqual(afterOriginal);
    } finally {
      await otherContext.close();
    }
    await page.reload();
    await expectSettledRoute(page, "/wallet/withdraw");
    await expect(
      section.getByRole("button", { name: "접수 전 요청 정리", exact: true }),
    ).toBeVisible();
    await section
      .getByRole("button", { name: "접수 전 요청 정리", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText(
      "접수 전 요청을 정리했어요.",
    );
    expect(
      (
        await recoverPrincipalRecord(
          page,
          member.member.userId,
          unsubmitted.key,
        )
      ).state,
    ).toBe("CANCELLED");
    expect(financialSnapshot(member.member.userId)).toEqual(afterOriginal);

    const seen: HoldTuple[] = [];
    let actualRecord: WithdrawalLogicalRecord | null = null;
    let dropped = false;
    await page.route("**/api/v1/withdrawals/hold", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      seen.push(holdTuple(route));
      if (dropped) {
        await route.continue();
        return;
      }
      const upstream = await route.fetch({ maxRetries: 1 }); // Existing same-request ECONNRESET retry; no fresh key.
      expect(upstream.status()).toBe(201);
      const id = (await upstream.json()).data.withdrawalId as string;
      expectAcceptedNativeBoundary(member.member.userId, id, "HOLD");
      actualRecord = await recoverPrincipalRecord(
        page,
        member.member.userId,
        seen[0]!.key,
      );
      expect(confirmedId(actualRecord)).toBe(id);
      dropped = true;
      await route.abort("connectionreset"); // Only the real committed reply is lost. No mocked response or seeded native HOLD.
    });
    await fillPrincipal(section, member);
    await section
      .getByRole("checkbox", { name: "원금 회수임을 확인하고 요청합니다." })
      .check();
    await section
      .getByRole("button", { name: "원금 회수 확인 후 요청", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText(
      "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    );
    expect(dropped).toBe(true);
    expect(seen).toHaveLength(1);
    const committedRecord = actualRecord as WithdrawalLogicalRecord | null;
    if (!committedRecord)
      throw new Error("REAL_COMMITTED_RESPONSE_LOSS_NOT_OBSERVED");
    const id = confirmedId(committedRecord);
    const afterHold = expectAcceptedNativeBoundary(
      member.member.userId,
      id,
      "HOLD",
    );
    expectFirstHoldSelection(member.member.userId, id);
    expect(afterHold.current.source.eligible_principal_atomic).toBe(
      (
        BigInt(member.initial.source.eligible_principal_atomic) -
        BigInt(member.amountKrw)
      ).toString(),
    );
    expect(afterHold.current.source.held_principal_atomic).toBe(
      member.amountKrw,
    );
    expect(afterHold.current.cycle).toEqual(member.initial.cycle);
    // A real second tab shares the owner's cookies and storage. Opening or recovering never creates a new HOLD.
    const secondTab = await page.context().newPage();
    const secondTabPosts: string[] = [];
    secondTab.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() === "POST" &&
        (path === "/api/v1/withdrawals/intents" ||
          path === "/api/v1/withdrawals/hold")
      ) {
        secondTabPosts.push(path);
      }
    });
    try {
      await secondTab.goto("/wallet/withdraw");
      await expectSettledRoute(secondTab, "/wallet/withdraw");
      await principalSection(secondTab, "KRW_BANK")
        .getByRole("button", { name: "이전 요청 확인", exact: true })
        .click();
      const secondTabOriginal = await recoverPrincipalRecord(
        secondTab,
        member.member.userId,
        committedRecord.key,
      );
      expect(
        sameWithdrawalLogicalOriginal(committedRecord, secondTabOriginal),
      ).toBe(true);
      expect(secondTabOriginal.state).toBe(committedRecord.state);
      expect(confirmedId(secondTabOriginal)).toBe(id);
      expect(secondTabPosts).toEqual([]);
      expect(financialSnapshot(member.member.userId)).toEqual(
        afterHold.current,
      );
      const secondTabRetry = await signedJson(
        secondTab,
        "/api/v1/withdrawals/hold",
        "POST",
        seen[0]!.body,
        seen[0]!.key,
      );
      expect(secondTabRetry.status).toBe(201);
      expect(
        (secondTabRetry.payload.data as { withdrawalId: string }).withdrawalId,
      ).toBe(id);
      expect(secondTabPosts).toEqual(["/api/v1/withdrawals/hold"]);
      const firstTabOriginal = await recoverPrincipalRecord(
        page,
        member.member.userId,
        committedRecord.key,
      );
      expect(
        sameWithdrawalLogicalOriginal(secondTabOriginal, firstTabOriginal),
      ).toBe(true);
      expect(firstTabOriginal.state).toBe(secondTabOriginal.state);
      expect(confirmedId(firstTabOriginal)).toBe(id);
      expect(financialSnapshot(member.member.userId)).toEqual(
        afterHold.current,
      );
      expect(nativeBoundaryEvidence(member.member.userId, id, "HOLD")).toEqual(
        afterHold.proof,
      );
    } finally {
      await secondTab.close();
    }
    const postsBeforeReload = mutations.length;
    await page.reload();
    await expectSettledRoute(page, "/wallet/withdraw");
    await section
      .getByRole("button", { name: "이전 요청 확인", exact: true })
      .click();
    const recovered = await recoverPrincipalRecord(
      page,
      member.member.userId,
      committedRecord.key,
    );
    expect(sameWithdrawalLogicalOriginal(committedRecord, recovered)).toBe(
      true,
    );
    expect(mutations.length).toBe(postsBeforeReload);
    expect(financialSnapshot(member.member.userId)).toEqual(afterHold.current);
    // Recovery finishes its read before evidence is collected; no finance is retried.
    await expect(
      section.getByRole("button", { name: "이전 요청 확인", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("원금 정보를 확인하고 있어요…", { exact: true }),
    ).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await captureRedactedWithdrawalEvidence(
      page,
      info.outputPath("principal-original-recovered.png"),
    );
    await page.unroute("**/api/v1/withdrawals/hold");
    const retry = await signedJson(
      page,
      "/api/v1/withdrawals/hold",
      "POST",
      seen[0]!.body,
      seen[0]!.key,
    );
    expect(retry.status).toBe(201);
    expect((retry.payload.data as { withdrawalId: string }).withdrawalId).toBe(
      id,
    );
    expect(financialSnapshot(member.member.userId)).toEqual(afterHold.current);
    expect(nativeBoundaryEvidence(member.member.userId, id, "HOLD")).toEqual(
      afterHold.proof,
    );
    const cannotCancelNativeAsLogical = await cancelLogicalOnly(
      page,
      recovered,
    );
    expect(cannotCancelNativeAsLogical.status).toBe(200);
    expect(
      (
        cannotCancelNativeAsLogical.payload.data as {
          record: { state: string; withdrawalId: string };
        }
      ).record,
    ).toMatchObject({ state: "OUTCOME_UNCERTAIN", withdrawalId: id });
    expect(financialSnapshot(member.member.userId)).toEqual(afterHold.current);
    await acknowledgeHeld(page, member.member.userId, recovered);
    await cancelNativeViaAdmin(operator, id, "KRW_BANK");
    const restored = expectAcceptedNativeBoundary(
      member.member.userId,
      id,
      "RELEASE",
    );
    expect(restored.proof.status).toBe("CANCELLED");
    expect(restored.current.source.eligible_principal_atomic).toBe(
      member.initial.source.eligible_principal_atomic,
    );
    expect(restored.current.source.held_principal_atomic).toBe("0");
    expect(restored.current.cycle).toEqual(member.initial.cycle);
    const ages = releaseAgeEvidence(member.member.userId, id);
    expect(ages.heldPortions).toBeGreaterThan(0);
    expect(ages.pausedAgePreserved).toBe(true);
    // A genuine second confirmation/HOLD observes two different ages within the same newest lot.
    await page.goto("/wallet/withdraw");
    await expectSettledRoute(page, "/wallet/withdraw");
    const repeated = await requestPrincipalViaUi(page, member, "KRW_BANK");
    expect(repeated.id).not.toBe(id);
    expectFirstHoldSelection(member.member.userId, repeated.id);
    expectAcceptedNativeBoundary(member.member.userId, repeated.id, "HOLD");
    await cancelNativeViaAdmin(operator, repeated.id, "KRW_BANK");
    const againRestored = expectAcceptedNativeBoundary(
      member.member.userId,
      repeated.id,
      "RELEASE",
    );
    expect(againRestored.current.source).toEqual(restored.current.source);
    expect(againRestored.current.cycle).toEqual(member.initial.cycle);
    expect(
      releaseAgeEvidence(member.member.userId, repeated.id).pausedAgePreserved,
    ).toBe(true);
  });

  for (const method of ["KRW_BANK", "USDT_ADDRESS"] as const) {
    test(`${method}: real member v3 HOLD, AAL2 manual send and FINALIZE, then current input3 credit/allocation`, async ({
      page,
    }, info) => {
      test.setTimeout(300_000);
      const member = await preparePrincipalMember(page, operator, method);
      const { id, record } = await requestPrincipalViaUi(page, member, method);
      const held = expectAcceptedNativeBoundary(
        member.member.userId,
        id,
        "HOLD",
      );
      expect(held.proof.status).toBe("HELD");
      expect(held.proof.sends).toBe(0);
      expect(held.current.cycle).toEqual(member.initial.cycle);
      await expectRenderedPrincipalFacts(page, held.current.source);
      await captureRedactedWithdrawalEvidence(
        page,
        info.outputPath(`principal-${method.toLowerCase()}-held.png`),
      );
      if (method === "USDT_ADDRESS")
        await expect(page.getByText(/USDT 잔액|내 USDT/)).toHaveCount(0);
      await recordAndFinalizeViaAdmin(operator, member, id, method);
      const final = financialSnapshot(member.member.userId);
      const historical = await recoverPrincipalRecord(
        page,
        member.member.userId,
        record.key,
      );
      expect(sameWithdrawalLogicalOriginal(record, historical)).toBe(true);
      expect(financialSnapshot(member.member.userId)).toEqual(final);
      // Same-key native replay remains recoverable after actual payout/current source changes.
      const nativeReplay = await signedJson(
        page,
        "/api/v1/withdrawals/hold",
        "POST",
        {
          method,
          destinationId: record.destinationId,
          amountKrw: record.amountKrw,
        },
        record.key,
      );
      expect(nativeReplay.status).toBe(201);
      expect(
        (nativeReplay.payload.data as { withdrawalId: string }).withdrawalId,
      ).toBe(id);
      expect(financialSnapshot(member.member.userId)).toEqual(final);
      creditPublishedMinimum(member.member.userId, operator.member.userId);
      const credited = financialSnapshot(member.member.userId);
      expectCurrentAcceptedCause(member.member.userId, "CREDIT");
      expect(credited.inputContract).toBe("3");
      expect(credited.source.coverage).toBe("COMPLETE");
      expect(credited.source.recovered_principal_atomic).toBe(member.amountKrw);
      expect(BigInt(credited.source.eligible_principal_atomic)).toBeGreaterThan(
        BigInt(final.source.eligible_principal_atomic),
      );
      expect(credited.cycle).toEqual(member.initial.cycle);
      const allocation = await allocateSignedMember(page, operator, "2500");
      const changed = financialSnapshot(member.member.userId);
      expectCurrentAcceptedCause(member.member.userId, "ALLOCATION");
      expect(changed.inputContract).toBe("3");
      expect(changed.source).toEqual(credited.source);
      expect(changed.cycle).toEqual(member.initial.cycle);
      const allocationReplay = await signedJson(
        page,
        "/api/v1/products/allocation",
        "POST",
        allocation.body,
        allocation.key,
      );
      expect(allocationReplay.status).toBe(200);
      expect(
        (allocationReplay.payload.data as { receipt: unknown }).receipt,
      ).toEqual(allocation.receipt);
      expect(financialSnapshot(member.member.userId)).toEqual(changed);
      const currentFacts = await readPrincipalFacts(
        page,
        member.member.userId,
        method,
      );
      expect(currentFacts.available).toBe(true);
      if (!currentFacts.available)
        throw new Error("POST_FINALIZE_CURRENT_PRINCIPAL_READ_UNAVAILABLE");
      expect(currentFacts.eligiblePrincipalKrw).toBe(
        changed.source.eligible_principal_atomic,
      );
      expect(currentFacts.heldPrincipalKrw).toBe("0");
      expect(currentFacts.allocationBps).toBe("2500");
      await page.goto("/wallet/withdraw");
      const route = await expectSettledRoute(page, "/wallet/withdraw");
      await expect(
        route.getByText("출금 처리가 완료됐어요.").filter({ visible: true }),
      ).toBeVisible();
      await expect(
        principalSection(page, method).getByRole("checkbox", {
          name: "원금 회수임을 확인하고 요청합니다.",
        }),
      ).not.toBeChecked();
      await expectRenderedPrincipalFacts(page, changed.source);
      expect(financialSnapshot(member.member.userId)).toEqual(changed);
      // Capture the actual refreshed completed view, not the prior HOLD UI.
      await captureRedactedWithdrawalEvidence(
        page,
        info.outputPath(
          `principal-${method.toLowerCase()}-completed-current-input3.png`,
        ),
      );
    });
  }

  test("reconstructed principal cards retain money truth at seven widths, both themes and enlarged Korean text", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const member = await preparePrincipalMember(page, operator, "KRW_BANK");
    const before = financialSnapshot(member.member.userId);
    const errors: string[] = [];
    const mutations: string[] = [];
    const origin = new URL(page.url()).origin;
    page.on("pageerror", (error) => errors.push(`page:${error.name}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push("console:error");
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(
          `http:${response.status()}:${new URL(response.url()).pathname}`,
        );
    });
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() !== "GET" &&
        ["/api/v1/withdrawals/intents", "/api/v1/withdrawals/hold"].includes(
          path,
        )
      )
        mutations.push(path);
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (
        request.failure()?.errorText === "net::ERR_ABORTED" &&
        request.method() === "GET" &&
        request.resourceType() === "fetch" &&
        !request.isNavigationRequest() &&
        request.headers()["next-router-prefetch"] === "1" &&
        url.origin === origin &&
        !url.pathname.startsWith("/api/")
      )
        return;
      errors.push(`network:${url.pathname}`);
    });
    const records = [];
    for (const width of [320, 360, 375, 390, 834, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
      for (const theme of ["dark", "light"] as const) {
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.evaluate(
          (theme) => localStorage.setItem("putduk-theme", theme),
          theme,
        );
        expect(
          (
            await page.goto("/wallet/withdraw", { waitUntil: "networkidle" })
          )?.status(),
        ).toBe(200);
        await expectSettledRoute(page, "/wallet/withdraw");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(
          principalSection(page, "KRW_BANK").getByRole("combobox"),
        ).toHaveValue(member.destinationId);
        for (const textScale of [1, 2]) {
          await page.evaluate(async (scale) => {
            document.documentElement.style.fontSize = scale === 2 ? "200%" : "";
            await document.fonts.ready;
          }, textScale);
          const main = page.getByRole("main");
          expect(
            await main.evaluate((root) => root.clientHeight),
          ).toBeGreaterThanOrEqual(page.viewportSize()!.height / 2);
          await expect
            .poll(() =>
              main.evaluate(
                (root) =>
                  root.scrollWidth <= root.clientWidth + 1 &&
                  document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            )
            .toBe(true);
          for (const method of ["KRW_BANK", "USDT_ADDRESS"] as const) {
            const section = principalSection(page, method);
            const moneyGroups = await section
              .locator("[data-principal-money-group]")
              .evaluateAll((groups) =>
                groups.map((group) => {
                  const range = document.createRange();
                  range.selectNodeContents(group);
                  const lines = [...range.getClientRects()].filter(
                    (box) => box.width > 0 && box.height > 0,
                  );
                  const box = group.closest("dd")!.getBoundingClientRect();
                  return (
                    lines.length === 1 &&
                    lines.every(
                      (line) =>
                        line.left >= box.left - 1 &&
                        line.right <= box.right + 1,
                    )
                  );
                }),
              );
            expect(moneyGroups.length).toBeGreaterThanOrEqual(6);
            expect(moneyGroups.every(Boolean)).toBe(true);
            const fields = section.locator('input[type="text"],select');
            expect(await fields.count()).toBe(2);
            const controls = await fields.evaluateAll((nodes) =>
              nodes.map((node) => {
                const css = getComputedStyle(node),
                  box = node.getBoundingClientRect(),
                  parent = node.closest("section")!.getBoundingClientRect();
                return {
                  styled:
                    css.borderTopStyle !== "none" &&
                    parseFloat(css.borderTopWidth) >= 1 &&
                    css.backgroundColor !== "rgba(0, 0, 0, 0)",
                  touchTarget: box.height >= 44,
                  contained:
                    box.left >= parent.left && box.right <= parent.right + 1,
                };
              }),
            );
            expect(
              controls.every((c) => c.styled && c.touchTarget && c.contained),
            ).toBe(true);
            const badgeContrasts = await section.evaluate((root) => {
              const luminance = (value: string) => {
                const channels = value.match(/[0-9.]+/g)?.map(Number);
                if (
                  !channels ||
                  channels.length < 3 ||
                  (channels.length > 3 && channels[3] !== 1)
                )
                  return null;
                const linear = channels.slice(0, 3).map((c) => {
                  const v = c / 255;
                  return v <= 0.04045
                    ? v / 12.92
                    : ((v + 0.055) / 1.055) ** 2.4;
                });
                return (
                  linear[0]! * 0.2126 +
                  linear[1]! * 0.7152 +
                  linear[2]! * 0.0722
                );
              };
              return [...root.querySelectorAll("form h3")].map((heading) => {
                const badge = heading.previousElementSibling;
                if (!badge) return null;
                const css = getComputedStyle(badge),
                  fg = luminance(css.color),
                  bg = luminance(css.backgroundColor);
                return fg === null || bg === null
                  ? null
                  : (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
              });
            });
            expect(badgeContrasts).toHaveLength(2);
            expect(
              badgeContrasts.every(
                (contrast) => contrast !== null && contrast >= 4.5,
              ),
            ).toBe(true);
            const consent = section.getByRole("checkbox", {
              name: "원금 회수임을 확인하고 요청합니다.",
              exact: true,
            });
            await expect(consent).not.toBeChecked();
            await expect(
              section.getByRole("button", {
                name: "원금 회수 확인 후 요청",
                exact: true,
              }),
            ).toBeDisabled();
            await section
              .getByLabel("회수할 원금 (원)", { exact: true })
              .focus();
            await expect(
              section.getByLabel("회수할 원금 (원)", { exact: true }),
            ).toBeFocused();
            await page.keyboard.press("Tab");
            await expect(section.getByRole("combobox")).toBeFocused();
            const evidence = await capturePrincipalPresentation(
              page,
              section,
              info,
              `principal-${method.toLowerCase()}-${width}-${theme}-text-${textScale}`,
            );
            records.push({ width, theme, textScale, method, ...evidence });
          }
        }
      }
    }
    expect(records).toHaveLength(56);
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
    expect(financialSnapshot(member.member.userId)).toEqual(before);
    await writePrincipalPresentationReport(info, {
      scope:
        "funded principal before-consent cards only; screenshot review pending",
      records,
      mutations,
      errors,
      moneyUnchanged: true,
      globalVisualAccepted: false,
    });
  });
});
