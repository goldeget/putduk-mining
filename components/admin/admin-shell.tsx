import type { ReactNode } from "react";
import Link from "next/link";

import { signOutAdminAction } from "@/app/admin/actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import type { AdminRole } from "@/lib/auth/session";

const sections = [
  ["overview", "Overview", "pulse"],
  ["users", "Users", "user"],
  ["trial", "Trial", "clock"],
  ["mining", "Mining", "mining"],
  ["economy", "Economy", "shield"],
  ["assets", "Assets", "wallet"],
  ["operations", "Operations", "event"],
  ["ai-trust", "AI & Trust", "ai"],
  ["system", "System", "menu"],
] as const;

export function AdminShell({
  children,
  role,
}: {
  children: ReactNode;
  role: AdminRole;
}) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link
          className="brand-lockup"
          href="/admin"
          aria-label="PUTDUK 운영 센터"
        >
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>OPERATIONS</small>
          </span>
        </Link>
        <nav aria-label="관리자 섹션">
          {sections.map(([anchor, label, icon]) => (
            <a href={`/admin#${anchor}`} key={anchor}>
              <PutdukIcon name={icon} size={19} />
              {label}
            </a>
          ))}
        </nav>
        <div className="admin-sidebar__boundary">
          <PutdukIcon name="shield" size={18} />
          <span>
            <small>MUTATION BOUNDARY</small>
            고위험 작업은 확인·사유·감사를 요구합니다
          </span>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-header">
          <div>
            <span className="admin-header__signal" />
            <span>CONTROL PLANE</span>
          </div>
          <div>
            <span className="admin-role">{role}</span>
            <form action={signOutAdminAction}>
              <button type="submit">로그아웃</button>
            </form>
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
