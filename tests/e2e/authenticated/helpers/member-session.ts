import { expect, type Page } from "@playwright/test";

import type { ConfirmedMember } from "../../fixtures/local-auth";
import { expectSettledRoute } from "./settled-route";

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
  // Dedicated AI intentionally hides the account header. Check the current
  // authenticated presentation rather than hidden text from a prior route.
  if (nextPath === "/ai" || nextPath === "/menu/ai") {
    await expect(page.locator("[data-ai-page]:visible")).toHaveCount(1);
  } else if (nextPath.split(/[?#]/, 1)[0] === "/products") {
    await expectSettledRoute(page, "/products");
    const header = page.locator('[data-route-brand-header="products"]:visible');
    await expect(header).toHaveCount(1);
    const account = header.getByRole("link", {
      name: "내 계정 보기",
      exact: true,
    });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/menu/account");
    const navigation =
      (page.viewportSize()?.width ?? 1280) >= 980
        ? page.getByRole("navigation", { name: "상품 전체 메뉴", exact: true })
        : page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    await expect(
      navigation.getByRole("link", { name: "상품", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  } else if (nextPath.split(/[?#]/, 1)[0] === "/mining") {
    await expectSettledRoute(page, "/mining");
    const header = page.locator("[data-mining-header]:visible");
    await expect(header).toHaveCount(1);
    await expect(
      header.getByRole("link", { name: "내 계정 보기", exact: true }),
    ).toHaveAttribute("href", "/menu/account");
    await expect(
      header.getByRole("link", { name: "내 계정 보기", exact: true }),
    ).toBeVisible();
    const navigation =
      (page.viewportSize()?.width ?? 1280) >= 980
        ? header.getByRole("navigation", {
            name: "채굴 주요 메뉴",
            exact: true,
          })
        : page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    await expect(
      navigation.getByRole("link", { name: "채굴", exact: true }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "채굴", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  } else if (nextPath.split(/[?#]/, 1)[0] === "/menu") {
    await expectSettledRoute(page, "/menu");
    const desktop = (page.viewportSize()?.width ?? 1280) >= 980;
    const header = page.locator(
      desktop
        ? "[data-menu-header]:visible"
        : '[data-ui-ready="/menu"] > header [data-menu-mobile-tools="true"]:visible',
    );
    await expect(header).toHaveCount(1);
    const account = header.getByRole("link", {
      name: "내 계정 보기",
      exact: true,
    });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/menu/account");
    const navigation = desktop
      ? header.getByRole("navigation", {
          name: "더보기 주요 메뉴",
          exact: true,
        })
      : page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    const more = navigation.getByRole("link", { name: "더보기", exact: true });
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("aria-current", "page");
  } else if (nextPath.split(/[?#]/, 1)[0] === "/wallet") {
    await expectSettledRoute(page, "/wallet");
    const header = page.locator("[data-wallet-header]:visible");
    await expect(header).toHaveCount(1);
    const account = header.getByRole("link", {
      name: "내 계정 보기",
      exact: true,
    });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/menu/account");
    const navigation =
      (page.viewportSize()?.width ?? 1280) >= 980
        ? header.getByRole("navigation", {
            name: "지갑 주요 메뉴",
            exact: true,
          })
        : page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    const wallet = navigation.getByRole("link", { name: "지갑", exact: true });
    await expect(wallet).toBeVisible();
    await expect(wallet).toHaveAttribute("aria-current", "page");
  } else if (nextPath.split(/[?#]/, 1)[0] === "/home") {
    await expectSettledRoute(page, "/home");
    if ((page.viewportSize()?.width ?? 1280) >= 980) {
      const account = page.getByRole("link", {
        name: "내 계정 보기",
        exact: true,
      });
      await expect(account).toBeVisible();
      await expect(account).toHaveAttribute("href", "/menu/account");
    } else {
      await expect(
        page
          .getByRole("navigation", { name: "주요 메뉴", exact: true })
          .getByRole("link", { name: "홈", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  } else {
    await expect(
      page.locator(".product-header__identity:visible small"),
    ).toHaveText("회원", { timeout: 30_000 });
  }
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
  if (!response.ok()) {
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
    .locator(".product-header__identity:visible small")
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
  if (!response.ok()) {
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
  if (!response.ok() || !payload?.data?.destinationId) {
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
  // 제목은 이미 하나여도 hidden S: 슬롯의 라디오는 남아 strict check가 바로 실패한다.
  const route = await expectSettledRoute(page, "/wallet/withdraw");
  const welcomeHeading = route.getByRole("heading", {
    level: 2,
    name: "입금 없이도 가능한 첫 출금",
  });
  await expect(welcomeHeading).toHaveCount(1);
  await expect(welcomeHeading).toBeVisible();

  const value = method === "KRW_BANK" ? "KRW_BANK" : "USDT_ADDRESS";
  const radio = page.locator(`input[name="welcomeMethod"][value="${value}"]`);
  await expect.poll(async () => radio.count()).toBeLessThanOrEqual(1);
  if ((await radio.count()) === 1) {
    await expect(radio).toHaveCount(1);
    await radio.check();
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
