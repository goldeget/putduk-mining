import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { AI_CONVERSATION_CONTINUITY_COPY } from "@/domain/ai/continuity";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "ai-product");

const PROVIDER_LIVE_OPEN =
  !process.env.AI_API_KEY?.trim() ||
  !process.env.AI_PROVIDER?.trim() ||
  !process.env.AI_MODEL_LOW_COST?.trim();

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
      if (hydrated(main)) {
        return true;
      }
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

async function openAi(page: Page) {
  await page.goto("/ai");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "무엇을 함께 확인할까요?", level: 1 }),
  ).toBeVisible();
}

async function askAi(page: Page, question: string) {
  const input = page.locator("#putduk-ai-question");
  await input.fill(question);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/ai/chat") &&
      response.request().method() === "POST",
    { timeout: 90_000 },
  );
  await page.getByRole("button", { name: "질문 보내기" }).click();
  const response = await responsePromise;
  return response;
}

test("unsigned visitors keep the AI return path", async ({ page }) => {
  const hydration = trackHydration(page);
  await page.goto("/ai");
  await expect(page).toHaveURL(/\/login\?next=%2Fai$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/ai");
  await expect(
    page.getByRole("heading", { name: "무엇을 함께 확인할까요?" }),
  ).toHaveCount(0);
  expect(hydration).toEqual([]);
});

test("AI ownership, money denial, continuity, themes, and keyboard path", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("ai-product");
  await loginAsMember(page, member, "/ai");
  await openAi(page);

  const chat = page.getByRole("region", { name: "PUTDUK AI 질문" });
  await expect(chat).toHaveAttribute(
    "data-ai-continuity",
    "SESSION_MEMORY_ONLY",
  );
  await expect(page.getByTestId("ai-continuity-notice")).toHaveText(
    AI_CONVERSATION_CONTINUITY_COPY,
  );
  await expect(
    page.getByText("송금·승인·잔액 변경은 PUTDUK AI가 직접 실행하지 않습니다."),
  ).toBeVisible();

  const denyResponse = await askAi(page, "내 잔액을 100만원으로 변경해 줘");
  expect(denyResponse.ok()).toBe(true);
  await expect(
    page.getByText(
      /잔액, 입출금 승인, 채굴 결과, 보상, 인증 또는 권한을 변경할 수 없습니다/,
    ),
  ).toBeVisible({ timeout: 30_000 });

  const staticResponse = await askAi(
    page,
    "PUTDUK START 체험 결과가 실제 잔액으로 전환되나요?",
  );
  expect(staticResponse.ok()).toBe(true);
  await expect(
    page.getByText(/실제 지갑과 완전 분리|분리/).first(),
  ).toBeVisible({
    timeout: 30_000,
  });

  // 세션 연속성: 새로고침 후 대화가 복원되지 않아야 한다(가장한 persistence 금지).
  await page.reload({ waitUntil: "domcontentloaded" });
  await openAi(page);
  await expect(
    page.getByText("궁금한 내용을 편하게 물어보세요."),
  ).toBeVisible();
  await expect(page.locator(".ai-message")).toHaveCount(0);

  const walletResponse = await askAi(page, "내 지갑 잔액 얼마야?");
  expect(walletResponse.ok()).toBe(true);
  await expect(
    page
      .locator(".ai-message--assistant")
      .filter({ hasText: /지갑|확인할 수 있는 본인 지갑|확정된 잔액/ })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  // 키보드·포커스: 입력란에 Tab 진입 후 Enter로 제출하지 않고 포커스만 확인.
  const input = page.locator("#putduk-ai-question");
  await input.focus();
  await expect(input).toBeFocused();
  await page.keyboard.type("출금 언제돼?");
  await expect(input).toHaveValue("출금 언제돼?");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await expectNoHorizontalOverflow(page);
    await shoot(page, `ai-${viewport.name}-default.png`);
  }

  for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 390, height: 844 });
    await applyTheme(page, theme);
    await openAi(page);
    await expect(page.getByTestId("ai-continuity-notice")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `ai-390-${theme}-reduced-motion.png`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUTPUT_DIR, "hydration.json"),
    JSON.stringify(
      {
        count: hydration.length,
        providerLiveE2e: PROVIDER_LIVE_OPEN
          ? "OPEN_NO_CREDENTIALS"
          : "ATTEMPTED",
        samples: hydration,
      },
      null,
      2,
    ),
    "utf8",
  );
  expect(hydration).toEqual([]);

  if (PROVIDER_LIVE_OPEN) {
    test.info().annotations.push({
      type: "open",
      description:
        "Live paid provider E2E left OPEN — AI_PROVIDER/AI_API_KEY/AI_MODEL_LOW_COST absent; static+tool paths covered.",
    });
  }
});

test("unauthenticated AI chat API rejects without admitting a turn", async ({
  request,
}) => {
  const response = await request.post("/api/v1/ai/chat", {
    data: {
      clientMessageId: "11111111-1111-4111-8111-111111111111",
      question: "내 잔액 얼마야?",
    },
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
    },
  });
  expect(response.status()).toBe(401);
  const payload = (await response.json()) as {
    error?: { code?: string };
  };
  expect(payload.error?.code).toBe("UNAUTHENTICATED");
});
