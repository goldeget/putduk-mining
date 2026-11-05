/** @vitest-environment jsdom */
// WORKROOM replaces the retired semiconductor/mining artwork. Keep actual signup protections under the approved image-independent design.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignupPage from "@/app/signup/page";
import { SignupForm } from "@/app/signup/signup-form";
import { signupAction, type SignupActionState } from "@/app/signup/actions";

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
function acknowledgement() {
  return host.querySelector<HTMLInputElement>(
    'input[name="workroomAcknowledged"]',
  )!;
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
async function fillAccount() {
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
}

describe("WORKROOM signup hierarchy and protected form behavior", () => {
  it("renders one semantic signup surface with real policy links and transparent practice disclosure", async () => {
    await render(createElement(SignupPage));
    expect(host.querySelectorAll("main")).toHaveLength(1);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toContain("시장의 흐름을");
    expect(host.querySelector("h2")?.textContent).toBe(
      "추천인 코드로 가입하세요",
    );
    expect(host.querySelectorAll('form[aria-label="회원가입"]')).toHaveLength(
      1,
    );
    expect(host.querySelector('a[href="/"]')?.textContent).toContain(
      "WORKROOM",
    );
    expect(host.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(host.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(host.textContent).toContain("100,000 P");
    expect(host.textContent).toContain(
      "현금으로 전환하거나 출금할 수 없습니다",
    );
    expect(host.querySelector('button[aria-label="Google 로그인"]')).toBeNull();
    expect(host.textContent).not.toMatch(
      /채굴|MINING|PUTDUK START|ChatGPT|₩|54,281|5,000,000,000|VIP|휴대폰 인증|SMS/,
    );
  });
  it("keeps native account field constraints, help associations, code and required consents", async () => {
    await render(createElement(SignupForm));
    const requirements = {
      "signup-referral-code": ["referralCode", "text"],
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
    expect(input("signup-referral-code").maxLength).toBe(64);
    expect(acknowledgement().required).toBe(true);
    expect(acknowledgement().labels?.length).toBe(1);
    expect(input("consent-service").required).toBe(true);
    expect(input("consent-privacy").required).toBe(true);
    expect(input("consent-marketing").required).toBe(false);
    await act(async () => input("consent-all").click());
    let payload = new FormData(host.querySelector("form")!);
    expect(payload.get("serviceTermsConsent")).toBe("on");
    expect(payload.get("privacyConsent")).toBe("on");
    expect(payload.get("marketingConsent")).toBe("on");
    // The separate practice acknowledgment requires its own explicit action.
    expect(payload.get("workroomAcknowledged")).toBeNull();
    await act(async () => input("consent-marketing").click());
    payload = new FormData(host.querySelector("form")!);
    expect(payload.get("marketingConsent")).toBeNull();
    expect(input("consent-service").checked).toBe(true);
    expect(input("consent-privacy").checked).toBe(true);
    expect(
      host.querySelector("#signup-service-terms p")?.textContent,
    ).toContain("현금으로 전환하거나 출금할 수 없습니다");
  });
  it("blocks native submission until both referral code and practice acknowledgment are supplied", async () => {
    await render(createElement(SignupForm));
    await fillAccount();
    const form = host.querySelector("form")!;
    expect(input("signup-referral-code").validity.valueMissing).toBe(true);
    expect(acknowledgement().validity.valueMissing).toBe(true);
    await act(async () => form.requestSubmit());
    expect(signupAction).not.toHaveBeenCalled();
    await enter("signup-referral-code", "WORKROOM-REVIEW");
    expect(input("signup-referral-code").checkValidity()).toBe(true);
    expect(form.checkValidity()).toBe(false);
    await act(async () => form.requestSubmit());
    expect(signupAction).not.toHaveBeenCalled();
    await act(async () => acknowledgement().click());
    expect(form.checkValidity()).toBe(true);
  });
  it("retains password mismatch validation, correction and both typed values", async () => {
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
  it("submits the actual action payload, disables pending submit and retains controlled values through confirmation", async () => {
    let finish: ((state: SignupActionState) => void) | undefined;
    vi.mocked(signupAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(createElement(SignupForm));
    await fillAccount();
    await enter("signup-referral-code", "WORKROOM-REVIEW");
    await act(async () => acknowledgement().click());
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(signupAction).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(signupAction).mock.calls[0]?.[1];
    for (const [name, value] of Object.entries({
      legalName: "테스트 회원",
      dateOfBirth: "1990-01-01",
      loginId: "stage_user",
      recoveryEmail: "stage@example.invalid",
      password: "stage-password-safe",
      passwordConfirmation: "stage-password-safe",
      phone: "01012345678",
      serviceTermsConsent: "on",
      privacyConsent: "on",
      referralCode: "WORKROOM-REVIEW",
      workroomAcknowledged: "on",
    }))
      expect(payload?.get(name)).toBe(value);
    expect(payload?.get("marketingConsent")).toBeNull();
    const submit = host.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(input("signup-referral-code").value).toBe("WORKROOM-REVIEW");
    expect(input("signup-login-id").value).toBe("stage_user");
    await act(async () =>
      finish?.({
        fieldErrors: {},
        message: "이메일 확인을 마치면 WORKROOM으로 이어집니다.",
        status: "confirmation",
      }),
    );
    expect(submit.disabled).toBe(false);
    expect(
      host.querySelector('[role="status"].auth-form__message')?.textContent,
    ).toContain("WORKROOM");
    expect(input("signup-login-id").value).toBe("stage_user");
    expect(input("signup-password").value).toBe("stage-password-safe");
  });
});

describe("Image-independent WORKROOM identity and responsive form preservation", () => {
  it("renders an accessible linked vector mark without image downloads or art fallback controls", async () => {
    await render(createElement(SignupPage));
    const brand = host.querySelector('a[href="/"]')!;
    expect(brand.textContent).toContain("WORKROOM");
    expect(brand.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector("img,picture,source,canvas")).toBeNull();
    expect(host.querySelector("[data-signup-art-recovery]")).toBeNull();
    // Document-level image errors cannot blank the identity or replace the live form.
    await enter("signup-login-id", "retained_user");
    await enter("signup-referral-code", "RETAIN-CODE");
    await act(async () => window.dispatchEvent(new Event("error")));
    expect(brand.textContent).toContain("WORKROOM");
    expect(input("signup-login-id").value).toBe("retained_user");
    expect(input("signup-referral-code").value).toBe("RETAIN-CODE");
  });
  it.each([320, 760, 1440])(
    "keeps one labeled live form and field state after viewport changes to %ipx",
    async (width) => {
      await render(createElement(SignupPage));
      await enter("signup-login-id", "retained_user");
      await enter("signup-password", "retained-password");
      await enter("signup-referral-code", "RETAIN-CODE");
      await act(async () => acknowledgement().click());
      vi.stubGlobal("innerWidth", width);
      await act(async () => window.dispatchEvent(new Event("resize")));
      await render(createElement(SignupPage));
      expect(host.querySelectorAll("main")).toHaveLength(1);
      expect(host.querySelectorAll('form[aria-label="회원가입"]')).toHaveLength(
        1,
      );
      expect(input("signup-login-id").value).toBe("retained_user");
      expect(input("signup-password").value).toBe("retained-password");
      expect(input("signup-referral-code").value).toBe("RETAIN-CODE");
      expect(acknowledgement().checked).toBe(true);
      expect(host.querySelectorAll("h1")).toHaveLength(1);
      expect(host.textContent).not.toMatch(/채굴|PUTDUK START|MINING|ChatGPT/);
    },
  );
});
