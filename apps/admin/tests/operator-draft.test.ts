// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftComposer } from "@/components/operations/draft-composer";
import { OperatorChecklist } from "@/components/operations/operator-checklist";
const signals = vi.hoisted(() => ({
  epoch: 0,
  clearedReason: null as "SESSION" | null,
}));
vi.mock("@/components/assistant/operator-draft-provider", () => ({
  useOperatorDraftSignals: () => signals,
}));

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn<(text: string) => Promise<void>>();
async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  writeText.mockReset().mockResolvedValue(undefined);
  signals.epoch = 0;
  signals.clearedReason = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function readyDraft() {
  await act(async () =>
    root.render(createElement(DraftComposer, { kind: "reply" })),
  );
  expect(
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
  ).toBe(true);
  expect(host.textContent).not.toContain("검토한 초안 복사");
  await click("안내 틀 불러오기");
  expect(writeText).not.toHaveBeenCalled();
  await click("초안 미리보기");
}

describe("reviewed local operator drafts", () => {
  it("copies only a reviewed preview and invalidates review after a new template", async () => {
    await readyDraft();
    await click("검토한 초안 복사");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("문의 답변\n\n"),
    );
    expect(host.textContent).toContain("보내거나 게시한 것은 아니에요");
    await click("안내 틀 불러오기");
    expect(host.textContent).not.toContain("검토한 초안 복사");
    expect(
      host.querySelector('article[aria-label="보내기 전 초안 미리보기"]'),
    ).toBeNull();
  });
  it("reports actual clipboard failure without claiming a send", async () => {
    await readyDraft();
    writeText.mockRejectedValue(new Error("clipboard denied"));
    await click("검토한 초안 복사");
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      "복사하지 못했어요",
    );
  });
  it("clears sensitive drafts offline and suppresses a late copy result", async () => {
    await readyDraft();
    let finish!: () => void;
    writeText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await click("검토한 초안 복사");
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(host.textContent).not.toContain("검토한 초안 복사");
    await act(async () => finish());
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      "초안을 지웠어요",
    );
    expect(host.textContent).not.toContain("초안을 복사했어요");
  });
  it("does not retain drafts after leaving the page", async () => {
    await readyDraft();
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(host.textContent).not.toContain("검토한 초안 복사");
  });
  it("expires a writing draft after five minutes without retaining its text", async () => {
    vi.useFakeTimers();
    await readyDraft();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
    expect(host.textContent).not.toContain("검토한 초안 복사");
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      "5분이 지나",
    );
  });
  it("clears on session invalidation and refuses further editing until reauthentication", async () => {
    await readyDraft();
    signals.epoch += 1;
    signals.clearedReason = "SESSION";
    await act(async () =>
      root.render(createElement(DraftComposer, { kind: "reply" })),
    );
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
    expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(host.textContent).not.toContain("검토한 초안 복사");
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      "다시 로그인",
    );
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("operator checklist", () => {
  it("keeps ticks local and clears them when leaving the page", async () => {
    await act(async () => root.render(createElement(OperatorChecklist)));
    const checkbox = host.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
    expect(host.textContent).toContain(
      "요청이 처리되거나 서비스 정상으로 기록되지 않아요",
    );
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(checkbox.checked).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
