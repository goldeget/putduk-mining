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
  if (linkRect.top < navRect.top - 1) {
    nav.scrollTop -= navRect.top - linkRect.top;
  } else if (linkRect.bottom > navRect.bottom + 1) {
    nav.scrollTop += linkRect.bottom - navRect.bottom;
  }
  const maxScroll = Math.max(0, nav.scrollHeight - nav.clientHeight);
  nav.scrollTop = Math.min(maxScroll, Math.max(0, nav.scrollTop));
}

export function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    scrollNavToTop(navRef.current);
  }, [pathname]);

  useEffect(() => {
    const resetScroll = () => scrollNavToTop(navRef.current);
    window.addEventListener("resize", resetScroll);
    return () => window.removeEventListener("resize", resetScroll);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    const root = nav?.ownerDocument?.documentElement;
    if (!nav || !root) return;
    const syncScroll = () => scrollNavToTop(nav);
    const observer = new ResizeObserver(syncScroll);
    observer.observe(nav);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && nav.contains(target)) {
        scrollNavLinkIntoView(nav, target);
      }
    };
    nav.addEventListener("focusin", onFocusIn);
    return () => nav.removeEventListener("focusin", onFocusIn);
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
