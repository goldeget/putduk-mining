import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { awaitPaintedImages } from "./helpers/painted-images";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const widths = [320, 390, 834, 1440] as const;
const themes = ["dark", "light"] as const;

async function expectPaintedCopyFits(
  root: Locator,
  selector: string,
  container: string,
) {
  const results = await root.evaluate(
    (element, { selector, container }) =>
      [...element.querySelectorAll(selector)].map((copy) => {
        const card = copy.closest(container);
        if (!card) return { fits: false, kind: copy.tagName };
        const bounds = card.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(copy);
        const fragments = [...range.getClientRects()].filter(
          (box) => box.width > 0 && box.height > 0,
        );
        return {
          kind: copy.tagName,
          fits:
            fragments.length > 0 &&
            fragments.every(
              (box) =>
                box.left >= bounds.left - 1 &&
                box.right <= bounds.right + 1 &&
                box.top >= bounds.top - 1 &&
                box.bottom <= bounds.bottom + 1,
            ),
        };
      }),
    { selector, container },
  );
  expect(results.length).toBeGreaterThan(0);
  expect(results.filter((copy) => !copy.fits)).toEqual([]);
}

type Reference = {
  reference_id: string;
  sha256: string;
  route_mapping: string[];
  classification: { viewport: string; theme: string; screen_type: string };
};

async function paintedTextLineCounts(root: Locator, selector: string) {
  return root.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const tops = new Set<number>();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top));
        }
      }
      return tops.size;
    }),
  );
}

async function expectOpaqueTextContrast(copy: Locator) {
  const contrast = await copy.evaluate((element) => {
    const style = getComputedStyle(element);
    function rgba(value: string) {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      const [r, g, b, alpha = 1] = values;
      if (r === undefined || g === undefined || b === undefined) {
        throw new Error("PAINTED_RGB_COLOR_REQUIRED");
      }
      const linear = [r, g, b].map((channel) => {
        const scaled = channel / 255;
        return scaled <= 0.04045
          ? scaled / 12.92
          : ((scaled + 0.055) / 1.055) ** 2.4;
      });
      const [red = 0, green = 0, blue = 0] = linear;
      return {
        alpha,
        luminance: red * 0.2126 + green * 0.7152 + blue * 0.0722,
      };
    }
    const foreground = rgba(style.color);
    const background = rgba(style.backgroundColor);
    const bright = Math.max(foreground.luminance, background.luminance);
    const dark = Math.min(foreground.luminance, background.luminance);
    return {
      opaque:
        foreground.alpha === 1 &&
        background.alpha === 1 &&
        style.opacity === "1",
      ratio: (bright + 0.05) / (dark + 0.05),
    };
  });
  expect(contrast.opaque).toBe(true);
  expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
}

async function sourceReferences() {
  const index = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "docs/design/mockup-source-index-2026-10-06.json",
      ),
      "utf8",
    ),
  ) as { images: Reference[] };
  expect(index.images).toHaveLength(52);
  expect(new Set(index.images.map((image) => image.sha256)).size).toBe(45);
  expect(
    index.images.every(
      (image) =>
        image.route_mapping.length > 0 &&
        image.classification.screen_type !== "unreviewed",
    ),
  ).toBe(true);
  return index.images;
}

