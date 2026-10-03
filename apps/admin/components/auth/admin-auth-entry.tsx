import type { ReactNode } from "react";

import { BrandMark } from "../../../../components/brand/brand-mark";
import { PutdukIcon } from "../../../../components/icons/putduk-icon";
import { ThemeControl } from "../../../../components/system/theme-control";
import { AdminAuthConnectionBoundary } from "./admin-auth-connection-boundary";

import styles from "./admin-auth-entry.module.css";

type AdminAuthPhase =
  "login" | "mfa" | "reauth" | "session-expired" | "unauthorized";

type AdminAuthEntryProps = {
  phase: AdminAuthPhase;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  footer?: ReactNode;
};

/** Entry presentation only. Live identity, AAL2 and session authority stay server-owned. */
export function AdminAuthEntry({
  phase,
  eyebrow,
  title,
  description,
  children,
  footer,
}: AdminAuthEntryProps) {
  const recovery = phase !== "login" && phase !== "mfa";
  // The wrapper cannot infer readiness from MfaGate's asynchronous state.
  return (
    <main
      className={`auth-stage ${styles.entry}`}
      data-ui-ready={phase === "mfa" ? undefined : `/${phase}`}
      data-ui-state={
        phase === "mfa" ? undefined : recovery ? "error" : "loaded"
      }
    >
      <header className={styles.top}>
        <div className={styles.identity}>
          <BrandMark title="" />
          <div>
            <strong>퍼뜩</strong>
            <span>운영자 보안 접속</span>
          </div>
        </div>
        <ThemeControl />
      </header>
      <div className={styles.layout}>
        <aside className={styles.context} aria-label="운영자 접속 안내">
          <span className={styles.contextSeal} aria-hidden="true">
            <PutdukIcon name="shield" size={30} />
          </span>
          <p className={styles.contextLabel}>운영자 전용</p>
          <p className={styles.contextTitle}>
            중요한 작업을 위한
            <br />
            안전한 접속
          </p>
          <p className={styles.contextCopy}>
            계정과 인증 앱을 확인한 뒤<br />
            승인된 권한으로 운영 화면을 열어요.
          </p>
          <dl className={styles.accessGuide}>
            <div>
              <dt>계정 확인</dt>
              <dd>승인된 운영자 계정으로 로그인해요.</dd>
            </div>
            <div>
              <dt>인증 앱 확인</dt>
              <dd>앱에 표시된 일회성 코드를 입력해요.</dd>
            </div>
          </dl>
          <p className={styles.contextNote}>
            운영자 접속은 일반 회원 로그인과 분리돼 있어요.
          </p>
        </aside>
        <section
          className={`auth-card ${styles.card}`}
          aria-labelledby="admin-entry-title"
        >
          <header className={styles.cardHeader}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 id="admin-entry-title" className={styles.title}>
              {title}
            </h1>
            <p className={styles.description}>{description}</p>
          </header>
          <AdminAuthConnectionBoundary>{children}</AdminAuthConnectionBoundary>
          {footer ? (
            <footer className={styles.footnote}>{footer}</footer>
          ) : null}
        </section>
      </div>
      <p className={styles.securityNote}>
        접근 시도와 중요한 작업은 보안 기록에 남습니다.
      </p>
    </main>
  );
}
