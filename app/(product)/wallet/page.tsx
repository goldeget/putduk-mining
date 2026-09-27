import Link from "next/link";

import { PageHeading } from "@/components/product/page-heading";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";

const entryLabels: Record<string, string> = {
  DEPOSIT: "입금",
  WITHDRAWAL: "출금",
  MINING_REWARD: "채굴 보상",
  WELCOME_REWARD: "환영 보상",
  TRIAL_REWARD_CONVERSION: "PUTDUK START 전환",
  EVENT_REWARD: "이벤트 보상",
  FUNDING_PROMO_REWARD: "입금 프로모션",
  REFERRAL_REWARD: "친구 초대 보상",
  REFUND: "환불",
  REVERSAL: "취소 반영",
};

const receiptStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  PENDING: "확인 중",
  REVIEWING: "확인 중",
  APPROVED: "승인",
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  REJECTED: "반려",
  FAILED: "처리 실패",
  CANCELLED: "취소",
};

const receiptTypeLabels: Record<string, string> = {
  DEPOSIT: "입금",
  WITHDRAWAL: "출금",
  WELCOME_WITHDRAWAL: "환영 보상 첫 출금",
};

export default async function WalletPage() {
  const identity = await requirePageUser();
  const [
    { data: krwAccount, error: accountsError },
    { data: trial, error: trialError },
  ] = await Promise.all([
    identity.supabase
      .from("wallet_balance_snapshots")
      .select("*")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .maybeSingle(),
    identity.supabase
      .from("trial_account_snapshots")
      .select("status, reward_atomic")
      .eq("user_id", identity.userId)
      .maybeSingle(),
  ]);

  const accountIds = krwAccount ? [krwAccount.wallet_account_id] : [];
  const [{ data: ledgerEntries, error: ledgerError }, { data: receipts }] =
    await Promise.all([
      accountIds.length
        ? identity.supabase
            .from("wallet_ledger")
            .select(
              "id, wallet_account_id, direction, entry_type, amount_atomic, created_at",
            )
            .eq("user_id", identity.userId)
            .in("wallet_account_id", accountIds)
            .order("created_at", { ascending: false })
            .limit(12)
        : Promise.resolve({ data: [], error: null }),
      identity.supabase
        .from("transaction_receipts")
        .select(
          "id, receipt_number, transaction_type, amount_atomic, currency, status, requested_at, completed_at",
        )
        .eq("user_id", identity.userId)
        .order("requested_at", { ascending: false })
        .limit(6),
    ]);

  const availableAtomic = String(krwAccount?.available_balance_atomic ?? "0");
  const heldAtomic = krwAccount
    ? (
        BigInt(String(krwAccount.balance_atomic)) -
        BigInt(String(krwAccount.available_balance_atomic))
      ).toString()
    : "0";

  return (
    <>
      <PageHeading
        eyebrow="MY WALLET"
        title="실제 출금 가능 잔액을 확인하세요."
        lead="사용 가능 원화와 출금 보류를 나누어 보여 드립니다. 체험 값은 아래에 따로 표시됩니다."
        action={
          <div className="wallet-actions">
            <Link className="button button--primary" href="/wallet/withdraw">
              출금하기
            </Link>
            <Link className="button button--secondary" href="/wallet/deposit">
              입금하기
            </Link>
          </div>
        }
      />

      <section className="balance-grid" aria-label="실제 KRW 지갑">
        {accountsError ? (
          <StatePanel
            tone="error"
            title="지갑을 불러오지 못했어요"
            description="연결을 확인한 뒤 다시 시도해 주세요."
          />
        ) : krwAccount ? (
          <Surface as="article" className="balance-card balance-card--primary">
            <div>
              <span>실제 지갑</span>
              <small>출금 가능</small>
            </div>
            <small>사용 가능 잔액</small>
            <strong>{formatAtomicAmount(availableAtomic, "KRW")}</strong>
            <dl className="balance-card__breakdown">
              <div>
                <dt>출금 보류</dt>
                <dd>{formatAtomicAmount(heldAtomic, "KRW")}</dd>
              </div>
              <div>
                <dt>전체</dt>
                <dd>
                  {formatAtomicAmount(
                    String(krwAccount.balance_atomic),
                    "KRW",
                  )}
                </dd>
              </div>
            </dl>
          </Surface>
        ) : (
          <StatePanel
            title="아직 표시할 지갑이 없어요"
            description="계정 준비가 끝나면 KRW 지갑이 이곳에 표시됩니다."
          />
        )}

        <Surface as="article" className="balance-card balance-card--trial">
          <div>
            <span>체험 보상</span>
            <small>분리 보관</small>
          </div>
          <small>PUTDUK START</small>
          <strong>
            {trialError
              ? "확인할 수 없음"
              : formatTrialValue(String(trial?.reward_atomic ?? "0"))}
          </strong>
          <p className="balance-card__note">
            체험 값은 원화가 아닙니다. 자격 확인 후 전환된 금액만 실제 지갑에
            반영됩니다.
          </p>
          <Link className="text-link" href="/start">
            전환 자격 안내
          </Link>
        </Surface>
      </section>

      <Surface as="section" className="ledger-principle">
        <p className="eyebrow">CLEAR MONEY HISTORY</p>
        <h2>금액 변화는 이유와 상태를 함께 남깁니다.</h2>
        <p>
          출금 보류는 사용 가능 금액과 분리됩니다. USDT 입출금도 사용자 USDT
          잔액이 아니라 KRW 기준으로 처리됩니다.
        </p>
      </Surface>

      <section
        className="ledger-history"
        aria-labelledby="ledger-history-title"
      >
        <header>
          <p className="eyebrow">RECENT ACTIVITY</p>
          <h2 id="ledger-history-title">최근 거래 내역</h2>
        </header>
        {ledgerError ? (
          <StatePanel
            tone="error"
            title="거래 내역을 불러오지 못했어요"
            description="잠시 후 다시 확인해 주세요."
          />
        ) : ledgerEntries?.length ? (
          <div>
            {ledgerEntries.map((entry) => (
              <article key={entry.id}>
                <span
                  className={`ledger-direction ledger-direction--${entry.direction.toLowerCase()}`}
                >
                  {entry.direction === "CREDIT" ? "+" : "−"}
                </span>
                <span>
                  <strong>
                    {entryLabels[entry.entry_type] ?? "지갑 변동"}
                  </strong>
                  <time dateTime={entry.created_at}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(entry.created_at))}
                  </time>
                </span>
                <strong>
                  {entry.direction === "CREDIT" ? "+" : "−"}
                  {formatAtomicAmount(String(entry.amount_atomic), "KRW")}
                </strong>
              </article>
            ))}
          </div>
        ) : (
          <p>
            아직 거래 내역이 없어요. 채굴 보상이나 입출금이 반영되면 이곳에서
            확인할 수 있습니다.
          </p>
        )}
      </section>

      <section
        className="wallet-receipts"
        aria-labelledby="wallet-receipts-title"
      >
        <header>
          <p className="eyebrow">REQUEST RECEIPTS</p>
          <h2 id="wallet-receipts-title">입출금 처리 내역</h2>
          <p>요청 번호와 현재 상태를 함께 확인할 수 있어요.</p>
        </header>
        {receipts?.length ? (
          <div className="wallet-receipts__list">
            {receipts.map((receipt) => (
              <article key={receipt.id}>
                <span>
                  <small>
                    {receiptTypeLabels[receipt.transaction_type] ?? "거래 요청"}
                  </small>
                  <strong>
                    {formatAtomicAmount(
                      String(receipt.amount_atomic),
                      "KRW",
                    )}
                  </strong>
                </span>
                <span>
                  <small>상태</small>
                  <strong>
                    {receiptStatusLabels[receipt.status] ?? receipt.status}
                  </strong>
                </span>
                <span>
                  <small>요청 번호</small>
                  <code>{receipt.receipt_number}</code>
                </span>
                <time dateTime={receipt.completed_at ?? receipt.requested_at}>
                  {new Intl.DateTimeFormat("ko-KR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Seoul",
                  }).format(
                    new Date(receipt.completed_at ?? receipt.requested_at),
                  )}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <StatePanel
            title="아직 입출금 처리 내역이 없어요"
            description="입금 또는 출금 요청을 만들면 이곳에 표시됩니다."
          />
        )}
      </section>
    </>
  );
}
