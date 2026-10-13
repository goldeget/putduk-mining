import { writeFile } from "node:fs/promises";

import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";
import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

/** Read only the genuine response ACK; assertion output contains no transcript. */
async function durableAnswerAck(response: Response) {
  const summary = {
    status: response.status(),
    bodyAvailable: false,
    doneCount: 0,
    doneSaved: false,
    conversationIdPresent: false,
    assistantMessageIdPresent: false,
  };
  try {
    const text = await response.text();
    if (text.length > 65_536) return summary;
    summary.bodyAvailable = true;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      let value: unknown;
      try {
        value = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const event = value as Record<string, unknown>;
      if (event.type !== "done") continue;
      summary.doneCount += 1;
      summary.doneSaved = event.saved === true;
      summary.conversationIdPresent = typeof event.conversationId === "string";
      summary.assistantMessageIdPresent =
        typeof event.assistantMessageId === "string";
    }
  } catch {
    // A closed navigation/connection must fail the boolean ACK assertion.
  }
  return summary;
}

/** Bounded metadata only: no answer body, identifier, credential or URL query. */
function observeHistoryRestoration(page: Page) {
  const records: Record<string, unknown>[] = [];
  const pending = new Set<Promise<void>>();
  function endpoint(urlText: string) {
    const url = new URL(urlText);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return null;
    const names: Record<string, string> = {
      "/api/v1/ai/chat": "ai_chat",
      "/rest/v1/ai_conversations": "ai_conversations",
      "/rest/v1/ai_messages": "ai_messages",
    };
    const name = names[url.pathname];
    return name
      ? {
          name,
          port: Number(url.port || (url.protocol === "https:" ? "443" : "80")),
        }
      : null;
  }
  function safeCode(value: unknown) {
    return typeof value === "string" && /^[A-Za-z0-9_:.-]{1,80}$/.test(value)
      ? value
      : null;
  }
  function observeResponse(response: Response) {
    const target = endpoint(response.url());
    if (!target || records.length >= 24) return;
    const record: Record<string, unknown> = {
      endpoint: target.name,
      port: target.port,
      method: response.request().method(),
      status: response.status(),
    };
    records.push(record);
    const task = (async () => {
      try {
        if (target.name === "ai_chat") {
          const text = await response.text();
          if (text.length > 65_536) {
            record.bodyMetadata = "OVER_BOUND";
            return;
          }
          for (const line of text.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line.slice(5)) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event.type === "done") {
              record.doneSaved = event.saved === true;
              record.conversationIdPresent =
                typeof event.conversationId === "string";
              record.assistantMessageIdPresent =
                typeof event.assistantMessageId === "string";
            }
          }
        } else {
          const payload: unknown = await response.json();
          record.rowCount = Array.isArray(payload) ? payload.length : null;
          if (payload && !Array.isArray(payload) && typeof payload === "object")
            record.errorCode = safeCode(
              (payload as Record<string, unknown>).code,
            );
          if (target.name === "ai_messages" && Array.isArray(payload)) {
            const assistant = payload.filter(
              (row) => row?.author_role === "ASSISTANT",
            );
            record.assistantRows = assistant.length;
            record.assistantWithSourceReceipt = assistant.filter(
              (row) =>
                Array.isArray(row.ai_answer_sources) &&
                row.ai_answer_sources.length > 0,
            ).length;
            record.malformedSourceEmbeds = assistant.filter(
              (row) => !Array.isArray(row.ai_answer_sources),
            ).length;
            record.positionType = payload.length
              ? typeof payload[0]?.position
              : "empty";
          }
        }
      } catch {
        record.bodyMetadata = "UNAVAILABLE";
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  function observeFailure(request: Request) {
    const target = endpoint(request.url());
    if (!target || records.length >= 24) return;
    records.push({
      endpoint: target.name,
      port: target.port,
      method: request.method(),
      status: null,
      errorCode: safeCode(request.failure()?.errorText) ?? "NETWORK_FAILURE",
    });
  }
  page.on("response", observeResponse);
  page.on("requestfailed", observeFailure);
  return async (info: TestInfo) => {
    page.off("response", observeResponse);
    page.off("requestfailed", observeFailure);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1_500);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const ui = await page
      .evaluate(() => ({
        complete: document.querySelectorAll(
          '.ai-message--assistant[data-message-state="complete"]',
        ).length,
        unverified: document.querySelectorAll(
          '.ai-message--assistant[data-message-state="unverified"]',
        ).length,
        error: document.querySelectorAll(
          '.ai-message--assistant[data-message-state="error"]',
        ).length,
        historyUnavailable: Array.from(
          document.querySelectorAll('[role="alert"]'),
        ).some((element) =>
          element.textContent?.includes("이전 대화를 불러오지 못했어요."),
        ),
      }))
      .catch(() => null);
    const diagnosticPath = info.outputPath(
      "ai-history-reload-diagnostics.json",
    );
    try {
      await writeFile(
        diagnosticPath,
        JSON.stringify(
          {
            records,
            ui,
            pendingMetadata: pending.size,
            bodyOrSecretsStored: false,
          },
          null,
          2,
        ) + "\n",
      );
      console.info(
        JSON.stringify({ diagnosticPath, observations: records.length, ui }),
      );
    } catch {
      console.info("AI_HISTORY_DIAGNOSTIC_WRITE_UNAVAILABLE");
    }
  };
}

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
  const dialog = page.getByRole("dialog", {
    name: "퍼뜩 AI 도우미",
    exact: true,
  });
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
  const finishDiagnostics = observeHistoryRestoration(page);
  try {
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/ai/chat",
    );
    await page
      .getByRole("button", { name: "질문 보내기", exact: true })
      .click();
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
    expect(await durableAnswerAck(await answered)).toEqual({
      status: 200,
      bodyAvailable: true,
      doneCount: 1,
      doneSaved: true,
      conversationIdPresent: true,
      assistantMessageIdPresent: true,
    });
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
  } finally {
    await finishDiagnostics(test.info());
  }
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
