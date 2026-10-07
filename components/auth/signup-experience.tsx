import type { ReactNode } from "react";
import Link from "next/link";

import { SignupArtwork } from "@/components/auth/signup-artwork";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";
import styles from "./signup-experience.module.css";

function SignupBrand() {
  return (
    <span className={styles.brand}>
      <svg viewBox="0 0 40 56" fill="none" aria-hidden="true" focusable="false">
        <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
        <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
        <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
        <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
        <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
        <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
      </svg>
      <span>
        <strong>퍼뜩 채굴</strong>
        <small>PUTDUK MINING</small>
      </span>
    </span>
  );
}

/** Signup owns this reference hierarchy; the existing action and server contracts remain separate. */
export function SignupExperience({ children }: { children?: ReactNode }) {
  return (
    <main
      className={styles.root}
      data-ui-ready="/signup"
      data-ui-state="loaded"
    >
      <header className={styles.header}>
        <Link className={styles.headerBrand} href="/" aria-label="퍼뜩 채굴 홈">
          <SignupBrand />
        </Link>
        <nav className={styles.publicNavigation} aria-label="서비스 메뉴">
          <Link href="/">홈</Link>
          <Link href="/mining">채굴</Link>
          <Link href="/products">상품</Link>
          <Link href="/wallet">지갑</Link>
          <Link href="/support">고객센터</Link>
        </nav>
        <div className={styles.headerTools}>
          <ThemeControl />
          <Link className={styles.headerLogin} href="/login">
            로그인
          </Link>
          <a
            className={styles.headerSignup}
            href="#signup-title"
            aria-current="page"
          >
            회원가입
          </a>
        </div>
      </header>

      <div className={styles.composition} data-signup-layout="semiconductor">
        <div className={styles.scene}>
          <SignupArtwork className={styles.artwork} />
          <div className={styles.sceneScrim} aria-hidden="true" />
        </div>
        <section className={styles.story} aria-label="퍼뜩 채굴 시작 안내">
          <Link
            className={styles.storyBrand}
            href="/"
            aria-label="퍼뜩 채굴 홈"
          >
            <SignupBrand />
          </Link>
          <h2>
            <span>지금 시작하고</span>
            <br />
            나만의 채굴 여정을
            <br />
            함께하세요.
          </h2>
          <p className={styles.storyDescription}>
            작은 한 걸음이
            <br />더 큰 가치를 만듭니다.
          </p>
          <p className={styles.storyTagline}>
            TECHNOLOGY CREATES
            <br />A MORE VALUABLE TOMORROW
          </p>
          <nav className={styles.guides} aria-label="가입 전 이용 안내">
            <Link href="/how-it-works">
              <PutdukHomeIcon name="coins" size={30} />
              <span>
                <small>첫 채굴 안내</small>
                <strong>이용 방법 보기</strong>
              </span>
            </Link>
            <Link href="/verification">
              <PutdukHomeIcon name="chart" size={30} />
              <span>
                <small>확정 기록과 지갑</small>
                <strong>확인 기준 보기</strong>
              </span>
            </Link>
            <Link href="/support">
              <PutdukHomeIcon name="cube" size={30} />
              <span>
                <small>가입·계정 복구</small>
                <strong>도움말 보기</strong>
              </span>
            </Link>
          </nav>
        </section>

        <section className={styles.panel} aria-labelledby="signup-title">
          <header className={styles.panelHeader}>
            <h1 id="signup-title">회원가입</h1>
            <p>
              작은 한 걸음이
              <br />더 큰 가치를 만듭니다.
            </p>
          </header>
          {children}
          <p className={styles.loginPrompt}>
            이미 계정이 있나요?
            <Link href="/login">
              로그인 <PutdukIcon name="arrow-right" size={17} />
            </Link>
          </p>
        </section>
      </div>
      <footer className={styles.footer}>
        <span>
          PUTDUK MINING{" "}
          <small>TECHNOLOGY CREATES A MORE VALUABLE TOMORROW</small>
        </span>
        <nav aria-label="가입 도움말">
          <a href="#signup-consents">가입 동의 보기</a>
          <Link href="/support">고객지원</Link>
          <Link href="/recover">계정 복구</Link>
        </nav>
      </footer>
    </main>
  );
}
