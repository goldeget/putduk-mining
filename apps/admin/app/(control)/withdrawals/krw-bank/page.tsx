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

import {
  EmptyQueueNextStep,
  WithdrawalOfflineBanner,
  WithdrawalQueueError,
} from "../_components/queue-states";
import { FinalizeLedgerForm, KrwBankSendForm, ReleaseHoldForm } from "./forms";

type WithdrawalRow = {
  id: string;
  user_id: string;
  amount_atomic: number;
  status: string;
  destination_type: string;
  destination_snapshot: Record<string, unknown>;
  requested_at: string;
  rejection_reason: string | null;
};

export default async function KrwBankWithdrawalQueuePage() {
  await requireAdminPage("/withdrawals/krw-bank");
  const db = createAdminServiceClient();

  const { data, error } = await db
    .from("withdrawal_requests")
    .select(
      "id, user_id, amount_atomic, status, destination_type, destination_snapshot, requested_at, rejection_reason",
    )
    .eq("destination_type", "KRW_BANK")
    .in("status", [
      "REQUESTED",
      "REVIEWING",
      "APPROVED",
      "PROCESSING",
      "EXTERNAL_SENT_RECORDED",
      "HELD",
      "ADMIN_PROCESSING",
    ])
    .order("requested_at", { ascending: true })
    .limit(40);

  // 신규 상태 enum이 아직 없으면 기존 상태로 재조회
  let rows = (data ?? []) as WithdrawalRow[];
  let queryError = error;
  if (error?.message?.includes("invalid input value for enum")) {
    const retry = await db
      .from("withdrawal_requests")
      .select(
        "id, user_id, amount_atomic, status, destination_type, destination_snapshot, requested_at, rejection_reason",
      )
      .eq("destination_type", "KRW_BANK")
      .in("status", ["REQUESTED", "REVIEWING", "APPROVED", "PROCESSING"])
      .order("requested_at", { ascending: true })
      .limit(40);
    rows = (retry.data ?? []) as WithdrawalRow[];
    queryError = retry.error;
  }

  return (
    <>
      <QueueShell
        eyebrow="계좌 출금"
        lead="계좌 출금만 다룹니다. 은행 참조·실제 원화·운영자·송금 시각을 남깁니다. 네트워크나 거래해시는 묻지 않습니다."
        title="계좌 출금 대기열"
      />

      <WithdrawalOfflineBanner />

      {queryError ? (
        <WithdrawalQueueError
          description="계좌 출금 대기열을 불러오지 못했습니다. 잠시 후 다시 열어 주세요."
          title="대기열을 불러오지 못함"
        />
      ) : null}

      {!queryError && rows.length === 0 ? (
        <EmptyQueue
          body="처리할 계좌 출금이 없습니다."
          title="대기 중인 계좌 출금 없음"
        />
      ) : null}

      {!queryError && rows.length === 0 ? (
        <EmptyQueueNextStep>
          새 요청이 접수되면 여기에 나타납니다. 오늘의 퍼뜩에서 다른 업무를
          확인하세요.
        </EmptyQueueNextStep>
      ) : null}

      <section className="queue-list" aria-label="계좌 출금 대기">
        {rows.map((row) => {
          const snap = row.destination_snapshot ?? {};
          const bankRef =
            typeof snap.bank_reference === "string"
              ? snap.bank_reference
              : typeof snap.external_bank_reference === "string"
                ? snap.external_bank_reference
                : null;
          const sentAt = typeof snap.sent_at === "string" ? snap.sent_at : null;
          const sent = hasExternalSendRecorded({
            status: row.status,
            bankReference: bankRef,
            sentAt,
          });
          const mask =
            typeof snap.account_mask === "string"
              ? snap.account_mask
              : typeof snap.masked_account === "string"
                ? snap.masked_account
                : "계좌(마스킹)";

          return (
            <QueueCard key={row.id} tone={sent ? "done" : "default"}>
              <header className="queue-card__head">
                <div>
                  <p className="eyebrow">계좌 출금 · {shortId(row.id)}</p>
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
                  <dt>목적지</dt>
                  <dd>{mask}</dd>
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
                {bankRef ? (
                  <div>
                    <dt>은행 참조</dt>
                    <dd className="mono">{bankRef}</dd>
                  </div>
                ) : null}
                {sentAt ? (
                  <div>
                    <dt>송금 시각</dt>
                    <dd>{formatKst(sentAt)}</dd>
                  </div>
                ) : null}
              </dl>

              {sent ? (
                <FinalizeLedgerForm withdrawalId={row.id} />
              ) : (
                <>
                  <KrwBankSendForm
                    amountKrw={String(row.amount_atomic)}
                    withdrawalId={row.id}
                  />
                  {canReleaseHold(row.status) ? (
                    <ReleaseHoldForm withdrawalId={row.id} />
                  ) : null}
                </>
              )}
            </QueueCard>
          );
        })}
      </section>
    </>
  );
}
