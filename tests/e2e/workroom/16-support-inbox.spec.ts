import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { adminLogin, adminOrigin, login, member, operator } from "./helpers";

test("persisted inquiry, original retry, own-thread isolation, operator reply and whole inbox", async ({
  page,
  browser,
}) => {
  const owner = await member();
  await login(page, owner);
  await page.goto("/menu/support");
  await page.getByRole("link", { name: "1:1 문의하기", exact: true }).click();
  await page
    .getByLabel("문의 내용", { exact: true })
    .fill("참여 내역 확인 방법을 알려 주세요.");
  await page.getByRole("button", { name: "문의 보내기", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "메시지를 저장했어요." }),
  ).toBeVisible();
  const threadId = new URL(page.url()).searchParams.get("thread")!;
  expect(threadId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("log")).toContainText(
    "참여 내역 확인 방법을 알려 주세요.",
  );
  const key = randomUUID();
  const send = () =>
    page.request.post("/api/v1/workroom-app", {
      headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": key },
      data: {
        operation: "SUPPORT_SEND",
        input: { threadId, body: "같은 요청은 한 번만 저장해 주세요." },
      },
    });
  const original = await send();
  const replay = await send();
  expect(original.status()).toBe(200);
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data).toEqual((await original.json()).data);
  await page.reload();
  await expect(
    page
      .getByRole("log")
      .getByText("같은 요청은 한 번만 저장해 주세요.", { exact: true }),
  ).toHaveCount(1);
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const other = await secondContext.newPage();
  await login(other, await member());
  const denied = await other.request.get(
    `/api/v1/workroom-app?operation=SUPPORT_READ&threadId=${threadId}`,
  );
  expect([403, 404]).toContain(denied.status());
  expect(await denied.text()).not.toContain("참여 내역 확인 방법");
  await secondContext.close();
  const adminPage = await page.context().newPage();
  await adminLogin(adminPage, await operator());
  await adminPage.goto(`${adminOrigin}/support?thread=${threadId}`);
  await expect(adminPage.getByRole("main")).toContainText(owner.loginId);
  await adminPage
    .getByRole("button", { name: "내 담당으로", exact: true })
    .click();
  await expect(
    adminPage
      .getByRole("status")
      .filter({ hasText: "내 담당으로 저장했어요." }),
  ).toBeVisible();
  await adminPage
    .getByLabel("회원에게 답변", { exact: true })
    .fill("하단 내역에서 참여 내역을 선택해 주세요.");
  await adminPage
    .getByRole("button", { name: "답변 보내기", exact: true })
    .click();
  await expect(adminPage.getByRole("log")).toContainText(
    "하단 내역에서 참여 내역을 선택해 주세요.",
  );
  await page.reload();
  await expect(page.getByRole("log")).toContainText(
    "하단 내역에서 참여 내역을 선택해 주세요.",
  );
  for (const [width, theme] of [
    [320, "light"],
    [390, "dark"],
    [768, "light"],
    [1280, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("combobox", { name: "화면 테마" }).selectOption(theme);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("link", { name: /알림,/ })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`support-member-${width}-${theme}.png`),
    });
  }
  await page.goto("/notifications");
  await expect(page.getByRole("main")).toContainText("알림함");
  await expect(page.locator("[data-notification-id]").first()).toBeVisible();
  await adminPage
    .getByRole("button", { name: "해결로 표시", exact: true })
    .click();
  await expect(
    adminPage
      .getByRole("status")
      .filter({ hasText: "해결 상태로 저장했어요." }),
  ).toBeVisible();
  await adminPage.setViewportSize({ width: 390, height: 900 });
  expect(
    await adminPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await adminPage.screenshot({
    path: test.info().outputPath("support-admin-390.png"),
  });
});

test("inquiry photos are optional, private and persisted with the message", async ({
  page,
}) => {
  await login(page, await member());
  await page.goto("/workroom/support");
  await page
    .getByLabel("문의 내용", { exact: true })
    .fill("화면 사진을 함께 보냅니다.");
  await page.locator('input[type="file"]').setInputFiles({
    name: "screen.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "문의 보내기", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "화면 사진을 함께 보냅니다.",
  );
  await page
    .getByRole("button", { name: "첨부 사진 보기", exact: true })
    .click();
  const link = page.getByRole("link", { name: /사진 열기/ });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toContain(
    "/object/sign/workroom-support-attachments/",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "첨부 사진 보기", exact: true }),
  ).toBeVisible();
});

test("unauthenticated private routes cannot read inquiries", async ({
  request,
}) => {
  expect(
    (await request.get("/api/v1/workroom-app?operation=SUPPORT_READ")).status(),
  ).toBe(401);
  expect([401, 403]).toContain(
    (
      await request.get(
        `${adminOrigin}/api/v1/admin/workroom-app?operation=SUPPORT_READ`,
      )
    ).status(),
  );
  const page = await request.get(
    `${adminOrigin}/support?thread=${randomUUID()}`,
    { maxRedirects: 0 },
  );
  expect([303, 307]).toContain(page.status());
});
