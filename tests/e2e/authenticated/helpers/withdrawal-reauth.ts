import { expect, type Page } from "@playwright/test";

export type ReauthDestination =
  | {
      method: "KRW_BANK";
      bankCode: string;
      accountHolder: string;
      accountNumber: string;
    }
  | {
      method: "USDT_ADDRESS";
      network: "TRC20" | "ERC20" | "BEP20";
      address: string;
    };

/** Real password/MFA provider route. Never seed a VERIFIED proof in browser QA. */
export async function reauthenticateDestination(
  page: Page,
  destination: ReauthDestination,
  password: string,
  totpCode?: string,
) {
  const response = await page.request.post(
    "/api/v1/withdrawals/destinations/reauth",
    {
      data: { destination, password, ...(totpCode ? { totpCode } : {}) },
    },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json();
  expect(typeof payload.data.token).toBe("string");
  // Do not include the transient credential/proof in failure messages or evidence.
  expect(/^[A-Za-z0-9_-]{43}$/.test(payload.data.token)).toBe(true);
  expect(Date.parse(payload.data.expiresAt) > Date.now()).toBe(true);
  return payload.data.token as string;
}
