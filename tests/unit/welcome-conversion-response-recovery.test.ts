// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeRewardAction } from "@/components/product/welcome-reward-action";
import { readWelcomeConversionSuccess } from "@/lib/product/welcome-conversion-response";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => createElement("a", { href, ...props }, children),
}));

const conversionId = "d092731d-ca0e-4976-8de4-88a5034a429a";
const validConversion = {
  id: conversionId,
  status: "CONVERTED",
  converted_amount_atomic: 5000,
  was_created: true,
};
const malformedConversions: [string, unknown][] = [
  ["truthy numeric ID", { ...validConversion, id: 17 }],
  ["object ID", { ...validConversion, id: { value: conversionId } }],
  ["non UUID ID", { ...validConversion, id: "not-a-conversion-uuid" }],
  [
    "missing ID",
    { status: "CONVERTED", converted_amount_atomic: 5000, was_created: true },
  ],
  ["unknown status", { ...validConversion, status: "APPROVED" }],
  [
    "amount object",
    { ...validConversion, converted_amount_atomic: { value: 5000 } },
  ],
  [
    "fractional atomic amount",
    { ...validConversion, converted_amount_atomic: "5000.5" },
  ],
  [
    "missing command result flag",
    { id: conversionId, status: "CONVERTED", converted_amount_atomic: 5000 },
  ],
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("welcome conversion waiting and uncertain results", () => {
  it.each(["fetch", "body"])(
    "a stalled %s releases pending after15s and ignores a possibly committed late success",
    async (stage) => {
      vi.useFakeTimers();
      let resolveLate: ((value: unknown) => void) | undefined;
      const stalled = new Promise((resolve) => {
        resolveLate = resolve;
      });
      const fetch =
        stage === "fetch"
          ? vi.fn().mockReturnValue(stalled)
          : vi.fn().mockResolvedValue({ ok: true, json: () => stalled });
      vi.stubGlobal("fetch", fetch);
      await mount();
      await clickAction();
      expect(host.textContent).toContain("자격 확인 중");
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(host.textContent).toContain("화면 다시 불러오기");
      expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
        false,
      );
      await act(async () =>
        resolveLate?.(
          stage === "fetch"
            ? successResponse(validConversion)
            : { data: { conversion: validConversion } },
        ),
      );
      expect(host.textContent).not.toContain("전환 완료");
      expect(host.querySelector('a[href^="/wallet/withdraw"]')).toBeNull();
      await clickAction();
      expect(fetch).toHaveBeenCalledOnce();
      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );

  it("transport uncertainty offers only re-read rather than another conversion command", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("connection lost after acceptance"));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await clickAction();
    expect(host.textContent).toContain("화면 다시 불러오기");
    await clickAction();
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("unmount aborts local waiting and late success does not affect a freshly mounted action", async () => {
    vi.useFakeTimers();
    let resolveLate: ((value: Response) => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveLate = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await clickAction();
    const signal = fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await mount();
    await act(async () => resolveLate?.(successResponse(validConversion)));
    expect(host.textContent).not.toContain("전환 완료");
    expect(host.textContent).toContain("환영 보상 자격 확인하기");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("fresh server-read conversion after refresh replaces uncertainty without another command", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("response lost"));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await clickAction();
    expect(host.textContent).toContain("화면 다시 불러오기");
    await mount({ id: conversionId, status: "CONVERTED" });
    expect(host.textContent).toContain("실제 KRW 환영 보상으로 전환 완료");
    expect(host.textContent).not.toContain("전환 결과를 확인하지 못했어요");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
async function mount(conversion?: { id: string; status: string }) {
  await act(async () =>
    root.render(
      createElement(WelcomeRewardAction, { conversion: conversion ?? null }),
    ),
  );
}
async function clickAction() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
}
function successResponse(conversion: unknown) {
  return new Response(JSON.stringify({ data: { conversion } }), {
    status: 200,
  });
}

describe("welcome reward conversion response truth", () => {
  it.each(malformedConversions)(
    "a 200 with %s never displays real-KRW converted success",
    async (_name, conversion) => {
      const fetch = vi.fn().mockResolvedValue(successResponse(conversion));
      vi.stubGlobal("fetch", fetch);
      await mount();
      await clickAction();
      expect(host.textContent).not.toContain(
        "실제 KRW 환영 보상으로 전환 완료",
      );
      expect(host.querySelector('a[href^="/wallet/withdraw"]')).toBeNull();
      expect(host.textContent).toContain("전환 결과를 확인하지 못했어요");
      expect(host.textContent).toContain("다시 불러오기");
      expect(host.textContent).not.toContain("전환 준비됨");
      // The recovery button re-reads; it never repeats a possibly accepted command.
      await clickAction();
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([5000, "5000", null])(
    "valid API response with supported atomic representation %s keeps the existing conversion success path",
    async (amount) => {
      const conversion = {
        ...validConversion,
        converted_amount_atomic: amount,
        was_created: false,
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(successResponse(conversion)),
      );
      await mount();
      await clickAction();
      expect(host.textContent).toContain("실제 KRW 환영 보상으로 전환 완료");
      expect(host.querySelector("a")?.getAttribute("href")).toBe(
        `/wallet/withdraw?welcome=${conversionId}`,
      );
      expect(readWelcomeConversionSuccess({ data: { conversion } })).toEqual(
        conversion,
      );
    },
  );

  it("a malformed success does not overwrite a previously read REJECTED state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          successResponse({ ...validConversion, status: "APPROVED" }),
        ),
    );
    await mount({ id: conversionId, status: "REJECTED" });
    await clickAction();
    expect(host.textContent).toContain("지금은 전환할 수 없어요");
    expect(host.textContent).not.toContain("전환 준비됨");
  });

  it.each([
    {},
    null,
    [],
    { data: { conversion: validConversion }, error: { code: "CONTRADICTORY" } },
  ])(
    "malformed or contradictory envelope %j is not a confirmed conversion",
    (payload) => {
      expect(readWelcomeConversionSuccess(payload)).toBeNull();
    },
  );

  it("invalid JSON in a 200 exposes re-read recovery rather than success or retrying conversion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{", { status: 200 })),
    );
    await mount();
    await clickAction();
    expect(host.textContent).toContain("다시 불러오기");
    expect(host.textContent).not.toContain("전환 완료");
  });

  it("malformed error message values do not crash the recovery UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: { raw: "not copy" } } }),
            { status: 503 },
          ),
        ),
    );
    await mount();
    await clickAction();
    expect(host.textContent).toContain("보상 전환 결과를 확인하지 못했어요");
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
  });

  it.each([
    "WELCOME_REWARD_KYC_REQUIRED",
    "WELCOME_REWARD_RISK_REVIEW_REQUIRED",
    "TRIAL_NOT_COMPLETED",
    "WELCOME_REWARD_AMOUNT_UNAVAILABLE",
  ])(
    "verified 409 %s permits an explicit manual retry without rendering arbitrary server text",
    async (code) => {
      const fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code, message: "qa arbitrary message never rendered" },
            }),
            { status: 409 },
          ),
        ),
      );
      vi.stubGlobal("fetch", fetch);
      await mount();
      await clickAction();
      expect(host.textContent).toContain("환영 보상 자격 확인하기");
      expect(host.textContent).not.toContain("화면 다시 불러오기");
      expect(host.textContent).not.toContain("qa arbitrary");
      expect(fetch).toHaveBeenCalledOnce();
      await clickAction();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain("전환 완료");
    },
  );

  it.each([
    [
      503,
      {
        error: {
          code: "WELCOME_REWARD_CONVERSION_FAILED",
          message: "환영 보상을 전환하지 못했습니다.",
        },
      },
    ],
    [500, { error: { code: "INTERNAL_ERROR", message: "error" } }],
    [502, { error: { code: "GATEWAY", message: "error" } }],
    [504, { error: { code: "GATEWAY_TIMEOUT", message: "error" } }],
    [503, { error: { code: "WELCOME_REWARD_KYC_REQUIRED", message: "error" } }],
    [400, { error: { code: "INVALID_IDEMPOTENCY_KEY", message: "error" } }],
    [401, { error: { code: "UNAUTHENTICATED", message: "error" } }],
    [404, { error: { code: "NOT_FOUND", message: "error" } }],
    [422, { error: { code: "TRIAL_NOT_COMPLETED", message: "error" } }],
    [409, { error: { code: "UNKNOWN_REJECTION", message: "error" } }],
    [409, { error: { code: "toString", message: "error" } }],
    [409, { error: { code: 17, message: "error" } }],
    [409, { error: { code: "TRIAL_NOT_COMPLETED", message: {} } }],
    [409, { error: { code: "TRIAL_NOT_COMPLETED", message: " " } }],
    [409, { error: { code: "TRIAL_NOT_COMPLETED" } }],
    [409, { error: [{ code: "TRIAL_NOT_COMPLETED", message: "error" }] }],
    [
      409,
      { data: null, error: { code: "TRIAL_NOT_COMPLETED", message: "error" } },
    ],
    [
      409,
      {
        data: { conversion: validConversion },
        error: { code: "TRIAL_NOT_COMPLETED", message: "error" },
      },
    ],
    [409, {}],
    [409, null],
    [409, []],
  ])(
    "uncertain HTTP %i/envelope %j provides re-read only, never another conversion POST",
    async (status, payload) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(payload), { status: status as number }),
        );
      vi.stubGlobal("fetch", fetch);
      await mount();
      await clickAction();
      expect(host.textContent).toContain("화면 다시 불러오기");
      expect(host.textContent).not.toContain("환영 보상 자격 확인하기");
      expect(host.textContent).not.toContain("전환 완료");
      await clickAction();
      expect(fetch).toHaveBeenCalledOnce();
      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );

  it("malformed JSON in a non-ok response remains uncertain even after identical server props return", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await clickAction();
    await clickAction();
    await mount();
    expect(host.textContent).toContain("화면 다시 불러오기");
    expect(host.textContent).not.toContain("전환 완료");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
