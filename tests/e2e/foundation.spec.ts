import { expect, test } from "@playwright/test";

test("renders the productized PUTDUK landing with accessible primary navigation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /작은 시작이.*나만의 채굴 세계/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /PUTDUK START 시작하기/ }),
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
        src: "/brand/pwa/putduk-pwa-maskable-512.png",
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
      name: "금빛 광부 헬멧과 새싹을 쓴 퍼뜩 마스코트",
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
    page.getByRole("heading", { name: "다시 만나 반가워요." }),
  ).toBeVisible();
  await expect(page.getByLabel("아이디 또는 복구 이메일")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expect(page.locator(".auth-form__message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /로그인/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "새 계정 만들기" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "새 계정 만들기" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: "계정 만들기" }),
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
