// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MfaGate } from "@/components/mfa-gate";

const mocks = vi.hoisted(() => ({
  factorId: undefined as unknown,
  prepareAdminMfaAction: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
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
vi.mock("@/app/mfa/actions", () => ({
  prepareAdminMfaAction: mocks.prepareAdminMfaAction,
}));

function trustedFactorId(value: unknown) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.prepareAdminMfaAction.mockImplementation(async () => {
    const factorId = mocks.factorId;
    if (!trustedFactorId(factorId)) {
      return {
        status: "retry",
        message:
          "인증 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도합니다.",
      } as const;
    }
    return {
      status: "ready",
      mode: "verify",
      factorId: factorId as string,
      enrolment: null,
      message: "인증 앱에 표시된 6자리 코드를 입력해 주세요.",
    } as const;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("malformed verified factor display recovery, without auth command changes", () => {
  it.each([undefined, null, "", "   ", 17, { id: "not-an-id" }])(
    "factor id %j exposes existing retry/login rather than unusable ready instructions",
    async (factorId) => {
      mocks.factorId = factorId;
      await act(async () =>
        root.render(createElement(MfaGate, { returnTo: "/today" })),
      );
      expect(host.textContent).toContain("인증 정보를 확인하지 못했습니다");
      expect(host.textContent).not.toContain(
        "인증 앱에 표시된 6자리 코드를 입력",
      );
      expect(
        host.querySelector<HTMLButtonElement>(".ghost-button")!.disabled,
      ).toBe(false);
      expect(host.querySelector('a[href="/login"]')?.textContent).toBe(
        "다시 로그인",
      );
      expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(
        true,
      );
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("a user retry with a trusted nonempty id restores the existing code-entry display only", async () => {
    mocks.factorId = "";
    await act(async () =>
      root.render(createElement(MfaGate, { returnTo: "/today" })),
    );
    mocks.factorId = "bca8ad9d-bfd6-4ccb-a5fb-bbba875a77fc";
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".ghost-button")!.click(),
    );
    expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(false);
    expect(
      host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    ).toBe(false);
    expect(host.querySelector(".ghost-button")).toBeNull();
    expect(host.textContent).toContain("인증 앱에 표시된 6자리 코드를 입력");
    expect(mocks.prepareAdminMfaAction).toHaveBeenCalledTimes(2);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
