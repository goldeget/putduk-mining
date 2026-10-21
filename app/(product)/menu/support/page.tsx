import Link from "next/link";

import {
  PutdukIcon,
  type PutdukIconName,
} from "@/components/icons/putduk-icon";
import { SupportStartButton } from "@/components/support/support-runtime";
import { START_WELCOME_STATEMENTS } from "@/lib/trust/public-content";

import styles from "./member-help.module.css";

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
    title: "체험 채굴",
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

/** Authenticated help keeps the member product shell (bottom nav). */
export default function MemberSupportPage() {
  return (
    <div
      className={styles.page}
      data-ui-ready="/menu/support"
      data-ui-state="loaded"
    >
      <header className={styles.hero}>
        <p className={styles.eyebrow}>고객지원</p>
        <h1>필요한 도움을 바로 확인해요</h1>
        <p>상담 창에서 비밀번호나 인증 코드는 보내지 마세요.</p>
        <SupportStartButton />
      </header>

      <section className={styles.topics} aria-labelledby="member-support-guide">
        <h2 id="member-support-guide">자주 확인하는 안내</h2>
        <ul>
          {topics.map((topic) => (
            <li key={topic.title}>
              <span className={styles.icon} aria-hidden="true">
                <PutdukIcon name={topic.icon} size={20} />
              </span>
              <div>
                <h3>{topic.title}</h3>
                {topic.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        className={styles.notice}
        aria-labelledby="member-support-security"
      >
        <PutdukIcon name="shield" size={20} />
        <div>
          <h2 id="member-support-security">보안 안내</h2>
          <p>
            상담원은 비밀번호, 인증 코드, 개인키, 시드 문구를 요구하지 않아요.
          </p>
          <p>잔액과 출금은 상담 창에서 바뀌지 않아요.</p>
        </div>
      </section>

      <p className={styles.publicLink}>
        <Link href="/support">공개 도움말 보기</Link>
      </p>
    </div>
  );
}
