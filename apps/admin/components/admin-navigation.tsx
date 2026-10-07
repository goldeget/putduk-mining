"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import type { AdminRole } from "@/lib/auth/policy";
import {
  canReadOperation,
  isOperationSection,
} from "@/lib/operations/registry";

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
  { href: "/members", label: "회원 종합 정보" },
  { href: "/operations/ledger", label: "거래 기록" },
  { href: "/operations/mining", label: "채굴 현황" },
  { href: "/operations/events", label: "행사 운영" },
  { href: "/operations/notices", label: "공지 운영" },
  { href: "/operations/notifications", label: "알림 전달" },
  { href: "/operations/support", label: "고객 지원" },
  { href: "/operations/audit", label: "보안·운영 기록" },
  { href: "/operations/analytics", label: "이용 현황" },
  { href: "/operations/system", label: "서비스 상태" },
] as const;

export function AdminNavigation({ role = "ADMIN" }: { role?: AdminRole }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const visible = items.filter((item) => {
    const section = item.href.split("/")[2];
    return (
      !section ||
      !isOperationSection(section) ||
      canReadOperation(section, role)
    );
  });
  return (
    <nav aria-label="운영자 주 메뉴">
      <button
        className="admin-menu-toggle"
        type="button"
        aria-controls={menuId}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        운영 메뉴 {expanded ? "접기" : "열기"}
      </button>
      <div className="admin-menu-links" id={menuId} data-expanded={expanded}>
        {visible.map((item, index) => {
          const current =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              href={item.href as Route}
              key={item.href}
              onClick={() => setExpanded(false)}
              aria-current={current ? "page" : undefined}
            >
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
