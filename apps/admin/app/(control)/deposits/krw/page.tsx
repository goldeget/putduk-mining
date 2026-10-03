import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { formatKrw, formatKst, shortId } from "@/app/(control)/_lib/format";
import {
  EmptyQueueNextStep,
  WithdrawalQueueError,
} from "@/app/(control)/withdrawals/_components/queue-states";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { loadKrwDepositQueue } from "@/lib/deposits/krw-queue";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminPage } from "@/lib/auth/principal";

export default async function KrwDepositQueuePage() {
  const principal = await requireAdminPage("/deposits/krw");
  if (!HIGH_IMPACT_ROLES.includes(principal.role)) {
    redirect("/unauthorized?code=ROLE_FORBIDDEN" as Route);
  }
  const loaded = await loadKrwDepositQueue();

  return (
    <div
      data-ui-ready="/deposits/krw"
      data-ui-state={
        loaded.ok ? (loaded.rows.length ? "loaded" : "empty") : "error"
      }
    >
      <QueueShell
        eyebrow="원화 입금"
        lead="계좌로 들어온 원화를 확인하고 잔액에 반영합니다."
        title="원화 입금 확인"
      />

      {!loaded.ok ? (
        <WithdrawalQueueError
          description="입금 대기열을 불러오지 못했습니다. 잠시 후 다시 열어 주세요."
          title="대기열을 불러오지 못함"
        />
      ) : null}

      {loaded.ok && loaded.rows.length === 0 ? (
        <>
          <EmptyQueue
            body="확인할 원화 입금이 없습니다."
            title="대기 중인 입금 없음"
          />
          <EmptyQueueNextStep>
            새 요청이 접수되면 여기에 나타납니다.
          </EmptyQueueNextStep>
        </>
      ) : null}

      <section className="queue-list" aria-label="원화 입금 확인 대기">
        {loaded.ok
          ? loaded.rows.map((row) => (
              <QueueCard key={row.id}>
                <header className="queue-card__head">
                  <div>
                    <p className="eyebrow">입금 · {shortId(row.id)}</p>
                    <h2>{formatKrw(row.amount_atomic)}</h2>
                  </div>
                  <time dateTime={row.requested_at}>
                    {formatKst(row.requested_at)}
                  </time>
                </header>
                <dl className="evidence-grid">
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
                <Link
                  className="ghost-button"
                  href={`/deposits/krw/${row.id}` as Route}
                >
                  이 입금 내용 보기
                </Link>
              </QueueCard>
            ))
          : null}
      </section>
    </div>
  );
}
