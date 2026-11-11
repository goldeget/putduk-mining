"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";

import { AdminNavigation } from "./admin-navigation";

export function AdminRailMenu({
  children,
  footer,
}: {
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    setOpen(false);
    if (open) toggle.current?.focus();
    document
      .querySelector<HTMLElement>(
        '.control-rail nav[aria-label="운영자 주 메뉴"]',
      )
      ?.scrollTo?.(0, 0);
  }

  return (
    <aside
      className="control-rail"
      data-menu-open={open}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closeMenu();
        }
      }}
    >
      <Link
        className="brand-lockup brand-lockup--rail"
        href="/"
        onNavigate={closeMenu}
      >
        <span className="brand-symbol">
          {/* Existing local SVG avoids importing member-only runtime dependencies. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/workroom-icon.svg" width={44} height={44} alt="" />
        </span>
        <strong>WORKROOM</strong>
        <small>ADMIN CONSOLE</small>
      </Link>
      <button
        className="control-menu-toggle"
        type="button"
        ref={toggle}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        운영 메뉴 <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div className="control-rail__menu" id={menuId}>
        <AdminNavigation onNavigate={closeMenu} />
        {children}
        {footer}
      </div>
    </aside>
  );
}