async function captureRoutes(
  page: Page,
  testInfo: TestInfo,
  routes: string[],
  references: Reference[],
) {
  const records = [];
  const errors: string[] = [];
  const cancelledPrefetches: { path: string; error: string }[] = [];
  const ownedOrigin = new URL(
    testInfo.project.use.baseURL ??
      `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
  ).origin;
  page.on("pageerror", (error) => errors.push(`page:${error.name}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console:error");
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const error = request.failure()?.errorText ?? "unknown";
    // Only an observed same-origin Next GET prefetch cancellation is expected.
    // Failed documents, API calls, assets and unknown aborts stay fatal.
    if (
      error === "net::ERR_ABORTED" &&
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      !request.isNavigationRequest() &&
      request.headers()["next-router-prefetch"] === "1" &&
      url.origin === ownedOrigin &&
      !url.pathname.startsWith("/api/")
    )
      cancelledPrefetches.push({ path: url.pathname, error });
    else errors.push(`network:${url.pathname}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(
        `http:${response.status()}:${new URL(response.url()).pathname}`,
      );
  });
  await page.goto(routes[0]!, { waitUntil: "networkidle" });
  for (const route of routes) {
    const routeWidths = [
      "/mining",
      "/wallet",
      "/signup",
      "/products",
      "/menu",
      "/ai",
    ].includes(route)
      ? [320, 360, 375, 390, 834, 1440, 1920]
      : route === "/login"
        ? [...widths, 1920]
        : widths;
    for (const width of routeWidths) {
      for (const theme of themes) {
        await page.evaluate((value) => {
          localStorage.setItem("putduk-theme", value);
        }, theme);
        // Configure the next capture on a blank document. Resizing the previous
        // route starts responsive image requests that the immediate navigation
        // would cancel; retain strict failures for the actual rendered route.
        await page.goto("about:blank");
        await page.setViewportSize({
          width,
          height: width === 834 ? 1112 : 900,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        const response = await page.goto(route, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL((url) => url.pathname === route);
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await main.evaluate((element) =>
          element.scrollTo({ top: 0, behavior: "instant" }),
        );
        const ready = page.locator(`[data-ui-ready="${route}"]`);
        await expect(ready).toHaveCount(1);
        await expect(ready).toBeVisible();
        for (const textScale of [
          "/login",
          "/signup",
          "/mining",
          "/wallet",
          "/products",
          "/menu",
          "/ai",
        ].includes(route) &&
        (["/mining", "/wallet"].includes(route) ||
          [390, 1440].includes(width) ||
          (route === "/signup" && width === 320))
          ? [1, 2]
          : [1]) {
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = scale === 2 ? "200%" : "";
          }, textScale);
          await main.evaluate((element) =>
            element.scrollTo({ top: 0, behavior: "instant" }),
          );
          await page.evaluate(() => document.fonts.ready);
          await expect
            .poll(() =>
              page.evaluate(() => {
                const main = document.querySelector("main");
                return (
                  document.documentElement.scrollWidth <= innerWidth + 1 &&
                  main !== null &&
                  main.scrollWidth <= main.clientWidth + 1
                );
              }),
            )
            .toBe(true);
          expect(
            await page.evaluate(() => /[가-힣]/.test(document.body.innerText)),
          ).toBe(true);
          await expect
            .poll(() =>
              page.evaluate(() =>
                [...document.images]
                  .filter((image) => image.getBoundingClientRect().width > 0)
                  .every((image) => image.complete && image.naturalWidth > 0),
              ),
            )
            .toBe(true);
          expect(errors).toEqual([]);
          if (route === "/login") {
            const form = page.getByRole("form", { name: "계정 로그인" });
            await expect(form).toBeVisible();
            await expect(
              page.getByRole("heading", { name: "로그인", exact: true }),
            ).toHaveCount(1);
            await expect(
              form.getByLabel("아이디 또는 복구 이메일", { exact: true }),
            ).toBeVisible();
            const password = form.locator('input[name="password"]');
            await expect(password).toHaveAttribute(
              "autocomplete",
              "current-password",
            );
            await expect(password).toHaveAttribute("type", "password");
            const toggle = form.getByRole("button", {
              name: "비밀번호 보기",
              exact: true,
            });
            await toggle.focus();
            await expect(toggle).toBeFocused();
            await toggle.press("Enter");
            await expect(password).toHaveAttribute("type", "text");
            await form
              .getByRole("button", { name: "비밀번호 숨기기", exact: true })
              .click();
            await expect(password).toHaveAttribute("type", "password");
            const help = form.locator("summary");
            await help.focus();
            await help.press("Enter");
            await expect(form.locator("details")).toHaveAttribute("open", "");
            await expect(
              form.getByRole("link", { name: "고객지원 보기" }),
            ).toHaveAttribute("href", "/support");
            await help.press("Enter");
            await expect(form.locator("details")).not.toHaveAttribute(
              "open",
              "",
            );
            await help.evaluate((element: HTMLElement) => element.blur());
            await expect(
              form.getByRole("link", { name: "회원가입", exact: true }),
            ).toHaveAttribute("href", "/signup");
            await expect(
              form.getByRole("link", { name: "아이디 찾기", exact: true }),
            ).toHaveAttribute("href", "/find-id");
            await expect(
              form.getByRole("link", { name: "비밀번호 재설정", exact: true }),
            ).toHaveAttribute("href", "/recover");
            for (const control of [
              toggle,
              form.getByRole("button", { name: "로그인", exact: true }),
              form.getByRole("link", { name: "회원가입", exact: true }),
            ]) {
              const box = await control.boundingBox();
              expect(box?.height).toBeGreaterThanOrEqual(44);
            }
            const scene = page.locator("picture[data-login-art-theme]");
            await expect(scene).toHaveAttribute("data-login-art-theme", theme);
            const expectedFamily =
              theme === "light"
                ? "login-semiconductor-light"
                : width < 1100
                  ? "login-wafer-dark"
                  : "login-semiconductor-dark";
            expect(
              await scene
                .locator("img")
                .evaluate((image: HTMLImageElement) => image.currentSrc),
            ).toContain(`/brand/scenes/${expectedFamily}/`);
            await main.evaluate((element) =>
              element.scrollTo({ top: 0, behavior: "instant" }),
            );
            await page.evaluate(() => window.scrollTo(0, 0));
          }
          if (route === "/signup") {
            const form = ready.getByRole("form", {
              name: "회원가입",
              exact: true,
            });
            await expect(form).toBeVisible();
            await expect(
              ready.getByRole("heading", {
                level: 1,
                name: "회원가입",
                exact: true,
              }),
            ).toHaveCount(1);
            for (const [id, name, type] of [
              ["signup-legal-name", "legalName", "text"],
              ["signup-date-of-birth", "dateOfBirth", "date"],
              ["signup-login-id", "loginId", "text"],
              ["signup-recovery-email", "recoveryEmail", "email"],
              ["signup-phone", "phone", "tel"],
            ] as const) {
              const field = form.locator(`#${id}`);
              await expect(field).toHaveAttribute("name", name);
              await expect(field).toHaveAttribute("type", type);
              await expect(field).toHaveAttribute("required", "");
            }
            for (const id of [
              "signup-password",
              "signup-password-confirmation",
            ] as const) {
              const field = form.locator(`#${id}`);
              const toggle = form.locator(`button[aria-controls="${id}"]`);
              await expect(field).toHaveAttribute("minlength", "10");
              await expect(field).toHaveAttribute(
                "autocomplete",
                "new-password",
              );
              await toggle.focus();
              await toggle.press("Enter");
              await expect(field).toHaveAttribute("type", "text");
              await expect(toggle).toHaveAttribute("aria-pressed", "true");
              await toggle.press("Enter");
              await expect(field).toHaveAttribute("type", "password");
              await expect(toggle).toHaveAttribute("aria-pressed", "false");
              expect(
                (await toggle.boundingBox())?.height,
              ).toBeGreaterThanOrEqual(44);
              await toggle.evaluate((element: HTMLButtonElement) =>
                element.blur(),
              );
            }
            const all = form.locator("#consent-all");
            await all.check();
            for (const id of [
              "consent-service",
              "consent-privacy",
              "consent-marketing",
            ]) {
              await expect(form.locator(`#${id}`)).toBeChecked();
            }
            await form.locator("#consent-marketing").uncheck();
            await expect(form.locator("#consent-service")).toBeChecked();
            await expect(form.locator("#consent-privacy")).toBeChecked();
            await expect(form.locator("#consent-marketing")).not.toBeChecked();
            await all.check();
            await all.uncheck();
            const consent = form.locator("#signup-service-terms");
            const summary = consent.locator("summary");
            await summary.focus();
            await summary.press("Enter");
            await expect(consent).toHaveAttribute("open", "");
            await expect(consent.locator("p")).toContainText(
              "체험 값은 실제 자산이 아닙니다.",
            );
            await summary.press("Enter");
            await expect(consent).not.toHaveAttribute("open", "");
            await summary.evaluate((element: HTMLElement) => element.blur());
            const scene = ready.locator("[data-signup-art-theme]");
            await expect(scene).toHaveAttribute("data-signup-art-theme", theme);
            await expect(scene).toHaveAttribute(
              "data-signup-art-state",
              "ready",
            );
            const expectedFamily =
              theme === "light"
                ? "login-semiconductor-light"
                : width < 700
                  ? "signup-semiconductor-mobile-dark"
                  : "login-semiconductor-dark";
            expect(
              await scene
                .locator("img")
                .evaluate((image: HTMLImageElement) => image.currentSrc),
            ).toContain(`/brand/scenes/${expectedFamily}/`);
            await main.evaluate((element) =>
              element.scrollTo({ top: 0, behavior: "instant" }),
            );
            await page.evaluate(() => window.scrollTo(0, 0));
          }
          if (route === "/mining") {
            const hero = ready.getByRole("region", {
              name: "현재 채굴 현황",
              exact: true,
            });
            await expectPaintedCopyFits(hero, "header > p", "header");
            const captionLines = await paintedTextLineCounts(
              hero,
              "header > p",
            );
            expect(captionLines).toHaveLength(1);
            expect(captionLines[0]).toBeGreaterThan(0);
            expect(captionLines[0]).toBeLessThanOrEqual(3);
            if (theme === "light") {
              await expectOpaqueTextContrast(hero.locator("header > p"));
            }
            const dock = page.locator("[data-ai-dock]:visible");
            await expect(dock).toHaveCount(1);
            await expectPaintedCopyFits(dock, "a, button", "[data-ai-dock]");
            const dockControls = await dock.evaluate((element) =>
              [...element.querySelectorAll("a, button")].map((control) => {
                const box = control.getBoundingClientRect();
                const center = document.elementFromPoint(
                  box.left + box.width / 2,
                  box.top + box.height / 2,
                );
                return {
                  visible:
                    box.left >= -1 &&
                    box.right <= innerWidth + 1 &&
                    box.top >= -1 &&
                    box.bottom <= innerHeight + 1,
                  reachable: Boolean(
                    center && (center === control || control.contains(center)),
                  ),
                  touchHeight: box.height >= 44,
                };
              }),
            );
            expect(dockControls).toHaveLength(2);
            expect(
              dockControls.every(
                (control) =>
                  control.visible && control.reachable && control.touchHeight,
              ),
            ).toBe(true);
            const facts = ready
              .locator('section[aria-label="채굴 현황"] > dl')
              .first();
            await expect(facts.locator(":scope > div")).toHaveCount(2);
            // Full Korean labels and exact server amounts must stay inside
            // their own cards when text grows; scrollWidth misses painted text.
            await expectPaintedCopyFits(facts, "dt > span, dd", "dl > div");
            const tierCopy = ready.getByText("확인된 채굴 원금 기준", {
              exact: true,
            });
            const tier = tierCopy.locator("..").locator("..");
            await expectPaintedCopyFits(tier, "span, strong, small", "div");
            const tierLines = await tierCopy.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return new Set(
                [...range.getClientRects()]
                  .filter((rect) => rect.width > 0 && rect.height > 0)
                  .map((rect) => Math.round(rect.top)),
              ).size;
            });
            expect(tierLines).toBeLessThanOrEqual(3);
            const narrowFactLines = await ready
              .locator(
                '[aria-labelledby="mining-capacity-title"] dl > div:not(:first-child) dd, [data-amount-weight="speed"] dd',
              )
              .evaluateAll((values) =>
                values.map((value) => {
                  const walker = document.createTreeWalker(
                    value,
                    NodeFilter.SHOW_TEXT,
                  );
                  const tops = new Set<number>();
                  for (
                    let node = walker.nextNode();
                    node;
                    node = walker.nextNode()
                  ) {
                    if (!node.textContent?.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    for (const rect of range.getClientRects()) {
                      if (rect.width > 0 && rect.height > 0)
                        tops.add(Math.round(rect.top));
                    }
                  }
                  return tops.size;
                }),
              );
            const trialRecovery = ready.getByRole("group", {
              name: "START 상태 다시 확인",
              exact: true,
            });
            const trialRetry = trialRecovery.getByRole("button", {
              name: "다시 확인",
              exact: true,
            });
            await expectPaintedCopyFits(trialRecovery, "button", "button");
            const retryLines = await trialRetry.evaluate((button) => {
              const walker = document.createTreeWalker(
                button,
                NodeFilter.SHOW_TEXT,
              );
              const tops = new Set<number>();
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                if (!node.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rect of range.getClientRects()) {
                  if (rect.width > 0 && rect.height > 0)
                    tops.add(Math.round(rect.top));
                }
              }
              return tops.size;
            });
            expect(retryLines).toBeGreaterThan(0);
            expect(retryLines).toBeLessThanOrEqual(2);
            expect(
              (await trialRetry.boundingBox())?.height,
            ).toBeGreaterThanOrEqual(44);
            const guide = ready.getByRole("link", {
              name: /채굴과 지갑 안내/,
            });
            await expect(guide).toHaveAttribute("href", "/how-it-works");
            await expectPaintedCopyFits(guide, "strong, small", "a");
            const guideLines = await guide.evaluate((element) =>
              [...element.querySelectorAll("strong, small")].map((copy) => {
                const walker = document.createTreeWalker(
                  copy,
                  NodeFilter.SHOW_TEXT,
                );
                const tops = new Set<number>();
                for (
                  let node = walker.nextNode();
                  node;
                  node = walker.nextNode()
                ) {
                  if (!node.textContent?.trim()) continue;
                  const range = document.createRange();
                  range.selectNodeContents(node);
                  for (const rect of range.getClientRects()) {
                    if (rect.width > 0 && rect.height > 0)
                      tops.add(Math.round(rect.top));
                  }
                }
                return tops.size;
              }),
            );
            expect(guideLines).toHaveLength(2);
            expect(guideLines[0]).toBeGreaterThan(0);
            expect(guideLines[0]).toBeLessThanOrEqual(2);
            expect(guideLines[1]).toBeGreaterThan(0);
            expect(guideLines[1]).toBeLessThanOrEqual(3);
            const detailFacts = ready.locator('dl[aria-label="채굴 기간"]');
            await expectPaintedCopyFits(detailFacts, "dt, dd", "div");
            const detailLines = await paintedTextLineCounts(
              detailFacts,
              "dt, dd",
            );
            expect(detailLines).toHaveLength(8);
            for (const lines of detailLines) {
              expect(lines).toBeGreaterThan(0);
              expect(lines).toBeLessThanOrEqual(2);
            }
            expect(narrowFactLines).toHaveLength(3);
            for (const lines of narrowFactLines) {
              expect(lines).toBeGreaterThan(0);
              expect(lines).toBeLessThanOrEqual(2);
            }
            const tierLink = tier.getByRole("link", { name: "채굴 상품 보기" });
            await expect(tierLink).toHaveAttribute("href", "/products");
            expect(
              (await tierLink.boundingBox())?.height,
            ).toBeGreaterThanOrEqual(44);
            if (width >= 980) {
              const sidebar = page.locator("aside.product-sidebar:visible");
              await expectPaintedCopyFits(
                sidebar,
                ".brand-lockup strong, .brand-lockup small, nav a > span",
                "a",
              );
            }
            const scene = ready.locator("[data-scene-theme]");
            await expect(scene).toHaveCount(1);
            await expect(scene).toHaveAttribute("data-scene-theme", theme);
            await expect(scene).toHaveAttribute("data-scene-art", "ready");
            await expect(scene).toHaveAttribute("data-motion", "static");
            const expectedFamily =
              theme === "light"
                ? width < 700
                  ? "mining-semiconductor-mobile-light"
                  : "mining-semiconductor-desktop-light"
                : width < 700
                  ? "mining-semiconductor-mobile-dark"
                  : "mining-semiconductor-desktop-dark";
            expect(
              await scene
                .locator("img")
                .evaluate((image: HTMLImageElement) => image.currentSrc),
            ).toContain(`/brand/scenes/${expectedFamily}/`);
            if (width >= 700) {
              const cover = await scene
                .locator("img")
                .evaluate((image: HTMLImageElement) => {
                  const box = image.getBoundingClientRect();
                  const selected = Number(
                    new URL(image.currentSrc).pathname.match(
                      /-(\d+)-v1\./,
                    )?.[1],
                  );
                  return {
                    selected,
                    needed: Math.max(box.width, (box.height * 1983) / 793),
                  };
                });
              expect(cover.selected).toBeGreaterThanOrEqual(
                Math.min(1920, cover.needed),
              );
              expect(cover.needed).toBeLessThanOrEqual(1920 * 1.1);
            }
            const title = ready.getByRole("heading", {
              level: 1,
              name: "채굴 월드",
            });
            await expect(title).toHaveCount(1);
            const titleBox = await title.boundingBox();
            const imageBox = await scene.locator("img").boundingBox();
            // The native heading belongs on the scene, not below a normal-flow
            // image. This catches the actual first-render displacement bug.
            expect(titleBox).not.toBeNull();
            expect(imageBox).not.toBeNull();
            expect(titleBox!.y).toBeGreaterThanOrEqual(imageBox!.y - 1);
            expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(
              imageBox!.y + imageBox!.height + 1,
            );
            await expect(
              ready.getByRole("link", { name: "전체 보기", exact: true }),
            ).toHaveCount(2);
            await expect(
              ready
                .getByRole("link", { name: "전체 보기", exact: true })
                .nth(0),
            ).toHaveAttribute("href", "/wallet?view=profit");
            await expect(
              ready
                .getByRole("link", { name: "전체 보기", exact: true })
                .nth(1),
            ).toHaveAttribute("href", "/wallet?view=history");
          }
          if (route === "/wallet") {
            if (width >= 980) {
              const sidebar = page.locator("aside.product-sidebar:visible");
              const account = sidebar.getByRole("link", {
                name: "내 계정 정보 확인",
                exact: true,
              });
              await expectPaintedCopyFits(account, "strong, small", "a");
              const accountBox = await account.boundingBox();
              const navigationBox = await sidebar
                .getByRole("navigation", {
                  name: "지갑 전체 메뉴",
                  exact: true,
                })
                .boundingBox();
              expect(accountBox).not.toBeNull();
              expect(navigationBox).not.toBeNull();
              expect(accountBox!.y + accountBox!.height).toBeLessThanOrEqual(
                navigationBox!.y + 1,
              );
            }
            const title = ready.getByRole("heading", {
              level: 1,
              name: "지갑",
              exact: true,
            });
            await expect(title).toHaveCount(1);
            await expect(title).toBeVisible();
            const scene = ready.locator("[data-scene-theme]");
            await expect(scene).toHaveCount(1);
            await expect(scene).toHaveAttribute("data-scene-theme", theme);
            await expect(scene).toHaveAttribute(
              "data-wallet-scene-state",
              "responsive",
            );
            const expectedFamily =
              theme === "light"
                ? width >= 640
                  ? "wallet-chip-desktop-light"
                  : "wallet-chip-mobile-light"
                : width >= 640
                  ? "wallet-vault-desktop-dark"
                  : "wallet-vault-mobile-dark";
            expect(
              await scene
                .locator("img")
                .evaluate((image: HTMLImageElement) => image.currentSrc),
            ).toContain(`/brand/scenes/${expectedFamily}/`);
            const titleBox = await title.boundingBox();
            const imageBox = await scene.locator("img").boundingBox();
            expect(titleBox).not.toBeNull();
            expect(imageBox).not.toBeNull();
            expect(titleBox!.y).toBeGreaterThanOrEqual(imageBox!.y - 1);
            expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(
              imageBox!.y + imageBox!.height + 1,
            );
            for (const [name, href] of [
              ["입금하기", "/wallet/deposit"],
              ["출금하기", "/wallet/withdraw"],
            ] as const) {
              const control = ready.getByRole("link", { name, exact: true });
              await expect(control).toHaveCount(1);
              await expect(control).toHaveAttribute("href", href);
              const box = await control.boundingBox();
              expect(box?.height).toBeGreaterThanOrEqual(44);
            }
            const selectors = ready.getByRole("radiogroup", {
              name: "원금, 수익, 거래내역",
              exact: true,
            });
            const principal = selectors.getByRole("radio", {
              name: "원금",
              exact: true,
            });
            await principal.focus();
            await principal.press("ArrowRight");
            await expect(
              selectors.getByRole("radio", { name: "수익", exact: true }),
            ).toBeChecked();
            await expect(
              ready.getByText(
                "체험 값은 원화가 아니에요. 전환된 금액만 실제 지갑에 반영됩니다.",
                { exact: true },
              ),
            ).toBeVisible();
            await selectors
              .getByRole("radio", { name: "수익", exact: true })
              .press("ArrowRight");
            await expect(
              selectors.getByRole("radio", { name: "거래내역", exact: true }),
            ).toBeChecked();
            await expect(
              ready.getByRole("region", {
                name: "최근 거래 내역",
                exact: true,
              }),
            ).toBeVisible();
            await selectors
              .getByRole("radio", { name: "거래내역", exact: true })
              .press("ArrowRight");
            await expect(principal).toBeChecked();
            await principal.evaluate((element: HTMLInputElement) =>
              element.blur(),
            );
            await main.evaluate((element) =>
              element.scrollTo({ top: 0, behavior: "instant" }),
            );
          }
          if (route === "/products") {
            await expect(
              ready.getByRole("heading", {
                level: 1,
                name: "상품",
                exact: true,
              }),
            ).toBeVisible();
            const action = ready.getByRole("link", {
              name: "채굴 보기",
              exact: true,
            });
            if (await action.count()) {
              await expect(action).toHaveAttribute("href", "/mining");
              expect(
                (await action.boundingBox())?.height,
              ).toBeGreaterThanOrEqual(44);
            }
          }
          if (route === "/menu") {
            await expect(
              ready.getByRole("heading", {
                level: 1,
                name: "더보기",
                exact: true,
              }),
            ).toBeVisible();
            if (width < 980) {
              const tools = ready.locator(
                ':scope > header [data-menu-mobile-tools="true"]',
              );
              for (const [name, href] of [
                ["알림 센터", "/notifications"],
                ["내 계정 보기", "/menu/account"],
              ] as const) {
                const link = tools.getByRole("link", { name, exact: true });
                await link.scrollIntoViewIfNeeded();
                await expect(link).toHaveAttribute("href", href);
                const hit = await link.evaluate((element) => {
                  const box = element.getBoundingClientRect();
                  return {
                    width: box.width,
                    height: box.height,
                    reachable: element.contains(
                      document.elementFromPoint(
                        box.x + box.width / 2,
                        box.y + box.height / 2,
                      ),
                    ),
                  };
                });
                expect(hit.width).toBeGreaterThanOrEqual(44);
                expect(hit.height).toBeGreaterThanOrEqual(44);
                expect(hit.reachable).toBe(true);
              }
            }
            const containment = await ready.evaluate((element) => {
              const targets = element.querySelectorAll(
                'header strong, section[aria-label="내 프로필"] strong, section[aria-label="내 프로필"] dd',
              );
              return [...targets].map((target) => ({
                fits: target.scrollWidth <= target.clientWidth + 1,
                text: target.textContent?.trim(),
              }));
            });
            expect(containment.length).toBeGreaterThanOrEqual(5);
            expect(containment.filter((target) => !target.fits)).toEqual([]);
            const navigation = ready.getByRole("navigation", {
              name: "더보기 메뉴",
              exact: true,
            });
            for (const href of [
              "/menu/account",
              "/notifications",
              "/events",
              "/putduk-facts",
              "/support",
              "/ai",
              "/menu/notifications",
            ]) {
              await expect(
                navigation.locator(`a[href="${href}"]`).first(),
              ).toBeVisible();
            }
          }
          if (route === "/ai") {
            await expect(
              ready.getByRole("heading", {
                level: 1,
                name: "퍼뜩 AI",
                exact: true,
              }),
            ).toBeVisible();
            const quick = ready.getByRole("group", {
              name: "빠른 질문",
              exact: true,
            });
            await expect(quick.getByRole("button")).toHaveCount(5);
            const overflowingPromptText = await quick.evaluate((element) => {
              const failures: string[] = [];
              for (const card of element.querySelectorAll("button")) {
                const bounds = card.getBoundingClientRect();
                for (const copy of card.querySelectorAll("strong, small")) {
                  const range = document.createRange();
                  range.selectNodeContents(copy);
                  for (const fragment of range.getClientRects()) {
                    if (
                      fragment.left < bounds.left - 1 ||
                      fragment.right > bounds.right + 1
                    ) {
                      failures.push(copy.textContent ?? "");
                    }
                  }
                }
              }
              return failures;
            });
            expect(overflowingPromptText).toEqual([]);
            const composer = ready.getByTestId("putduk-ai-question");
            const inputReadability = await composer.evaluate(
              (element: HTMLTextAreaElement) => {
                const style = getComputedStyle(element);
                const context = document
                  .createElement("canvas")
                  .getContext("2d");
                if (!context) throw new Error("Text measurement unavailable");
                context.font = style.font;
                return {
                  availableWidth:
                    element.clientWidth -
                    parseFloat(style.paddingLeft) -
                    parseFloat(style.paddingRight),
                  placeholderWidth: context.measureText(element.placeholder)
                    .width,
                  availableHeight:
                    element.clientHeight -
                    parseFloat(style.paddingTop) -
                    parseFloat(style.paddingBottom),
                  lineHeight: parseFloat(style.lineHeight),
                  noticeOffset:
                    element
                      .form!.querySelector("footer > p")!
                      .getBoundingClientRect().top -
                    element.getBoundingClientRect().bottom,
                };
              },
            );
            expect(inputReadability.placeholderWidth).toBeLessThanOrEqual(
              inputReadability.availableWidth + 1,
            );
            expect(inputReadability.availableHeight + 1).toBeGreaterThanOrEqual(
              inputReadability.lineHeight,
            );
            expect(inputReadability.noticeOffset).toBeGreaterThanOrEqual(-1);
            for (const [label, question] of [
              ["내 채굴 상태", "내 채굴 상태 알려줘"],
              ["START 확인", "내 PUTDUK START 체험 상태 알려줘"],
              ["출금 준비", "첫 출금은 어떻게 준비하나요?"],
              ["이벤트 안내", "이벤트 참여 방법 알려줘"],
              ["고객지원", "고객지원은 어디에 있나요?"],
            ] as const) {
              const button = quick.getByRole("button", {
                name: `${label} ${question}`,
                exact: true,
              });
              await expect(button).toBeEnabled();
              await button.focus();
              await expect(button).toBeFocused();
              await expect
                .poll(() =>
                  button.evaluate((element) => {
                    const box = element.getBoundingClientRect();
                    return element.contains(
                      document.elementFromPoint(
                        box.x + box.width / 2,
                        box.y + box.height / 2,
                      ),
                    );
                  }),
                )
                .toBe(true);
              await button.press("Enter");
              await expect(composer).toBeFocused();
              await expect(composer).toHaveValue(question);
              await composer.fill("");
            }
            await quick.evaluate((element) =>
              element.scrollTo({ left: 0, behavior: "instant" }),
            );
            await composer.evaluate((element: HTMLElement) => element.blur());
            await main.evaluate((element) =>
              element.scrollTo({ top: 0, behavior: "instant" }),
            );
          }
          if (width >= 980 && ["/products", "/menu", "/ai"].includes(route)) {
            const sidebar = page.locator("aside.product-sidebar:visible");
            await expect(sidebar).toHaveCount(1);
            const finalLink = sidebar
              .getByRole("navigation")
              .getByRole("link")
              .last();
            const story = sidebar.locator(":scope > div").last();
            const linkBox = await finalLink.boundingBox();
            const storyBox = await story.boundingBox();
            expect(linkBox).not.toBeNull();
            expect(storyBox).not.toBeNull();
            // Font growth must extend the scrollable sidebar, never squeeze
            // its navigation underneath the decorative poster.
            expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(
              storyBox!.y + 1,
            );
            await finalLink.scrollIntoViewIfNeeded();
            await expect(finalLink).toBeVisible();
            await sidebar.evaluate((element) =>
              element.scrollTo({ top: 0, behavior: "instant" }),
            );
          }
          const suffix = textScale === 2 ? "-text-200" : "";
          const filename = `${route.slice(1)}-${width}-${theme}${suffix}.png`;
          const output = testInfo.outputPath(filename);
          const paintedImages = await awaitPaintedImages(page);
          await page.screenshot({
            path: output,
            fullPage: true,
            animations: "disabled",
            caret: "initial",
          });
          const contents = await readFile(output);
          const matched = references.filter(
            (reference) =>
              reference.route_mapping.includes(route) &&
              reference.classification.theme === theme &&
              (width === 390
                ? reference.classification.viewport === "mobile"
                : width === 1440
                  ? reference.classification.viewport === "desktop"
                  : false),
          );
          records.push({
            route,
            width,
            theme,
            screenshot: filename,
            sha256: createHash("sha256").update(contents).digest("hex"),
            state: await ready.getAttribute("data-ui-state"),
            scroll_position: "top",
            text_scale: textScale,
            decoded_image_sources: paintedImages,
            references: matched.map((reference) => reference.reference_id),
            manual_reference_comparison: "pending",
          });
          if (
            route === "/signup" &&
            textScale === 2 &&
            [320, 390].includes(width)
          ) {
            const date = ready.locator("#signup-date-of-birth");
            await expect(date).toHaveCSS("font-size", "32px");
            await date.fill("1990-01-02");
            await expect(date).toHaveValue("1990-01-02");
            expect(
              await date.evaluate((input: HTMLInputElement) =>
                input.checkValidity(),
              ),
            ).toBe(true);
            const filledFilename = `signup-${width}-${theme}-text-200-date-filled.png`;
            const filledOutput = testInfo.outputPath(filledFilename);
            await awaitPaintedImages(page);
            await page.screenshot({
              path: filledOutput,
              fullPage: true,
              animations: "disabled",
            });
            records.push({
              route,
              width,
              theme,
              screenshot: filledFilename,
              sha256: createHash("sha256")
                .update(await readFile(filledOutput))
                .digest("hex"),
              state: "native_date_filled",
              scroll_position: "full_page",
              text_scale: textScale,
              references: matched.map((reference) => reference.reference_id),
              manual_reference_comparison: "pending",
            });
            await date.click();
            expect(
              await date.evaluate((input: HTMLInputElement) => {
                input.showPicker();
                return input.type === "date";
              }),
            ).toBe(true);
            await page.keyboard.press("Escape");
            await expect(date).toHaveValue("1990-01-02");
            await date.fill("");
            await expect(date).toHaveValue("");
            await date.evaluate((input: HTMLInputElement) => input.blur());
            await page.evaluate(() => window.scrollTo(0, 0));
          }
          const { scrollRange, step } = await main.evaluate((element) => ({
            scrollRange: element.scrollHeight - element.clientHeight,
            // Overlapping tiles cover the middle of independently scrolling main.
            step: Math.max(1, Math.floor(element.clientHeight * 0.7)),
          }));
          if (scrollRange > 16) {
            const positions = [];
            for (let top = step; top < scrollRange; top += step) {
              positions.push(top);
            }
            positions.push(scrollRange);
            for (const [index, top] of positions.entries()) {
              await main.evaluate(
                (element, top) =>
                  element.scrollTo({
                    top,
                    behavior: "instant",
                  }),
                top,
              );
              await expect
                .poll(() =>
                  main.evaluate(
                    (element, expected) =>
                      Math.abs(element.scrollTop - expected),
                    top,
                  ),
                )
                .toBeLessThanOrEqual(1);
              const position =
                top === scrollRange ? "bottom" : `middle-${index + 1}`;
              const bottomFilename = `${route.slice(1)}-${width}-${theme}${suffix}-${position}.png`;
              const bottomOutput = testInfo.outputPath(bottomFilename);
              const bottomPaintedImages = await awaitPaintedImages(page);
              await page.screenshot({
                path: bottomOutput,
                fullPage: true,
                animations: "disabled",
                caret: "initial",
              });
              const bottomContents = await readFile(bottomOutput);
              records.push({
                route,
                width,
                theme,
                screenshot: bottomFilename,
                sha256: createHash("sha256")
                  .update(bottomContents)
                  .digest("hex"),
                state: await ready.getAttribute("data-ui-state"),
                scroll_position: position,
                scroll_top: top,
                scroll_range: scrollRange,
                capture_step: step,
                text_scale: textScale,
                decoded_image_sources: bottomPaintedImages,
                references: matched.map((reference) => reference.reference_id),
                manual_reference_comparison: "pending",
              });
            }
          }
        }
        // The next document starts at its normal text size. Resetting this
        // departing document can start another responsive image request.
      }
    }
  }
  await writeFile(
    testInfo.outputPath("reference-render-index.json"),
    JSON.stringify(
      {
        records,
        console_network_errors: errors,
        cancelledPrefetches,
        visual_qa_complete: false,
      },
      null,
      2,
    ) + "\n",
  );
  expect(errors).toEqual([]);
}

