"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

type PublicNavigationLink = { href: string; label: string };

export function PublicNavigation({
  label,
  links,
}: {
  label: string;
  links: readonly PublicNavigationLink[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      {links.map((link) => (
        <Link
          href={link.href as Route}
          key={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
