/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthForm } from "@/app/login/auth-form";
import { SignupForm } from "@/app/signup/signup-form";
import { UpdatePasswordForm } from "@/app/auth/update-password/update-password-form";

vi.mock("@/app/login/actions", () => ({ authenticateAction: vi.fn() }));
vi.mock("@/app/signup/actions", () => ({
  signupAction: vi.fn(),
  checkSignupPhoneAvailability: vi.fn(),
}));
vi.mock("@/app/auth/update-password/actions", () => ({
  updatePasswordAction: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

describe("public password controls", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render(element: ReactNode) {
    root = createRoot(host);
    await act(async () => root?.render(element));
  }

  function input(id: string): HTMLInputElement {
    const field = host.querySelector(`#${id}`);
    if (!(field instanceof HTMLInputElement))
      throw new Error(`Missing input: ${id}`);
    return field;
  }

  function reveal(id: string): HTMLButtonElement {
    const button = host.querySelector(`button[aria-controls~="${id}"]`);
    if (!(button instanceof HTMLButtonElement))
      throw new Error(`Missing reveal: ${id}`);
    return button;
  }

  function assertAssociatedHelp(field: HTMLInputElement) {
    for (const id of field.getAttribute("aria-describedby")?.split(" ") ?? []) {
      expect(host.querySelector(`#${id}`)?.textContent?.trim()).toBeTruthy();
    }
  }

  it("login reveal stays an independent control and preserves the entered password", async () => {
    await render(createElement(AuthForm, { nextPath: "/wallet" }));
    const password = input("login-password");
    password.value = "safe-password-value";
    const button = reveal("login-password");
    expect(password.labels?.[0]?.textContent).toBe("비밀번호");
    expect(button.closest("label")).toBeNull();
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button.click());
    expect(password.type).toBe("text");
    expect(password.value).toBe("safe-password-value");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button.click());
    expect(password.type).toBe("password");
    expect(password.value).toBe("safe-password-value");
    expect(
      host.querySelector('input[name="next"]')?.getAttribute("value"),
    ).toBe("/wallet");
  });

  it("signup exposes separate labels, stable help and independent reveal controls", async () => {
    await render(createElement(SignupForm));
    for (const id of ["signup-password", "signup-password-confirmation"]) {
      const password = input(id);
      const button = reveal(id);
      expect(password.labels?.length).toBe(1);
      expect(button.closest("label")).toBeNull();
      expect(password.autocomplete).toBe("new-password");
      assertAssociatedHelp(password);
    }
    await act(async () => reveal("signup-password").click());
    expect(input("signup-password").type).toBe("text");
    expect(input("signup-password-confirmation").type).toBe("password");
    await act(async () => reveal("signup-password-confirmation").click());
    expect(input("signup-password-confirmation").type).toBe("text");
    expect(input("signup-phone").labels?.[0]?.textContent).toBe("휴대전화");
    expect(input("signup-login-id").labels?.[0]?.textContent).toBe(
      "로그인 아이디",
    );
    expect(input("signup-date-of-birth").type).toBe("date");
    assertAssociatedHelp(input("signup-date-of-birth"));
    expect(host.textContent).toContain("태어난 연도, 월, 일을 선택해 주세요.");
    expect(host.textContent).not.toContain("휴대폰 인증");
  });

  it("password update toggles both fields without nesting the control in a label", async () => {
    await render(createElement(UpdatePasswordForm));
    const button = reveal("new-password");
    expect(button.closest("label")).toBeNull();
    expect(input("new-password").labels?.[0]?.textContent).toBe("새 비밀번호");
    assertAssociatedHelp(input("new-password"));
    await act(async () => button.click());
    expect(input("new-password").type).toBe("text");
    expect(input("password-confirmation").type).toBe("text");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});
