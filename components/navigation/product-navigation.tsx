"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  PutdukIcon,
  type PutdukIconName,
} from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import styles from "@/components/layout/product-shell.module.css";

const homeNavigationIcons = {
  "/home": "home",
  "/mining": "coins",
  "/products": "cube",
  "/wallet": "wallet",
  "/menu": "more",
} as const;

const items = [
  { href: "/home", icon: "home", label: "홈" },
  { href: "/mining", icon: "mining", label: "채굴" },
  { href: "/products", icon: "products", label: "상품" },
  { href: "/wallet", icon: "wallet", label: "지갑" },
  { href: "/menu", icon: "menu", label: "더보기" },
] as const satisfies ReadonlyArray<{
  href: "/products" | "/home" | "/menu" | "/mining" | "/wallet";
  icon: PutdukIconName;
  label: string;
}>;

const miningSidebarItems = [
  { href: "/mining", label: "채굴", icon: "coins" },
  { href: "/products", label: "상품", icon: "cube" },
  { href: "/wallet", label: "지갑", icon: "wallet" },
  { href: "/wallet?view=history", label: "거래내역", icon: "ledger" },
  { href: "/menu/account", label: "계정 보안", icon: "shield" },
  { href: "/support", label: "고객센터", icon: "support" },
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
            aria-current={item.href === pathname ? "page" : undefined}
          >
            {item.icon === "shield" ? (
              <PutdukIcon name="shield" size={24} />
            ) : item.icon === "support" ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 14v-3a8 8 0 0 1 16 0v3M19 17v1a3 3 0 0 1-3 3h-3" />
                <rect x="2" y="11" width="4" height="7" rx="2" />
                <rect x="18" y="11" width="4" height="7" rx="2" />
              </svg>
            ) : (
              <PutdukHomeIcon name={item.icon} size={25} metallic={false} />
            )}
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
          (item.href === "/menu" &&
            (pathname === "/ai" ||
              pathname === "/notifications" ||
              pathname === "/events" ||
              pathname.startsWith("/events/")));
        return (
          <Link
            className={active ? "is-active" : undefined}
            href={item.href}
            aria-current={active ? "page" : undefined}
            key={item.href}
          >
            {pathname === "/home" ||
            pathname === "/mining" ||
            pathname === "/wallet" ||
            pathname === "/menu" ||
            pathname === "/products" ||
            pathname === "/ai" ||
            pathname === "/menu/ai" ? (
              <PutdukHomeIcon
                name={homeNavigationIcons[item.href]}
                size={24}
                metallic={false}
              />
            ) : (
              <PutdukIcon name={item.icon} size={21} />
            )}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
