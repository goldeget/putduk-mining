import type { Metadata } from "next";
import Link from "next/link";

import { WorkroomMark } from "@/components/workroom/identity";
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
import workroomStyles from "@/components/workroom/workroom.module.css";

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
    title: "워크룸 체험",
    body: [
      "진행 중인 회차는 서버 시간을 기준으로 이어져요.",
      "다시 접속하면 결과를 확인할 수 있어요.",
      "무료 체험 포인트는 현금으로 전환하거나 출금할 수 없어요.",
    ],
  },
  {
    icon: "spark",
    title: "회차와 기록",
    body: ["내 워크룸의 진행 상태와 참여 기록을 먼저 확인해 주세요."],
  },
  {
    icon: "wallet",
    title: "실제 잔액과 입출금",
    body: [
      "입금 방법은 담당자에게 문의하고, 실제 잔액 메뉴에서 신청해 주세요.",
      "입금은 운영자 확인 후 반영되며 실제 원화 출금은 체험 포인트와 별도로 처리돼요.",
    ],
  },
  {
    icon: "bell",
    title: "문의할 때",
    body: ["화면 이름과 대략적인 시각을 알려 주세요."],
  },
];

export const metadata: Metadata = {
  title: "상담",
  description:
    "워크룸 가입, 무료 체험, 참여 기록과 실제 입출금 문의를 확인하는 상담 안내입니다.",
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
    <main className={`${workroomStyles.theme} support-center ${styles.page}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(supportBreadcrumb).replace(/</g, "\\u003c"),
        }}
      />
      <header className="site-header shell">
        <Link className="brand-lockup" href="/" aria-label="워크룸 홈">
          <WorkroomMark />
          <span>
            <strong>WORKROOM</strong>
            <small>나만의 워크룸</small>
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
          <Link className="support-center__login" href="/login">
            로그인
          </Link>
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
          <Link href="/workroom/support" className="button button--primary">
            1:1 문의하기
          </Link>
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
