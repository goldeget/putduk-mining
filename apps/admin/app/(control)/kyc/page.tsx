import Link from "next/link";
import type { Route } from "next";

import {
  formatKst,
  kycStatusLabel,
  shortId,
} from "@/app/(control)/_lib/format";
import {
  EmptyQueue,
  QueueCard,
  QueueShell,
} from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { KycReviewForm } from "./review-form";

export default async function KycQueuePage() {
  await requireAdminPage("/kyc");
  const db = createAdminServiceClient();

  const { data, error } = await db
    .from("kyc_cases")
    .select(
      "id, user_id, status, risk_level, opened_at, decided_at, decision_reason",
    )
    .in("status", [
      "PENDING",
      "IN_REVIEW",
      "ON_HOLD",
      "REQUIRES_RESUBMISSION",
    ])
    .order("opened_at", { ascending: true })
    .limit(40);

  const rows = data ?? [];

  return (
    <>
      <QueueShell
        eyebrow="IDENTITY REVIEW"
        lead="본인 확인 건을 검토하고 결과와 사유를 남깁니다. 문서 원문과 비밀번호는 보여 주지 않습니다."
        title="본인 확인 검토"
      />

      {error ? (
        <p className="queue-flash" role="alert">
          본인 확인 대기열을 불러오지 못했습니다.
        </p>
      ) : null}

      {!error && rows.length === 0 ? (
        <EmptyQueue
          body="지금 검토할 본인 확인 건이 없습니다."
          title="대기 건 없음"
        />
      ) : null}

      <section className="queue-list" aria-label="본인 확인 대기">
        {rows.map((row) => (
          <QueueCard key={row.id}>
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">본인 확인 · {shortId(row.id)}</p>
                <h2>{kycStatusLabel(row.status)}</h2>
              </div>
              <span className="risk-chip">{row.risk_level}</span>
            </header>
            <dl className="evidence-grid">
              <div>
                <dt>접수</dt>
                <dd>{formatKst(row.opened_at)}</dd>
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
            </dl>
            <KycReviewForm caseId={row.id} />
          </QueueCard>
        ))}
      </section>
    </>
  );
}
