"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { WorkroomBrand } from "@/components/workroom/identity";
import { ThemeControl } from "@/components/system/theme-control";
import { NotificationBell } from "@/components/workroom-app/notification-bell";
import { MemberSecondaryNavigation } from "@/components/workroom-app/member-secondary-navigation";
import { workroomPageTitle } from "./workroom-navigation";
import chrome from "./workroom-chrome.module.css";
import styles from "@/components/workroom/workroom.module.css";
export function ProductShell({
  children,
  displayName,
}: {
  children?: ReactNode;
  displayName: string;
}) {
  const pathname = usePathname();
  const title = workroomPageTitle(pathname);
  return (
    <div className={styles.theme}>
      <a className={styles.skip} href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className={styles.sidebar}>
        <WorkroomBrand />
        <ProductNavigation presentation="mining-sidebar" />
        <div className={styles.sideBottom}>
          <span className={styles.sideBottomLabel}>바로가기</span>
          <Link href="/workroom/history">참여 내역</Link>
          <Link href="/workroom/points">체험 포인트</Link>
          <Link href="/workroom/guide">이용 안내</Link>
          <small>
            무료 시뮬레이션
            <br />
            체험 포인트는 출금할 수 없으며 실제 자산과 분리됩니다.
          </small>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <strong className={chrome.title} title={title}>
            {title}
          </strong>
          <div className={`${styles.topRight} ${chrome.tools}`}>
            <NotificationBell />
            <div className={styles.themeControl}>
              <ThemeControl />
            </div>
            <span className={styles.badge}>
              {pathname.startsWith("/workroom/cash") ||
              pathname.startsWith("/workroom/records")
                ? "KRW WALLET"
                : "SIMULATION"}
            </span>
            <Link
              href="/menu/account"
              aria-label="내 계정 관리"
              title={displayName}
              className={chrome.account}
            >
              {displayName}
            </Link>
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <MemberSecondaryNavigation pathname={pathname} />
          {children}
        </main>
        <ProductNavigation />
      </div>
    </div>
  );
}
