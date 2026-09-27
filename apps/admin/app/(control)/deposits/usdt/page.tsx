import Link from "next/link";
import type { Route } from "next";

import {
  depositStatusLabel,
  formatKst,
  formatKrw,
  formatUsdt,
  shortId,
} from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { ConfirmUsdtDepositForm } from "./confirm-form";

type CryptoDepositRow = {
  id: string;
  deposit_request_id: string;
  user_id: string;
  network: string;
  deposit_address: string;
  transaction_hash: string | null;
  received_amount_atomic: number | null;
  created_at: string;
  deposit_requests:
    | {
        id: string;
        status: string;
        amount_atomic: number;
        requested_at: string;
        currency: string;
      }
    | {
        id: string;
        status: string;
        amount_atomic: number;
        requested_at: string;
        currency: string;
      }[]
    | null;
};

function asRequest(row: CryptoDepositRow) {
  const nested = row.deposit_requests;
  if (!nested) return null;
  return Array.isArray(nested) ? (nested[0] ?? null) : nested;
}

export default async function UsdtDepositQueuePage() {
  await requireAdminPage("/deposits/usdt");
  const db = createAdminServiceClient();

  // 기존 crypto_deposits + deposit_requests. WS-04 스냅샷 컬럼은 A 반영 후 확장.
  const { data, error } = await db
    .from("crypto_deposits")
    .select(
      `
      id,
      deposit_request_id,
      user_id,
      network,
      deposit_address,
      transaction_hash,
      received_amount_atomic,
      created_at,
      deposit_requests!inner (
        id,
        status,
        amount_atomic,
        requested_at,
        currency
      )
    `,
    )
    .in("deposit_requests.status", [
      "REQUESTED",
      "AWAITING_TRANSFER",
      "REVIEWING",
    ])
    .order("created_at", { ascending: true })
    .limit(40);

  const rows = (data ?? []) as unknown as CryptoDepositRow[];

  return (
    <>
      <QueueShell
        eyebrow="USDT MANUAL DEPOSIT"
        lead="회원이 보낸 USDT를 확인하고, 원화 입금만 반영합니다. 출금 처리는 이 화면에서 하지 않습니다."
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
        {rows.map((row) => {
          const request = asRequest(row);
          if (!request) return null;
          return (
            <QueueCard key={row.id}>
              <header className="queue-card__head">
                <div>
                  <p className="eyebrow">입금 · {shortId(request.id)}</p>
                  <h2>{depositStatusLabel(request.status)}</h2>
                </div>
                <time dateTime={request.requested_at}>
                  {formatKst(request.requested_at)}
                </time>
              </header>

              <dl className="evidence-grid">
                <div>
                  <dt>네트워크(요청 시점)</dt>
                  <dd>{row.network}</dd>
                </div>
                <div>
                  <dt>입금 주소(요청 시점)</dt>
                  <dd className="mono">{row.deposit_address}</dd>
                </div>
                <div>
                  <dt>거래 해시</dt>
                  <dd className="mono">{row.transaction_hash ?? "미입력"}</dd>
                </div>
                <div>
                  <dt>보낸 USDT</dt>
                  <dd>
                    {row.received_amount_atomic != null
                      ? formatUsdt(row.received_amount_atomic)
                      : "확인 필요"}
                  </dd>
                </div>
                <div>
                  <dt>요청 원화</dt>
                  <dd>{formatKrw(request.amount_atomic)}</dd>
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

              <ConfirmUsdtDepositForm
                depositId={request.id}
                suggestedKrw={String(request.amount_atomic)}
              />
            </QueueCard>
          );
        })}
      </section>
    </>
  );
}
