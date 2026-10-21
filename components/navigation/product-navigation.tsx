"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PutdukIconName } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import styles from "@/components/layout/product-shell.module.css";

const homeNavigationIcons = {
  "/home": "home",
  "/mining": "coins",
  "/wallet": "wallet",
  "/menu": "more",
} as const;

/** SIMPLIFIED_TRACK: 홈 · 채굴 · 지갑 · 더보기 — 상품/이벤트/AI는 peer CTA 아님. */
const items = [
  { href: "/home", icon: "home", label: "홈" },
  { href: "/mining", icon: "mining", label: "채굴" },
  { href: "/wallet", icon: "wallet", label: "지갑" },
  { href: "/menu", icon: "menu", label: "더보기" },
] as const satisfies ReadonlyArray<{
  href: "/home" | "/menu" | "/mining" | "/wallet";
  icon: PutdukIconName;
  label: string;
}>;

const miningSidebarItems = [
  { href: "/home", label: "홈", icon: "home" },
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/menu", label: "더보기", icon: "more" },
] as const;

export function ProductNavigation({
  presentation = "default",
}: {
  presentation?: "default" | "mining-sidebar";
} = {}) {
  const pathname = usePathname();

  if (presentation === "mining-sidebar") {
    return (
      <nav className={styles.miningSideNavigation} aria-label="채굴 전체 메뉴">
        {miningSidebarItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={
              pathname === item.href || pathname.startsWith(`${item.href}/`)
                ? "page"
                : undefined
            }
          >
            <PutdukHomeIcon name={item.icon} size={25} metallic={false} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="product-navigation" aria-label="주요 메뉴">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          (item.href === "/home" && pathname === "/start") ||
          (item.href === "/menu" &&
            (pathname === "/ai" ||
              pathname === "/notifications" ||
              pathname === "/events" ||
              pathname.startsWith("/events/") ||
              pathname === "/support" ||
              pathname === "/products" ||
              pathname.startsWith("/products/")));
        return (
          <Link
            className={active ? "is-active" : undefined}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            key={item.href}
          >
            <PutdukHomeIcon
              name={homeNavigationIcons[item.href]}
              size={24}
              metallic={false}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
