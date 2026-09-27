import Link from "next/link";

import { PageHeading } from "@/components/product/page-heading";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
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
  const { data: accounts, error: accountsError } = await identity.supabase
    .from("wallet_balance_snapshots")
    .select("*")
    .eq("user_id", identity.userId)
    .order("currency");
  const accountIds = (accounts ?? []).map(
    (account) => account.wallet_account_id,
  );
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
  const currencyByAccount = new Map(
    (accounts ?? []).map((account) => [
      account.wallet_account_id,
      account.currency as DisplayCurrency,
    ]),
  );

  return (
    <>
      <PageHeading
        eyebrow="MY WALLET"
        title="지금 쓸 수 있는 금액부터, 어디서 왔는지까지."
        lead="KRW를 중심으로 사용 가능 금액, 처리 중인 금액과 최근 보상·입출금 내역을 분명하게 보여드립니다."
        action={
          <div className="wallet-actions">
            <Link className="button button--primary" href="/wallet/deposit">
              입금
            </Link>
            <Link className="button button--secondary" href="/wallet/withdraw">
              출금
            </Link>
          </div>
        }
      />
      <section className="balance-grid" aria-label="자산 계정">
        {accountsError ? (
          <StatePanel
            tone="error"
            title="지갑을 불러오지 못했어요"
            description="연결을 확인한 뒤 다시 시도해 주세요. 표시 오류가 실제 잔액을 바꾸지는 않습니다."
          />
        ) : accounts?.length ? (
          accounts.map((account) => (
            <Surface
              as="article"
              className="balance-card"
              key={account.wallet_account_id}
            >
              <div>
                <span>{account.currency}</span>
                <small>
                  {account.currency === "KRW" ? "기본 지갑" : "보조 지갑"}
                </small>
              </div>
              <small>전체 잔액</small>
              <strong>
                {formatAtomicAmount(
                  account.balance_atomic,
                  account.currency as DisplayCurrency,
                )}
              </strong>
              <dl className="balance-card__breakdown">
                <div>
                  <dt>사용 가능</dt>
                  <dd>
                    {formatAtomicAmount(
                      account.available_balance_atomic,
                      account.currency as DisplayCurrency,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>처리 중·보류</dt>
                  <dd>
                    {formatAtomicAmount(
                      (
                        BigInt(String(account.balance_atomic)) -
                        BigInt(String(account.available_balance_atomic))
                      ).toString(),
                      account.currency as DisplayCurrency,
                    )}
                  </dd>
                </div>
              </dl>
            </Surface>
          ))
        ) : (
          <StatePanel
            title="아직 표시할 지갑이 없어요"
            description="계정 준비가 끝나면 KRW 지갑이 이곳에 표시됩니다."
          />
        )}
      </section>
      <Surface as="section" className="ledger-principle">
        <p className="eyebrow">CLEAR MONEY HISTORY</p>
        <h2>모든 금액 변화는 이유와 처리 상태를 함께 남깁니다.</h2>
        <p>
          출금 대기 금액은 사용할 수 있는 금액과 분리됩니다. 완료·취소·환불도
          기존 기록을 지우지 않고 새 기록으로 확인할 수 있습니다.
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
            description="잠시 후 다시 확인해 주세요. 이미 접수된 요청은 그대로 유지됩니다."
          />
        ) : ledgerEntries?.length ? (
          <div>
            {ledgerEntries.map((entry) => {
              const currency =
                currencyByAccount.get(entry.wallet_account_id) ?? "KRW";
              return (
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
                    {formatAtomicAmount(String(entry.amount_atomic), currency)}
                  </strong>
                </article>
              );
            })}
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
                      receipt.currency as DisplayCurrency,
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
            description="입금 또는 출금 요청을 만들면 요청 번호와 진행 상태가 이곳에 표시됩니다."
          />
        )}
      </section>
    </>
  );
}
