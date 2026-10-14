import { expect, test } from "@playwright/test";

test("landing world artwork and reward disclosures work through real controls", async ({
  page,
}) => {
  await page.goto("/");
  const sources = new Set<string>();
  for (const world of ["korea", "usa", "gold", "silver", "digital"]) {
    const picture = page.locator(`[data-world-scene="${world}"]`);
    await expect(picture).toHaveCount(1);
    await picture.scrollIntoViewIfNeeded();
    const image = picture.locator("img");
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const source = await image.evaluate(
      (element: HTMLImageElement) => new URL(element.currentSrc).pathname,
    );
    expect(source).toContain(`/world-collection/${world}-`);
    sources.add(source);
  }
  expect(sources.size).toBe(5);
  const question = page
    .locator("summary")
    .filter({ hasText: "처음 시작하려면 입금해야 하나요?" });
  await question.focus();
  await question.press("Enter");
  const answer = question.locator("..");
  await expect(answer).toHaveAttribute("open", "");
  await expect(answer.locator("p")).toContainText(
    "첫 출금에는 사전 입금이 필요하지 않아요",
  );
  await question.press("Enter");
  await expect(answer).not.toHaveAttribute("open", "");
  const conversion = page
    .locator("details")
    .filter({ hasText: "체험 중에 보이는 값이 바로 현금인가요?" });
  await conversion.locator("summary").click();
  await expect(conversion.locator("p")).toContainText(
    "체험 값과 실제 원화 지갑은 별개",
  );
  await expect(conversion.locator("p")).toContainText(
    "전환은 한 번만 가능합니다",
  );
});

test("landing system theme follows OS changes without replacing the user preference", async ({
  page,
}) => {
  await page.goto("/");
  const theme = page.getByLabel("화면 테마", { exact: true });
  await theme.selectOption("system");
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(theme).toHaveValue("system");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      colorScheme,
    );
  }
  await theme.selectOption("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(theme).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("renders the productized PUTDUK landing with accessible primary navigation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: /일상에 더하는 부수입,.*퍼뜩 채굴로 시작하세요\./,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".landing-hero")
      .getByRole("link", { name: /무료로 채굴 체험하기/ }),
  ).toBeVisible();
  const publicNavigation = page.locator('nav[aria-label="공개 메뉴"]');
  await expect(publicNavigation).toHaveCount(1);
  if ((page.viewportSize()?.width ?? 1440) < 980) {
    await expect(publicNavigation).toBeHidden();
    await expect(
      page.getByRole("link", { name: "내 채굴로 돌아가기" }),
    ).toBeVisible();
  } else {
    await expect(publicNavigation).toBeVisible();
  }
  await expect(page.getByText(/FOUNDATION|READ-MOSTLY/)).toHaveCount(0);
});

test("exposes install and discovery metadata", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    icons: expect.arrayContaining([
      expect.objectContaining({
        purpose: "maskable",
        src: "/brand/identity/20261014/pwa/putduk-pwa-maskable-512.png",
      }),
    ]),
    name: "퍼뜩 채굴",
  });

  const robotsResponse = await page.request.get("/robots.txt");
  expect(robotsResponse.ok()).toBe(true);

  const healthResponse = await page.request.get("/api/v1/health");
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "putduk-mining-web",
    status: "ok",
  });

  const factsResponse = await page.request.get("/api/v1/public/facts");
  expect(factsResponse.ok()).toBe(true);
  await expect(factsResponse.json()).resolves.toMatchObject({
    data: { version: "2026.09" },
  });

  const llmsResponse = await page.request.get("/llms.txt");
  expect(llmsResponse.ok()).toBe(true);
  expect(await llmsResponse.text()).toContain("# PUTDUK MINING");
});

test("renders canonical real copy and persists an explicit theme", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("지금, 퍼뜩.")).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "금빛 새싹과 광물 섬으로 표현한 퍼뜩의 첫 채굴 월드",
    }),
  ).toBeVisible();

  const theme = page.getByLabel("화면 테마");
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(theme).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("renders canonical trust content without claiming a production launch", async ({
  page,
}) => {
  await page.goto("/status");

  await expect(
    page.getByRole("heading", {
      name: "현재 정식 서비스 오픈을 준비하고 있습니다.",
    }),
  ).toBeVisible();
  await expect(page.getByText("2026.09").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "검증 원칙 보기" }),
  ).toBeVisible();
});

test("renders distinct product login and signup states", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("아이디 또는 복구 이메일")).toBeVisible();
  await expect(
    page.getByRole("textbox", { exact: true, name: "비밀번호" }),
  ).toBeVisible();
  await expect(page.locator(".auth-form__message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /로그인/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "회원가입", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "회원가입", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: "회원가입", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "회원가입", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("이름")).toBeVisible();
  await expect(page.getByLabel("생년월일")).toBeVisible();
  await expect(page.getByLabel("휴대전화")).toBeVisible();
  await expect(page.getByLabel("복구 이메일")).toBeVisible();
  await expect(page.getByLabel("로그인 아이디")).toBeVisible();
  await expect(page.getByLabel("서비스 이용약관")).toBeVisible();
  await expect(page.getByLabel("개인정보 수집·이용")).toBeVisible();
  await expect(page.getByLabel("혜택·이벤트 소식 받기")).toBeVisible();
});

