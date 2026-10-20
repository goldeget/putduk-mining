/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import SupportPage from "@/app/support/page";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) =>
    createElement(
      "a",
      { href, ...props, "data-framework-link": "true" },
      children,
    ),
}));
vi.mock("@/components/system/theme-control", () => ({
  ThemeControl: () => null,
}));
vi.mock("@/components/support/support-runtime", () => ({
  SupportStartButton: () => createElement("button", {}, "상담 시작"),
}));

const memberApp = "https://mining.putduk.com/";

function render(page: typeof HomePage) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(page));
  return host;
}

function installSection() {
  const section = render(SupportPage).querySelector("section#app-install");
  expect(section).not.toBeNull();
  return section!;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No network"))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("member app installation guidance", () => {
  it("offers a secondary homepage footer link to the local installation guide", () => {
    const footer = render(HomePage).querySelector("footer");
    const link = [...(footer?.querySelectorAll("a") ?? [])].find(
      (element) => element.textContent === "앱 설치 안내",
    );
    expect(link?.getAttribute("href")).toBe("/support#app-install");
    expect(link?.className).not.toContain("button--primary");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["https://putduk.com", "https://mining.putduk.com"])(
    "keeps the guide open while entering the member app from %s",
    (origin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
      const section = installSection();
      const heading = section.querySelector("h2");
      expect(heading?.textContent).toBe("앱 설치 안내");
      expect(section.getAttribute("aria-labelledby")).toBe(heading?.id);
      const entry = section.querySelector("a");
      expect(entry?.getAttribute("href")).toBe(memberApp);
      expect(entry?.textContent).toBe("회원 앱 열기");
      expect(entry?.getAttribute("target")).toBe("_blank");
      expect(entry?.rel.split(/\s+/)).toEqual(
        expect.arrayContaining(["noopener", "noreferrer"]),
      );
      expect(entry?.hasAttribute("data-framework-link")).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("directs installation to the member screen without depending on its support guide", () => {
    const section = installSection();
    expect(section.textContent).toContain("회원 앱 화면에서");
    expect(section.textContent).toContain("브라우저 설치 메뉴");
    expect(section.textContent).toContain("mining.putduk.com");
    expect(section.textContent).not.toContain("회원 앱 안내를 열고");
    expect(
      section.querySelector(
        'a[href="https://mining.putduk.com/support#app-install"]',
      ),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives browser-specific phone, tablet and desktop menu instructions", () => {
    const rows = [...installSection().querySelectorAll("article")];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toMatch(/iPhone.*iPad/);
    expect(rows[0]?.textContent).toMatch(/Safari.*공유.*홈 화면에 추가/);
    expect(rows[1]?.textContent).toMatch(/Android.*태블릿.*Galaxy Tab/);
    expect(rows[1]?.textContent).toMatch(
      /Chrome.*Samsung Internet.*앱 설치.*홈 화면에 추가/,
    );
    expect(rows[2]?.textContent).toMatch(/PC.*Chrome.*Edge.*설치/);
  });

  it("keeps installation user-directed with an honest unsupported-menu fallback", () => {
    const section = installSection();
    expect(
      section.querySelector("button, form, input, iframe, script"),
    ).toBeNull();
    expect(section.textContent).toMatch(/브라우저.*버전.*메뉴/);
    expect(section.textContent).toContain("브라우저에서 계속 이용");
    expect(
      [...section.querySelectorAll("a")].every(
        (link) => link.getAttribute("href") === memberApp,
      ),
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
