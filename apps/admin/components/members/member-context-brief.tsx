import Link from "next/link";
import type { Route } from "next";
import styles from "../operations/operations.module.css";

export function MemberContextBrief({
  userId,
  name,
  stage,
  partial,
  riskCount,
}: {
  userId: string;
  name: string;
  stage: string;
  partial: boolean;
  riskCount: number | null;
}) {
  return (
    <section className={styles.panel} aria-labelledby="member-context-title">
      <p className="eyebrow">운영 도우미 · 회원 맥락</p>
      <h2 id="member-context-title">이 회원을 확인할 때</h2>
      <div className={styles.panels}>
        <article>
          <h3>확인한 사실</h3>
          <p>
            {name} · {stage}
          </p>
          <p>
            {riskCount === null
              ? "위험 신호 조회 확인이 필요해요."
              : `조회된 위험 신호는 ${riskCount.toLocaleString("ko-KR")}건이에요.`}
          </p>
        </article>
        <article>
          <h3>판단 참고</h3>
          <p>
            {partial
              ? "일부 기록을 확인하지 못했어요. 회원 상태를 단정하지 마세요."
              : "조회된 기록을 바탕으로 문의 내용을 함께 확인해요. 기록만으로 신원을 단정하지 않아요."}
          </p>
        </article>
        <article>
          <h3>추천 다음 행동</h3>
          <p>입출금 문의는 실제 거래 결과와 최근 활동을 대조해 주세요.</p>
          <a className="text-link" href="#evidence-money">
            입출금 기록으로 이동
          </a>
        </article>
        <article>
          <h3>아직 확인하지 못한 것</h3>
          <p>
            이체 진위, 실제 송금 완료, 회원이 알림을 받았는지는 별도 확인이
            필요해요.
          </p>
        </article>
      </div>
      <div className={styles.links}>
        <Link className="text-link" href={`/members?id=${userId}` as Route}>
          회원 기록 새로 조회
        </Link>
        <Link className="text-link" href={"/operations/support" as Route}>
          문의 답변 준비
        </Link>
      </div>
    </section>
  );
}
