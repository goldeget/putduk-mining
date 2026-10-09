import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { formatKst, shortId } from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { RouteRetryButton } from "@/components/route-retry-button";
import { requireAdminPage } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { kycRiskLabel, kycStatusLabel } from "./labels";
import { KycReviewForm } from "./review-form";
import { KycReviewFeedback } from "./review-feedback";

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
  const principal = await requireAdminPage("/kyc");
  if (!HIGH_IMPACT_ROLES.includes(principal.role)) {
    redirect("/unauthorized?code=ROLE_FORBIDDEN" as Route);
  }
  const db = createAdminServiceClient();
  // Match Member 360: privileged summary reads require a successful audit first.
  const audit = await db.from("audit_logs").insert({
    actor_user_id: principal.userId,
    actor_role: principal.role,
    action: "ADMIN_KYC_QUEUE_VIEW",
    target_type: "KYC_QUEUE",
    reason: "본인 확인 대기열에서 상태·위험 요약 조회",
    request_id: randomUUID(),
    metadata: {
      surface: "admin_kyc_queue",
      fields: ["status", "risk_level", "decision_reason", "submission_count"],
      limit: 40,
    },
  });
  if (audit.error) {
    return (
      <div data-ui-ready="/kyc" data-ui-state="error">
        <QueueShell
          eyebrow="본인 확인"
          lead="본인 확인 건을 검토하고 결과와 사유를 남깁니다."
          title="본인 확인 검토"
        />
        <p className="queue-flash" role="alert">
          조회 기록을 남기지 못해 본인 확인 정보를 열지 않았습니다.
          <RouteRetryButton />
        </p>
      </div>
    );
  }

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
  let submissionsUnavailable = false;
  if (!error && caseIds.length > 0) {
    const { data: submissions, error: submissionError } = await db
      .from("kyc_submissions")
      .select("case_id, document_kind")
      .in("case_id", caseIds);
    submissionsUnavailable = Boolean(submissionError);
    for (const row of submissionError ? [] : (submissions ?? [])) {
      const list = submissionByCase.get(row.case_id) ?? [];
      list.push({ document_kind: row.document_kind });
      submissionByCase.set(row.case_id, list);
    }
  }

  return (
    <div
      data-ui-ready="/kyc"
      data-ui-state={
        error
          ? "error"
          : submissionsUnavailable
            ? "partial"
            : rows.length === 0
              ? "empty"
              : "loaded"
      }
    >
      <QueueShell
        eyebrow="본인 확인"
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
          <RouteRetryButton />
        </p>
      ) : null}
      {submissionsUnavailable ? (
        <div className="queue-flash" role="alert">
          <p>
            제출 서류 정보를 확인하지 못했습니다. 자료를 다시 확인한 뒤 검토할
            수 있습니다.
          </p>
          <RouteRetryButton />
        </div>
      ) : null}

      <KycReviewFeedback>
        {!error && rows.length === 0 ? (
          <EmptyQueue
            body="지금 검토할 본인 확인 건이 없습니다."
            title="대기 건 없음"
          />
        ) : null}

        <section className="queue-list" aria-label="본인 확인 대기">
          {(error ? [] : rows).map((row) => {
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
                      {submissionsUnavailable
                        ? "확인 불가"
                        : submissionCount === 0
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
                <KycReviewForm
                  caseId={row.id}
                  evidenceAvailable={!submissionsUnavailable}
                />
              </QueueCard>
            );
          })}
        </section>
      </KycReviewFeedback>
    </div>
  );
}