test("preserves a safe protected return path and rejects an external one", async ({
  page,
}) => {
  await page.goto("/wallet/withdraw?receipt=one");
  await expect(page).toHaveURL(
    /\/login\?next=%2Fwallet%2Fwithdraw%3Freceipt%3Done$/,
  );
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/wallet/withdraw?receipt=one",
  );

  await page.goto("/login?next=https%3A%2F%2Fattacker.invalid%2Fwallet");
  await expect(page.locator('input[name="next"]')).toHaveValue("/home");
});

test("shows only allowlisted account status after password or logout actions", async ({
  page,
}) => {
  await page.goto("/login?password=updated&logout=untrusted");
  await expect(page.getByRole("status")).toHaveText(
    "비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.",
  );
  await expect(page.getByText("untrusted")).toHaveCount(0);

  await page.goto("/login?logout=global");
  await expect(page.getByRole("status")).toHaveText(
    "모든 기기에서 안전하게 로그아웃했습니다.",
  );
});

test("marks account and protected surfaces as non-indexable", async ({
  page,
}) => {
  const login = await page.request.get("/login");
  expect(login.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  const signup = await page.request.get("/signup");
  expect(signup.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  const wallet = await page.request.get("/wallet", { maxRedirects: 0 });
  expect(wallet.headers()["location"]).toContain("/login?next=%2Fwallet");
});

test.describe("Landing journey CTA geometry", () => {
  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      test(`landing journey CTA stays below intro ${width}px ${theme}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.addInitScript((selectedTheme) => {
          localStorage.setItem("putduk-theme", selectedTheme);
        }, theme);
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.evaluate(() => document.fonts.ready);

        const section = page.locator("#start");
        const intro = section.locator(":scope > .section-heading");
        const action = intro.locator(":scope > .landing-journey__action");
        const copy = intro.locator(":scope > .ko-copy");
        const steps = section.locator(":scope > .landing-journey__grid");
        await expect(section).toHaveCount(1);
        await expect(intro).toHaveCount(1);
        await expect(copy).toHaveCount(1);
        await expect(section.locator(".landing-journey__action")).toHaveCount(
          1,
        );
        await expect(action).toHaveCount(1);
        await expect(steps).toHaveCount(1);
        const button = action.getByRole("link", {
          name: "내 첫 채굴 시작하기",
        });
        await expect(button).toHaveAttribute("href", "/signup");
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();

        const geometry = await section.evaluate((element) => {
          const intro = element.querySelector<HTMLElement>(
            ":scope > .section-heading",
          );
          const copy = intro?.querySelector<HTMLElement>(":scope > .ko-copy");
          const action = intro?.querySelector<HTMLElement>(
            ":scope > .landing-journey__action",
          );
          const button =
            action?.querySelector<HTMLAnchorElement>("a[href='/signup']");
          const steps = element.querySelector<HTMLElement>(
            ":scope > .landing-journey__grid",
          );
          if (!intro || !copy || !action || !button || !steps) {
            throw new Error(
              "Journey CTA geometry requires the real intro, copy, action, link and steps",
            );
          }
          const rect = (node: Element) => {
            const box = node.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            };
          };
          const style = getComputedStyle(action);
          return {
            intro: rect(intro),
            copy: rect(copy),
            action: rect(action),
            button: rect(button),
            steps: rect(steps),
            parentIsIntro: action.parentElement === intro,
            borderTop: parseFloat(style.borderTopWidth),
            margins: [
              style.marginTop,
              style.marginRight,
              style.marginBottom,
              style.marginLeft,
            ].map(parseFloat),
            flexDirection: style.flexDirection,
            viewportWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        expect(geometry.parentIsIntro).toBe(true);
        expect(geometry.action.top).toBeGreaterThanOrEqual(
          geometry.copy.bottom + 16,
        );
        expect(
          Math.abs(geometry.action.left - geometry.intro.left),
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(geometry.button.left - geometry.intro.left),
        ).toBeLessThanOrEqual(2);
        expect(geometry.button.width).toBeGreaterThanOrEqual(44);
        expect(geometry.button.height).toBeGreaterThanOrEqual(48);
        expect(geometry.borderTop).toBe(0);
        expect(
          geometry.margins.every(
            (margin) => Number.isFinite(margin) && margin >= 0,
          ),
        ).toBe(true);
        expect(geometry.flexDirection).toBe("column");
        expect(geometry.scrollWidth).toBeLessThanOrEqual(
          geometry.viewportWidth + 1,
        );
        const overlapWidth =
          Math.min(geometry.action.right, geometry.steps.right) -
          Math.max(geometry.action.left, geometry.steps.left);
        const overlapHeight =
          Math.min(geometry.action.bottom, geometry.steps.bottom) -
          Math.max(geometry.action.top, geometry.steps.top);
        expect(
          overlapWidth <= 0 || overlapHeight <= 0,
          "CTA must not overlap the real steps",
        ).toBe(true);
        if (width <= 759) {
          expect(geometry.action.bottom).toBeLessThanOrEqual(
            geometry.steps.top,
          );
          expect(
            Math.abs(geometry.button.width - geometry.intro.width),
          ).toBeLessThanOrEqual(2);
        } else {
          expect(geometry.action.right).toBeLessThanOrEqual(
            geometry.steps.left + 2,
          );
        }
        await testInfo.attach(`journey-cta-${width}-${theme}-geometry`, {
          body: Buffer.from(JSON.stringify(geometry)),
          contentType: "application/json",
        });
        if (theme === "light" && (width === 390 || width === 768)) {
          await testInfo.attach(`journey-cta-${width}-${theme}`, {
            body: await section.screenshot({ animations: "disabled" }),
            contentType: "image/png",
          });
        }
      });
    }
  }
});
