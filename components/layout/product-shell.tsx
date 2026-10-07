"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { ProductHeader } from "@/components/layout/product-header";
import { WalletSidebar } from "@/components/layout/wallet-chrome";
import { ConnectivityStatus } from "@/components/system/connectivity-status";
import { PutdukAiDock } from "@/components/product/putduk-ai-dock";

import { MenuHeader, MenuSidebar } from "./menu-chrome";
import { RouteBrandHeader, RouteBrandSidebar } from "./route-brand-chrome";
import routeStyles from "./route-brand-chrome.module.css";
import menuStyles from "./menu-chrome.module.css";
import styles from "./product-shell.module.css";

export function ProductShell({
  children,
  displayName,
}: {
  children?: ReactNode;
  displayName: string;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/home";
  const isMining = pathname === "/mining";
  const isWallet = pathname === "/wallet";
  const isMenu = pathname === "/menu";
  const chromeView =
    pathname === "/products"
      ? "products"
      : pathname === "/ai" || pathname === "/menu/ai"
        ? "ai"
        : null;
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
    <div
      className={
        isMining
          ? `product-shell ${styles.miningShell}`
          : isWallet
            ? `product-shell ${styles.walletShell}`
            : isMenu
              ? `product-shell ${menuStyles.shell}`
              : chromeView
                ? `product-shell ${routeStyles.shell} ${chromeView === "ai" ? routeStyles.aiShell : routeStyles.productsShell}`
                : "product-shell"
      }
      data-home-page-active={isHome}
      data-mining-page-active={isMining}
      data-wallet-page-active={isWallet}
    >
      <ConnectivityStatus />
      {isMenu ? <MenuHeader displayName={displayName} /> : null}
      {chromeView ? (
        <RouteBrandHeader view={chromeView} displayName={displayName} />
      ) : null}
      {isWallet ? (
        <ProductHeader wallet="desktop" displayName={displayName} />
      ) : null}
      {isHome ? null : isMenu ? (
        <aside className={`product-sidebar ${menuStyles.sidebar}`}>
          <MenuSidebar />
        </aside>
      ) : chromeView ? (
        <aside className={`product-sidebar ${routeStyles.sidebar}`}>
          <RouteBrandSidebar view={chromeView} />
        </aside>
      ) : isWallet ? (
        <aside className={`product-sidebar ${styles.walletSidebar}`}>
          <WalletSidebar displayName={displayName} />
        </aside>
      ) : (
        <aside
          className={
            isMining
              ? `product-sidebar ${styles.miningSidebar}`
              : "product-sidebar"
          }
        >
          <Link className="brand-lockup" href="/home" aria-label="퍼뜩 채굴 홈">
            {isMining ? <MiningBrandSymbol /> : <BrandMark title="" />}
            <span>
              <strong>PUTDUK</strong>
              <small>MINING</small>
            </span>
          </Link>
          <ProductNavigation
            presentation={isMining ? "mining-sidebar" : "default"}
          />
          {isMining ? (
            <div className={styles.miningSidebarFooter}>
              <PutdukHomeIcon name="cube" size={72} />
              <p>
                TECHNOLOGY
                <br />
                CREATES A MORE
                <br />
                VALUABLE TOMORROW
              </p>
              <span aria-hidden="true" />
            </div>
          ) : (
            <div className="product-sidebar__principle">
              <PutdukIcon name="shield" size={18} />
              <span>
                <small>확인된 잔액</small>
                확인된 내역만 잔액에 반영됩니다
              </span>
            </div>
          )}
        </aside>
      )}
      <div
        className={`product-workspace ${styles.workspace}${isMenu ? ` ${menuStyles.workspace}` : ""}${chromeView ? ` ${routeStyles.workspace}` : ""}`}
        data-ai-page-active={pathname === "/ai" || pathname === "/menu/ai"}
        data-home-page-active={isHome}
        data-mining-page-active={isMining}
        data-wallet-page-active={isWallet}
      >
        {isHome || isMining || isWallet || isMenu || chromeView ? null : (
          <ProductHeader displayName={displayName} />
        )}
        <main
          ref={mainRef}
          id="main-content"
          className={`product-main ${styles.main}${isMenu ? ` ${menuStyles.main}` : ""}${chromeView ? ` ${routeStyles.main}` : ""}`}
          tabIndex={-1}
          onScroll={(event) => {
            scrollPositions.current.set(
              renderedPath.current,
              event.currentTarget.scrollTop,
            );
          }}
        >
          {isMining ? <ProductHeader mining displayName={displayName} /> : null}
          {isWallet ? (
            <ProductHeader wallet="mobile" displayName={displayName} />
          ) : null}
          {children}
        </main>
        {isHome || isMenu ? null : <PutdukAiDock />}
        <ProductNavigation />
      </div>
    </div>
  );
}

function MiningBrandSymbol() {
  return (
    <svg viewBox="0 0 40 56" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
      <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
      <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
      <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
      <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
      <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
    </svg>
  );
}