test("captures every public authentication reference family with live controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  await captureRoutes(page, testInfo, ["/login", "/signup"], references);
});

test("captures every member reference family without fabricated balances or activity", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("mockup-reference-empty");
  await loginAsMember(page, member, "/home");
  await dismissGuidedQuestIfPresent(page);
  await captureRoutes(
    page,
    testInfo,
    ["/home", "/mining", "/products", "/wallet", "/menu", "/ai"],
    references,
  );
});

test("captures reconstructed mining at seven widths with genuine read-only controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("mining-reference-reconstruction");
  await loginAsMember(page, member, "/mining");
  await captureRoutes(page, testInfo, ["/mining"], references);
});

test("captures reconstructed wallet at seven widths with real links and keyboard selection", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("wallet-reference-reconstruction");
  await loginAsMember(page, member, "/wallet");
  await captureRoutes(page, testInfo, ["/wallet"], references);
});

for (const [route, screen] of [
  ["/products", "products"],
  ["/menu", "menu"],
  ["/ai", "ai"],
] as const) {
  test(`captures reconstructed ${screen} at seven widths and 200 percent Korean text`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const references = await sourceReferences();
    const member = await createConfirmedMember(
      `${screen}-reference-reconstruction`,
    );
    await loginAsMember(page, member, route);
    await captureRoutes(page, testInfo, [route], references);
  });
}
