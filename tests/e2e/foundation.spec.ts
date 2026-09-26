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
