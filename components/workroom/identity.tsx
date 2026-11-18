import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./workroom.module.css";
import { ThemeControl } from "@/components/system/theme-control";
import { WorkroomMark } from "./workroom-mark";
export { WorkroomMark } from "./workroom-mark";

export function WorkroomBrand() {
  return (
    <Link href="/" className={styles.brand} aria-label="WORKROOM 홈">
      <WorkroomMark />
      <span>
        WORKROOM<small>나만의 워크룸</small>
      </span>
    </Link>
  );
}

export function WorkroomAuth({
  children,
  signup = false,
}: {
  children: ReactNode;
  signup?: boolean;
}) {
  return (
    <main className={`${styles.theme} ${styles.auth}`}>
      <header className={styles.authHeader}>
        <WorkroomBrand />
        <div className={styles.themeControl}>
          <ThemeControl />
        </div>
      </header>
      <div className={styles.authGrid}>
        <section className={styles.intro}>
          <span className={styles.eyebrow}>A NEW WAY TO EXPERIENCE</span>
          <h1>
            나만의 공간에서,
            <br />
            시장의 흐름을
            <br />
            <em>경험하세요.</em>
          </h1>
          <p>
            환율과 주식의 흐름을 확인하고 모니터링하세요.
            <br />
            업무 기록과 실제 자산 기록을 한곳에서 관리합니다.
          </p>
          <ul>
            <li>계정에 저장되는 모니터링 업무 기록</li>
            <li>참여 전 확인하는 패턴과 진행 조건</li>
            <li>실제 입출금 기록과 분리된 워크룸 화면</li>
          </ul>
        </section>
        <section className={`${styles.panel} ${styles.authCard}`}>
          <span className={styles.eyebrow}>WELCOME TO WORKROOM</span>
          <h2>{signup ? "추천인 코드로 가입하세요" : "내 워크룸에 로그인"}</h2>
          <p className={styles.muted}>
            {signup
              ? "추천인 코드를 확인하고 워크룸 계정을 개설합니다."
              : "기존 아이디와 비밀번호를 그대로 사용하세요."}
          </p>
          {children}
          <p className={styles.disclosure}>
            시장 흐름과 모니터링 기록은 실제 입출금 기록과 분리해 확인합니다.
          </p>
        </section>
      </div>
      <footer className={styles.footer}>
        <span>© 2026 WORKROOM · 모니터링 플랫폼</span>
        <nav aria-label="이용 안내">
          <Link href="/terms">이용약관</Link>
          {" · "}
          <Link href="/privacy">개인정보처리방침</Link>
        </nav>
      </footer>
    </main>
  );
}
