// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartTrialButton } from "@/components/product/start-trial-button";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/analytics/client", () => ({
  trackAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}));

const uuid = (id: number) =>
  `ab125100-0000-4000-8000-${String(id).padStart(12, "0")}`;
const technicalMessage = `SQL permission denied service_role admin.mining.putduk.com ${uuid(99)}`;
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let requestCounter: number;

beforeEach(() => {
  vi.clearAllMocks();
  requestCounter = 10;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { randomUUID: () => uuid(requestCounter++) });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  )!;
  expect(button).toBeDefined();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
function errorResponse(
  status: number,
  code: unknown,
  message = technicalMessage,
) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message } }),
  };
}

describe("real member action error presentation", () => {
  it.each([
    [401, "UNAUTHENTICATED", "로그인"],
    [400, "INVALID_IDEMPOTENCY_KEY", "화면을 다시 열고"],
    [409, "TRIAL_NOT_CONFIGURED", "지금은 체험을 시작할 수 없어요"],
    [503, "TRIAL_START_FAILED", "현재 체험 상태를 확인한 뒤"],
    [409, "UNKNOWN_SQL_FAILURE", "현재 체험 상태를 확인한 뒤"],
    [503, "TRIAL_NOT_CONFIGURED", "현재 체험 상태를 확인한 뒤"],
  ])(
    "renders reviewed START copy for %s/%s, never remote error text",
    async (status, code, copy) => {
      fetchMock.mockResolvedValue(errorResponse(Number(status), code));
      await mount(createElement(StartTrialButton));
      await click("첫 채굴 시작");
      expect(host.textContent).toContain(copy);
      expect(host.textContent).not.toContain(technicalMessage);
      expect(navigation.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    { error: null },
    { error: { code: 500 } },
    { error: { code: "TRIAL_NOT_CONFIGURED", message: {} } },
  ])("keeps malformed START replies uncertain: %j", async (payload) => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => payload,
    });
    await mount(createElement(StartTrialButton));
    await click("첫 채굴 시작");
    expect(host.textContent).toContain("체험 시작 결과를 확인하지 못했어요");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("reports a lost START response as unknown and retains the existing command request", async () => {
    fetchMock.mockRejectedValue(new Error(technicalMessage));
    await mount(createElement(StartTrialButton));
    await click("첫 채굴 시작");
    expect(host.textContent).toContain("체험 시작 결과를 받지 못했어요");
    expect(host.textContent).not.toContain(technicalMessage);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/trial/start", {
      method: "POST",
      headers: { "Idempotency-Key": uuid(10) },
    });
  });

  it("preserves the successful START refresh path", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { sessionId: uuid(7) } }),
    });
    await mount(createElement(StartTrialButton));
    await click("첫 채굴 시작");
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
