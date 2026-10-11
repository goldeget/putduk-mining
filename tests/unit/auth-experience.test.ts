/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthForm } from "@/app/login/auth-form";
import { SignupForm } from "@/app/signup/signup-form";
import { FindIdForm } from "@/app/find-id/find-id-form";
import { RecoveryForm } from "@/app/recover/recovery-form";
import { UpdatePasswordForm } from "@/app/auth/update-password/update-password-form";
import { AuthExperience } from "@/components/auth/auth-experience";
import { GLOBAL_PAVILION_ASSET } from "@/components/brand/global-pavilion";

vi.mock("@/app/login/actions", () => ({ authenticateAction: vi.fn() }));
vi.mock("@/app/signup/actions", () => ({
  signupAction: vi.fn(),
  checkSignupPhoneAvailability: vi.fn(),
}));
vi.mock("@/app/find-id/actions", () => ({ requestLoginIdLink: vi.fn() }));
vi.mock("@/app/recover/actions", () => ({ requestPasswordRecovery: vi.fn() }));
vi.mock("@/app/auth/update-password/actions", () => ({
  updatePasswordAction: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

describe("approved auth composition", () => {
  it("serves the approved responsive image as decoration with live, unique headings", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(
        AuthExperience,
        {
          route: "/login",
          titleId: "auth-title",
          eyebrow: "안전한 로그인",
          title: "나의 채굴로 돌아가기",
          description: "로그인하면 채굴 상태를 확인할 수 있어요.",
          panelTitle: "다시 만나 반가워요.",
          panelDescription: "계정 정보를 입력해 주세요.",
        },
        createElement(AuthForm, { nextPath: "/wallet" }),
      ),
    );
    const approved = GLOBAL_PAVILION_ASSET;
    const image = host.querySelector("picture img");
    expect(image?.getAttribute("src")).toBe(approved.path);
    expect(image?.getAttribute("width")).toBe(String(approved.width));
    expect(image?.getAttribute("height")).toBe(String(approved.height));
    expect(image?.getAttribute("alt")).toBe("");
    expect(
      image?.closest("div[aria-hidden]")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("나의 채굴로 돌아가기");
    const stage = host.querySelector('[data-auth-layout="stage"]');
    const story = host.querySelector('section[aria-labelledby="auth-title"]');
    const panel = host.querySelector(
      'section[aria-labelledby="auth-title-panel"]',
    );
    expect(stage).not.toBeNull();
    expect(story?.querySelector("[data-auth-scrim]")).not.toBeNull();
    expect(story?.querySelector("h1")).not.toBeNull();
    expect(panel?.querySelector("h2")?.textContent).toBe("다시 만나 반가워요.");
    expect(
      story &&
        panel &&
        story.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const submit = host.querySelector('button[type="submit"]');
    const recovery = host.querySelector(".auth-form__recovery");
    expect(
      submit &&
        recovery &&
        recovery.compareDocumentPosition(submit) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(host.textContent).not.toMatch(/₩|HBM|반도체|KOSPI|NYSE/);
    expect(host.querySelector('main[data-ui-ready="/login"]')).not.toBeNull();
    expect(
      host.querySelector('section[aria-labelledby="auth-title-panel"]'),
    ).not.toBeNull();
    for (const source of ["avif", "webp"].flatMap((format) =>
      [640, 960, 1280, 1536].map((width) => ({
        mimeType: `image/${format}`,
        assetPath: `/brand/scenes/global-pavilion/global-pavilion-${width}-v1.${format}`,
        width,
      })),
    )) {
      expect(
        [...host.querySelectorAll("source")].some(
          (node) =>
            node.type === source.mimeType &&
            node.srcset.includes(`${source.assetPath} ${source.width}w`),
        ),
      ).toBe(true);
    }
    expect(host.querySelector("canvas")).toBeNull();
    expect(host.querySelector('link[rel="preload"][as="image"]')).toBeNull();
    expect(
      host.querySelector('input[name="next"]')?.getAttribute("value"),
    ).toBe("/wallet");
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
});

describe("auth offline and reconnect", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  let online: boolean;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
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
  async function render(element: ReactNode) {
    root = createRoot(host);
    await act(async () => root?.render(element));
  }
  async function connection(value: boolean) {
    online = value;
    await act(async () =>
      window.dispatchEvent(new Event(value ? "online" : "offline")),
    );
  }

  for (const { name, element, fieldId } of [
    {
      name: "로그인",
      element: () => createElement(AuthForm, { nextPath: "/mining" }),
      fieldId: "login-identifier",
    },
    {
      name: "회원가입",
      element: () => createElement(SignupForm),
      fieldId: "signup-recovery-email",
    },
    {
      name: "아이디 찾기",
      element: () => createElement(FindIdForm),
      fieldId: "find-id-email",
    },
    {
      name: "비밀번호 재설정",
      element: () => createElement(RecoveryForm),
      fieldId: "recovery-email",
    },
    {
      name: "새 비밀번호",
      element: () => createElement(UpdatePasswordForm),
      fieldId: "new-password",
    },
  ]) {
    it(`${name}: keeps the entered value and cancels offline submission, then restores the action`, async () => {
      await render(element());
      const input = host.querySelector<HTMLInputElement>(`#${fieldId}`)!;
      const submit = host.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      const form = host.querySelector("form")!;
      input.value = "fixture@example.invalid";
      expect(submit.disabled).toBe(false);
      await connection(false);
      expect(submit.disabled).toBe(true);
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "인터넷 연결이 끊겼어요.",
      );
      expect(input.value).toBe("fixture@example.invalid");
      const submission = new Event("submit", {
        bubbles: true,
        cancelable: true,
      });
      await act(async () => form.dispatchEvent(submission));
      expect(submission.defaultPrevented).toBe(true);
      await connection(true);
      expect(submit.disabled).toBe(false);
      expect(host.querySelector(".auth-form__message--offline")).toBeNull();
      expect(input.value).toBe("fixture@example.invalid");
    });
  }

  it("keeps phone checks unavailable offline and releases every connection observer on unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await render(createElement(SignupForm));
    await connection(false);
    expect(
      host.querySelector<HTMLButtonElement>("#signup-phone + button")?.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>("#signup-login-id + button")
        ?.disabled,
    ).toBe(true);
    expect(host.textContent).not.toContain("휴대폰 인증");
    await connection(true);
    expect(
      host.querySelector<HTMLButtonElement>("#signup-phone + button")?.disabled,
    ).toBe(false);
    await act(async () => root?.unmount());
    root = undefined;
    for (const event of ["online", "offline"]) {
      const registrations = add.mock.calls.filter(([name]) => name === event);
      expect(registrations.length).toBeGreaterThan(0);
      for (const [, listener] of registrations) {
        expect(
          remove.mock.calls.some(
            ([name, removed]) => name === event && removed === listener,
          ),
        ).toBe(true);
      }
    }
  });
});
