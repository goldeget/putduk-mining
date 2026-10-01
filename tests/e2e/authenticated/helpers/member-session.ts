import { expect, type Page } from "@playwright/test";

import type { ConfirmedMember } from "../../fixtures/local-auth";

export async function loginAsMember(
  page: Page,
  member: ConfirmedMember,
  nextPath = "/home",
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  // label 안 '보기' 토글 때문에 getByLabel('비밀번호')가 불안정해 ID로 채운다.
  await page.locator("#login-identifier").fill(member.email);
  await page.locator("#login-password").fill(member.password);
  await page.getByRole("button", { name: /^로그인$/ }).click();
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 60_000,
    });
  } catch (error) {
    const alert = (
      await page
        .locator("#login-error")
        .textContent()
        .catch(() => null)
    )?.trim();
    throw new Error(
      `MEMBER_LOGIN_FAILED: alert=${alert ?? "none"}; cause=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // 서버 액션 쿠키가 브라우저에 정착할 때까지 인증 UI를 확인한다.
  await page
    .getByText("회원", { exact: true })
    .first()
    .waitFor({ timeout: 30_000 });
}

/** 첫 방문 안내 오버레이가 시작 CTA를 가리거나 클릭을 가로채지 않게 닫는다. */
export async function dismissGuidedQuestIfPresent(page: Page) {
  const later = page.getByRole("button", { name: "나중에 보기" });
  // production start는 오버레이가 늦게 마운트될 수 있어 짧게 등장만 기다린다.
  const appeared = await later
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    return;
  }
  await later.click();
  await later
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => undefined);
}

export async function startTrialFromUi(page: Page) {
  await page.goto("/start");
  await dismissGuidedQuestIfPresent(page);
  const startResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/trial/start") &&
      response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /첫 채굴 시작/ }).click();
  const response = await startResponse;
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(
      `TRIAL_START_FAILED:${payload?.error?.code ?? "HTTP_" + response.status()}:${payload?.error?.message ?? "no-body"}`,
    );
  }
  // UI 스냅샷이 지연돼도 API 성공이면 통과. ACTIVE 문구는 가능하면 확인한다.
  // h1「첫 채굴이 진행 중이에요.」와 부분 일치하지 않도록 h2 exact name을 쓴다.
  await page.goto("/start");
  await dismissGuidedQuestIfPresent(page);
  const activeCopy = page.getByRole("heading", {
    level: 2,
    name: "채굴이 진행 중이에요",
    exact: true,
  });
  try {
    await activeCopy.waitFor({ timeout: 20_000 });
  } catch {
    const statusLocator = page
      .locator(
        "[data-start-stage-meta] strong, .product-mining-stage__meta strong",
      )
      .first();
    const status = (await statusLocator.textContent())?.trim();
    if (status !== "진행 중") {
      throw new Error(
        `TRIAL_START_UI_NOT_ACTIVE: status=${status ?? "none"} (API was ok)`,
      );
    }
  }
}

function redactConvertPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return String(payload);
  }
  const root = payload as {
    data?: { conversion?: Record<string, unknown> | null };
    error?: { code?: string; message?: string };
  };
  const conversion = root.data?.conversion;
  return JSON.stringify({
    topKeys: Object.keys(root),
    dataKeys:
      root.data && typeof root.data === "object"
        ? Object.keys(root.data)
        : null,
    conversionKeys:
      conversion && typeof conversion === "object"
        ? Object.keys(conversion)
        : null,
    conversionIdType: conversion ? typeof conversion.id : "missing",
    conversionStatus: conversion?.status ?? null,
    errorCode: root.error?.code ?? null,
    errorMessage: root.error?.message ?? null,
  });
}

export async function convertWelcomeFromUi(page: Page) {
  await page.goto("/start");
  await dismissGuidedQuestIfPresent(page);
  const memberVisible = await page
    .getByText("회원", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
  const convertButton = page.getByRole("button", {
    name: /환영 보상 자격 확인하기/,
  });
  await convertButton.waitFor({ timeout: 30_000 });
  const convertResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/trial/convert") &&
      response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await convertButton.click();
  const response = await convertResponse;
  const payload = (await response.json().catch(() => null)) as {
    data?: { conversion?: { id?: string; status?: string } | null };
    error?: { code?: string; message?: string };
  } | null;
  const shape = redactConvertPayload(payload);
  if (!response.ok) {
    throw new Error(
      `WELCOME_CONVERT_FAILED:status=${response.status()};authed=${memberVisible};${shape}`,
    );
  }
  if (
    !payload?.data?.conversion?.id ||
    payload.data.conversion.status !== "CONVERTED"
  ) {
    throw new Error(
      `WELCOME_CONVERT_UNEXPECTED_PAYLOAD:status=${response.status()};authed=${memberVisible};${shape}`,
    );
  }
  // 실제 느린 성공 경로: API 통과 후에도 DOM 성공 문구를 검증한다.
  await page
    .getByText(/실제 KRW 환영 보상으로 전환 완료/)
    .waitFor({ timeout: 60_000 });
}

/** Registers a destination through the same production route the UI form uses. */
export async function registerDestinationViaProductionApi(
  page: Page,
  body:
    | {
        method: "KRW_BANK";
        accountHolder: string;
        accountNumber: string;
        bankCode: string;
      }
    | {
        method: "USDT_ADDRESS";
        address: string;
        network: "TRC20" | "ERC20" | "BEP20";
      },
) {
  const response = await page.request.post("/api/v1/withdrawals/destinations", {
    data: body,
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: { destinationId?: string };
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.data?.destinationId) {
    throw new Error(
      payload?.error?.message ??
        `DESTINATION_REGISTER_FAILED:${response.status()}`,
    );
  }
  return payload.data.destinationId;
}

export async function requestWelcomeWithdrawalFromUi(
  page: Page,
  method: "KRW_BANK" | "USDT_ADDRESS",
) {
  await page.goto("/wallet/withdraw");
  await page.getByText("입금 없이도 가능한 첫 출금").waitFor();

  const radios = page.locator('input[name="welcomeMethod"]');
  if ((await radios.count()) > 0) {
    const value = method === "KRW_BANK" ? "KRW_BANK" : "USDT_ADDRESS";
    await page.locator(`input[name="welcomeMethod"][value="${value}"]`).check();
  }

  const requestButton = page.getByRole("button", {
    name: "입금 없이 첫 출금 요청",
    exact: true,
  });
  await requestButton.waitFor({ state: "visible" });
  await expect(requestButton).toBeEnabled({ timeout: 30_000 });
  await requestButton.click();
  // refresh 이후에도 안정적인 완료 신호는 disabled 완료 버튼이다.
  await page
    .getByRole("button", { name: "첫 출금 접수 완료" })
    .waitFor({ timeout: 60_000 });
}
