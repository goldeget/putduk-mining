import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "support-product");

const FORBIDDEN_COPY = [
  "휴대폰 인증",
  "SMS 인증",
  "USDT 잔액",
  "CHANNEL_TALK_MEMBER_HASH_SECRET",
  "coming soon",
];

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

async function applyTheme(
  page: Page,
  theme: "dark" | "light" | "system",
) {
  await page.emulateMedia({
    colorScheme: theme === "system" ? "light" : theme,
    reducedMotion: "reduce",
  });
  await page.evaluate((selected) => {
    if (selected === "system") {
      localStorage.setItem("putduk-theme", "system");
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = "light dark";
    } else {
      localStorage.setItem("putduk-theme", selected);
      document.documentElement.dataset.theme = selected;
      document.documentElement.style.colorScheme = selected;
    }
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  if (theme === "system") {
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  } else {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
}

test("anonymous support center stays usable without Channel Talk", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const external: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("channel.io") || url.includes("sentry-cdn.com")) {
      external.push(url);
    }
  });

  await page.goto("/support");
  await expect(
    page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
  ).toBeVisible();
  await expect(page.getByText("앱을 닫아도 채굴은 계속돼요.")).toBeVisible();
  await expect(
    page.getByText(
      "상담원은 비밀번호, 인증 코드, 개인키, 시드 문구를 요구하지 않아요.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("잔액과 출금은 상담 창에서 바뀌지 않아요."),
  ).toBeVisible();
  await expect(
    page.getByText("지금은 아래 안내를 먼저 확인해 주세요."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  const launcher = page.locator("#putduk-support-launcher");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("data-support-state", "unavailable");
  await expect(page.getByRole("button", { name: "상담 시작" })).toBeVisible();
  await waitForHydratedControls(page);

  const launcherBox = await launcher.boundingBox();
  const headingBox = await page
    .getByRole("heading", { name: "필요한 도움을 바로 확인해요." })
    .boundingBox();
  expect(launcherBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  if (launcherBox && headingBox) {
    const overlap = !(
      launcherBox.y + launcherBox.height <= headingBox.y ||
      headingBox.y + headingBox.height <= launcherBox.y ||
      launcherBox.x + launcherBox.width <= headingBox.x ||
      headingBox.x + headingBox.width <= launcherBox.x
    );
    expect(overlap).toBe(false);
  }

  await page.getByLabel("화면 테마").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("화면 테마").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(launcher).toBeVisible();
  expect(external).toEqual([]);
  const bodyText = await page.locator("body").innerText();
  for (const forbidden of FORBIDDEN_COPY) {
    expect(bodyText).not.toContain(forbidden);
  }
  expect(hydration).toEqual([]);
});

test("support route covers viewports, themes, keyboard, and recovery", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/support", { waitUntil: "domcontentloaded" });
    await waitForHydratedControls(page);
    await expect(
      page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
    ).toBeVisible();
    await expect(
      page.getByText("지금은 아래 안내를 먼저 확인해 주세요."),
    ).toBeVisible();

    const launcher = page.locator("#putduk-support-launcher");
    await expect(launcher).toHaveAttribute("data-support-state", "unavailable");
    await launcher.focus();
    await expect(launcher).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#support-guide")).toBeInViewport();

    await page.getByRole("link", { name: "로그인" }).focus();
    await expect(page.getByRole("link", { name: "로그인" })).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `support-unavailable-${viewport.name}-light.png`);

    await applyTheme(page, "dark");
    await expect(
      page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `support-unavailable-${viewport.name}-dark.png`);

    await applyTheme(page, "system");
    await expect(
      page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
    ).toBeVisible();
    await expect(page.getByLabel("화면 테마")).toHaveValue("system");
    await expectNoHorizontalOverflow(page);
    await shoot(page, `support-unavailable-${viewport.name}-system.png`);
  }

  expect(hydration).toEqual([]);
});

test("public admin aliases stay unavailable from support", async ({
  request,
}) => {
  test.setTimeout(180_000);
  for (const path of ["/admin", "/administrator", "/manage", "/backoffice"]) {
    const response = await request.get(path, {
      maxRedirects: 0,
      timeout: 60_000,
    });
    expect(response.status()).toBe(404);
  }
});
