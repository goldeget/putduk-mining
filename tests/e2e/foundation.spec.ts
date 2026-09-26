import { expect, test } from "@playwright/test";

test("renders the PUTDUK foundation with accessible primary navigation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /채굴의 시간을.*신뢰 가능한 기록/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "PUTDUK START 보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴 디자인 예시" }),
  ).toBeVisible();
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
    data: { version: "2026.09-foundation" },
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
      name: "현재 프로덕션 서비스는 준비 중입니다.",
    }),
  ).toBeVisible();
  await expect(page.getByText("2026.09-foundation").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "검증 원칙 보기" }),
  ).toBeVisible();
});

test("renders a clean account entry state without a phantom status message", async ({
  page,
}) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "계정으로 시작하기" }),
  ).toBeVisible();
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expect(page.locator(".auth-form__message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /로그인/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "새 계정 만들기" }),
  ).toBeVisible();
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
  await expect(page.locator('input[name="next"]')).toHaveValue("/start");
});

test("marks account and protected surfaces as non-indexable", async ({
  page,
}) => {
  const login = await page.request.get("/login");
  expect(login.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  const wallet = await page.request.get("/wallet", { maxRedirects: 0 });
  expect(wallet.headers()["location"]).toContain("/login?next=%2Fwallet");
});
