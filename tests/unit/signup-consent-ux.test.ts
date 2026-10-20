/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupForm } from "@/app/signup/signup-form";
import { signupAction } from "@/app/signup/actions";

vi.mock("@/app/signup/actions", () => ({
  signupAction: vi.fn(),
  checkSignupPhoneAvailability: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));

describe("signup consent disclosure and draft preservation", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(SignupForm)));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });
  const field = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;

  it("explains optional consent without making it a signup requirement", () => {
    for (const id of [
      "consent-service",
      "consent-privacy",
      "consent-marketing",
    ])
      expect(field(id).checked).toBe(false);
    expect(field("consent-service").required).toBe(true);
    expect(field("consent-privacy").required).toBe(true);
    expect(field("consent-marketing").required).toBe(false);
    expect(host.querySelector("#signup-consents")?.textContent).toContain(
      "선택 항목이 포함돼요",
    );
    expect(
      host.querySelector("#signup-marketing-choice-help")?.textContent,
    ).toBe("동의하지 않아도 서비스를 이용할 수 있어요.");
    expect(field("consent-marketing").getAttribute("aria-describedby")).toBe(
      "signup-marketing-choice-help",
    );
  });

  it("opens each full document separately without toggling consent or clearing the draft", async () => {
    await act(async () => {
      const loginId = field("signup-login-id");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(loginId, "retained_reader");
      loginId.dispatchEvent(new Event("input", { bubbles: true }));
      field("consent-service").click();
    });
    for (const path of ["/terms", "/privacy"]) {
      const link = host.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)!;
      expect(link.target).toBe("_blank");
      expect(link.relList.contains("noopener")).toBe(true);
      expect(link.relList.contains("noreferrer")).toBe(true);
      expect(link.textContent).toContain("새 탭");
      expect(link.closest("label")).toBeNull();
      link.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      await act(async () => link.click());
      expect(field("signup-login-id").value).toBe("retained_reader");
      expect(field("consent-service").checked).toBe(true);
      expect(field("consent-privacy").checked).toBe(false);
      expect(field("consent-marketing").checked).toBe(false);
    }
    expect(signupAction).not.toHaveBeenCalled();
  });
});
