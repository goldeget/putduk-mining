// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_MFA_PREPARE_TIMEOUT_MS, MfaGate } from "@/components/mfa-gate";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { KycReviewForm } from "@/app/(control)/kyc/review-form";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  reviewKyc: vi.fn(),
}));
vi.mock("@/app/(control)/kyc/actions", () => ({
  reviewKycCaseFromFields: mocks.reviewKyc,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createAdminBrowserClient: () => ({
    auth: {
      getSession: mocks.getSession,
      mfa: {
        listFactors: mocks.listFactors,
        challengeAndVerify: mocks.challengeAndVerify,
        enroll: mocks.enroll,
        unenroll: mocks.unenroll,
      },
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: "qa-only" } } },
    error: null,
  });
  mocks.listFactors.mockResolvedValue({
    data: { totp: [{ id: "factor-qa", status: "verified" }], all: [] },
    error: null,
  });
  mocks.challengeAndVerify.mockResolvedValue({ error: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function fillCode(code = "123456") {
  const input = container.querySelector<HTMLInputElement>(
    'input[autoComplete="one-time-code"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mountStepUp(onTokenIssued = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(StepUpTokenField, {
        commandFamily: "KYC_REVIEW",
        onTokenIssued,
      }),
    ),
  );
  await fillCode();
  return onTokenIssued;
}
async function issue() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
}
async function mountMfa() {
  await act(async () =>
    root.render(createElement(MfaGate, { returnTo: "/kyc" })),
  );
}
async function verifyMfa() {
  await fillCode();
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockVerifiedThen(body: unknown, status = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("totp-verify"))
      return jsonResponse({ data: { verified: true } });
    return jsonResponse(body, status);
  });
}

