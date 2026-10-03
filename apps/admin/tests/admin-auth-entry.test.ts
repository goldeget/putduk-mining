/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";
import MfaPage from "@/app/mfa/page";
import ReauthPage from "@/app/reauth/page";
import SessionExpiredPage from "@/app/session-expired/page";
import UnauthorizedPage from "@/app/unauthorized/page";
import { AdminAuthConnectionBoundary } from "@/components/auth/admin-auth-connection-boundary";

const mocks = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  requireIdentity: vi.fn(),
  prepare: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/principal", () => ({
  getAdminIdentityForLoginPage: mocks.getIdentity,
  requireAdminIdentity: mocks.requireIdentity,
}));
vi.mock("@/lib/auth/mfa-prepare", () => ({
  prepareAdminMfaOnServer: mocks.prepare,
}));
vi.mock("@/app/actions", () => ({ loginAction: vi.fn() }));
vi.mock("@/app/mfa/actions", () => ({ prepareAdminMfaAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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

function rendered(element: ReactNode) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIdentity.mockResolvedValue(null);
  mocks.requireIdentity.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue({
    status: "ready",
    mode: "verify",
    factorId: "fixture-factor",
    enrolment: null,
    message: "인증 앱에 표시된 6자리 코드를 입력해 주세요.",
  });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

describe("admin auth page composition preserves live authority boundaries", () => {
  it("keeps login selectors and generic denial without reflecting unknown input", async () => {
    const host = rendered(
      await LoginPage({
        searchParams: Promise.resolve({
          returnTo: "https://example.invalid/economy",
          denied: "private-error-key",
        }),
      }),
    );
    expect(host.querySelector("h1")?.textContent).toBe(
      "운영자 전용 보안 로그인",
    );
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(
      host.querySelector('input[name="returnTo"]')?.getAttribute("value"),
    ).toBe("/");
    expect(
      host.querySelector('input[name="email"]')?.getAttribute("type"),
    ).toBe("email");
    expect(
      host
        .querySelector('input[name="password"]')
        ?.getAttribute("autocomplete"),
    ).toBe("current-password");
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe(
      "보안 로그인",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "운영 권한이 없거나 세션이 거절되었습니다.",
    );
    expect(host.textContent).not.toContain("private-error-key");
    expect(host.querySelector('select[aria-label="화면 테마"]')).not.toBeNull();
    expect(host.querySelector('main[data-ui-ready="/login"]')).not.toBeNull();
    expect(host.querySelector("canvas, img")).toBeNull();
  });

  it.each([
    { aal: "aal2", destination: "/economy?policy=V1" },
    { aal: "aal1", destination: "/mfa?returnTo=%2Feconomy%3Fpolicy%3DV1" },
  ])(
    "server identity $aal keeps its original guarded destination",
    async ({ aal, destination }) => {
      mocks.getIdentity.mockResolvedValue({ role: "ADMIN", aal });
      await expect(
        LoginPage({
          searchParams: Promise.resolve({ returnTo: "/economy?policy=V1" }),
        }),
      ).rejects.toThrow(`REDIRECT:${destination}`);
    },
  );

  it("requires current identity before preparing any MFA registration", async () => {
    mocks.requireIdentity.mockRejectedValue(new Error("IDENTITY_REQUIRED"));
    await expect(
      MfaPage({ searchParams: Promise.resolve({ returnTo: "/economy" }) }),
    ).rejects.toThrow("IDENTITY_REQUIRED");
    expect(mocks.requireIdentity).toHaveBeenCalledWith("/economy");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("keeps the actual MFA gate and QR/key selectors from the server payload", async () => {
    mocks.prepare.mockResolvedValue({
      status: "ready",
      mode: "enroll",
      factorId: "fixture-factor",
      enrolment: {
        id: "fixture-factor",
        qrCode: "data:image/svg+xml,fixture",
        secret: "SYNTHETICUNITKEY",
      },
      message: "인증 앱에 QR을 등록한 뒤 6자리 코드를 입력해 주세요.",
    });
    const host = rendered(
      await MfaPage({
        searchParams: Promise.resolve({ returnTo: "/economy" }),
      }),
    );
    expect(host.querySelector("h1")?.textContent).toBe("운영자 본인 확인");
    expect(host.querySelector("main[data-ui-ready]")).toBeNull();
    expect(host.querySelector(".mfa-enrolment code")?.textContent).toBe(
      "SYNTHETICUNITKEY",
    );
    expect(
      host
        .querySelector('input[autocomplete="one-time-code"]')
        ?.getAttribute("inputmode"),
    ).toBe("numeric");
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe(
      "인증 완료",
    );
    expect(mocks.requireIdentity).toHaveBeenCalledBefore(mocks.prepare);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps safe returnTo on both recovery actions and rejects external destinations", async () => {
    for (const { returnTo, suffix } of [
      {
        returnTo: "/economy?policy=V1",
        suffix: "?returnTo=%2Feconomy%3Fpolicy%3DV1",
      },
      { returnTo: "//example.invalid/economy", suffix: "" },
    ]) {
      const host = rendered(
        await ReauthPage({
          searchParams: Promise.resolve({ returnTo, reason: "step-up" }),
        }),
      );
      expect(host.querySelector("h1")?.textContent).toBe("다시 확인해 주세요");
      expect(host.querySelector("a.gold-button")?.getAttribute("href")).toBe(
        `/login${suffix}`,
      );
      expect(host.querySelector("a.ghost-button")?.getAttribute("href")).toBe(
        `/mfa${suffix}`,
      );
      expect(host.textContent).toContain(
        "고위험 작업을 위해 인증 앱으로 다시 확인해 주세요.",
      );
      expect(host.textContent).not.toContain("impersonation");
    }
  });

  it.each([
    {
      code: "STEP_UP_REQUIRED",
      expected: "고위험 작업입니다. 인증 앱으로 다시 확인한 뒤 시도해 주세요.",
    },
    {
      code: "ROLE_FORBIDDEN",
      expected: "현재 역할로는 이 작업을 할 수 없습니다.",
    },
    {
      code: "PRIVATE_ENTITY_KEY",
      expected: "이 화면이나 명령을 실행할 권한이 없습니다.",
    },
  ])(
    "keeps the $code denial generic and does not claim permission was granted",
    async ({ code, expected }) => {
      const host = rendered(
        await UnauthorizedPage({ searchParams: Promise.resolve({ code }) }),
      );
      expect(host.querySelector("h1")?.textContent).toBe("권한이 없습니다");
      expect(host.textContent).toContain(expected);
      expect(host.textContent).not.toContain(code);
      expect(host.querySelector("a.gold-button")?.getAttribute("href")).toBe(
        "/",
      );
      expect(host.querySelector('main[data-ui-state="error"]')).not.toBeNull();
    },
  );

  it("keeps the expired-session recovery action and existing heading", () => {
    const host = rendered(createElement(SessionExpiredPage));
    expect(host.querySelector("h1")?.textContent).toBe("세션이 만료되었습니다");
    expect(host.querySelector("a.gold-button")?.getAttribute("href")).toBe(
      "/login",
    );
    expect(host.querySelector("a.gold-button")?.textContent).toBe(
      "다시 로그인",
    );
  });
});

describe("admin entry offline boundary", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  let connected = true;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    connected = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => connected);
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function mount(
    onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault()),
  ) {
    root = createRoot(host);
    await act(async () =>
      root?.render(
        createElement(
          AdminAuthConnectionBoundary,
          null,
          createElement(
            "form",
            { onSubmit },
            createElement("input", { name: "code", defaultValue: "123456" }),
            createElement("button", { type: "submit" }, "인증 완료"),
            createElement(
              "button",
              { type: "button", disabled: true },
              "기존 확인 중",
            ),
          ),
        ),
      ),
    );
    return onSubmit;
  }
  it("locks native controls offline, preserves input and keeps pending controls locked after reconnect", async () => {
    await mount();
    connected = false;
    await act(async () => window.dispatchEvent(new Event("offline")));
    const field = host.querySelector("input")!;
    const submit = host.querySelector('button[type="submit"]')!;
    expect(field.matches(":disabled")).toBe(true);
    expect(submit.matches(":disabled")).toBe(true);
    expect(field.value).toBe("123456");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "인터넷 연결이 끊겼어요.",
    );
    connected = true;
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(field.matches(":disabled")).toBe(false);
    expect(submit.matches(":disabled")).toBe(false);
    expect(
      host.querySelector('button[type="button"]')?.matches(":disabled"),
    ).toBe(true);
    expect(field.value).toBe("123456");
  });
  it("rejects an offline submission even before the offline event renders a notice", async () => {
    const onSubmit = await mount();
    connected = false;
    const event = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => host.querySelector("form")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("releases the connection observers when leaving the page", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await mount();
    await act(async () => root?.unmount());
    root = undefined;
    for (const event of ["online", "offline"]) {
      const [, listener] = add.mock.calls.find(([name]) => name === event)!;
      expect(
        remove.mock.calls.some(
          ([name, removed]) => name === event && removed === listener,
        ),
      ).toBe(true);
    }
  });
});
