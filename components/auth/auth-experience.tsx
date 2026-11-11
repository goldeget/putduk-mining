import type { ReactNode } from "react";
import Link from "next/link";

import { WorkroomBrand, WorkroomMark } from "@/components/workroom/identity";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";

import styles from "./auth-experience.module.css";
import workroom from "@/components/workroom/workroom.module.css";

type AuthExperienceProps = {
  route: string;
  titleId: string;
  eyebrow: string;
  title: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  children?: ReactNode;
  footer?: ReactNode;
  spacious?: boolean;
  state?: "loaded" | "error";
};

/** The same canonical mark used by the workspace; no product illustration. */
export function AuthArtwork() {
  return (
    <div className={styles.artwork}>
      <WorkroomMark />
    </div>
  );
}

export function AuthExperience({
  route,
  titleId,
  eyebrow,
  title,
  description,
  panelTitle,
  panelDescription,
  children,
  footer,
  spacious = false,
  state = "loaded",
}: AuthExperienceProps) {
  return (
    <main
      className={`${workroom.theme} ${styles.root} ${spacious ? styles.spacious : ""}`}
      data-workroom-surface="auth"
      data-ui-ready={route}
      data-ui-state={state}
    >
      <div className={styles.stage}>
        <header className={styles.header}>
          <WorkroomBrand />
          <div className={workroom.themeControl}>
            <ThemeControl />
          </div>
        </header>
        <div className={styles.composition} data-auth-layout="workroom">
          <section className={styles.story} aria-labelledby={titleId}>
            <div aria-hidden="true">
              <AuthArtwork />
            </div>
            <div>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 id={titleId}>{title}</h1>
              <p className={styles.description}>{description}</p>
            </div>
            <p className={styles.security}>
              <PutdukIcon name="shield" size={18} />
              비밀번호와 인증 코드는 다른 사람에게 공유하지 마세요.
            </p>
          </section>
          <section
            className={styles.panel}
            aria-labelledby={`${titleId}-panel`}
          >
            <div className={styles.panelHeader}>
              <span className={styles.seal} aria-hidden="true">
                <PutdukIcon name="shield" size={24} />
              </span>
              <h2 id={`${titleId}-panel`}>{panelTitle}</h2>
              <p>{panelDescription}</p>
            </div>
            {children}
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </section>
        </div>
        <footer className={styles.pageFooter}>
          <Link href="/">WORKROOM 홈</Link>
          <span aria-hidden="true">·</span>
          <Link href="/recover">계정 복구</Link>
          <Link href="/find-id">아이디 찾기</Link>
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보 처리방침</Link>
          <Link href="/support">고객지원</Link>
        </footer>
      </div>
    </main>
  );
}
