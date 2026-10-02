import type { ReactNode } from "react";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PublicNavigation } from "@/components/layout/public-navigation";
import { ThemeControl } from "@/components/system/theme-control";
import {
  TRUST_CONTENT_VERSION,
  TRUST_DOCUMENTS,
} from "@/lib/trust/public-content";
import { getTrustNavigationLabel } from "@/lib/trust/public-presentation";

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
              <small>신뢰 안내</small>
            </span>
          </Link>
          <PublicNavigation
            label="신뢰센터 주요 메뉴"
            links={primaryLinks.map(([href, label]) => ({ href, label }))}
          />
          <div className="trust-header__tools">
            <ThemeControl />
            <Link
              className="button button--secondary"
              href="/login"
              aria-label="로그인으로 이동"
            >
              <span>로그인</span>
              <PutdukIcon name="arrow-right" size={17} />
            </Link>
          </div>
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
        <PublicNavigation
          label="전체 신뢰센터 문서"
          links={TRUST_DOCUMENTS.map((document) => ({
            href: document.path,
            label: getTrustNavigationLabel(document.path),
          }))}
        />
      </footer>
    </div>
  );
}