describe("security confirmation recovery", () => {
  it("MFA preparation timeout recovers without a fake verified factor", async () => {
    vi.useFakeTimers();
    mocks.getSession.mockImplementationOnce(() => new Promise(() => undefined));
    await mountMfa();
    await act(async () =>
      vi.advanceTimersByTimeAsync(ADMIN_MFA_PREPARE_TIMEOUT_MS + 1),
    );
    expect(container.textContent).toContain("다시 확인");
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("MFA preparation throw exposes a retry instead of permanent busy", async () => {
    mocks.getSession.mockRejectedValueOnce(new TypeError("network"));
    await mountMfa();
    expect(container.textContent).toContain("다시 확인");
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(false);
  });
  it("MFA transport throw restores the form and does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await mountMfa();
    await verifyMfa();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(false);
    expect(container.textContent).toContain("결과");
  });
  it("MFA 200 malformed body cannot masquerade as recorded verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    await mountMfa();
    await verifyMfa();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(container.textContent).toContain("인증 결과");
  });
  it.each(["", "fixture-session", "00000000-0000-4000-8000"])(
    "MFA rejects a non-UUID recorded session %s",
    async (adminSessionId) => {
      vi.stubGlobal(
        "fetch",
        mockVerifiedThen({ data: { recorded: true, adminSessionId } }),
      );
      await mountMfa();
      await verifyMfa();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(container.textContent).toContain("보안 기록");
    },
  );
  it("MFA accepts the recorded UUID response contract", async () => {
    vi.stubGlobal(
      "fetch",
      mockVerifiedThen({
        data: {
          recorded: true,
          adminSessionId: "00000000-0000-4000-8000-000000000001",
        },
      }),
    );
    await mountMfa();
    await verifyMfa();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/kyc");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it.each(["fetch", "json"])(
    "MFA bounds an unresponsive %s even when transport does not honor abort",
    async (stage) => {
      vi.useFakeTimers();
      let resolveLate: ((value: unknown) => void) | undefined;
      const stalled = new Promise((resolve) => {
        resolveLate = resolve;
      });
      vi.stubGlobal(
        "fetch",
        stage === "fetch"
          ? vi.fn().mockReturnValue(stalled)
          : vi.fn().mockResolvedValue({ ok: true, json: () => stalled }),
      );
      await mountMfa();
      await verifyMfa();
      await act(async () => vi.advanceTimersByTimeAsync(15_001));
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')!
          .disabled,
      ).toBe(false);
      expect(mocks.replace).not.toHaveBeenCalled();
      const data = {
        data: {
          recorded: true,
          adminSessionId: "00000000-0000-4000-8000-000000000001",
        },
      };
      await act(async () =>
        resolveLate?.(
          stage === "fetch"
            ? new Response(JSON.stringify(data), { status: 200 })
            : data,
        ),
      );
      expect(mocks.replace).not.toHaveBeenCalled();
    },
  );
  it.each(["fetch", "json"])(
    "step-up bounds an unresponsive %s and ignores its late token",
    async (stage) => {
      vi.useFakeTimers();
      let resolveLate: ((value: unknown) => void) | undefined;
      const stalled = new Promise((resolve) => {
        resolveLate = resolve;
      });
      vi.stubGlobal(
        "fetch",
        stage === "fetch"
          ? vi.fn().mockReturnValue(stalled)
          : vi.fn().mockResolvedValue({ ok: true, json: () => stalled }),
      );
      const callback = await mountStepUp();
      await issue();
      await act(async () => vi.advanceTimersByTimeAsync(15_001));
      expect(
        container.querySelector<HTMLButtonElement>("button")!.disabled,
      ).toBe(false);
      const data = {
        data: {
          token: "qa-token-with-more-than-16-characters",
          commandFamily: "KYC_REVIEW",
        },
      };
      await act(async () =>
        resolveLate?.(
          stage === "fetch"
            ? new Response(JSON.stringify(data), { status: 200 })
            : data,
        ),
      );
      expect(
        container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
          .value,
      ).toBe("");
      expect(callback).toHaveBeenLastCalledWith("");
    },
  );
  it("form action captures the grant before pending clears its hidden and parent copies", async () => {
    const grant = "qa-token-with-more-than-16-characters";
    vi.stubGlobal(
      "fetch",
      mockVerifiedThen({
        data: { token: grant, commandFamily: "KYC_REVIEW" },
      }),
    );
    const callback = vi.fn();
    let finish: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const action = vi.fn(async (data: FormData) => {
      expect(data.get("stepUpToken")).toBe(grant);
      await completion;
    });
    await act(async () =>
      root.render(
        createElement(
          "form",
          { action },
          createElement(StepUpTokenField, {
            commandFamily: "KYC_REVIEW",
            onTokenIssued: callback,
          }),
          createElement("button", { type: "submit" }, "보내기"),
        ),
      ),
    );
    await fillCode();
    await issue();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(action).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
    expect(callback).toHaveBeenLastCalledWith("");
    expect(
      container.querySelector<HTMLButtonElement>('button[type="button"]')!
        .disabled,
    ).toBe(true);
    expect(container.textContent).toContain("다음 작업에는 다시 확인");
    await act(async () => finish?.());
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
  });
  it("manual KYC submission keeps the captured grant while clearing the next-command UI", async () => {
    const grant = "qa-token-with-more-than-16-characters";
    vi.stubGlobal(
      "fetch",
      mockVerifiedThen({
        data: { token: grant, commandFamily: "KYC_REVIEW" },
      }),
    );
    let finish: ((value: unknown) => void) | undefined;
    mocks.reviewKyc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () =>
      root.render(createElement(KycReviewForm, { caseId: "qa-only" })),
    );
    await fillCode();
    await issue();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.reviewKyc).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "qa-only", stepUpToken: grant }),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
    expect(container.textContent).toContain("다음 작업에는 다시 확인");
    await act(async () => finish?.({ ok: true }));
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
  });
  it("step-up clears an earlier grant before a thrown re-check", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { verified: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            token: "qa-token-with-more-than-16-characters",
            commandFamily: "KYC_REVIEW",
          },
        }),
      )
      .mockRejectedValueOnce(new TypeError("failed"));
    vi.stubGlobal("fetch", fetch);
    const callback = await mountStepUp();
    await issue();
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toContain("qa-token");
    await fillCode();
    await issue();
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
    expect(callback).toHaveBeenLastCalledWith("");
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
  });
  it.each(["malformed", "wrong-family"])(
    "step-up rejects %s success bodies",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        mockVerifiedThen(
          kind === "malformed"
            ? {}
            : {
                data: {
                  token: "qa-token-with-more-than-16-characters",
                  commandFamily: "DEPOSIT_CONFIRM",
                },
              },
        ),
      );
      await mountStepUp();
      await issue();
      expect(
        container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
          .value,
      ).toBe("");
      expect(container.textContent).not.toContain("이제 명령을");
    },
  );
  it("step-up confirmation does not call browser Auth MFA", async () => {
    const fetch = mockVerifiedThen({
      data: {
        token: "qa-token-with-more-than-16-characters",
        commandFamily: "KYC_REVIEW",
      },
    });
    vi.stubGlobal("fetch", fetch);
    await mountStepUp();
    await issue();
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(String(fetch.mock.calls[0]?.[0])).toContain("totp-verify");
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toContain("qa-token");
  });
  it("offline invalidation removes the hidden grant and parent copy", async () => {
    vi.stubGlobal(
      "fetch",
      mockVerifiedThen({
        data: {
          token: "qa-token-with-more-than-16-characters",
          commandFamily: "KYC_REVIEW",
        },
      }),
    );
    const callback = await mountStepUp();
    await issue();
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(callback).toHaveBeenLastCalledWith("");
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
  });
  it("a stored confirmation is discarded before the authoritative server TTL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      mockVerifiedThen({
        data: {
          token: "qa-token-with-more-than-16-characters",
          commandFamily: "KYC_REVIEW",
        },
      }),
    );
    const callback = await mountStepUp();
    await issue();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(callback).toHaveBeenLastCalledWith("");
    expect(
      container.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
        .value,
    ).toBe("");
    expect(container.textContent).not.toContain("이제 명령을");
  });
});
