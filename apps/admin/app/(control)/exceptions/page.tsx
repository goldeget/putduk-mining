import { formatKst, shortId } from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { ExceptionAckForm } from "./ack-form";

export default async function ExceptionsPage() {
  await requireAdminPage("/exceptions");
  const db = createAdminServiceClient();

  const [mismatches, jobs] = await Promise.all([
    db
      .from("reconciliation_mismatches")
      .select(
        "id, mismatch_type, subject_type, subject_id, status, created_at, resolution_reason",
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

  return (
    <>
      <QueueShell
        eyebrow="SETTLEMENT · RECONCILIATION"
        lead="정산 실패와 대사 차이를 확인합니다. 여기서 숫자를 자동으로 고치지 않습니다."
        title="정산·대사 예외"
      />

      {mismatches.error || jobs.error ? (
        <p className="queue-flash" role="alert">
          예외 목록을 일부 불러오지 못했습니다.
        </p>
      ) : null}

      <section className="section-heading">
        <div>
          <p className="eyebrow">RECONCILIATION</p>
          <h2>대사 차이</h2>
        </div>
      </section>

      {!mismatches.error && mismatchRows.length === 0 ? (
        <EmptyQueue body="열린 대사 차이가 없습니다." title="대사 예외 없음" />
      ) : null}

      <section className="queue-list" aria-label="대사 예외">
        {mismatchRows.map((row) => (
          <QueueCard key={row.id} tone="caution">
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">{row.mismatch_type}</p>
                <h2>
                  {row.subject_type} · {shortId(row.subject_id)}
                </h2>
              </div>
              <span>{row.status}</span>
            </header>
            <p className="panel-note">발견 {formatKst(row.created_at)}</p>
            <ExceptionAckForm mismatchId={row.id} />
          </QueueCard>
        ))}
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">BACKGROUND JOBS</p>
          <h2>실패·격리된 작업</h2>
        </div>
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
                <p className="eyebrow">{row.job_type}</p>
                <h2>
                  {row.dead_lettered_at ? "격리됨" : "실패"} · 사람 확인 필요
                </h2>
              </div>
              <time dateTime={row.updated_at}>{formatKst(row.updated_at)}</time>
            </header>
            <p className="panel-note">
              시도 {row.attempts}회 · {shortId(row.id)}. 이 화면에서 잔액을 직접
              고치지 않습니다.
            </p>
          </QueueCard>
        ))}
      </section>
    </>
  );
}
