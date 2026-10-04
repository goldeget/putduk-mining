import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  issueCommandFamilyToken,
  setStepUpToken,
} from "./helpers/admin-money-ui";

async function postEconomyFromBrowser(
  page: Page,
  endpoint: "state" | "command",
  data: Record<string, unknown>,
  idempotencyKey: string | null = null,
) {
  // Production Secure cookies are honored by Chromium on loopback. Node's
  // APIRequestContext drops them on HTTP; use the actual authenticated browser.
  return page.evaluate(
    async ({ origin, endpoint, data, idempotencyKey }) => {
      if (location.origin !== origin) throw new Error("ADMIN_ORIGIN_MISMATCH");
      const response = await fetch(`/api/v1/admin/economy/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(data),
      });
      return {
        ok: response.ok,
        status: response.status,
        payload: await response.json(),
      };
    },
    { origin: ADMIN_ORIGIN, endpoint, data, idempotencyKey },
  );
}

test("real admin policy lifecycle preserves exact values, source boundaries and same-key replay", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The same spec explicitly covers phone, tablet and desktop widths.",
  );
  test.setTimeout(240_000);
  const account = await createConfirmedMember("admin-economy-policy");
  await grantAdminRole(account.userId);
  const secret = await completeAdminLoginWithTotp(
    page,
    account.email,
    account.password,
  );
  const captured: { key: string; body: string }[] = [];
  page.on("request", (request) => {
    if (
      request.url() === `${ADMIN_ORIGIN}/api/v1/admin/economy/command` &&
      request.method() === "POST"
    )
      captured.push({
        key: request.headers()["idempotency-key"] ?? "",
        body: request.postData() ?? "",
      });
  });
  await page.goto(`${ADMIN_ORIGIN}/economy`);
  await expect(
    page.getByRole("heading", { level: 1, name: "채굴 정책" }),
  ).toBeVisible();
  await expect(
    page.getByText("정책 발행과 실제 정산은 별개입니다"),
  ).toBeVisible();
  const denied = await page.request.post(
    `${ADMIN_ORIGIN}/api/v1/admin/economy/state`,
    { headers: { Origin: "https://untrusted.example" }, data: {} },
  );
  expect(denied.status()).toBe(403);

  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page
        .getByRole("combobox", { name: "화면 테마" })
        .selectOption(theme);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await testInfo.attach(`economy-${width}-${theme}`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }),
        contentType: "image/png",
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "새 버전 작성", exact: true }).click();
  const create = page.getByRole("form", { name: "새 정책 저장" });
  const version = `E2E-ECONOMY-${randomUUID().replaceAll("-", "").toUpperCase()}`;
  await create.getByLabel("새 버전 이름", { exact: true }).fill(version);
  await create.getByLabel("기본 비율").fill("12.34");
  await create
    .getByLabel("작업 사유", { exact: true })
    .fill("경제 정책 실제 화면 검토와 정수 값 보존 검사입니다.");
  await create.getByLabel("정책 값과 적용 시간을 확인했습니다.").check();
  await confirmOperatorStepUp(create, secret);
  await create
    .getByRole("button", { name: "새 정책 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: version }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("12.34%", { exact: true })).toBeVisible();

  const stateResponse = await postEconomyFromBrowser(page, "state", {
    policyVersion: version,
  });
  expect(stateResponse.ok).toBe(true);
  expect(stateResponse.status).toBe(200);
  const state = stateResponse.payload.data;
  expect(state.selectedVersion.settings.baseCycleRateBps).toBe(1234);
  expect(state.runtimeStatus).toBe("POLICY_CONSUMER_NOT_ENABLED");
  expect(JSON.stringify(state)).not.toContain("sourceComplete");
  expect(JSON.stringify(state)).not.toContain("manifestText");
  const latest = state.latestPublishedStart
    ? Date.parse(state.latestPublishedStart)
    : Date.now();
  const scheduled = Math.max(Date.now(), latest) + 3_600_000;
  const koreanLocal = new Date(scheduled + 9 * 3_600_000)
    .toISOString()
    .slice(0, 16);

  for (const label of ["적용 전 검토", "정책 승인", "발행 예약"]) {
    const form = page.getByRole("form", { name: label, exact: true });
    await expect(form).toBeVisible();
    if (label === "적용 전 검토")
      await form.getByLabel("적용 예정 시간 (한국 시간)").fill(koreanLocal);
    await form
      .getByLabel("작업 사유", { exact: true })
      .fill(`정책 값과 적용 시간을 확인한 ${label} 작업입니다.`);
    await form.getByLabel("정책 값과 적용 시간을 확인했습니다.").check();
    // Real single-use grants from the already verified recent TOTP session.
    // No synthetic AAL, token, role or policy receipt is injected.
    const grant = await issueCommandFamilyToken(page, "ECONOMY_POLICY");
    expect(grant.status).toBe(200);
    expect(grant.token).not.toBeNull();
    await setStepUpToken(form, grant.token!);
    await form.getByRole("button", { name: label, exact: true }).click();
    await expect(form).toHaveCount(0, { timeout: 30_000 });
  }
  await expect(
    page.getByText("발행된 버전은 수정하지 않습니다.", { exact: false }),
  ).toBeVisible();
  const final = await postEconomyFromBrowser(page, "state", {
    policyVersion: version,
  });
  expect(final.ok).toBe(true);
  expect(final.status).toBe(200);
  const finalState = final.payload.data;
  expect(finalState.selectedVersion.latestRevision.state).toBe("PUBLISHED");
  expect(
    finalState.selectedVersion.history.map(
      (item: { state: string }) => item.state,
    ),
  ).toEqual(["DRAFT", "PREVIEWED", "APPROVED", "PUBLISHED"]);
  expect(finalState.selectedVersion.settings.baseCycleRateBps).toBe(1234);
  const preview = captured.find(
    (item) => JSON.parse(item.body).operation === "PREVIEW",
  );
  expect(preview).toBeDefined();
  const replay = await postEconomyFromBrowser(
    page,
    "command",
    JSON.parse(preview!.body),
    preview!.key,
  );
  expect(replay.ok).toBe(true);
  expect(replay.status).toBe(200);
  const replayData = replay.payload.data;
  expect(replayData.receipt.state).toBe("PREVIEWED");
  expect(replayData.console.selectedVersion.latestRevision.state).toBe(
    "PUBLISHED",
  );
  expect(replayData.console.selectedVersion.history).toHaveLength(4);
  expect(replayData.console.runtimeStatus).toBe("POLICY_CONSUMER_NOT_ENABLED");
});
