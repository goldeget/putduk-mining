import type { Page } from "@playwright/test";

import type { ConfirmedMember } from "../../fixtures/local-auth";

export async function loginAsMember(
  page: Page,
  member: ConfirmedMember,
  nextPath = "/home",
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await page.getByLabel("아이디 또는 복구 이메일").fill(member.email);
  await page.getByLabel("비밀번호").fill(member.password);
  await page.getByRole("button", { name: /^로그인$/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
}

export async function startTrialFromUi(page: Page) {
  await page.goto("/start");
  await page.getByRole("button", { name: /첫 채굴 시작/ }).click();
  await page.getByText("채굴이 진행 중이에요").waitFor({ timeout: 60_000 });
}

export async function convertWelcomeFromUi(page: Page) {
  await page.goto("/start");
  await page.getByRole("button", { name: /환영 보상 자격 확인하기/ }).click();
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

  await page.getByRole("button", { name: /입금 없이 첫 출금 요청/ }).click();
  await page
    .getByText(/첫 출금 요청을 접수했어요|첫 출금 접수 완료/)
    .waitFor({ timeout: 60_000 });
}
