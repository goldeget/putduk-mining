/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignupPage from "@/app/signup/page";
import { SignupForm } from "@/app/signup/signup-form";
import { signupAction, type SignupActionState } from "@/app/signup/actions";
import { SignupArtwork } from "@/components/auth/signup-artwork";

const theme = vi.hoisted(() => ({ value: "dark" as "dark" | "light" }));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => theme.value,
}));
vi.mock("@/app/signup/actions", () => ({
  signupAction: vi.fn(),
  checkSignupPhoneAvailability: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  theme.value = "dark";
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render(element: ReactNode) {
  await act(async () => root.render(element));
}
function input(id: string) {
  const field = host.querySelector<HTMLInputElement>(`#${id}`);
  if (!field) throw new Error(`missing real field ${id}`);
  return field;
}
async function enter(id: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input(id), value);
    input(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Signup reference hierarchy and protected form behavior", () => {
  it("has one live signup heading, real service/login routes and no invented public counters or referral action", async () => {
    await render(createElement(SignupPage));
    expect(host.querySelectorAll("main")).toHaveLength(1);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("회원가입");
    expect(host.querySelector('main[data-ui-ready="/signup"]')).not.toBeNull();
    expect(
      host.querySelector('[data-signup-layout="semiconductor"]'),
    ).not.toBeNull();
    const service = host.querySelector('nav[aria-label="서비스 메뉴"]');
    expect(
      Array.from(service!.querySelectorAll("a"), (a) => a.getAttribute("href")),
    ).toEqual(["/", "/mining", "/products", "/wallet", "/support"]);
    expect(host.querySelector('a[href="/login"]')).not.toBeNull();
    expect(host.querySelector('input[name="referralCode"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Google 로그인"]')).toBeNull();
    expect(host.textContent).not.toMatch(
      /₩|54,281|5,000,000,000|VIP|휴대폰 인증|SMS/,
    );
  });

  it("keeps every native field name, required constraint, help association and consent payload", async () => {
    await render(createElement(SignupForm));
    const requirements = {
      "signup-legal-name": ["legalName", "text"],
      "signup-date-of-birth": ["dateOfBirth", "date"],
      "signup-login-id": ["loginId", "text"],
      "signup-recovery-email": ["recoveryEmail", "email"],
      "signup-password": ["password", "password"],
      "signup-password-confirmation": ["passwordConfirmation", "password"],
      "signup-phone": ["phone", "tel"],
    };
    for (const [id, [name, type]] of Object.entries(requirements)) {
      const field = input(id);
      expect(field.name).toBe(name);
      expect(field.type).toBe(type);
      expect(field.required).toBe(true);
      expect(field.labels?.length).toBe(1);
      for (const help of field.getAttribute("aria-describedby")?.split(" ") ??
        [])
        expect(
          host.querySelector(`#${help}`)?.textContent?.trim(),
        ).toBeTruthy();
    }
    expect(input("signup-password").minLength).toBe(10);
    expect(input("signup-login-id").pattern).toBe("[a-z][a-z0-9_]{3,19}");
    expect(input("consent-service").required).toBe(true);
    expect(input("consent-privacy").required).toBe(true);
    expect(input("consent-marketing").required).toBe(false);
    await act(async () => input("consent-all").click());
    let payload = new FormData(host.querySelector("form")!);
    expect(payload.get("serviceTermsConsent")).toBe("on");
    expect(payload.get("privacyConsent")).toBe("on");
    expect(payload.get("marketingConsent")).toBe("on");
    await act(async () => input("consent-marketing").click());
    payload = new FormData(host.querySelector("form")!);
    expect(payload.get("marketingConsent")).toBeNull();
    expect(input("consent-service").checked).toBe(true);
    expect(input("consent-privacy").checked).toBe(true);
    expect(
      host.querySelector("#signup-service-terms p")?.textContent,
    ).toContain("체험 값은 실제 자산이 아닙니다.");
  });

  it("retains password mismatch validation, recovery and both typed values", async () => {
    await render(createElement(SignupForm));
    await enter("signup-password", "stage-password-safe");
    await enter("signup-password-confirmation", "different-password-safe");
    const submit = host.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(submit.disabled).toBe(true);
    expect(
      input("signup-password-confirmation").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      host
        .querySelector("#signup-password-confirmation-help")
        ?.getAttribute("role"),
    ).toBe("alert");
    await enter("signup-password-confirmation", "stage-password-safe");
    expect(submit.disabled).toBe(false);
    expect(input("signup-password").value).toBe("stage-password-safe");
    expect(input("signup-password-confirmation").value).toBe(
      "stage-password-safe",
    );
  });

  it("uses the unchanged action seam, native pending button and actual confirmation state without losing inputs", async () => {
    let finish: ((state: SignupActionState) => void) | undefined;
    vi.mocked(signupAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(createElement(SignupForm));
    await enter("signup-legal-name", "테스트 회원");
    await enter("signup-date-of-birth", "1990-01-01");
    await enter("signup-login-id", "stage_user");
    await enter("signup-recovery-email", "stage@example.invalid");
    await enter("signup-password", "stage-password-safe");
    await enter("signup-password-confirmation", "stage-password-safe");
    await enter("signup-phone", "01012345678");
    await act(async () => {
      input("consent-service").click();
      input("consent-privacy").click();
    });
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(signupAction).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(signupAction).mock.calls[0]?.[1];
    expect(payload?.get("legalName")).toBe("테스트 회원");
    expect(payload?.get("dateOfBirth")).toBe("1990-01-01");
    expect(payload?.get("loginId")).toBe("stage_user");
    expect(payload?.get("recoveryEmail")).toBe("stage@example.invalid");
    expect(payload?.get("password")).toBe("stage-password-safe");
    expect(payload?.get("passwordConfirmation")).toBe("stage-password-safe");
    expect(payload?.get("serviceTermsConsent")).toBe("on");
    expect(payload?.get("privacyConsent")).toBe("on");
    expect(payload?.get("phone")).toBe("01012345678");
    expect(payload?.get("marketingConsent")).toBeNull();
    const submit = host.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    await act(async () =>
      finish?.({
        fieldErrors: {},
        message: "이메일 확인을 마치면 PUTDUK START로 이어집니다.",
        status: "confirmation",
      }),
    );
    expect(submit.disabled).toBe(false);
    expect(
      host.querySelector('[role="status"].auth-form__message')?.textContent,
    ).toContain("PUTDUK START");
    expect(input("signup-login-id").value).toBe("stage_user");
  });
});

describe("Signup art source, theme and recovery", () => {
  it("uses the reviewed native portrait without upscale and existing desktop families as decorative art", async () => {
    await render(createElement(SignupArtwork));
    const portrait = host.querySelector('source[media="(max-width: 699px)"]');
    expect(portrait?.getAttribute("srcset")).toContain(
      "signup-semiconductor-mobile-dark-941-v1.avif 941w",
    );
    expect(portrait?.getAttribute("srcset")).not.toContain("960w");
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "login-semiconductor-dark-960-v1.webp",
    );
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(host.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("recovers through fallback and real retry without interfering with the signup form", async () => {
    await render(createElement(SignupPage));
    await enter("signup-login-id", "retained_user");
    await act(async () =>
      host.querySelector("img")!.dispatchEvent(new Event("error")),
    );
    expect(host.querySelectorAll("source")).toHaveLength(0);
    await act(async () =>
      host.querySelector("img")!.dispatchEvent(new Event("error")),
    );
    const retry = host.querySelector<HTMLButtonElement>(
      "[data-signup-art-recovery] button",
    )!;
    expect(retry.textContent).toBe("배경 다시 보기");
    await act(async () => retry.click());
    expect(host.querySelectorAll("source")).toHaveLength(4);
    expect(input("signup-login-id").value).toBe("retained_user");
  });

  it("uses the actual bright desktop family for the explicitly adapted Light composition", async () => {
    await render(createElement(SignupArtwork));
    theme.value = "light";
    await render(createElement(SignupArtwork));
    expect(
      host.querySelector('[data-signup-art-theme="light"]'),
    ).not.toBeNull();
    for (const source of host.querySelectorAll("source"))
      expect(source.getAttribute("srcset")).toContain(
        "login-semiconductor-light-",
      );
  });
});

describe("Signup art preserves responsive fallback and form state", () => {
  it.each([
    [
      "dark",
      true,
      "signup-semiconductor-mobile-dark-640-v1.webp",
      "941",
      "1672",
    ],
    ["dark", false, "login-semiconductor-dark-960-v1.webp", "1983", "793"],
    ["light", true, "login-semiconductor-light-960-v1.webp", "1983", "793"],
  ] as const)(
    "uses the current %s family after a real image error (mobile=%s)",
    async (resolvedTheme, mobile, filename, width, height) => {
      theme.value = resolvedTheme;
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: mobile })),
      );
      await render(createElement(SignupPage));
      await enter("signup-login-id", "retained_user");
      await act(async () =>
        host.querySelector("img")!.dispatchEvent(new Event("error")),
      );
      const fallback = host.querySelector("img")!;
      expect(host.querySelectorAll("source")).toHaveLength(0);
      expect(fallback.getAttribute("src")).toContain(filename);
      expect(fallback.getAttribute("width")).toBe(width);
      expect(fallback.getAttribute("height")).toBe(height);
      await act(async () => fallback.dispatchEvent(new Event("error")));
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "배경을 불러오지 못했어요.",
      );
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>(
            "[data-signup-art-recovery] button",
          )!
          .click(),
      );
      expect(host.querySelectorAll("source")).toHaveLength(4);
      expect(host.querySelector("img")?.getAttribute("src")).toContain(
        "signup-art-retry=1",
      );
      expect(input("signup-login-id").value).toBe("retained_user");
    },
  );
});
