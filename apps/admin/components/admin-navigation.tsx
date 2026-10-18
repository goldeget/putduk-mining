"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const items = [
  { href: "/", label: "오늘의 퍼뜩" },
  { href: "/assistant", label: "운영 도우미" },
  { href: "/deposits/usdt", label: "USDT 입금 확인" },
  { href: "/deposits/krw", label: "원화 입금 확인" },
  { href: "/withdrawals/krw-bank", label: "계좌 출금" },
  { href: "/withdrawals/usdt", label: "USDT 출금" },
  { href: "/kyc", label: "본인 확인 검토" },
  { href: "/exceptions", label: "정산·대사 예외" },
  { href: "/restrictions", label: "제한·안전 모드" },
  { href: "/economy", label: "채굴 정책" },
  { href: "/catalog", label: "상품 검토" },
  { href: "/members", label: "회원 종합 정보" },
  { href: "/ai-conversations", label: "회원 AI 대화" },
  { href: "/content", label: "이벤트·공지" },
] as const;

function scrollNavToTop(nav: HTMLElement | null) {
  nav?.scrollTo?.(0, 0);
}

function scrollNavLinkIntoView(nav: HTMLElement, link: HTMLElement) {
  if (!nav.contains(link)) {
    link.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return;
  }
  const navRect = nav.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  const linkFits = linkRect.height <= navRect.height + 1;
  // A destination taller than the menu used to align its bottom, which
  // pushed the top above the nav. Keep the top inside the menu instead.
  if (!linkFits || linkRect.top < navRect.top - 1) {
    nav.scrollTop += linkRect.top - navRect.top;
  } else if (linkRect.bottom > navRect.bottom + 1) {
    nav.scrollTop += linkRect.bottom - navRect.bottom;
  }
  const settled = link.getBoundingClientRect();
  const settledNav = nav.getBoundingClientRect();
  if (settled.top < settledNav.top - 1) {
    nav.scrollTop += settled.top - settledNav.top;
  }
  const maxScroll = Math.max(0, nav.scrollHeight - nav.clientHeight);
  nav.scrollTop = Math.min(maxScroll, Math.max(0, nav.scrollTop));
}

function focusedNavLink(nav: HTMLElement) {
  const active = nav.ownerDocument.activeElement;
  const link = active instanceof HTMLElement ? active.closest("a") : null;
  return link instanceof HTMLElement && nav.contains(link) ? link : null;
}

function syncNavScroll(nav: HTMLElement | null) {
  if (!nav) return;
  const link = focusedNavLink(nav);
  if (link) {
    scrollNavLinkIntoView(nav, link);
    return;
  }
  scrollNavToTop(nav);
}

export function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    syncNavScroll(navRef.current);
  }, [pathname]);

  useEffect(() => {
    const resetScroll = () => syncNavScroll(navRef.current);
    window.addEventListener("resize", resetScroll);
    return () => window.removeEventListener("resize", resetScroll);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    const root = nav?.ownerDocument?.documentElement;
    if (!nav || !root || typeof ResizeObserver === "undefined") return;
    const syncScroll = () => syncNavScroll(nav);
    const observer = new ResizeObserver(syncScroll);
    observer.observe(nav);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let framing = false;
    const frameLink = (link: HTMLElement) => {
      if (framing) return;
      framing = true;
      scrollNavLinkIntoView(nav, link);
      framing = false;
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !nav.contains(target)) return;
      const link = target.closest("a");
      if (!(link instanceof HTMLElement)) return;
      frameLink(link);
      nav.ownerDocument.defaultView?.requestAnimationFrame(() => {
        if (nav.contains(link)) frameLink(link);
      });
    };
    const onScroll = () => {
      const link = focusedNavLink(nav);
      if (link) frameLink(link);
    };
    nav.addEventListener("focusin", onFocusIn);
    nav.addEventListener("scroll", onScroll);
    return () => {
      nav.removeEventListener("focusin", onFocusIn);
      nav.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav aria-label="운영자 주 메뉴" ref={navRef}>
      {items.map((item, index) => {
        const current =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            href={item.href as Route}
            key={item.href}
            aria-current={current ? "page" : undefined}
            onFocus={(event) => {
              const nav = navRef.current;
              const link = event.currentTarget;
              if (nav) {
                scrollNavLinkIntoView(nav, link);
                nav.ownerDocument.defaultView?.requestAnimationFrame(() => {
                  if (nav.contains(link)) scrollNavLinkIntoView(nav, link);
                });
                return;
              }
              link.scrollIntoView?.({
                block: "nearest",
                inline: "nearest",
              });
            }}
            onNavigate={() => onNavigate?.()}
          >
            <span className="control-nav__index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="control-nav__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
