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
  const navRect = nav.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  if (linkRect.top < navRect.top - 1) {
    nav.scrollTop -= navRect.top - linkRect.top;
  } else if (linkRect.bottom > navRect.bottom + 1) {
    nav.scrollTop += linkRect.bottom - navRect.bottom;
  }
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
