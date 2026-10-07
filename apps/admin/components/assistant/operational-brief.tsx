import Link from "next/link";
import type { Route } from "next";
import type { TodaySnapshot } from "@/app/(control)/_lib/today-snapshot";
import { formatKst } from "@/app/(control)/_lib/format";
import { buildDailyBrief } from "@/lib/operations/daily-brief";
import styles from "../operations/operations.module.css";

export function OperationalBrief({ snapshot }: { snapshot: TodaySnapshot }) {
  const brief = buildDailyBrief(snapshot);
  return (
    <section
      className={styles.panel}
      aria-labelledby="operator-brief-title"
      data-testid="operator-brief"
    >
      <p className="eyebrow">퍼뜩 운영 도우미</p>
      <h2 id="operator-brief-title">지금 할 일을 짧게 정리해요</h2>
      <p className={styles.note}>
        조회 기록을 정리한 안내예요. 모델이 금액을 판단하거나 작업을 대신
        승인하지 않아요.
      </p>
      <div className={styles.panels}>
        <article>
          <h3>확인한 사실</h3>
          <p>{brief.fact}</p>
          <small>조회 시각 · {formatKst(snapshot.observedAtIso)}</small>
        </article>
        <article>
          <h3>판단 참고</h3>
          <p>{brief.inference}</p>
        </article>
        <article>
          <h3>추천 다음 행동</h3>
          <p>{brief.recommendation}</p>
          <Link
            className="text-link"
            href={(brief.next?.href ?? "/operations/system") as Route}
          >
            {brief.next ? `${brief.next.label} 열기` : "서비스 상태 열기"}
          </Link>
        </article>
        <article>
          <h3>아직 확인하지 못한 것</h3>
          <p>{brief.unknownText}</p>
          {brief.unknown.length ? (
            <p>
              {brief.unknown.map((item) => item.label).join(" · ")} 조회도
              확인이 필요해요.
            </p>
          ) : null}
        </article>
      </div>
      <div className={styles.links}>
        <Link className="text-link" href={"/operations/support" as Route}>
          답변 초안 준비
        </Link>
        <Link className="text-link" href={"/operations/notices" as Route}>
          공지 초안 준비
        </Link>
        <Link className="text-link" href={"/operations/audit" as Route}>
          운영 기록 확인
        </Link>
      </div>
      <p className={styles.note}>
        처리가 필요한 작업은 초안 준비 → 운영자 검토 → 영향 확인 → 직접 확인 →
        서버 권한 확인 → 운영 기록 순서로 진행해요.
      </p>
    </section>
  );
}
