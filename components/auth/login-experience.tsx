import type { ReactNode } from "react";
import Link from "next/link";

import { ThemeControl } from "@/components/system/theme-control";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { LoginArtwork, LoginHeading } from "@/components/auth/login-artwork";
import styles from "./login-experience.module.css";

function LoginBrand({ panel = false }: { panel?: boolean }) {
  return (
    <span className={`${styles.brandLockup} ${panel ? styles.panelBrand : ""}`}>
      <svg viewBox="0 0 40 56" fill="none" aria-hidden="true" focusable="false">
        <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
        <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
        <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
        <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
        <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
        <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
      </svg>
      <span>
        <strong>
          <span className={styles.brandKorean}>퍼뜩 채굴</span>
          <span className={styles.brandEnglish}>PUTDUK MINING</span>
        </strong>
        <small>프리미엄 채굴 플랫폼</small>
      </span>
    </span>
  );
}

/** Login has its own reference hierarchy; the auth action remains in its existing form. */
export function LoginExperience({ children }: { children?: ReactNode }) {
  return (
    <main className={styles.root} data-ui-ready="/login" data-ui-state="loaded">
      <header className={styles.header}>
        <Link className={styles.headerBrand} href="/" aria-label="퍼뜩 채굴 홈">
          <LoginBrand />
        </Link>
        <nav className={styles.publicNavigation} aria-label="서비스 안내">
          <Link href="/about">서비스 소개</Link>
          <Link href="/how-it-works">이용 방법</Link>
          <Link href="/support">고객지원</Link>
        </nav>
        <ThemeControl />
      </header>
      <div className={styles.composition} data-login-layout="semiconductor">
        <div className={styles.scene} aria-hidden="true">
          <LoginArtwork className={styles.artwork} />
          <div className={styles.sceneScrim} />
        </div>
        <section className={styles.story} aria-label="퍼뜩 채굴 소개">
          <div className={styles.storyCopy}>
            <Link
              className={styles.storyBrand}
              href="/"
              aria-label="퍼뜩 채굴 홈"
            >
              <LoginBrand />
            </Link>
            <h2>
              작은 한 걸음이
              <br />
              <span>더 큰 가치를 만듭니다.</span>
            </h2>
            <p className={styles.storyTagline}>
              TECHNOLOGY CREATES
              <br />A MORE VALUABLE TOMORROW
            </p>
            <p className={styles.storyDescription}>
              채굴 상태와 지갑을 확인하고,
              <br />
              오늘의 여정을 이어가세요.
            </p>
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="auth-title">
          <div className={styles.panelHeader}>
            <LoginBrand panel />
            <LoginHeading id="auth-title" className={styles.panelTitle} />
            <p>더 큰 가치를 만드는 여정에 함께하세요.</p>
          </div>
          {children}
          <p className={styles.panelTagline}>
            SEMICONDUCTOR DRIVES
            <br />A BRIGHTER TOMORROW
          </p>
        </section>
      </div>
      <footer className={styles.footer}>
        <Link href="/how-it-works">
          <PutdukIcon name="shield" size={22} />
          <span>보호된 계정 로그인</span>
        </Link>
        <Link href="/recover">
          <PutdukIcon name="user" size={22} />
          <span>아이디 찾기와 계정 복구</span>
        </Link>
        <Link href="/verification">
          <PutdukIcon name="wallet" size={22} />
          <span>확인된 채굴과 지갑</span>
        </Link>
      </footer>
    </main>
  );
}
