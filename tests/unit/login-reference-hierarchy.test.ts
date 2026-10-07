/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthForm } from "@/app/login/auth-form";
import { LoginExperience } from "@/components/auth/login-experience";

const theme = vi.hoisted(() => ({ value: "dark" as "dark" | "light" }));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => theme.value,
}));
vi.mock("@/app/login/actions", () => ({ authenticateAction: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Login story reconstruction preserves the real account journey", () => {
  it.each(["dark", "light"] as const)(
    "%s keeps a unique named login region, accessible fields and real recovery routes outside decoration",
    async (resolvedTheme) => {
      theme.value = resolvedTheme;
      await act(async () =>
        root.render(
          createElement(
            LoginExperience,
            null,
            createElement(AuthForm, { nextPath: "/wallet" }),
          ),
        ),
      );
      expect(host.querySelectorAll("main")).toHaveLength(1);
      expect(host.querySelectorAll("h1")).toHaveLength(1);
      const heading = host.querySelector("h1")!;
      expect(heading.getAttribute("aria-label")).toBe("로그인");
      const panel = host.querySelector(
        `section[aria-labelledby="${heading.id}"]`,
      )!;
      const form = panel.querySelector("form")!;
      expect(form.getAttribute("aria-label")).toBe("계정 로그인");
      expect(form.closest('[aria-hidden="true"]')).toBeNull();
      for (const [id, name, label] of [
        ["login-identifier", "identifier", "아이디 또는 복구 이메일"],
        ["login-password", "password", "비밀번호"],
      ]) {
        const input = form.querySelector<HTMLInputElement>(`#${id}`)!;
        expect(input.name).toBe(name);
        expect(input.required).toBe(true);
        expect(input.labels?.[0]?.textContent).toBe(label);
      }
      expect(
        form.querySelector<HTMLInputElement>("#login-password")?.minLength,
      ).toBe(10);
      expect(
        form.querySelector<HTMLInputElement>('input[name="next"]')?.value,
      ).toBe("/wallet");
      expect(
        [...form.querySelectorAll('nav[aria-label="계정 찾기"] a')].map(
          (link) => link.getAttribute("href"),
        ),
      ).toEqual(["/find-id", "/recover"]);
      expect(form.querySelector('a[href="/signup"]')).not.toBeNull();
      expect(
        host.querySelector('[aria-label="퍼뜩 채굴 소개"] h2')?.textContent,
      ).toBe("작은 한 걸음이더 큰 가치를 만듭니다.");
      expect(host.textContent).not.toMatch(/Google|Apple|자동 로그인|₩|수익률/);
    },
  );
});
