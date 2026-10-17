import type { Route } from "next";
import Link from "next/link";

import { readMemberNoticeCta } from "@/domain/content/member-notice";

/** Defense in depth: only a complete source-bound, allowlisted CTA is linked. */
export function MemberNoticeCta({ notice }: { notice: unknown }) {
  const cta = readMemberNoticeCta(notice);
  if (!cta) return null;
  return (
    <Link className="button button--primary" href={cta.route as Route}>
      {cta.label}
    </Link>
  );
}
