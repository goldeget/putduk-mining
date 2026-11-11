import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./workroom.module.css";
import { ThemeControl } from "@/components/system/theme-control";
import { WorkroomMark } from "./workroom-mark";
export { WorkroomMark } from "./workroom-mark";

export function WorkroomBrand() {
  return (
    <Link href="/" className={styles.brand}>
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
            환율과 주식, 10개 항목을 무료로 체험하세요.
            <br />
            실제 거래와 분리된 나만의 모의 워크룸입니다.
          </p>
          <ul>
            <li>계정에 저장되는 포인트와 참여 기록</li>
            <li>참여 전 확인하는 패턴과 종료 변동률</li>
            <li>입금·출금 없이 무료로 이용</li>
          </ul>
        </section>
        <section className={`${styles.panel} ${styles.authCard}`}>
          <span className={styles.eyebrow}>WELCOME TO WORKROOM</span>
          <h2>{signup ? "추천인 코드로 가입하세요" : "내 워크룸에 로그인"}</h2>
          <p className={styles.muted}>
            {signup
              ? "가입 시 체험 포인트 100,000 P를 한 번 지급합니다."
              : "기존 아이디와 비밀번호를 그대로 사용하세요."}
          </p>
          {children}
          <p className={styles.disclosure}>
            사전 설정된 패턴을 따르는 무료 시뮬레이션입니다. 체험 포인트는
            현금으로 전환하거나 출금할 수 없습니다.
          </p>
        </section>
      </div>
      <footer className={styles.footer}>
        <span>© 2026 WORKROOM · 무료 시뮬레이션</span>
        <nav aria-label="이용 안내">
          <Link href="/terms">이용약관</Link>
          {" · "}
          <Link href="/privacy">개인정보처리방침</Link>
        </nav>
      </footer>
    </main>
  );
}
