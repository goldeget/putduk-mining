import Link from "next/link";
import type { Route } from "next";

import {
  canReleaseHold,
  formatKst,
  formatKrw,
  hasExternalSendRecorded,
  shortId,
  withdrawalStatusLabel,
} from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";
import { ACTIONABLE_WITHDRAWAL_STATUSES } from "@/lib/withdrawals/queue-statuses";

import {
  EmptyQueueNextStep,
  WithdrawalOfflineBanner,
  WithdrawalQueueError,
} from "../_components/queue-states";
import { UsdtFinalizeForm, UsdtReleaseForm, UsdtSendForm } from "./forms";

type WithdrawalRow = {
  id: string;
  user_id: string;
  amount_atomic: number;
  status: string;
  destination_type: string;
  destination_snapshot: Record<string, unknown>;
  requested_at: string;
};

type CryptoWithdrawal = {
  withdrawal_request_id: string;
  network: string;
  destination_address: string;
  transaction_hash: string | null;
  submitted_at: string | null;
};

export default async function UsdtWithdrawalQueuePage() {
  await requireAdminPage("/withdrawals/usdt");
  const db = createAdminServiceClient();

  let { data, error } = await db
    .from("withdrawal_requests")
    .select(
      "id, user_id, amount_atomic, status, destination_type, destination_snapshot, requested_at",
    )
    .eq("destination_type", "USDT_ADDRESS")
    .in("status", [...ACTIONABLE_WITHDRAWAL_STATUSES])
    .order("requested_at", { ascending: true })
    .limit(40);

  if (error?.message?.includes("invalid input value for enum")) {
    const retry = await db
      .from("withdrawal_requests")
      .select(
        "id, user_id, amount_atomic, status, destination_type, destination_snapshot, requested_at",
      )
      .eq("destination_type", "USDT_ADDRESS")
      .in("status", ["REQUESTED", "REVIEWING", "APPROVED", "PROCESSING"])
      .order("requested_at", { ascending: true })
      .limit(40);
    data = retry.data;
    error = retry.error;
  }

  const rows = (data ?? []) as WithdrawalRow[];
  const ids = rows.map((r) => r.id);
  const cryptoMap = new Map<string, CryptoWithdrawal>();
  let cryptoReadFailed = false;
  if (!error && ids.length) {
    const crypto = await db
      .from("crypto_withdrawals")
      .select(
        "withdrawal_request_id, network, destination_address, transaction_hash, submitted_at",
      )
      .in("withdrawal_request_id", ids);
    cryptoReadFailed = Boolean(crypto.error);
    for (const item of (crypto.error
      ? []
      : (crypto.data ?? [])) as CryptoWithdrawal[]) {
      cryptoMap.set(item.withdrawal_request_id, item);
    }
  }

  return (
    <div
      data-ui-ready="/withdrawals/usdt"
      data-ui-state={
        error
          ? "error"
          : cryptoReadFailed
            ? "partial"
            : rows.length
              ? "loaded"
              : "empty"
      }
    >
      <QueueShell
        eyebrow="USDT 주소 출금"
        lead="KRW 잔액에서 빠져나가는 USDT 주소 출금입니다. 회원 USDT 잔액은 없습니다. 외부 송금 기록 뒤에는 다시 보내기를 제공하지 않습니다."
        title="USDT 출금 대기열"
      />

      <WithdrawalOfflineBanner />
      {cryptoReadFailed ? (
        <WithdrawalQueueError
          title="송금 기록을 확인하지 못했습니다"
          description="이미 송금한 기록을 확인할 때까지 작업을 잠급니다. 연결을 확인한 뒤 다시 불러오세요."
        />
      ) : null}

      {error ? (
        <WithdrawalQueueError
          description="USDT 출금 대기열을 불러오지 못했습니다. 잠시 후 다시 열어 주세요."
          title="대기열을 불러오지 못함"
        />
      ) : null}

      {!error && rows.length === 0 ? (
        <EmptyQueue
          body="처리할 USDT 출금이 없습니다."
          title="대기 중인 USDT 출금 없음"
        />
      ) : null}

      {!error && rows.length === 0 ? (
        <EmptyQueueNextStep>
          새 요청이 접수되면 여기에 나타납니다. KRW 잔액 기준 출금만 다룹니다.
        </EmptyQueueNextStep>
      ) : null}

      <section className="queue-list" aria-label="USDT 출금 대기">
        {(error ? [] : rows).map((row) => {
          const crypto = cryptoMap.get(row.id);
          const snap = row.destination_snapshot ?? {};
          const networkHint =
            crypto?.network ??
            (typeof snap.network === "string" ? snap.network : undefined);
          const addressMask = crypto?.destination_address
            ? `${crypto.destination_address.slice(0, 6)}…${crypto.destination_address.slice(-4)}`
            : typeof snap.address_mask === "string"
              ? snap.address_mask
              : "주소(마스킹)";
          const sent = hasExternalSendRecorded({
            status: row.status,
            txHash: crypto?.transaction_hash,
            sentAt: crypto?.submitted_at,
          });

          return (
            <QueueCard key={row.id} tone={sent ? "done" : "caution"}>
              <header className="queue-card__head">
                <div>
                  <p className="eyebrow">USDT 출금 · {shortId(row.id)}</p>
                  <h2>{withdrawalStatusLabel(row.status)}</h2>
                </div>
                <strong>{formatKrw(row.amount_atomic)}</strong>
              </header>

              <dl className="evidence-grid">
                <div>
                  <dt>요청 시각</dt>
                  <dd>{formatKst(row.requested_at)}</dd>
                </div>
                <div>
                  <dt>네트워크</dt>
                  <dd>{networkHint ?? "확인 필요"}</dd>
                </div>
                <div>
                  <dt>주소</dt>
                  <dd className="mono">{addressMask}</dd>
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
                {crypto?.transaction_hash ? (
                  <div>
                    <dt>거래 해시</dt>
                    <dd className="mono">{crypto.transaction_hash}</dd>
                  </div>
                ) : null}
              </dl>

              {cryptoReadFailed ? (
                <p className="panel-note" role="alert">
                  송금 기록 확인 후 작업할 수 있습니다.
                </p>
              ) : sent ? (
                <UsdtFinalizeForm withdrawalId={row.id} />
              ) : (
                <>
                  <UsdtSendForm
                    networkHint={networkHint}
                    withdrawalId={row.id}
                  />
                  {canReleaseHold(row.status) ? (
                    <UsdtReleaseForm withdrawalId={row.id} />
                  ) : null}
                </>
              )}
            </QueueCard>
          );
        })}
      </section>
    </div>
  );
}
