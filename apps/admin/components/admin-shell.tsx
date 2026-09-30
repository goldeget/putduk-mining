import Link from "next/link";

import { logoutAction, logoutAllAction } from "@/app/actions";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { AdminNavigation } from "./admin-navigation";
import { ThemeControl } from "../../../components/system/theme-control";

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
          <small>운영</small>
        </Link>
        <AdminNavigation />
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
          <div className="control-topbar__tools">
            <ThemeControl />
            <p>admin.mining.putduk.com</p>
          </div>
        </header>
        <main className="control-main">{children}</main>
      </div>
    </div>
  );
}
