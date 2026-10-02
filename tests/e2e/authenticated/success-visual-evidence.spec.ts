import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { prepareMemberThroughStart } from "./helpers/journey";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "834", width: 834, height: 1112 },
  { name: "1440", width: 1440, height: 900 },
] as const;

const THEMES = ["dark", "light"] as const;

const OUTPUT_DIR = path.join("test-results", "success-visual");

type Shot = {
  audience: "user" | "admin";
  route: string;
  viewport: string;
  theme: string;
  state: "success";
  file: string;
};

const shots: Shot[] = [];

function isHydrationMismatch(text: string) {
  return (
    text.includes("react.dev/link/hydration-mismatch") ||
    text.includes("hydration-mismatch") ||
    text.includes("Hydration failed because") ||
    text.includes("A tree hydrated but some attributes") ||
    /Text content did not match/i.test(text)
  );
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
      const settled = (node: Element) => {
        let current: Element | null = node;
        while (current) {
          if (hydrated(current)) return true;
          current = current.parentElement;
        }
        return false;
      };
      // Playwright caret:hide 가 바꾸는 요소와 같다.
      const targets = Array.from(
        document.querySelectorAll("input, textarea, [contenteditable]"),
      );
      if (targets.length > 0) {
        return targets.every(settled);
      }
      const main = document.querySelector("main") ?? document.body;
      if (hydrated(main)) return true;
      return Array.from(main.querySelectorAll("*")).some(hydrated);
    },
    undefined,
    { timeout: 60_000 },
  );
}

function shotName(
  audience: Shot["audience"],
  route: string,
  viewport: string,
  theme: string,
) {
  return `${audience}-${route}-${viewport}-${theme}-success.png`;
}

async function captureSuccess(
  page: Page,
  input: {
    audience: Shot["audience"];
    route: string;
    url: string;
    viewport: (typeof VIEWPORTS)[number];
    theme: (typeof THEMES)[number];
    ready: RegExp | string;
  },
) {
  await page.setViewportSize({
    width: input.viewport.width,
    height: input.viewport.height,
  });
  await page.emulateMedia({
    colorScheme: input.theme,
    reducedMotion: "reduce",
  });
  await page.goto(input.url, { waitUntil: "domcontentloaded" });
  await page.evaluate((theme) => {
    localStorage.setItem("putduk-theme", theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, input.theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(input.ready).first()).toBeVisible({
    timeout: 60_000,
  });
  await waitForHydratedControls(page);
  const fileName = shotName(
    input.audience,
    input.route,
    input.viewport.name,
    input.theme,
  );
  const file = path.join(OUTPUT_DIR, fileName);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  // 기본 caret:hide 는 input 에 caret-color:transparent 를 넣는다.
  // 개발 빌드 hydration 이 그 변경을 mismatch 로 기록하므로, 증거 캡처는 caret 를 바꾸지 않는다.
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    fullPage: true,
    path: file,
  });
  shots.push({
    audience: input.audience,
    route: input.route,
    viewport: input.viewport.name,
    theme: input.theme,
    state: "success",
    file: fileName,
  });
}

test.describe("authenticated success visual evidence", () => {
  test("captures user and admin success screens for the visual lab matrix", async ({
    page,
    browser,
  }) => {
    test.setTimeout(600_000);
    const hydration: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (isHydrationMismatch(text)) {
        hydration.push(text);
      }
    });
    await prepareMemberThroughStart(page, "ws05-visual");

    const userScreens = [
      {
        route: "home",
        url: "/home",
        ready: "오늘의 채굴 상태를 확인해요.",
      },
      {
        route: "start",
        url: "/start",
        ready: /실제 KRW 환영 보상으로 전환 완료/,
      },
      {
        route: "wallet",
        url: "/wallet",
        ready: "출금 가능 잔액",
      },
      {
        route: "wallet-withdraw",
        url: "/wallet/withdraw",
        ready: "입금 없이도 가능한 첫 출금",
      },
    ] as const;

    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        for (const screen of userScreens) {
          await captureSuccess(page, {
            audience: "user",
            route: screen.route,
            url: screen.url,
            viewport,
            theme,
            ready: screen.ready,
          });
        }
      }
    }

    const operator = await createConfirmedMember("ws05-visual-admin");
    await grantAdminRole(operator.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    try {
      await completeAdminLoginWithTotp(
        adminPage,
        operator.email,
        operator.password,
      );
      await expect(adminPage.getByText("오늘의 퍼뜩").first()).toBeVisible({
        timeout: 60_000,
      });

      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          await captureSuccess(adminPage, {
            audience: "admin",
            route: "today",
            url: `${ADMIN_ORIGIN}/`,
            viewport,
            theme,
            ready: "오늘의 퍼뜩",
          });
        }
      }
    } finally {
      await adminContext.close();
    }

    writeFileSync(
      path.join(OUTPUT_DIR, "manifest.json"),
      `${JSON.stringify(
        {
          benchmark: "docs/design/visual-lab",
          benchmarkId: "visual-lab-2026.09.27-v1",
          productComplete: false,
          note: "파일명만으로 성공 상태를 식별한다. Visual Lab과 맞춘 수동 비교 전에는 PRODUCT COMPLETE가 아니다.",
          shots,
        },
        null,
        2,
      )}\n`,
    );
    expect(shots).toHaveLength(30);
    expect(hydration).toEqual([]);
  });
});
