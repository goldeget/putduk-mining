import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";

import styles from "../support/member-help.module.css";

const facts = [
  {
    title: "워크룸은 체험 포인트로 참여해요",
    body: "진행 중인 회차와 참여 기록을 내 워크룸에서 확인할 수 있어요.",
  },
  {
    title: "잔액은 확인된 기록만 보여 드려요",
    body: "화면에서 금액을 임의로 만들지 않아요. 확인된 원화만 표시해요.",
  },
  {
    title: "입금은 선택 사항이에요",
    body: "실제 입금은 담당자 안내에 따라 신청하며 운영자가 확인한 뒤 반영돼요.",
  },
  {
    title: "출금 전 본인 확인이 필요해요",
    body: "출금은 실제 원화 잔액과 적용된 출금 정책을 기준으로 처리돼요. 체험 포인트는 출금할 수 없어요.",
  },
  {
    title: "AI는 잔액을 바꾸지 않아요",
    body: "WORKROOM AI는 안내만 해요. 승인·출금·잔액 변경은 하지 않아요.",
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
        <h1>워크룸이 지키는 기본 원칙</h1>
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
