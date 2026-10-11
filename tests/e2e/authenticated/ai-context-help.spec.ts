import { expect, test } from "@playwright/test";
import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

test("context suggestions, wide view, persisted help and real destination work without an external model", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The approved dock offers wide view on desktop; its mobile panel is already full screen.
  await page.setViewportSize({ width: 1440, height: 900 });
  const member = await createConfirmedMember("ai-context-help");
  let submitted = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/ai/chat"
    )
      submitted += 1;
  });
  await loginAsMember(page, member, "/wallet");
  await dismissGuidedQuestIfPresent(page);
  await page.getByRole("button", { name: "AI 도움", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "퍼뜩 AI", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^자산 화면 도움/ }).click();
  await expect(
    dialog.getByRole("textbox", { name: "질문 입력", exact: true }),
  ).toHaveValue("사용 가능 금액과 보류 금액은 무슨 뜻인가요?");
  expect(submitted).toBe(0);
  await dialog.getByRole("link", { name: "넓게 보기", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/ai" && url.searchParams.get("aiOrigin") === "/wallet",
  );
  const input = page.getByRole("textbox", { name: "질문 입력", exact: true });
  await expect(input).toBeInViewport({ ratio: 1 });
  await expect(input).toHaveValue(
    "사용 가능 금액과 보류 금액은 무슨 뜻인가요?",
  );
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/ai/chat",
  );
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  expect((await answered).ok()).toBe(true);
  const answer = page
    .locator('.ai-message--assistant[data-message-state="complete"]')
    .last();
  await expect(answer).toHaveAttribute("data-answer-source", "static");
  await expect(
    answer
      .getByRole("navigation", { name: "관련 화면" })
      .getByRole("link", { name: "출금 안내", exact: true }),
  ).toHaveAttribute("href", "/wallet/withdraw");
  expect(submitted).toBe(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(answer).toContainText("저장된 답변");
  const destination = answer
    .getByRole("navigation", { name: "관련 화면" })
    .getByRole("link", { name: "출금 안내", exact: true });
  await expect(destination).toHaveAttribute("href", "/wallet/withdraw");
  await page.screenshot({
    path: test.info().outputPath("member-ai-context-history.png"),
    fullPage: true,
    animations: "disabled",
  });
  await destination.click();
  await expect(page).toHaveURL((url) => url.pathname === "/wallet/withdraw");
  await expect(
    page.getByRole("heading", { name: "출금하기", exact: true }),
  ).toBeVisible();
});

test("offline drafting survives reconnection and never resubmits automatically", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const member = await createConfirmedMember("ai-context-offline");
  await loginAsMember(page, member, "/ai");
  await dismissGuidedQuestIfPresent(page);
  let submitted = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/ai/chat"
    )
      submitted += 1;
  });
  const input = page.getByRole("textbox", { name: "질문 입력", exact: true });
  await expect(input).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(input).toBeInViewport({ ratio: 1 });
  await context.setOffline(true);
  try {
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "작성한 질문은 그대로 남아 있어요" }),
    ).toBeVisible();
    await input.fill("알림 설정은 어디에 있나요?");
    await expect(
      page.getByRole("button", { name: "질문 보내기", exact: true }),
    ).toBeDisabled();
    expect(submitted).toBe(0);
    await page.screenshot({
      path: test.info().outputPath("member-ai-offline-draft.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await context.setOffline(false);
  }
  await expect(
    page.getByRole("button", { name: "질문 보내기", exact: true }),
  ).toBeEnabled();
  await expect(input).toHaveValue("알림 설정은 어디에 있나요?");
  expect(submitted).toBe(0);
  await page.getByRole("button", { name: "질문 보내기", exact: true }).click();
  const answer = page
    .locator('.ai-message--assistant[data-message-state="complete"]')
    .last();
  await expect(answer).toHaveAttribute("data-answer-source", "static");
  await expect(
    answer.getByRole("link", { name: "알림 설정", exact: true }),
  ).toHaveAttribute("href", "/menu/notifications");
  expect(submitted).toBe(1);
  await page.screenshot({
    path: test.info().outputPath("member-ai-reconnected-answer.png"),
    fullPage: true,
    animations: "disabled",
  });
});
