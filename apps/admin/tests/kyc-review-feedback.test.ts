// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import { KycReviewFeedback } from "@/app/(control)/kyc/review-feedback";
import { KycReviewForm } from "@/app/(control)/kyc/review-form";

const mocks = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock("@/app/(control)/kyc/actions", () => ({
  reviewKycCaseFromFields: mocks.review,
}));
vi.mock("@/components/step-up-token-field", () => ({
  StepUpTokenField: () => null,
}));

let container: HTMLDivElement;
let root: Root;
const success = {
  ok: true,
  message: "본인 확인 검토 결과를 저장했습니다.",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(children: ReactNode) {
  await act(async () =>
    root.render(createElement(KycReviewFeedback, null, children)),
  );
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
const form = () =>
  createElement(KycReviewForm, {
    caseId: "11111111-1111-4111-8111-111111111111",
  });

describe("KYC queue review result", () => {
  it("shows confirmed success even when server revalidation removes the card before the action returns", async () => {
    let resolve!: (result: CommandActionResult) => void;
    mocks.review.mockReturnValue(
      new Promise<CommandActionResult>((done) => {
        resolve = done;
      }),
    );
    await render(form());
    await submit();
    expect(container.textContent).not.toContain(success.message);
    // Model the server component patch: keep the queue boundary, remove card.
    await render(createElement("p", null, "대기 건 없음"));
    expect(container.querySelector("form")).toBeNull();
    await act(async () => resolve(success));
    expect(
      container.querySelector(
        '[role="status"][aria-label="본인 확인 검토 결과"]',
      )?.textContent,
    ).toBe(success.message);
    expect(mocks.review).toHaveBeenCalledOnce();
  });

  it("keeps failed review feedback in the form and never publishes success", async () => {
    mocks.review.mockResolvedValue({
      ok: false,
      code: "STEP_UP_REQUIRED",
      message: "인증 앱으로 다시 확인해 주세요.",
    });
    await render(form());
    await submit();
    expect(container.querySelector('form [role="status"]')?.textContent).toBe(
      "인증 앱으로 다시 확인해 주세요.",
    );
    expect(
      container.querySelector('[aria-label="본인 확인 검토 결과"]'),
    ).toBeNull();
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("clears previous success when the next review fails", async () => {
    mocks.review.mockResolvedValueOnce(success).mockResolvedValueOnce({
      ok: false,
      code: "STEP_UP_REQUIRED",
      message: "인증 앱으로 다시 확인해 주세요.",
    });
    await render(form());
    await submit();
    expect(container.textContent).toContain(success.message);
    await submit();
    expect(container.textContent).not.toContain(success.message);
    expect(container.querySelector('form [role="status"]')?.textContent).toBe(
      "인증 앱으로 다시 확인해 주세요.",
    );
  });

  it("retains the confirmed queue result through child refresh without duplicate success announcements", async () => {
    mocks.review.mockResolvedValue(success);
    await render(form());
    await submit();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    await render(createElement("p", null, "대기 건 없음"));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.textContent).toContain(success.message);
  });
});
