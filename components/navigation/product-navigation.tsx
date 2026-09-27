"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  PutdukIcon,
  type PutdukIconName,
} from "@/components/icons/putduk-icon";

const items = [
  { href: "/home", icon: "home", label: "홈" },
  { href: "/mining", icon: "mining", label: "채굴" },
  { href: "/wallet", icon: "wallet", label: "자산" },
  { href: "/events", icon: "event", label: "이벤트" },
  { href: "/menu", icon: "menu", label: "메뉴" },
] as const satisfies ReadonlyArray<{
  href: "/events" | "/home" | "/menu" | "/mining" | "/wallet";
  icon: PutdukIconName;
  label: string;
}>;

export function ProductNavigation() {
  const pathname = usePathname();

  return (
    <nav className="product-navigation" aria-label="주요 메뉴">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            className={active ? "is-active" : undefined}
            href={item.href}
            aria-current={active ? "page" : undefined}
            key={item.href}
          >
            <PutdukIcon name={item.icon} size={21} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
