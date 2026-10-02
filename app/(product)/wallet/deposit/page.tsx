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
import { classifyDepositRead } from "@/domain/wallet/deposit-read";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import {
  formatSentUsdtDisplay,
  isUsdtDepositNetwork,
  type UsdtDepositInstruction,
} from "@/domain/wallet/usdt-manual-deposit";
import { formatProductDateTime } from "@/lib/i18n/date-time";
import { requirePageUser } from "@/lib/auth/session";

const krwStatusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  REQUESTED: {
    description: "요청을 접수한 단계예요.",
    label: "요청 접수",
    tone: "info",
  },
  AWAITING_TRANSFER: {
    description: "본인 명의 이체를 기다리는 단계예요.",
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

const usdtStatusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  SUBMITTED: {
    description: "확인을 기다리고 있어요.",
    label: "접수",
    tone: "info",
  },
  CONFIRMED: {
    description: "확인이 끝나 KRW 지갑에 반영됐어요.",
    label: "KRW 반영 완료",
    tone: "success",
  },
  REJECTED: {
    description: "입금 정보를 다시 확인해 주세요.",
    label: "확인 필요",
    tone: "danger",
  },
};

function formatSeoul(value: string | null | undefined) {
  if (!value) {
    return "시간 확인 중";
  }
  try {
    return formatProductDateTime(value);
  } catch {
    return "시간 확인 중";
  }
}

function validTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : null;
}

function formatKrwAmount(amount: unknown, currency: unknown) {
  const atomic =
    typeof amount === "string" && /^-?\d+$/.test(amount)
      ? amount
      : typeof amount === "bigint"
        ? amount.toString()
        : typeof amount === "number" && Number.isSafeInteger(amount)
          ? String(amount)
          : null;
  if (!atomic || (currency !== "KRW" && currency !== "USDT")) {
    return "금액 확인 중";
  }
  try {
    return formatAtomicAmount(atomic, currency as DisplayCurrency);
  } catch {
    return "금액 확인 중";
  }
}

function readInstructions(rows: unknown): UsdtDepositInstruction[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const instructions: UsdtDepositInstruction[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const network = "network" in row ? String(row.network) : "";
    const depositAddress =
      "deposit_address" in row ? String(row.deposit_address).trim() : "";
    if (!isUsdtDepositNetwork(network) || depositAddress.length < 8) {
      continue;
    }
    if (instructions.some((item) => item.network === network)) {
      continue;
    }
    instructions.push({ depositAddress, network });
  }
  return instructions;
}

