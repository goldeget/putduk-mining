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
  const fileName = shotName(
    input.audience,
    input.route,
    input.viewport.name,
    input.theme,
  );
  const file = path.join(OUTPUT_DIR, fileName);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: "disabled",
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
  }) => {
    test.setTimeout(600_000);
    await prepareMemberThroughStart(page, "ws05-visual");

    const userScreens = [
      {
        route: "home",
        url: "/home",
        ready: "오늘도 채굴이 이어지고 있어요.",
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
    await completeAdminLoginWithTotp(page, operator.email, operator.password);
    await expect(page.getByText("오늘의 퍼뜩").first()).toBeVisible({
      timeout: 60_000,
    });

    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        await captureSuccess(page, {
          audience: "admin",
          route: "today",
          url: `${ADMIN_ORIGIN}/`,
          viewport,
          theme,
          ready: "오늘의 퍼뜩",
        });
      }
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
  });
});
