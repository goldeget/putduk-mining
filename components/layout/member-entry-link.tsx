import type { AnchorHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

import { PUBLIC_SITE_ORIGIN } from "@/lib/trust/public-discovery";

export function MemberEntryLink({
  href,
  children,
  ...attributes
}: {
  href: "/login" | "/signup";
  children: ReactNode;
} & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "aria-label">) {
  if (PUBLIC_SITE_ORIGIN === "https://putduk.com") {
    return (
      <a href={`https://mining.putduk.com${href}`} {...attributes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...attributes}>
      {children}
    </Link>
  );
}