function maskTx(value: string) {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function reopenDeposit() {
  return (
    <Link className="button button--secondary" href="/wallet/deposit">
      다시 열기
    </Link>
  );
}

export default async function DepositPage() {
  const identity = await requirePageUser("/wallet/deposit");

  const { data: requests, error } = await identity.supabase
    .from("deposit_requests")
    .select("id, currency, amount_atomic, status, requested_at, updated_at")
    .eq("user_id", identity.userId)
    .order("requested_at", { ascending: false })
    .limit(8);

  const instructionResult = await identity.supabase
    .from("usdt_deposit_instructions")
    .select("deposit_address, network")
    .eq("is_active", true)
    .order("network", { ascending: true });
  const instructions = instructionResult.error
    ? []
    : readInstructions(instructionResult.data);
  const instructionRead = classifyDepositRead({
    count: instructions.length,
    error: Boolean(instructionResult.error),
  });

  const usdtHistoryResult = await identity.supabase
    .from("usdt_manual_deposits")
    .select(
      "id, network_snapshot, tx_hash, sent_usdt_amount, status, created_at, updated_at",
    )
    .eq("user_id", identity.userId)
    .order("created_at", { ascending: false })
    .limit(6);
  const usdtRequests = usdtHistoryResult.error
    ? []
    : (usdtHistoryResult.data ?? []);
  const usdtHistoryRead = classifyDepositRead({
    count: usdtRequests.length,
    error: Boolean(usdtHistoryResult.error),
  });
  const krwHistoryRead = classifyDepositRead({
    count: requests?.length ?? 0,
    error: Boolean(error),
  });

  return (
    <div
      data-ui-ready="/wallet/deposit"
      data-ui-state={
        error || instructionResult.error || usdtHistoryResult.error
          ? "partial"
          : "loaded"
      }
    >
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
              입금 요청
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
        <UsdtManualDepositForm
          instructions={instructions}
          loadFailed={instructionRead === "error"}
        />
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

        {krwHistoryRead === "error" ? (
          <div className={styles.emptyInset}>
            <StatePanel
              tone="error"
              title="입금 요청 내역을 불러오지 못했어요"
              description="인터넷 연결을 확인한 뒤 다시 열어 주세요."
              action={reopenDeposit()}
            />
          </div>
        ) : krwHistoryRead === "ready" && requests ? (
          <ul className={styles.historyList}>
            {requests.map((request) => {
              const status = krwStatusCopy[request.status] ?? {
                description: "현재 처리 상태를 확인하고 있어요.",
                label: "확인 중",
                tone: "info" as const,
              };
              const timestamp = validTimestamp(
                request.updated_at ?? request.requested_at,
              );
              return (
                <li className={styles.historyItem} key={request.id}>
                  <span>
                    <span className={styles.historyPrimary}>
                      <ProductStatusPill
                        label={status.label}
                        tone={status.tone}
                      />
                      <span>
                        <strong>
                          {formatKrwAmount(
                            request.amount_atomic,
                            request.currency,
                          )}
                        </strong>
                        <small>{status.description}</small>
                      </span>
                    </span>
                  </span>
                  <time {...(timestamp ? { dateTime: timestamp } : {})}>
                    {formatSeoul(timestamp)}
                  </time>
                </li>
              );
            })}
          </ul>
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
            <p>
              코인을 따로 보관하지 않아요. 확인 후 KRW로 반영되는 요청이에요.
            </p>
          </span>
          <PutdukIcon name="wallet" size={22} aria-hidden="true" />
        </header>

        {usdtHistoryRead === "error" ? (
          <div className={styles.emptyInset}>
            <StatePanel
              tone="error"
              title="USDT 입금 내역을 불러오지 못했어요"
              description="인터넷 연결을 확인한 뒤 다시 열어 주세요."
              action={reopenDeposit()}
            />
          </div>
        ) : usdtHistoryRead === "ready" ? (
          <ul className={styles.historyList}>
            {usdtRequests.map((request) => {
              const status = usdtStatusCopy[request.status] ?? {
                description: "현재 처리 상태를 확인하고 있어요.",
                label: "확인 중",
                tone: "info" as const,
              };
              const timestamp = validTimestamp(
                request.updated_at ?? request.created_at,
              );
              return (
                <li className={styles.historyItem} key={request.id}>
                  <span>
                    <span className={styles.historyPrimary}>
                      <ProductStatusPill
                        label={status.label}
                        tone={status.tone}
                      />
                      <span>
                        <strong>
                          {formatSentUsdtDisplay(request.sent_usdt_amount)} USDT
                          송금
                        </strong>
                        <small>{status.description}</small>
                        <small className={styles.historyDetail}>
                          {request.network_snapshot} ·{" "}
                          {maskTx(String(request.tx_hash))}
                        </small>
                      </span>
                    </span>
                  </span>
                  <time {...(timestamp ? { dateTime: timestamp } : {})}>
                    {formatSeoul(timestamp)}
                  </time>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.emptyInset}>
            <StatePanel
              title="아직 USDT 입금 내역이 없어요"
              description="안내 주소로 보낸 뒤 거래 정보를 접수하면 이곳에 표시됩니다."
            />
          </div>
        )}
      </section>
    </div>
  );
}
