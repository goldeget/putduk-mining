import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";

import styles from "../support/member-help.module.css";

const facts = [
  {
    title: "채굴은 버튼 한 번으로 시작해요",
    body: "앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요.",
  },
  {
    title: "잔액은 확인된 기록만 보여 드려요",
    body: "화면에서 금액을 임의로 만들지 않아요. 확인된 원화만 표시해요.",
  },
  {
    title: "입금은 선택 사항이에요",
    body: "USDT 입금은 직접 보내는 수동 입금이에요. USDT 잔액이 아니에요.",
  },
  {
    title: "출금 전 본인 확인이 필요해요",
    body: "최대 5,000원까지 환영 보상으로 출금할 수 있어요. 출금은 원화 잔액 기준이에요.",
  },
  {
    title: "AI는 잔액을 바꾸지 않아요",
    body: "퍼뜩 AI는 안내만 해요. 승인·출금·잔액 변경은 하지 않아요.",
  },
] as const;

/** Authenticated trust summary keeps the member product shell. */
export default function MemberTrustPage() {
  return (
    <div
      className={styles.page}
      data-ui-ready="/menu/trust"
      data-ui-state="loaded"
    >
      <header className={styles.hero}>
        <p className={styles.eyebrow}>신뢰 센터</p>
        <h1>퍼뜩이 지키는 기본 원칙</h1>
        <p>짧게 확인할 수 있는 공식 안내예요.</p>
      </header>

      <section className={styles.topics} aria-labelledby="member-trust-facts">
        <h2 id="member-trust-facts">공식 안내</h2>
        <ul>
          {facts.map((fact) => (
            <li key={fact.title}>
              <span className={styles.icon} aria-hidden="true">
                <PutdukIcon name="shield" size={20} />
              </span>
              <div>
                <h3>{fact.title}</h3>
                <p>{fact.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.publicLink}>
        <Link href="/putduk-facts">공개 사실 전체 보기</Link>
      </p>
    </div>
  );
}
