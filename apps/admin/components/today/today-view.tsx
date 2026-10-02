import Link from "next/link";
import type { Route } from "next";

import type { TodaySnapshot } from "@/app/(control)/_lib/today-snapshot";
import {
  auditActionLabel,
  auditTargetLabel,
  formatAuditTimeKst,
  formatCountDisplay,
  formatObservedAtKst,
} from "@/app/(control)/_lib/today-snapshot";

import { TodayRefreshButton } from "./today-refresh-button";
import styles from "./today.module.css";

export function TodayView({ snapshot }: { snapshot: TodaySnapshot }) {
  const totalLabel = formatCountDisplay(snapshot.attentionTotal);
  const observed = formatObservedAtKst(snapshot.observedAtIso);

  return (
    <div className={styles.root} data-testid="admin-today">
      <section className={styles.hero} aria-labelledby="today-title">
        <div>
          <p className={styles.eyebrow}>오늘 운영</p>
          <h1 id="today-title">오늘의 퍼뜩</h1>
          <p className={styles.lead}>
            지금 확인할 일과 서비스 상태를 한 화면에 모았어요.
          </p>
          <small className={styles.meta}>
            <time dateTime={snapshot.observedAtIso}>{observed}</time>
          </small>
        </div>
        <div
          className={styles.orbit}
          aria-label={
            snapshot.attentionTotal.kind === "unavailable"
              ? "지금 확인할 일 합계를 확인하지 못했습니다"
              : `지금 확인할 일 ${totalLabel}건`
          }
        >
          <span>지금 확인할 일</span>
          <strong data-testid="today-attention-total">{totalLabel}</strong>
          <small>
            {snapshot.attentionTotal.kind === "unavailable"
              ? "일부 조회 확인 필요"
              : snapshot.allQueuesEmpty
                ? "대기열 비어 있음"
                : "대기열 합계"}
          </small>
        </div>
      </section>

      {snapshot.hasUnavailable ? (
        <section
          className={styles.failureBanner}
          role="alert"
          data-testid="today-partial-failure"
        >
          <div>
            <strong>일부 정보를 불러오지 못했어요</strong>
            <p>
              숫자를 임의로 채우지 않았어요. 다시 불러오거나 해당 대기열로
              이동해 주세요.
            </p>
          </div>
          <TodayRefreshButton />
        </section>
      ) : null}

      {snapshot.allQueuesEmpty ? (
        <section
          className={styles.emptyBanner}
          aria-live="polite"
          data-testid="today-empty-queues"
        >
          <strong>지금 확인할 일이 없어요</strong>
          <p>
            대기열이 비어 있어요. 서비스 요약과 최근 기록만 확인하면 됩니다.
          </p>
        </section>
      ) : null}

      <section className={styles.sectionHead}>
        <div>
          <p className={styles.eyebrow}>우선 확인</p>
          <h2>오늘 확인할 일</h2>
        </div>
        <span>요청 시점 조회</span>
      </section>

      <section
        className={styles.attentionGrid}
        aria-label="운영 확인 항목"
        data-testid="today-attention-grid"
      >
        {snapshot.attention.map((item, index) => {
          const unavailable = item.status.kind === "unavailable";
          const empty = item.status.kind === "ready" && item.status.count === 0;
          return (
            <Link
              key={item.code}
              className={[
                styles.card,
                unavailable ? styles.cardUnknown : "",
                empty ? styles.cardEmpty : "",
              ]
                .filter(Boolean)
                .join(" ")}
              href={item.href as Route}
              data-testid={`today-queue-${item.code}`}
              data-count-state={
                unavailable ? "unavailable" : empty ? "empty" : "ready"
              }
            >
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <small>
                  {unavailable ? "확인 필요" : empty ? "비어 있음" : "대기"}
                </small>
              </header>
              <strong>{formatCountDisplay(item.status)}</strong>
              <h3>{item.label}</h3>
              <p>
                {unavailable
                  ? "이 대기열을 불러오지 못했어요."
                  : empty
                    ? item.emptyHint
                    : item.description}
              </p>
            </Link>
          );
        })}
      </section>

      <section className={styles.operationsGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>조회 요약</p>
              <h2>현재 조회 요약</h2>
            </div>
            <span className={styles.liveChip}>조회 시점</span>
          </header>
          <div className={styles.metrics} data-testid="today-summary-metrics">
            <div>
              <span>전체 회원</span>
              <strong data-testid="today-member-total">
                {formatCountDisplay(snapshot.memberTotal)}
              </strong>
            </div>
            <div>
              <span>진행 중 START</span>
              <strong data-testid="today-trial-total">
                {formatCountDisplay(snapshot.activeTrials)}
              </strong>
            </div>
            <div>
              <span>지금 확인할 일</span>
              <strong>{totalLabel}</strong>
            </div>
          </div>
          <p className={styles.note}>
            대기열로 바로 이동할 수 있어요. 회원 맥락은 회원 상세에서
            확인하세요.
          </p>
          <Link className={styles.textLink} href={"/members" as Route}>
            회원 상세 열기
          </Link>
        </article>

        <article className={styles.panel} data-testid="today-audit-panel">
          <header>
            <p className={styles.eyebrow}>운영 기록</p>
            <h2>최근 운영 기록</h2>
          </header>
          {snapshot.audits === "unavailable" ? (
            <div className={styles.unavailableBlock}>
              <p className={styles.emptyState}>
                감사 기록을 확인할 수 없습니다.
              </p>
              <TodayRefreshButton label="기록 다시 불러오기" />
            </div>
          ) : snapshot.audits.length ? (
            <ol className={styles.auditList}>
              {snapshot.audits.map((entry) => (
                <li key={entry.id}>
                  <span>{auditTargetLabel(entry.targetType)}</span>
                  <strong>{auditActionLabel(entry.action)}</strong>
                  <time dateTime={entry.createdAt}>
                    {formatAuditTimeKst(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.emptyState} data-testid="today-audit-empty">
              아직 감사 기록이 없습니다.
            </p>
          )}
        </article>
      </section>
    </div>
  );
}
