import { expect, test } from "@playwright/test";

import { prepareMemberThroughStart } from "./helpers/journey";
import { expectSettledRoute } from "./helpers/settled-route";

test.describe("지갑 제품 읽기 화면", () => {
  test("지갑 화면은 읽기 모델과 hydration 안정성을 유지한다", async ({
    page,
  }) => {
    const hydration: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.toLowerCase().includes("hydration")) {
        hydration.push(text);
      }
    });

    await prepareMemberThroughStart(page, "wallet-product-read");
    hydration.length = 0;

    await page.goto("/wallet");
    await expect(
      page.getByRole("heading", {
        name: "지갑",
        exact: true,
        level: 1,
      }),
    ).toBeVisible({
      timeout: 60_000,
    });
    // hidden id="S:*"가 같은 지갑 라벨을 복제한다. 정착된 지갑 안에서만 하나이고 보여야 한다.
    const wallet = await expectSettledRoute(page, "/wallet");
    const krwWallet = wallet.getByLabel("실제 KRW 지갑");
    await expect(krwWallet).toHaveCount(1);
    await expect(krwWallet).toBeVisible();

    const ledgerHistory = page.getByRole("region", {
      name: "최근 거래 내역",
      exact: true,
    });
    await expect(
      ledgerHistory.getByRole("heading", {
        name: "최근 거래 내역",
        exact: true,
        level: 2,
      }),
    ).toBeVisible();

    // empty StatePanel h2 includes this substring — use exact + region, not UI change
    const receipts = page.getByRole("region", {
      name: "입출금 처리 내역",
      exact: true,
    });
    await expect(
      receipts.getByRole("heading", {
        name: "입출금 처리 내역",
        exact: true,
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      receipts.getByRole("heading", {
        name: "아직 입출금 처리 내역이 없어요",
        exact: true,
        level: 2,
      }),
    ).toBeVisible();

    await expect(page.getByRole("link", { name: "출금하기" })).toHaveAttribute(
      "href",
      "/wallet/withdraw",
    );
    await expect(page.getByRole("link", { name: "입금하기" })).toHaveAttribute(
      "href",
      "/wallet/deposit",
    );
    await expect(page.getByText(/USDT\s*잔액|내 USDT|USDT 잔고/)).toHaveCount(
      0,
    );

    for (const width of [390, 834, 1440] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("heading", {
          name: "지갑",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
    }

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(
        page.getByRole("heading", {
          name: "지갑",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
    }

    expect(hydration).toEqual([]);
  });
});
