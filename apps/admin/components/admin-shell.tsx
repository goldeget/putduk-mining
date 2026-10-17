import { logoutAction, logoutAllAction } from "@/app/actions";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { AdminRailMenu } from "./admin-rail-menu";
import { AdminScreenGuide } from "./presentation/admin-screen-guide";
import { ThemeControl } from "../../../components/system/theme-control";

const operatorRoleLabel: Record<AdminPrincipal["role"], string> = {
  SUPER_ADMIN: "최고 운영자",
  ADMIN: "운영자",
  CONTENT_ADMIN: "콘텐츠 운영자",
  SUPPORT_ADMIN: "고객 지원 운영자",
  VIEWER: "조회 담당자",
};

export function AdminShell({
  children,
  principal,
}: {
  children: React.ReactNode;
  principal: AdminPrincipal;
}) {
  return (
    <div className="control-shell">
      <a className="admin-skip-link" href="#admin-main-content">
        본문 바로가기
      </a>
      <AdminRailMenu>
        <div className="operator-card">
          <span>보안 세션</span>
          <strong>{operatorRoleLabel[principal.role]}</strong>
          <small>추가 본인 확인 완료</small>
          <form action={logoutAction}>
            <button type="submit">이 기기 로그아웃</button>
          </form>
          <form action={logoutAllAction}>
            <button type="submit">모든 세션 종료</button>
          </form>
        </div>
      </AdminRailMenu>
      <div className="control-workspace">
        <header className="control-topbar">
          <div>
            <span className="status-dot" />
            운영자 본인 확인 완료
          </div>
          <div className="control-topbar__tools">
            <AdminScreenGuide />
            <ThemeControl />
            <p>admin.mining.putduk.com</p>
          </div>
        </header>
        <main className="control-main" id="admin-main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
