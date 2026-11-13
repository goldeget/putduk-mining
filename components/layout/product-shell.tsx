"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { WorkroomBrand } from "@/components/workroom/identity";
import { ThemeControl } from "@/components/system/theme-control";
import { NotificationBell } from "@/components/workroom-app/notification-bell";
import { MemberSecondaryNavigation } from "@/components/workroom-app/member-secondary-navigation";
import styles from "@/components/workroom/workroom.module.css";
export function ProductShell({
  children,
  displayName,
}: {
  children?: ReactNode;
  displayName: string;
}) {
  const pathname = usePathname();
  const title = pathname.startsWith("/workroom/support")
    ? "1:1 문의"
    : pathname.startsWith("/notifications")
      ? "알림함"
      : pathname.includes("/history")
        ? "참여 내역"
        : pathname.includes("/points")
          ? "체험 포인트"
          : pathname.includes("/guide")
            ? "이용 안내"
            : pathname.startsWith("/workroom/cash") ||
                pathname.startsWith("/workroom/records")
              ? "실제 잔액 · 입출금"
              : pathname.startsWith("/workroom")
                ? "내 워크룸"
                : pathname.startsWith("/wallet")
                  ? "실제 자산 · 입출금"
                  : "내 계정";
  return (
    <div className={styles.theme}>
      <a className={styles.skip} href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className={styles.sidebar}>
        <WorkroomBrand />
        <ProductNavigation presentation="mining-sidebar" />
        <div className={styles.sideBottom}>
          <Link href="/workroom/cash">실제 잔액 · 입금·출금</Link>
          <Link href="/menu/account">내 계정 관리</Link>
          <Link href="/workroom/support">1:1 문의</Link>
          <Link href="/workroom/history">참여 내역</Link>
          <Link href="/workroom/points">체험 포인트</Link>
          <Link href="/workroom/guide">이용 안내</Link>
          <Link href="/workroom/records">실제 거래 기록</Link>
          <small>
            무료 시뮬레이션
            <br />
            체험 포인트는 출금할 수 없으며 실제 자산과 분리됩니다.
          </small>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <strong>{title}</strong>
          <div className={styles.topRight}>
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
            <Link href="/menu/account" aria-label="내 계정 관리">
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
