import Link from "next/link";
import type { Route } from "next";

import {
  formatKst,
  mismatchStatusLabel,
  mismatchTypeLabel,
} from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";
import {
  describeExceptionEvidence,
  exceptionSubjectLabel,
} from "@/lib/operations/exception-evidence";
import { operationType } from "@/lib/operations/registry";

import { ExceptionAckForm } from "./ack-form";

export default async function ExceptionsPage() {
  await requireAdminPage("/exceptions");
  const db = createAdminServiceClient();

  const [mismatches, jobs] = await Promise.all([
    db
      .from("reconciliation_mismatches")
      .select(
        "id, mismatch_type, subject_type, subject_id, status, created_at, resolution_reason, expected_value, actual_value",
      )
      .in("status", ["OPEN", "INVESTIGATING"])
      .order("created_at", { ascending: true })
      .limit(30),
    db
      .from("system_jobs")
      .select("id, job_type, status, attempts, updated_at, dead_lettered_at")
      .or("status.eq.FAILED,dead_lettered_at.not.is.null")
      .order("updated_at", { ascending: true })
      .limit(20),
  ]);

  const mismatchRows = mismatches.data ?? [];
  const jobRows = jobs.data ?? [];
  const loadFailed = Boolean(mismatches.error || jobs.error);

  return (
    <div
      data-ui-ready="/exceptions"
      data-ui-state={
        loadFailed
          ? "partial"
          : mismatchRows.length + jobRows.length === 0
            ? "empty"
            : "loaded"
      }
    >
      <QueueShell
        eyebrow="정산 · 대사"
        lead="정산 실패와 대사 차이를 확인합니다. 여기서 숫자를 자동으로 고치지 않습니다."
        title="정산·대사 예외"
      />

      {loadFailed ? (
        <p className="queue-flash" role="alert">
          예외 목록을 일부 불러오지 못했습니다.{" "}
          <Link className="text-link" href={"/exceptions" as Route}>
            다시 불러오기
          </Link>
        </p>
      ) : null}

      <section className="section-heading">
        <div>
          <p className="eyebrow">대사 차이</p>
          <h2>열린 대사 차이</h2>
        </div>
        <p className="panel-note" aria-live="polite">
          {mismatches.error
            ? "조회 확인 필요"
            : `${mismatchRows.length.toLocaleString("ko-KR")}건 · 자동 수리 없음`}
        </p>
      </section>

      {!mismatches.error && mismatchRows.length === 0 ? (
        <EmptyQueue
          body="열린 대사 차이가 없습니다. 차이가 나면 여기 증거로 남습니다."
          title="대사 예외 없음"
        />
      ) : null}

      <section className="queue-list" aria-label="대사 예외">
        {mismatchRows.map((row) => (
          <QueueCard key={row.id} tone="caution">
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">
                  {mismatchTypeLabel(row.mismatch_type)}
                </p>
                <h2>{exceptionSubjectLabel(row.subject_type)}</h2>
              </div>
              <span>{mismatchStatusLabel(row.status)}</span>
            </header>
            <dl className="evidence-grid">
              <div>
                <dt>발견</dt>
                <dd>{formatKst(row.created_at)}</dd>
              </div>
              <div>
                <dt>확인할 내용</dt>
                <dd>{mismatchTypeLabel(row.mismatch_type)}</dd>
              </div>
              <div>
                <dt>기대 값</dt>
                <dd>{describeExceptionEvidence(row.expected_value)}</dd>
              </div>
              <div>
                <dt>실제 값</dt>
                <dd>{describeExceptionEvidence(row.actual_value)}</dd>
              </div>
            </dl>
            {row.resolution_reason ? (
              <p className="panel-note">이전 사유: {row.resolution_reason}</p>
            ) : null}
            <p className="panel-note">
              이 화면은 확인만 합니다. 원장 수리는 별도 승인 명령이 필요합니다.
            </p>
            <ExceptionAckForm mismatchId={row.id} />
          </QueueCard>
        ))}
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">자동 작업</p>
          <h2>실패·격리된 작업</h2>
        </div>
        <p className="panel-note" aria-live="polite">
          {jobs.error
            ? "조회 확인 필요"
            : `${jobRows.length.toLocaleString("ko-KR")}건 · 잔액 직접 수정 없음`}
        </p>
      </section>

      {!jobs.error && jobRows.length === 0 ? (
        <EmptyQueue
          body="실패하거나 격리된 자동 작업이 없습니다."
          title="작업 예외 없음"
        />
      ) : null}

      <section className="queue-list" aria-label="실패 작업">
        {jobRows.map((row) => (
          <QueueCard key={row.id}>
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">{operationType(row.job_type)}</p>
                <h2>
                  {row.dead_lettered_at ? "격리됨" : "실패"} · 사람 확인 필요
                </h2>
              </div>
              <time dateTime={row.updated_at}>{formatKst(row.updated_at)}</time>
            </header>
            <p className="panel-note">
              시도 {row.attempts}회. 이 화면에서 잔액을 직접 고치지 않습니다.
            </p>
          </QueueCard>
        ))}
      </section>
    </div>
  );
}
