import type { ReactNode } from "react";
import Link from "next/link";

import { WorkroomBrand } from "@/components/workroom/identity";
import { PublicNavigation } from "@/components/layout/public-navigation";
import { ThemeControl } from "@/components/system/theme-control";
import {
  TRUST_CONTENT_VERSION,
  TRUST_DOCUMENTS,
} from "@/lib/workroom/public-content";
import { getTrustNavigationLabel } from "@/lib/workroom/public-presentation";
import workroom from "@/components/workroom/workroom.module.css";
import styles from "./trust-shell.module.css";

const primaryLinks = [
  ["/about", "소개"],
  ["/how-it-works", "이용 방법"],
  ["/faq", "자주 묻는 질문"],
  ["/support", "고객지원"],
] as const;

export function TrustShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${workroom.theme} ${styles.shell}`}
      data-workroom-surface="public"
    >
      <a className={workroom.skip} href="#public-content">
        본문으로 건너뛰기
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <WorkroomBrand />
          <div className={styles.navArea}>
            <PublicNavigation
              label="신뢰센터 주요 메뉴"
              links={primaryLinks.map(([href, label]) => ({ href, label }))}
            />
            <Link className={styles.mobileLogin} href="/login">
              로그인
            </Link>
          </div>
          <div className={styles.tools}>
            <div className={workroom.themeControl}>
              <ThemeControl />
            </div>
            <Link
              className={`${workroom.secondary} ${styles.login}`}
              href="/login"
              aria-label="로그인으로 이동"
            >
              로그인 →
            </Link>
          </div>
        </div>
      </header>
      <main id="public-content" className={styles.content} tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div>
          <WorkroomBrand />
          <p>
            공개 사실 버전 <span>{TRUST_CONTENT_VERSION}</span>
          </p>
        </div>
        <div className={styles.footerLinks}>
          <PublicNavigation
            label="전체 신뢰센터 문서"
            links={TRUST_DOCUMENTS.map((document) => ({
              href: document.path,
              label: getTrustNavigationLabel(document.path),
            }))}
          />
        </div>
      </footer>
    </div>
  );
}
