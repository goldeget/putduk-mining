import { expect, test } from "@playwright/test";

test("anonymous support center stays usable without Channel Talk", async ({
  page,
}) => {
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
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  const launcher = page.locator("#putduk-support-launcher");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("data-support-state", "unavailable");
  await expect(page.getByRole("button", { name: "상담 시작" })).toBeVisible();

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
  await expect(page.locator("body")).not.toContainText(
    "CHANNEL_TALK_MEMBER_HASH_SECRET",
  );
});

test("public admin aliases stay unavailable from support", async ({
  request,
}) => {
  for (const path of ["/admin", "/administrator", "/manage", "/backoffice"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  }
});
