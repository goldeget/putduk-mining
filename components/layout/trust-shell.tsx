import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  TRUST_CONTENT_VERSION,
  TRUST_DOCUMENTS,
} from "@/lib/trust/public-content";

const primaryLinks = [
  ["/about", "소개"],
  ["/how-it-works", "작동 방식"],
  ["/putduk-facts", "공식 사실"],
  ["/status", "상태"],
] as const;

export function TrustShell({ children }: { children: ReactNode }) {
  return (
    <div className="trust-shell">
      <header className="trust-header">
        <div className="trust-header__inner">
          <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
            <BrandMark title="" />
            <span>
              <strong>PUTDUK</strong>
              <small>TRUST CENTER</small>
            </span>
          </Link>
          <nav aria-label="신뢰센터 주요 메뉴">
            {primaryLinks.map(([href, label]) => (
              <Link href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
          <Link className="button button--secondary" href="/login">
            계정으로 이동
            <PutdukIcon name="arrow-right" size={17} />
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <footer className="trust-footer">
        <div>
          <Link className="brand-lockup brand-lockup--footer" href="/">
            <BrandMark title="퍼뜩 채굴" />
            <span>
              <strong>PUTDUK</strong>
              <small>MINING</small>
            </span>
          </Link>
          <p>
            공개 사실 버전 <span>{TRUST_CONTENT_VERSION}</span>
          </p>
        </div>
        <nav aria-label="전체 신뢰센터 문서">
          {TRUST_DOCUMENTS.map((document) => (
            <Link href={document.path as Route} key={document.path}>
              {document.path}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
