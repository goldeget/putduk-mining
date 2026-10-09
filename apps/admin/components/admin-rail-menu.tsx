"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";

import { AdminNavigation } from "./admin-navigation";

export function AdminRailMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    setOpen(false);
    if (open) toggle.current?.focus();
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
        <span className="brand-symbol">P</span>
        <strong>퍼뜩</strong>
        <small>운영</small>
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
      </div>
    </aside>
  );
}
