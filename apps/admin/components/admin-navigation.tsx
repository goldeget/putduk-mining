"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "오늘의 퍼뜩" },
  { href: "/deposits/usdt", label: "USDT 입금 확인" },
  { href: "/deposits/krw", label: "원화 입금 확인" },
  { href: "/withdrawals/krw-bank", label: "계좌 출금" },
  { href: "/withdrawals/usdt", label: "USDT 출금" },
  { href: "/kyc", label: "본인 확인 검토" },
  { href: "/exceptions", label: "정산·대사 예외" },
  { href: "/restrictions", label: "제한·안전 모드" },
  { href: "/members", label: "회원 종합 정보" },
] as const;

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="운영자 주 메뉴">
      {items.map((item, index) => {
        const current =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            href={item.href as Route}
            key={item.href}
            aria-current={current ? "page" : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
