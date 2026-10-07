import Link from "next/link";
import type { Route } from "next";

import {
  depositStatusLabel,
  formatKst,
  formatUsdt,
  shortId,
} from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";
import { similarPendingRequests } from "@/lib/operations/similar-requests";
import { SimilarRequestNotice } from "@/components/operations/similar-request-notice";

import { ConfirmUsdtDepositForm } from "./confirm-form";

/** 캐노니컬 회원 USDT 수동 입금. crypto_deposits / deposit_requests가 아님. */
type UsdtManualDepositRow = {
  id: string;
  user_id: string;
  network: string;
  tx_hash: string;
  sent_usdt_amount: string | number;
  deposit_address_snapshot: string;
  network_snapshot: string;
  status: string;
  created_at: string;
};

export default async function UsdtDepositQueuePage() {
  await requireAdminPage("/deposits/usdt");
  const db = createAdminServiceClient();

  // 회원 USDT 입금 진리원: usdt_manual_deposits (SUBMITTED만 확인 대기).
  // 레거시 crypto_deposits + deposit_requests는 회원 USDT 진리로 쓰지 않는다.
  const { data, error } = await db
    .from("usdt_manual_deposits")
    .select(
      `
      id,
      user_id,
      network,
      tx_hash,
      sent_usdt_amount,
      deposit_address_snapshot,
      network_snapshot,
      status,
      created_at
    `,
    )
    .eq("status", "SUBMITTED")
    .order("created_at", { ascending: true })
    .limit(40);

  const rows = (data ?? []) as UsdtManualDepositRow[];
  const similar = similarPendingRequests(
    error
      ? []
      : rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          method: row.network_snapshot,
          amount: row.sent_usdt_amount,
        })),
  );

  return (
    <div
      data-ui-ready="/deposits/usdt"
      data-ui-state={error ? "error" : rows.length ? "loaded" : "empty"}
    >
      <QueueShell
        eyebrow="USDT 수동 입금"
        lead="회원이 보낸 USDT를 확인하고, 원화 입금만 반영합니다. 회원 USDT 잔액은 없습니다."
        title="USDT 입금 확인"
      />

      {error ? (
        <p className="queue-flash" role="alert">
          입금 대기열을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
        </p>
      ) : null}

      {!error && rows.length === 0 ? (
        <EmptyQueue
          body="확인할 USDT 입금이 없습니다."
          title="대기 중인 입금 없음"
        />
      ) : null}

      <section className="queue-list" aria-label="USDT 입금 확인 대기">
        {rows.map((row) => (
          <QueueCard key={row.id} id={`usdt-deposit-${row.id}`}>
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">입금 · {shortId(row.id)}</p>
                <h2>{depositStatusLabel(row.status)}</h2>
              </div>
              <time dateTime={row.created_at}>{formatKst(row.created_at)}</time>
            </header>

            <dl className="evidence-grid">
              <div>
                <dt>네트워크(요청 시점)</dt>
                <dd>{row.network_snapshot}</dd>
              </div>
              <div>
                <dt>입금 주소(요청 시점)</dt>
                <dd className="mono">{row.deposit_address_snapshot}</dd>
              </div>
              <div>
                <dt>거래 해시</dt>
                <dd className="mono">{row.tx_hash}</dd>
              </div>
              <div>
                <dt>보낸 USDT</dt>
                <dd>{formatUsdt(row.sent_usdt_amount)}</dd>
              </div>
              <div>
                <dt>회원</dt>
                <dd>
                  <Link
                    className="text-link"
                    href={`/members?id=${row.user_id}` as Route}
                  >
                    회원 기록 확인
                  </Link>
                </dd>
              </div>
            </dl>
            <SimilarRequestNotice count={similar.get(row.id)} />

            {/*
              REJECTED 전환은 WS-04에 공개 명령이 없다.
              원장·잔액 효과는 HUMAN_DECISION_REQUIRED — 여기서 구현하지 않는다.
            */}
            <p className="panel-note">
              반영할 원화는 운영자가 직접 입력합니다. 자동 환율은 쓰지 않습니다.
              이 화면에서는 입금 확인만 할 수 있습니다. 반려는 처리할 수
              없습니다.
            </p>

            <ConfirmUsdtDepositForm depositId={row.id} />
          </QueueCard>
        ))}
      </section>
    </div>
  );
}
