import Link from "next/link";
import type { Route } from "next";

import { formatKst } from "@/app/(control)/_lib/format";
import { TodayRefreshButton } from "@/components/today/today-refresh-button";
import styles from "./failed-jobs.module.css";

export type FailedJobRecord = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  updated_at: string;
  dead_lettered_at: string | null;
};

const JOB_GUIDANCE = {
  FINANCIAL_RECONCILIATION: {
    title: "금액 기록 비교",
    description: "입출금과 지갑 기록이 맞는지 비교하는 작업이에요.",
    steps: [
      "금액 차이 목록에서 비교 결과를 확인하세요.",
      "실제 입출금 결과와 함께 검토하세요. 잔액을 직접 바꾸지 마세요.",
    ],
    href: "/exceptions#reconciliation-exceptions",
    action: "금액 차이 보기",
  },
  FUNDING_MINING_TICK_V1: {
    title: "유료 채굴 갱신",
    description: "입금 원금과 연결된 채굴 상태를 갱신하는 작업이에요.",
    steps: [
      "문의를 받은 회원이 있다면 회원 찾기에서 채굴 상태를 확인하세요.",
      "원금·보류 금액과 채굴 결과를 따로 확인하세요.",
    ],
    href: "/members",
    action: "회원 채굴 확인",
  },
} as const;

const UNKNOWN_GUIDANCE = {
  title: "작업 종류 확인 필요",
  description: "작업 종류를 확인하지 못했어요. 처리 내용을 추정하지 않아요.",
  steps: [
    "오늘 확인할 업무에서 다른 예외가 있는지 살펴보세요.",
    "작업 원인을 확인하기 전에는 같은 처리를 반복하지 마세요.",
  ],
  href: "/",
  action: "오늘 업무 보기",
} as const;

function guidanceFor(type: string) {
  return Object.hasOwn(JOB_GUIDANCE, type)
    ? JOB_GUIDANCE[type as keyof typeof JOB_GUIDANCE]
    : UNKNOWN_GUIDANCE;
}

function statusFor(job: FailedJobRecord) {
  if (
    job.status === "DEAD_LETTER" ||
    (job.status === "FAILED" && job.dead_lettered_at)
  )
    return {
      label: "자동 처리 중단",
      explanation: "자동 처리가 중단된 기록이에요. 현재 결과부터 확인하세요.",
      stopped: true,
    };
  if (job.status === "FAILED")
    return {
      label: "처리 실패",
      explanation:
        "처리 실패가 기록됐어요. 재시도 시점은 이 목록에서 확인할 수 없어요.",
      stopped: false,
    };
  return {
    label: "현재 상태 확인 필요",
    explanation:
      "현재 처리 상태를 확인하지 못했어요. 목록을 다시 불러와 주세요.",
    stopped: false,
  };
}

export function FailedJobs({
  jobs,
  unavailable,
  canUseAssistant,
  observedAt,
}: {
  jobs: readonly FailedJobRecord[];
  unavailable: boolean;
  canUseAssistant: boolean;
  observedAt: string;
}) {
  return (
    <section
      className={styles.root}
      aria-labelledby="failed-jobs-title"
      data-testid="failed-jobs"
    >
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>자동 작업</p>
          <h2 id="failed-jobs-title">확인이 필요한 자동 작업</h2>
          <p className={styles.description}>
            먼저 현재 결과를 확인해요. 작업 실패가 금액 반영 실패를 뜻하지는
            않아요.
          </p>
        </div>
        <div className={styles.toolbar}>
          <TodayRefreshButton label="목록 다시 불러오기" />
          {canUseAssistant ? (
            <Link
              className={styles.secondaryAction}
              href={"/assistant" as Route}
            >
              운영 도우미
            </Link>
          ) : null}
        </div>
      </header>

      {unavailable ? (
        <div className={styles.readState} role="alert">
          <h3>작업 목록을 확인하지 못했어요</h3>
          <p>현재 작업 상태는 확인되지 않았어요. 목록을 다시 불러와 주세요.</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className={styles.readState} role="status">
          <h3>실패한 작업 기록이 없어요</h3>
          <p>이 조회에서 실패하거나 중단된 작업을 찾지 못했어요.</p>
        </div>
      ) : (
        <>
          <p className={styles.listSummary} role="status">
            불러온 작업 {jobs.length.toLocaleString("ko-KR")}건 · 오래된
            기록부터 최대 20건
          </p>
          <section className={styles.jobList} aria-label="실패 작업">
            {jobs.map((job, index) => {
              const guidance = guidanceFor(job.job_type);
              const status = statusFor(job);
              return (
                <article
                  className={styles.job}
                  key={job.id}
                  data-testid={`failed-job-review-${index + 1}`}
                  aria-labelledby={`failed-job-title-${index}`}
                >
                  <header className={styles.jobHeader}>
                    <div>
                      <p className={styles.eyebrow}>확인할 작업 {index + 1}</p>
                      <h3 id={`failed-job-title-${index}`}>{guidance.title}</h3>
                    </div>
                    <span
                      className={styles.status}
                      data-state={status.stopped ? "stopped" : "attention"}
                    >
                      {status.label}
                    </span>
                  </header>
                  <div className={styles.jobBody}>
                    <div className={styles.context}>
                      <p>{status.explanation}</p>
                      <p>{guidance.description}</p>
                      <dl className={styles.evidence}>
                        <div>
                          <dt>처리 시도</dt>
                          <dd>{job.attempts.toLocaleString("ko-KR")}회</dd>
                        </div>
                        <div>
                          <dt>마지막 변경</dt>
                          <dd>
                            <time dateTime={job.updated_at}>
                              {formatKst(job.updated_at)}
                            </time>
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className={styles.nextSteps}>
                      <h4>지금 확인할 순서</h4>
                      <ol>
                        {guidance.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <Link
                        className={styles.primaryAction}
                        href={guidance.href as Route}
                        prefetch={false}
                      >
                        <span className={styles.actionLabel}>
                          {guidance.action}
                        </span>
                        <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
          <aside className={styles.boundary} aria-label="복구 전에 확인">
            <h3>이 화면에서는 작업을 다시 실행할 수 없어요</h3>
            <p>
              원인과 영향을 먼저 확인해요. 같은 처리나 송금을 반복하지 마세요.
            </p>
            <p>
              복구 요청에는 작업 이름·처리 시도·마지막 변경 시각을 함께
              전달하세요.
            </p>
            <p>관련 회원과 복구 결과는 이 목록에서 확인할 수 없어요.</p>
          </aside>
        </>
      )}
      <p className={styles.observed}>
        조회한 시각 · <time dateTime={observedAt}>{formatKst(observedAt)}</time>
      </p>
    </section>
  );
}
