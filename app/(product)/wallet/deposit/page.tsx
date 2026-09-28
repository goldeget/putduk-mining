import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { DepositForm } from "@/components/product/deposit-form";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import { UsdtManualDepositForm } from "@/components/product/usdt-manual-deposit-form";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";

const statusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  REQUESTED: {
    description: "입금 안내를 확인하는 단계예요.",
    label: "요청 접수",
    tone: "info",
  },
  AWAITING_TRANSFER: {
    description: "안내된 계좌로 본인 명의 이체를 진행해 주세요.",
    label: "이체 대기",
    tone: "warning",
  },
  REVIEWING: {
    description: "입금 정보를 확인하고 있어요.",
    label: "입금 확인 중",
    tone: "warning",
  },
  APPROVED: {
    description: "확인이 끝나 KRW 지갑에 반영됐어요.",
    label: "반영 완료",
    tone: "success",
  },
  REJECTED: {
    description: "입금 정보가 일치하지 않아 확인이 필요해요.",
    label: "확인 필요",
    tone: "danger",
  },
  CANCELLED: {
    description: "취소된 요청이에요.",
    label: "취소",
    tone: "neutral",
  },
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export default async function DepositPage() {
  const identity = await requirePageUser();

  const { data: requests, error } = await identity.supabase
    .from("deposit_requests")
    .select("id, currency, amount_atomic, status, requested_at, updated_at")
    .eq("user_id", identity.userId)
    .order("requested_at", { ascending: false })
    .limit(8);

  // USDT 안내·요청 테이블/읽기 경로는 Agent A 스키마에 따름.
  // 동결 RPC submit_usdt_manual_deposit만 호출하고, 안내는 준비되면 표시.
  let usdtInstructions: { address: string; network: string } | null = null;
  let usdtRequests: Array<{
    id: string;
    network_snapshot: string;
    tx_hash: string;
    sent_usdt_amount: string | number;
    status: string;
    created_at: string;
    updated_at: string | null;
  }> | null = null;
  let usdtHistoryReady = false;

  try {
    const { data: instructionRow } = await identity.supabase
      .from("usdt_deposit_instructions")
      .select("address, network, is_active")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (instructionRow?.address && instructionRow?.network) {
      usdtInstructions = {
        address: String(instructionRow.address),
        network: String(instructionRow.network),
      };
    }
  } catch {
    usdtInstructions = null;
  }

  try {
    const { data, error: usdtError } = await identity.supabase
      .from("usdt_manual_deposit_requests")
      .select(
        "id, network_snapshot, tx_hash, sent_usdt_amount, status, created_at, updated_at",
      )
      .eq("user_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(6);
    if (!usdtError) {
      usdtHistoryReady = true;
      usdtRequests = data ?? [];
    }
  } catch {
    usdtHistoryReady = false;
  }

  return (
    <>
      <Link className={styles.pageBack} href="/wallet">
        ← 내 자산으로
      </Link>
      <PageHeading
        eyebrow="DEPOSIT"
        title="입금하기"
        lead="입금은 선택 사항이에요. PUTDUK START 전환이나 첫 출금 조건이 아닙니다."
      />

      <div className={styles.fundingWorkspace}>
        <Surface as="section" className={styles.fundingPanel} tone="raised">
          <DepositForm />
        </Surface>

        <Surface as="aside" className={styles.summaryPanel}>
          <p className="eyebrow">MANUAL TRANSFER</p>
          <h2>직접 이체 후 확인</h2>
          <p>요청만으로는 잔액이 바뀌지 않아요. 확인된 뒤 KRW에 반영됩니다.</p>
          <ol className={styles.flowList}>
            <li>
              <span>01</span>
              입금 요청·안내 확인
            </li>
            <li>
              <span>02</span>
              본인 명의로 이체·송금
            </li>
            <li>
              <span>03</span>
              입금 확인
            </li>
            <li>
              <span>04</span>
              KRW 지갑 반영
            </li>
          </ol>
        </Surface>
      </div>

      <Surface as="section" className={styles.fundingPanel} tone="raised">
        <UsdtManualDepositForm instructions={usdtInstructions} />
      </Surface>

      <section
        className={styles.historyPanel}
        aria-labelledby="deposit-history"
      >
        <header className={styles.historyHeader}>
          <span>
            <p className="eyebrow">KRW BANK TRANSFER</p>
            <h2 id="deposit-history">최근 원화 입금</h2>
            <p>요청별 금액과 처리 단계예요.</p>
          </span>
          <PutdukIcon name="clock" size={22} aria-hidden="true" />
        </header>

        {error ? (
          <div className={styles.emptyInset}>
            <StatePanel
              tone="error"
              title="입금 요청 내역을 불러오지 못했어요"
              description="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
            />
          </div>
        ) : requests?.length ? (
          <div className={styles.historyList}>
            {requests.map((request) => {
              const status = statusCopy[request.status] ?? {
                description: "현재 처리 상태를 확인하고 있어요.",
                label: "확인 중",
                tone: "info" as const,
              };
              return (
                <article className={styles.historyItem} key={request.id}>
                  <span>
                    <span className={styles.historyPrimary}>
                      <ProductStatusPill
                        label={status.label}
                        tone={status.tone}
                      />
                      <span>
                        <strong>
                          {formatAtomicAmount(
                            String(request.amount_atomic),
                            request.currency as DisplayCurrency,
                          )}
                        </strong>
                        <small>{status.description}</small>
                      </span>
                    </span>
                  </span>
                  <time dateTime={request.updated_at ?? request.requested_at}>
                    {dateFormatter.format(
                      new Date(request.updated_at ?? request.requested_at),
                    )}
                  </time>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyInset}>
            <StatePanel
              title="아직 원화 입금 요청이 없어요"
              description="금액을 정해 요청하면 진행 상태가 이곳에 표시됩니다."
            />
          </div>
        )}
      </section>

      <section
        className={styles.historyPanel}
        aria-labelledby="usdt-deposit-history"
      >
        <header className={styles.historyHeader}>
          <span>
            <p className="eyebrow">USDT MANUAL DEPOSIT</p>
            <h2 id="usdt-deposit-history">최근 USDT 입금</h2>
            <p>코인을 따로 보관하지 않아요. KRW 반영을 기다리는 요청이에요.</p>
          </span>
          <PutdukIcon name="wallet" size={22} aria-hidden="true" />
        </header>

        {!usdtHistoryReady ? (
          <div className={styles.emptyInset}>
            <StatePanel
              title="USDT 입금 내역을 준비하고 있어요"
              description="접수 기능이 열리면 상태·네트워크·거래 해시가 이곳에 표시됩니다."
            />
          </div>
        ) : usdtRequests?.length ? (
          <div className={styles.historyList}>
            {usdtRequests.map((request) => (
              <article className={styles.historyItem} key={request.id}>
                <span>
                  <span className={styles.historyPrimary}>
                    <ProductStatusPill
                      label={
                        request.status === "APPROVED"
                          ? "KRW 반영"
                          : request.status === "REVIEWING"
                            ? "확인 중"
                            : "접수"
                      }
                      tone={
                        request.status === "APPROVED"
                          ? "success"
                          : request.status === "REJECTED"
                            ? "danger"
                            : "info"
                      }
                    />
                    <span>
                      <strong>
                        {String(request.sent_usdt_amount)} USDT 송금
                      </strong>
                      <small>
                        {request.network_snapshot} ·{" "}
                        {maskTx(String(request.tx_hash))}
                      </small>
                    </span>
                  </span>
                </span>
                <time dateTime={request.updated_at ?? request.created_at}>
                  {dateFormatter.format(
                    new Date(request.updated_at ?? request.created_at),
                  )}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyInset}>
            <StatePanel
              title="아직 USDT 입금 내역이 없어요"
              description="안내 주소로 보낸 뒤 거래 정보를 접수하면 이곳에 표시됩니다."
            />
          </div>
        )}
      </section>
    </>
  );
}

function maskTx(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
