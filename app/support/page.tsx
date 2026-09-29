import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { SupportStartButton } from "@/components/support/support-runtime";
import { ThemeControl } from "@/components/system/theme-control";

import styles from "./support-page.module.css";

const topics = [
  {
    title: "계정과 가입",
    body: ["로그인에 쓰는 아이디를 먼저 확인해 주세요."],
  },
  {
    title: "PUTDUK START",
    body: [
      "앱을 닫아도 채굴은 계속돼요.",
      "다시 접속하면 결과를 확인할 수 있어요.",
    ],
  },
  {
    title: "채굴",
    body: ["채굴 화면의 상태를 먼저 확인해 주세요."],
  },
  {
    title: "입금과 출금",
    body: [
      "입금은 직접 보내는 수동 입금이에요.",
      "출금은 원화 잔액을 기준으로 해요.",
    ],
  },
  {
    title: "문의할 때",
    body: ["화면 이름과 대략적인 시각을 알려 주세요."],
  },
] as const;

export const metadata: Metadata = {
  title: "상담",
  description: "가입, 채굴, 입금과 출금 문의를 확인하는 상담 안내입니다.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <main className={`support-center ${styles.page}`}>
      <header className="site-header shell">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <div className="site-header__tools">
          <ThemeControl />
          <Link className="support-center__login" href="/login">
            로그인
          </Link>
        </div>
      </header>

      <section className="shell support-center__hero">
        <p className="eyebrow">SUPPORT</p>
        <h1 className={styles.heading}>
          필요한 도움을 바로 <span className={styles.token}>확인해요</span>.
        </h1>
        <p className="ko-copy">
          상담 창에서 비밀번호나 인증 코드는 보내지 마세요.
        </p>
        <SupportStartButton />
      </section>

      <section
        className="shell support-center__guide"
        id="support-guide"
        aria-labelledby="support-guide-title"
        tabIndex={-1}
      >
        <h2 id="support-guide-title">자주 확인하는 안내</h2>
        <div className="support-center__topics">
          {topics.map((topic) => (
            <article key={topic.title}>
              <h3>{topic.title}</h3>
              {topic.body.map((paragraph) => (
                <p className="ko-copy" key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section
        className="shell support-center__notice"
        aria-labelledby="support-security-title"
      >
        <h2 id="support-security-title">보안 안내</h2>
        <p className="ko-copy">
          상담원은 비밀번호, 인증 코드, 개인키, 시드 문구를 요구하지 않아요.
        </p>
        <p className="ko-copy">잔액과 출금은 상담 창에서 바뀌지 않아요.</p>
      </section>
    </main>
  );
}
