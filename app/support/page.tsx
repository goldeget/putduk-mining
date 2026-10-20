import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { MemberEntryLink } from "@/components/layout/member-entry-link";
import { START_WELCOME_STATEMENTS } from "@/lib/trust/public-content";
import {
  buildBreadcrumbStructuredData,
  publicLanguageAlternates,
} from "@/lib/trust/public-discovery";
import {
  PutdukIcon,
  type PutdukIconName,
} from "@/components/icons/putduk-icon";
import { SupportStartButton } from "@/components/support/support-runtime";
import { ThemeControl } from "@/components/system/theme-control";

import styles from "./support-page.module.css";

const helpLinks = [
  ["/about", "소개"],
  ["/how-it-works", "이용 방법"],
  ["/faq", "자주 묻는 질문"],
  ["/support", "고객지원"],
] as const;

const topics: readonly {
  body: readonly string[];
  icon: PutdukIconName;
  title: string;
}[] = [
  {
    icon: "user",
    title: "계정과 가입",
    body: ["로그인에 쓰는 아이디를 먼저 확인해 주세요."],
  },
  {
    icon: "spark",
    title: "PUTDUK START",
    body: [
      "앱을 닫아도 채굴은 계속돼요.",
      "다시 접속하면 결과를 확인할 수 있어요.",
      ...START_WELCOME_STATEMENTS,
    ],
  },
  {
    icon: "mining",
    title: "채굴",
    body: ["채굴 화면의 상태를 먼저 확인해 주세요."],
  },
  {
    icon: "wallet",
    title: "입금과 출금",
    body: [
      "입금은 직접 보내는 수동 입금이에요.",
      "출금은 원화 잔액을 기준으로 해요.",
    ],
  },
  {
    icon: "bell",
    title: "문의할 때",
    body: ["화면 이름과 대략적인 시각을 알려 주세요."],
  },
];

const installSteps = [
  {
    title: "iPhone · iPad",
    body: "Safari에서 회원 앱을 열고, 공유 메뉴에서 ‘홈 화면에 추가’를 선택해 주세요.",
  },
  {
    title: "Android 휴대폰 · 태블릿 · Galaxy Tab",
    body: "Chrome 또는 Samsung Internet에서 회원 앱을 열고, 브라우저 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.",
  },
  {
    title: "PC",
    body: "Chrome 또는 Edge에서 회원 앱을 열고, 주소창의 설치 아이콘이나 브라우저 메뉴의 앱 설치를 이용해 주세요.",
  },
] as const;

export const metadata: Metadata = {
  title: "상담",
  description: "가입, 채굴, 입금과 출금 문의를 확인하는 상담 안내입니다.",
  alternates: {
    canonical: "/support",
    languages: publicLanguageAlternates("/support"),
  },
};

const supportBreadcrumb = buildBreadcrumbStructuredData({
  name: "상담",
  path: "/support",
});

export default function SupportPage() {
  return (
    <main className={`support-center ${styles.page}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(supportBreadcrumb).replace(/</g, "\\u003c"),
        }}
      />
      <header className="site-header shell">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <nav className={styles.nav} aria-label="도움말">
          {helpLinks.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={href === "/support" ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="site-header__tools">
          <ThemeControl />
          <MemberEntryLink className="support-center__login" href="/login">
            로그인
          </MemberEntryLink>
        </div>
      </header>

      <div className={styles.board}>
        <section className="shell support-center__hero">
          <p className="eyebrow">고객지원</p>
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
                <span className={styles.icon} aria-hidden="true">
                  <PutdukIcon name={topic.icon} size={20} />
                </span>
                <div className={styles.copy}>
                  <h3>{topic.title}</h3>
                  {topic.body.map((paragraph) => (
                    <p className="ko-copy" key={paragraph}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <section
            id="app-install"
            aria-labelledby="app-install-title"
            tabIndex={-1}
          >
            <h2 id="app-install-title">앱 설치 안내</h2>
            <p className="ko-copy">
              이 안내를 확인한 뒤 회원 앱을 열어 주세요. 회원 앱 화면에서
              브라우저 설치 메뉴를 사용해 주세요.
            </p>
            <p className="ko-copy">
              앱 설치는 mining.putduk.com의 회원 앱 화면에서 진행해 주세요.
            </p>
            <p className="ko-copy">
              <a
                href="https://mining.putduk.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                회원 앱 열기
              </a>
            </p>
            <div className="support-center__topics">
              {installSteps.map((step) => (
                <article key={step.title}>
                  <span className={styles.icon} aria-hidden="true">
                    <PutdukIcon name="home" size={20} />
                  </span>
                  <div className={styles.copy}>
                    <h3>{step.title}</h3>
                    <p className="ko-copy">{step.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className="ko-copy">
              브라우저와 버전에 따라 메뉴 이름이나 설치 지원 여부가 달라요. 설치
              메뉴가 없으면 브라우저에서 계속 이용할 수 있어요.
            </p>
          </section>
        </section>

        <section
          className={`shell support-center__notice ${styles.notice}`}
          aria-labelledby="support-security-title"
        >
          <span className={styles.icon} aria-hidden="true">
            <PutdukIcon name="shield" size={20} />
          </span>
          <div className={styles.copy}>
            <h2 id="support-security-title">보안 안내</h2>
            <p className="ko-copy">
              상담원은 비밀번호, 인증 코드, 개인키, 시드 문구를 요구하지 않아요.
            </p>
            <p className="ko-copy">잔액과 출금은 상담 창에서 바뀌지 않아요.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
