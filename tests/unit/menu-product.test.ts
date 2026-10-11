// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MenuPage from "@/app/(product)/menu/page";
import { MENU_ITEMS } from "@/app/(product)/menu/menu-items";
import {
  maskEmail,
  maskPhone,
} from "@/app/(product)/menu/account/account-mask";
import {
  buildLoginPath,
  isSafeProtectedReturnPath,
} from "@/lib/auth/return-path";
import { requirePageUser } from "@/lib/auth/session";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";

vi.mock("@/lib/auth/session", () => ({
  requirePageUser: vi.fn(async () => ({ userId: "menu-member" })),
}));

vi.mock("@/lib/product/member-screen-facts", () => ({
  readMemberScreenFacts: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => createElement("a", { href, ...props }, children),
}));

describe("rendered menu hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readMemberScreenFacts).mockResolvedValue({
      availableKrwAtomic: "50000",
      displayName: "원본 회원",
      joinedAt: "2026-10-01T00:00:00.000Z",
      locale: "ko",
      rankName: null,
      walletUnavailable: false,
    });
  });

  it("introduces the menu before the genuine profile and preserves every destination", async () => {
    const html = renderToStaticMarkup(await MenuPage());
    const document = new DOMParser().parseFromString(html, "text/html");
    const page = document.querySelector('[data-ui-ready="/menu"]');
    expect(page?.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(page?.querySelector(":scope > header h1")?.textContent).toBe(
      "더보기",
    );
    expect(page?.children[2]?.getAttribute("aria-label")).toBe("내 프로필");
    const profile = document.querySelector('[aria-label="내 프로필"]');
    expect(profile?.textContent).toContain("원본 회원");
    expect(profile?.textContent).toContain("50,000 KRW");
    expect(profile?.textContent).toContain("2026년 10월 1일");
    expect(profile?.textContent).toContain("아직 표시할 수 없어요");
    expect(requirePageUser).toHaveBeenCalledWith("/menu");
    expect(readMemberScreenFacts).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "menu-member" }),
    );
    const hub = document.querySelector('nav[aria-label="더보기 메뉴"]');
    for (const item of MENU_ITEMS) {
      expect(
        hub?.querySelector(`a[href="${item.href}"]`)?.textContent,
      ).toContain(item.label);
    }
    const image = page?.firstElementChild?.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(hub?.querySelector('select[aria-label="화면 테마"]')).not.toBeNull();
  });

  it("keeps unavailable facts explicit and does not invent rank or security switches", async () => {
    vi.mocked(readMemberScreenFacts).mockResolvedValue({
      availableKrwAtomic: null,
      displayName: "확인 회원",
      joinedAt: null,
      locale: null,
      rankName: null,
      walletUnavailable: true,
    });
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(await MenuPage()),
      "text/html",
    );
    const profile = document.querySelector('[aria-label="내 프로필"]');
    expect(profile?.textContent).toContain("등급은 아직 없어요");
    expect(profile?.textContent).toContain("확인할 수 없음");
    expect(profile?.textContent).not.toContain("0 KRW");
    expect(document.body.textContent).not.toMatch(
      /L5 PRO|생체 인증|2단계 인증|54,281|보유 자산/,
    );
    expect(
      document.querySelector('input[type="checkbox"], [role="switch"]'),
    ).toBeNull();
    expect(
      [
        ...document.querySelectorAll('select[aria-label="화면 테마"] option'),
      ].map((option) => option.getAttribute("value")),
    ).toEqual(["system", "light", "dark"]);
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("menu hub navigation", () => {
  it("exposes account, notification center, and settings routes", () => {
    const hrefs = MENU_ITEMS.map((item) => item.href);
    expect(hrefs).toContain("/menu/account");
    expect(hrefs).toContain("/notifications");
    expect(hrefs).toContain("/menu/notifications");
    expect(hrefs).toContain("/ai");
    expect(hrefs).toContain("/support");
    expect(hrefs).toContain("/events");
    expect(
      MENU_ITEMS.filter((item) => item.lane === "settings").map(
        (item) => item.label,
      ),
    ).toEqual(expect.arrayContaining(["알림 설정", "퍼뜩 AI"]));
  });

  it("keeps Korean labels free of developer jargon", () => {
    for (const item of MENU_ITEMS) {
      expect(item.label).not.toMatch(/API|RPC|RLS|JWT|schema/i);
      expect(item.description).not.toMatch(/API|RPC|RLS|JWT|schema/i);
      expect(item.description.length).toBeLessThan(40);
    }
  });
});

describe("account masking", () => {
  it("masks email local-part while keeping the domain", () => {
    expect(maskEmail("putduk.member@example.com")).toBe("pu••••••@example.com");
    expect(maskEmail("ab@example.com")).toBe("ab••@example.com");
    expect(maskEmail("not-an-email")).toBe("등록됨");
  });

  it("shows only the last four phone digits", () => {
    expect(maskPhone("+821012345678")).toBe("••• •••• 5678");
    expect(maskPhone("12")).toBe("등록됨");
  });
});

describe("menu protected return paths", () => {
  it.each(["/menu", "/menu/account", "/menu/notifications", "/menu/ai"])(
    "preserves menu return path: %s",
    (path) => {
      expect(isSafeProtectedReturnPath(path)).toBe(true);
      expect(buildLoginPath(path)).toBe(
        `/login?next=${encodeURIComponent(path)}`,
      );
    },
  );
});
