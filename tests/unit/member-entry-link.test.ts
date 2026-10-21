/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href: string;
  }) =>
    createElement(
      "a",
      { ...props, href, "data-framework-link": "true" },
      children,
    ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/about" }));
vi.mock("@/components/system/theme-control", () => ({
  ThemeControl: () => null,
}));
vi.mock("@/components/support/support-runtime", () => ({
  SupportStartButton: () => createElement("button", {}, "상담 시작"),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function render(tree: ReactNode) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(tree);
  return host;
}

async function publicSurface(surface: "home" | "support" | "trust") {
  if (surface === "home")
    return render(createElement((await import("@/app/page")).default));
  if (surface === "support")
    return render(createElement((await import("@/app/support/page")).default));
  const { TrustShell } = await import("@/components/layout/trust-shell");
  return render(createElement(TrustShell, null, "Public document"));
}

describe("public account entry uses a document boundary only on the official apex", () => {
  for (const surface of ["home", "support", "trust"] as const) {
    it.each(["https://putduk.com", "https://mining.putduk.com"])(
      `${surface} preserves all account CTAs and public navigation on %s`,
      async (origin) => {
        vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
        vi.resetModules();
        const host = await publicSurface(surface);
        const entries = [
          ...host.querySelectorAll<HTMLAnchorElement>("a[href]"),
        ].filter((link) =>
          ["/login", "/signup"].includes(
            new URL(link.getAttribute("href")!, origin).pathname,
          ),
        );
        expect(entries).toHaveLength(surface === "home" ? 6 : 1);
        for (const link of entries) {
          const path = new URL(link.getAttribute("href")!, origin).pathname;
          expect(link.getAttribute("href")).toBe(
            origin === "https://putduk.com"
              ? `https://mining.putduk.com${path}`
              : path,
          );
          expect(link.hasAttribute("data-framework-link")).toBe(
            origin !== "https://putduk.com",
          );
          expect(link.textContent?.trim()).not.toBe("");
          expect(link.className).not.toBe("");
        }
        if (surface === "home") {
          expect(
            entries.filter((link) => link.pathname === "/login"),
          ).toHaveLength(2);
          expect(
            entries.filter((link) => link.pathname === "/signup"),
          ).toHaveLength(4);
        }
        if (surface === "trust")
          expect(entries[0]?.getAttribute("aria-label")).toBe(
            "로그인으로 이동",
          );
        const publicLinks = [
          ...host.querySelectorAll<HTMLAnchorElement>("header nav a[href]"),
        ];
        expect(publicLinks.length).toBeGreaterThan(0);
        for (const link of publicLinks) {
          expect(link.getAttribute("href")).toMatch(/^\/(?!\/)/);
          expect(link.getAttribute("data-framework-link")).toBe("true");
        }
      },
    );
  }

  it.each([
    "http://localhost:3000",
    "https://putduk-mining-member-staging-ab1de38.putduk-landing.workers.dev",
  ])(
    "retains the relative framework route for local or QA origin %s",
    async (origin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
      vi.resetModules();
      const { MemberEntryLink } =
        await import("@/components/layout/member-entry-link");
      const link = render(
        MemberEntryLink({ href: "/signup", children: "가입" }),
      ).querySelector("a");
      expect(link?.getAttribute("href")).toBe("/signup");
      expect(link?.getAttribute("data-framework-link")).toBe("true");
    },
  );

  it("does not select the apex boundary from a lookalike origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://putduk.com.evil.invalid");
    vi.resetModules();
    const { MemberEntryLink } =
      await import("@/components/layout/member-entry-link");
    const link = render(
      MemberEntryLink({ href: "/login", children: "로그인" }),
    ).querySelector("a");
    expect(link?.getAttribute("href")).toBe("/login");
    expect(link?.getAttribute("data-framework-link")).toBe("true");
  });

  it("preserves styling, accessible label and children in the native apex anchor", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://putduk.com");
    vi.resetModules();
    const { MemberEntryLink } =
      await import("@/components/layout/member-entry-link");
    const link = render(
      MemberEntryLink({
        href: "/login",
        className: "button button--secondary",
        "aria-label": "회원 로그인",
        children: createElement("span", {}, "로그인"),
      }),
    ).querySelector("a");
    expect(link?.outerHTML).toBe(
      '<a href="https://mining.putduk.com/login" class="button button--secondary" aria-label="회원 로그인"><span>로그인</span></a>',
    );
  });
});
