import Link from "next/link";
import type { Route } from "next";

import {
  formatKst,
  kycRiskLabel,
  kycStatusLabel,
  shortId,
} from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { KycReviewForm } from "./review-form";

type KycQueueRow = {
  id: string;
  user_id: string;
  status: string;
  risk_level: string;
  opened_at: string;
  decided_at: string | null;
  decision_reason: string | null;
};

/** 제출 건수만. 경로·해시·종류 원문·이미지는 노출하지 않는다. */
function countSubmissions(
  rows: { document_kind: string }[] | null | undefined,
): number {
  return (rows ?? []).length;
}

export default async function KycQueuePage() {
  await requireAdminPage("/kyc");
  const db = createAdminServiceClient();

  const { data, error } = await db
    .from("kyc_cases")
    .select(
      "id, user_id, status, risk_level, opened_at, decided_at, decision_reason",
    )
    .in("status", ["PENDING", "IN_REVIEW", "ON_HOLD", "REQUIRES_RESUBMISSION"])
    .order("opened_at", { ascending: true })
    .limit(40);

  const rows = (data ?? []) as KycQueueRow[];
  const caseIds = rows.map((row) => row.id);

  const submissionByCase = new Map<string, { document_kind: string }[]>();
  if (caseIds.length > 0) {
    const { data: submissions } = await db
      .from("kyc_submissions")
      .select("case_id, document_kind")
      .in("case_id", caseIds);
    for (const row of submissions ?? []) {
      const list = submissionByCase.get(row.case_id) ?? [];
      list.push({ document_kind: row.document_kind });
      submissionByCase.set(row.case_id, list);
    }
  }

  return (
    <>
      <QueueShell
        eyebrow="IDENTITY REVIEW"
        lead="본인 확인 건을 검토하고 결과와 사유를 남깁니다. 문서 원문·번호·비밀번호는 보여 주지 않습니다."
        title="본인 확인 검토"
      />

      <p className="panel-note" role="note">
        이 화면은 상태·위험 요약·제출 건수만 표시합니다. 원본 파일과 식별 번호는
        열지 않습니다.
      </p>

      {error ? (
        <p className="queue-flash" role="alert">
          본인 확인 대기열을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
        </p>
      ) : null}

      {!error && rows.length === 0 ? (
        <EmptyQueue
          body="지금 검토할 본인 확인 건이 없습니다."
          title="대기 건 없음"
        />
      ) : null}

      <section className="queue-list" aria-label="본인 확인 대기">
        {rows.map((row) => {
          const submissionCount = countSubmissions(
            submissionByCase.get(row.id),
          );
          return (
            <QueueCard
              key={row.id}
              tone={row.risk_level === "HIGH" ? "caution" : "default"}
            >
              <header className="queue-card__head">
                <div>
                  <p className="eyebrow">본인 확인 · {shortId(row.id)}</p>
                  <h2>{kycStatusLabel(row.status)}</h2>
                </div>
                <span className="risk-chip">
                  {kycRiskLabel(row.risk_level)}
                </span>
              </header>
              <dl className="evidence-grid">
                <div>
                  <dt>접수</dt>
                  <dd>
                    <time dateTime={row.opened_at}>
                      {formatKst(row.opened_at)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>회원</dt>
                  <dd>
                    <Link
                      className="text-link"
                      href={`/members?id=${row.user_id}` as Route}
                    >
                      {shortId(row.user_id)}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>제출 서류</dt>
                  <dd>
                    {submissionCount === 0
                      ? "없음"
                      : `${submissionCount}건 (원문 비공개)`}
                  </dd>
                </div>
                {row.decision_reason ? (
                  <div>
                    <dt>최근 사유</dt>
                    <dd>{row.decision_reason}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="panel-note">
                원문·저장 경로·해시·식별 번호는 표시하지 않습니다.
              </p>
              <KycReviewForm caseId={row.id} />
            </QueueCard>
          );
        })}
      </section>
    </>
  );
}
