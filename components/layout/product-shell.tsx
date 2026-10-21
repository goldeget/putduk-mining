"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand/brand-mark";
import { MiningBrandSymbol } from "@/components/product/mining-brand-symbol";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { ProductHeader } from "@/components/layout/product-header";
import { WalletSidebar } from "@/components/layout/wallet-chrome";
import { ConnectivityStatus } from "@/components/system/connectivity-status";

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
  const isWallet = pathname === "/wallet" || pathname.startsWith("/wallet/");
  const isMenu = pathname === "/menu";
  const chromeView =
    pathname === "/products" || pathname.startsWith("/products/")
      ? "products"
      : pathname === "/ai" || pathname === "/menu/ai"
        ? "ai"
        : pathname.startsWith("/menu/") ||
            pathname === "/events" ||
            pathname.startsWith("/events/") ||
            pathname === "/notifications" ||
            pathname === "/start"
          ? "member"
          : null;
  const secondaryActiveHref = pathname === "/start" ? "/home" : "/menu";
  const shellClassName = isMining
    ? `product-shell ${styles.memberExperience}`
    : isWallet
      ? `product-shell ${styles.memberExperience} ${styles.walletShell}`
      : isMenu
        ? `product-shell ${styles.memberExperience} ${menuStyles.shell}`
        : chromeView
          ? `product-shell ${styles.memberExperience} ${routeStyles.shell} ${chromeView === "ai" ? routeStyles.aiShell : chromeView === "products" ? routeStyles.productsShell : routeStyles.memberShell}`
          : `product-shell ${styles.memberExperience}`;
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const renderedPath = useRef(pathname);
  const restoringHistory = useRef(false);

  useLayoutEffect(() => {
    if (pathname !== "/products") return;
    const retainVisibleProductsSurface = () => {
      const main = mainRef.current;
      if (!main) return;
      const markers = document.querySelectorAll('[data-ui-ready="/products"]');
      let inMain = false;
      for (const marker of markers) {
        if (main.contains(marker)) {
          inMain = true;
          break;
        }
      }
      if (inMain) {
        for (const marker of markers) {
          if (!main.contains(marker)) marker.removeAttribute("data-ui-ready");
        }
      }
      // Next keeps the previous stream in a hidden id="S:*" segment. That copy
      // is not the active theme, and page-wide hero locators must see one node.
      const heroes = document.querySelectorAll(
        "section[aria-labelledby='catalog-hero-title']",
      );
      const visible: Element[] = [];
      for (const hero of heroes) {
        if (main.contains(hero) && !hero.closest('div[hidden][id^="S:"]')) {
          visible.push(hero);
        }
      }
      if (visible.length !== 1) return;
      const kept = visible[0];
      if (!kept) return;
      for (const hero of heroes) {
        if (hero === kept) continue;
        hero.removeAttribute("aria-labelledby");
        for (const scene of hero.querySelectorAll(
          "[data-catalog-hero-state]",
        )) {
          scene.removeAttribute("data-catalog-hero-state");
        }
      }
    };
    retainVisibleProductsSurface();
    const observer = new MutationObserver(retainVisibleProductsSurface);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "data-ui-ready",
        "aria-labelledby",
        "data-catalog-hero-state",
        "hidden",
        "id",
      ],
    });
    return () => observer.disconnect();
  }, [pathname]);

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
      className={shellClassName}
      data-home-page-active={isHome}
      data-mining-page-active={isMining}
      data-wallet-page-active={isWallet}
    >
      <a className={styles.skipLink} href="#main-content">
        본문으로 건너뛰기
      </a>
      <ConnectivityStatus />
      {isMenu ? <MenuHeader displayName={displayName} /> : null}
      {chromeView ? (
        <RouteBrandHeader
          view={chromeView}
          displayName={displayName}
          activeHref={secondaryActiveHref}
        />
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
          <RouteBrandSidebar
            view={chromeView}
            activeHref={secondaryActiveHref}
          />
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
              <strong>퍼뜩 채굴</strong>
              <small>PUTDUK MINING</small>
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
        {/* SIMPLIFIED_TRACK: AI is deep-link only (/ai via 더보기), not a peer dock CTA. */}
        <ProductNavigation />
      </div>
    </div>
  );
}
