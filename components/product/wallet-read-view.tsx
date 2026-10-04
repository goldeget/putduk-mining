import Link from "next/link";

import { PageHeading } from "@/components/product/page-heading";
import { WalletReadRecovery } from "@/components/product/wallet-read-recovery";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import {
  type KrwWalletProjection,
  type WalletLedgerEvidence,
  type WalletReadState,
  type WalletReceiptEvidence,
  formatWalletEvidenceTime,
  labelWalletEntryType,
  labelWalletReceiptStatus,
  labelWalletReceiptType,
} from "@/domain/wallet/wallet-read";
import type { WalletFundingView } from "@/lib/product/wallet-server-display";

export type WalletFundingPanel = { state: "error" } | WalletFundingView;

export type WalletReadViewProps = {
  balanceState: WalletReadState;
  funding: WalletFundingPanel;
  krw: KrwWalletProjection | null;
  ledgerEntries: WalletLedgerEvidence[];
  ledgerState: WalletReadState;
  receiptState: WalletReadState;
  receipts: WalletReceiptEvidence[];
  trialRewardAtomic: string | null;
  trialState: WalletReadState;
};

export function WalletReadView({
  balanceState,
  funding,
  krw,
  ledgerEntries,
  ledgerState,
  receiptState,
  receipts,
  trialRewardAtomic,
  trialState,
}: WalletReadViewProps) {
  return (
    <>
      <PageHeading
        eyebrow="MY WALLET"
        title="출금 가능 잔액"
        lead="사용 가능 원화와 출금 보류를 나눠 보여 드려요. 체험 값은 아래에 따로 있어요."
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
        {balanceState === "error" ? (
          <StatePanel
            tone="error"
            title="지갑을 불러오지 못했어요"
            description="연결을 확인한 뒤 다시 시도해 주세요. 실제 잔액은 바뀌지 않아요."
            action={<WalletReadRecovery />}
          />
        ) : balanceState === "empty" || !krw ? (
          <StatePanel
            title="아직 표시할 지갑이 없어요"
            description="계정 준비가 끝나면 KRW 지갑이 이곳에 표시됩니다."
          />
        ) : (
          <Surface as="article" className="balance-card balance-card--primary">
            <div>
              <span>실제 지갑</span>
              <small>출금 가능</small>
            </div>
            <small>사용 가능 잔액</small>
            <strong>{formatAtomicAmount(krw.availableAtomic, "KRW")}</strong>
            <dl className="balance-card__breakdown">
              <div>
                <dt>출금 보류</dt>
                <dd>{formatAtomicAmount(krw.heldAtomic, "KRW")}</dd>
              </div>
              <div>
                <dt>전체</dt>
                <dd>{formatAtomicAmount(krw.balanceAtomic, "KRW")}</dd>
              </div>
            </dl>
            {balanceState === "zero" ? (
              <p className="balance-card__note">
                지금 사용 가능한 원화는 0원이에요. 입금하거나 전환이 끝나면
                여기에 반영됩니다.
              </p>
            ) : null}
          </Surface>
        )}

        <Surface as="article" className="balance-card balance-card--trial">
          <div>
            <span>체험 보상</span>
            <small>분리 보관</small>
          </div>
          <small>PUTDUK START</small>
          <strong>
            {trialState === "error"
              ? "확인할 수 없음"
              : formatTrialValue(String(trialRewardAtomic ?? "0"))}
          </strong>
          <p className="balance-card__note">
            체험 값은 원화가 아니에요. 전환된 금액만 실제 지갑에 반영됩니다.
          </p>
          {trialState === "error" ? (
            <WalletReadRecovery label="체험 값 다시 확인" />
          ) : (
            <Link className="text-link" href="/start">
              전환 자격 안내
            </Link>
          )}
        </Surface>
      </section>

      <section
        className="wallet-funding"
        aria-labelledby="wallet-funding-title"
      >
        <header>
          <h2 id="wallet-funding-title">원금과 대기 수익</h2>
          <p className="wallet-funding__lead">
            정산 전 금액은 출금 가능 잔액에 포함되지 않아요.
          </p>
        </header>
        {funding.state === "error" ? (
          <StatePanel
            tone="error"
            title="원금과 대기 수익을 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요."
            action={<WalletReadRecovery label="금액 다시 확인" />}
          />
        ) : funding.state === "empty" ? (
          <p className="wallet-funding__empty">
            원금과 대기 수익은 아직 없어요.
          </p>
        ) : (
          <dl className="wallet-funding__facts">
            {funding.rows.map((row) => (
              <div
                key={row.label}
                className={
                  row.tone === "unconfirmed"
                    ? "wallet-funding__unconfirmed"
                    : "wallet-funding__fact"
                }
                data-funding-tone={row.tone}
              >
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
                {row.tone === "unconfirmed" ? (
                  <p>확정된 수익이 아니에요.</p>
                ) : null}
              </div>
            ))}
          </dl>
        )}
      </section>

      <Surface as="section" className="ledger-principle">
        <p className="eyebrow">CLEAR MONEY HISTORY</p>
        <h2>금액 변화는 이유와 상태를 함께 남겨요.</h2>
        <p>
          출금 보류는 사용 가능 금액과 분리됩니다. 수동 USDT 입금과 KRW 잔액
          출금도 이곳에 기록돼요.
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
        {ledgerState === "error" ? (
          <StatePanel
            tone="error"
            title="거래 내역을 불러오지 못했어요"
            description="잠시 후 다시 확인해 주세요. 이미 반영된 금액에는 영향이 없어요."
            action={<WalletReadRecovery />}
          />
        ) : ledgerState === "ready" ? (
          <div>
            {ledgerEntries.map((entry) => (
              <article key={entry.id}>
                <span
                  className={`ledger-direction ledger-direction--${entry.direction.toLowerCase()}`}
                >
                  {entry.direction === "CREDIT" ? "+" : "−"}
                </span>
                <span>
                  <strong>{labelWalletEntryType(entry.entryType)}</strong>
                  <time dateTime={entry.createdAt}>
                    {formatWalletEvidenceTime(entry.createdAt)}
                  </time>
                </span>
                <strong>
                  {entry.direction === "CREDIT" ? "+" : "−"}
                  {formatAtomicAmount(entry.amountAtomic, "KRW")}
                </strong>
              </article>
            ))}
          </div>
        ) : (
          <p>
            아직 거래 내역이 없어요. 채굴 보상이나 입출금이 생기면 이곳에
            표시됩니다.
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
        {receiptState === "error" ? (
          <StatePanel
            tone="error"
            title="처리 내역을 불러오지 못했어요"
            description="연결을 확인한 뒤 다시 시도해 주세요. 접수된 요청은 그대로 유지됩니다."
            action={<WalletReadRecovery />}
          />
        ) : receiptState === "ready" ? (
          <div className="wallet-receipts__list">
            {receipts.map((receipt) => (
              <article key={receipt.id}>
                <span>
                  <small>
                    {labelWalletReceiptType(receipt.transactionType)}
                  </small>
                  <strong>
                    {formatAtomicAmount(String(receipt.amountAtomic), "KRW")}
                  </strong>
                </span>
                <span>
                  <small>상태</small>
                  <strong>{labelWalletReceiptStatus(receipt.status)}</strong>
                </span>
                <span>
                  <small>요청 번호</small>
                  <code>{receipt.receiptNumber}</code>
                </span>
                <time dateTime={receipt.completedAt ?? receipt.requestedAt}>
                  {formatWalletEvidenceTime(
                    receipt.completedAt ?? receipt.requestedAt,
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
