"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef } from "react";
import { ADMIN_MENU_ITEMS as items, isCurrentAdminItem } from "./admin-menu";

/** WORKROOM and the independent manual cash operations share this console. */
function scrollNavToTop(nav: HTMLElement | null) {
  nav?.scrollTo?.(0, 0);
}

function scrollNavLinkIntoView(nav: HTMLElement, link: HTMLElement) {
  if (!nav.contains(link)) {
    link.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return;
  }
  const place = () => {
    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const linkFits = linkRect.height <= navRect.height + 1;
    // A destination taller than the menu used to align its bottom, which
    // pushed the top above the nav. Keep the top inside the menu instead.
    let next = nav.scrollTop;
    if (!linkFits || linkRect.top < navRect.top - 1) {
      next += linkRect.top - navRect.top;
    } else if (linkRect.bottom > navRect.bottom + 1) {
      next += linkRect.bottom - navRect.bottom;
      const projectedTop = linkRect.top - (linkRect.bottom - navRect.bottom);
      if (projectedTop < navRect.top - 1) next += projectedTop - navRect.top;
    }
    const maxScroll = Math.max(0, nav.scrollHeight - nav.clientHeight);
    nav.scrollTop = Math.min(maxScroll, Math.max(0, next));
  };
  place();
  const settled = link.getBoundingClientRect();
  const settledNav = nav.getBoundingClientRect();
  if (
    settled.top < settledNav.top - 1 ||
    (settled.height <= settledNav.height + 1 &&
      settled.bottom > settledNav.bottom + 1)
  ) {
    place();
  }
}

function focusedNavLink(nav: HTMLElement) {
  const active = nav.ownerDocument.activeElement;
  const link = active instanceof HTMLElement ? active.closest("a") : null;
  return link instanceof HTMLElement && nav.contains(link) ? link : null;
}

function syncNavScroll(nav: HTMLElement | null) {
  if (!nav) return;
  const link = focusedNavLink(nav);
  if (link) {
    scrollNavLinkIntoView(nav, link);
    return;
  }
  scrollNavToTop(nav);
}

export function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    syncNavScroll(navRef.current);
  }, [pathname]);

  useEffect(() => {
    const resetScroll = () => syncNavScroll(navRef.current);
    window.addEventListener("resize", resetScroll);
    return () => window.removeEventListener("resize", resetScroll);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    const root = nav?.ownerDocument?.documentElement;
    if (!nav || !root || typeof ResizeObserver === "undefined") return;
    const syncScroll = () => syncNavScroll(nav);
    const observer = new ResizeObserver(syncScroll);
    observer.observe(nav);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let framing = false;
    const frameLink = (link: HTMLElement) => {
      if (framing) return;
      framing = true;
      scrollNavLinkIntoView(nav, link);
      framing = false;
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !nav.contains(target)) return;
      const link = target.closest("a");
      if (!(link instanceof HTMLElement)) return;
      frameLink(link);
      const view = nav.ownerDocument.defaultView;
      view?.queueMicrotask(() => {
        if (nav.contains(link)) frameLink(link);
      });
      view?.requestAnimationFrame(() => {
        if (nav.contains(link)) frameLink(link);
      });
    };
    const onScroll = () => {
      const link = focusedNavLink(nav);
      if (link) frameLink(link);
    };
    nav.addEventListener("focusin", onFocusIn);
    nav.addEventListener("scroll", onScroll);
    return () => {
      nav.removeEventListener("focusin", onFocusIn);
      nav.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav aria-label="운영자 주 메뉴" ref={navRef}>
      {items.map((item, index) => {
        const current = isCurrentAdminItem(
          item.href,
          pathname,
          searchParams.get("tab"),
        );
        return (
          <Fragment key={item.href}>
            {items[index - 1]?.group !== item.group && (
              <p className="control-nav__group">{item.group}</p>
            )}
            <Link
              href={item.href as Route}
              key={item.href}
              aria-current={current ? "page" : undefined}
              onFocus={(event) => {
                const nav = navRef.current;
                const link = event.currentTarget;
                if (nav) {
                  scrollNavLinkIntoView(nav, link);
                  const view = nav.ownerDocument.defaultView;
                  view?.queueMicrotask(() => {
                    if (nav.contains(link)) scrollNavLinkIntoView(nav, link);
                  });
                  view?.requestAnimationFrame(() => {
                    if (nav.contains(link)) scrollNavLinkIntoView(nav, link);
                  });
                  return;
                }
                link.scrollIntoView?.({
                  block: "nearest",
                  inline: "nearest",
                });
              }}
              onNavigate={() => onNavigate?.()}
            >
              <span className="control-nav__index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="control-nav__label">{item.label}</span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
