import Link from "next/link";
import type { Route } from "next";

import { logoutAction, logoutAllAction } from "@/app/actions";
import type { AdminPrincipal } from "@/lib/auth/principal";

const NAV = [
  { href: "/" as Route, label: "오늘의 퍼뜩", index: "01" },
  { href: "/deposits/usdt" as Route, label: "USDT 입금 확인", index: "02" },
  {
    href: "/withdrawals/krw-bank" as Route,
    label: "계좌 출금",
    index: "03",
  },
  { href: "/withdrawals/usdt" as Route, label: "USDT 출금", index: "04" },
  { href: "/kyc" as Route, label: "본인 확인 검토", index: "05" },
  { href: "/exceptions" as Route, label: "정산·대사 예외", index: "06" },
  { href: "/restrictions" as Route, label: "제한·안전 모드", index: "07" },
  { href: "/members" as Route, label: "Member 360", index: "08" },
] as const;

export function AdminShell({
  children,
  principal,
}: {
  children: React.ReactNode;
  principal: AdminPrincipal;
}) {
  return (
    <div className="control-shell">
      <aside className="control-rail">
        <Link className="brand-lockup brand-lockup--rail" href="/">
          <span className="brand-symbol">P</span>
          <strong>퍼뜩</strong>
          <small>CONTROL</small>
        </Link>
        <nav aria-label="운영자 주 메뉴">
          {NAV.map((item) => (
            <Link href={item.href} key={item.href}>
              <span>{item.index}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="operator-card">
          <span>보안 세션</span>
          <strong>{principal.role}</strong>
          <small>AAL2 · {principal.userId.slice(0, 8)}</small>
          <form action={logoutAction}>
            <button type="submit">이 기기 로그아웃</button>
          </form>
          <form action={logoutAllAction}>
            <button type="submit">모든 세션 종료</button>
          </form>
        </div>
      </aside>
      <div className="control-workspace">
        <header className="control-topbar">
          <div>
            <span className="status-dot" />
            AAL2 운영자 세션 확인됨
          </div>
          <p>admin.mining.putduk.com</p>
        </header>
        <main className="control-main">{children}</main>
      </div>
    </div>
  );
}
