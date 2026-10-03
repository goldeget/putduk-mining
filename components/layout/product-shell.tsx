"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { ThemeControl } from "@/components/system/theme-control";
import { ConnectivityStatus } from "@/components/system/connectivity-status";
import { PutdukAiDock } from "@/components/product/putduk-ai-dock";

import styles from "./product-shell.module.css";

export function ProductShell({
  children,
  displayName,
}: {
  children?: ReactNode;
  displayName: string;
}) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const renderedPath = useRef(pathname);
  const restoringHistory = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      // Same-path hash/query history does not run the pathname effect below.
      // It must not turn the next ordinary link into a history restoration.
      restoringHistory.current =
        window.location.pathname !== renderedPath.current;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useLayoutEffect(() => {
    if (renderedPath.current === pathname) return;
    renderedPath.current = pathname;
    const top = restoringHistory.current
      ? (scrollPositions.current.get(pathname) ?? 0)
      : 0;
    restoringHistory.current = false;
    mainRef.current?.scrollTo({ top, left: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="product-shell">
      <ConnectivityStatus />
      <aside className="product-sidebar">
        <Link className="brand-lockup" href="/home" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <ProductNavigation />
        <div className="product-sidebar__principle">
          <PutdukIcon name="shield" size={18} />
          <span>
            <small>확인된 잔액</small>
            확인된 내역만 잔액에 반영됩니다
          </span>
        </div>
      </aside>
      <div className={`product-workspace ${styles.workspace}`}>
        <header className="product-header">
          <Link className="product-header__brand" href="/home">
            <BrandMark title="퍼뜩 채굴" />
          </Link>
          <div className="product-header__tools">
            <Link
              className="product-header__notification"
              href="/notifications"
              aria-label="알림 센터"
            >
              <PutdukIcon name="bell" size={19} />
            </Link>
            <ThemeControl />
            <div className="product-header__identity">
              <span>
                <small>회원</small>
                {displayName}
              </span>
              <span className="product-header__avatar" aria-hidden="true">
                <PutdukIcon name="user" size={18} />
              </span>
            </div>
          </div>
        </header>
        <main
          ref={mainRef}
          id="main-content"
          className={`product-main ${styles.main}`}
          tabIndex={-1}
          onScroll={(event) => {
            scrollPositions.current.set(
              renderedPath.current,
              event.currentTarget.scrollTop,
            );
          }}
        >
          {children}
        </main>
        <PutdukAiDock />
        <ProductNavigation />
      </div>
    </div>
  );
}
