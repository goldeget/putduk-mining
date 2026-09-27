import Link from "next/link";

import { logoutAction, logoutAllAction } from "@/app/actions";
import type { AdminPrincipal } from "@/lib/auth/principal";

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
          <Link href="/">
            <span>01</span>오늘의 퍼뜩
          </Link>
          <Link href="/members">
            <span>02</span>Member 360
          </Link>
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
