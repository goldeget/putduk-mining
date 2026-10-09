import Link from "next/link";
import type { CSSProperties } from "react";

import { WalletScene } from "@/components/product/wallet-scene";
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

import styles from "./wallet-read-view.module.css";

const displayedAmountPattern =
  /^(-?[0-9][0-9,]*(?:\.[0-9]+)?)(원| KRW| 체험 단위)$/;

/** 숫자와 단위만 나누고, 한글 문장은 한 덩어리로 둔다. 금액은 다시 계산하지 않는다. */
function WalletAmountText({ value }: { value: string }) {
  const amount = displayedAmountPattern.exec(value);
  const figure = amount?.[1];
  const unit = amount?.[2];
  if (!figure || unit === undefined) {
    return value;
  }
  const displayUnit = unit === " KRW" ? "원" : unit;
  return (
    <span
      className={styles.amountValue}
      data-wallet-long-amount={figure.length > 14 ? "true" : undefined}
      style={
        {
          "--wallet-amount-length": figure.length + displayUnit.length,
        } as CSSProperties
      }
    >
      <span className={styles.amountFigure}>{figure}</span>
      <span className={styles.amountUnit}>{displayUnit}</span>
    </span>
  );
}

function WalletIcon({
  kind,
}: {
  kind:
    | "principal"
    | "pending"
    | "unconfirmed"
    | "deposit"
    | "withdraw"
    | "history";
}) {
  return (
    <svg
      aria-hidden="true"
      data-wallet-decoration="glyph"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "principal" ? (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
        </>
      ) : null}
      {kind === "pending" ? (
        <>
          <path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4m10-18v4l-5 5 5 5v4" />
          <path d="M9 6h6m-6 12h6" />
        </>
      ) : null}
      {kind === "unconfirmed" ? (
        <>
          <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
          <path d="M9 12h6" />
        </>
      ) : null}
      {kind === "deposit" || kind === "withdraw" ? (
        <>
          <path d="M4 15v5h16v-5M12 4v11" />
          <path d={kind === "deposit" ? "m7 10 5 5 5-5" : "m7 9 5-5 5 5"} />
        </>
      ) : null}
      {kind === "history" ? (
        <>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </>
      ) : null}
    </svg>
  );
}

export type WalletFundingPanel = { state: "error" } | WalletFundingView;

export type WalletReadViewProps = {
  initialView?: "principal" | "profit" | "history";
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
  initialView = "principal",
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
    <div
      className={styles.page}
      data-wallet-presentation="reference-reconstruction"
    >
      <div className={styles.overview}>
        <div className={styles.sceneLayer}>
          <WalletScene priority />
          <div className={styles.sceneScrim} />
        </div>
        <header className={styles.heading} data-wallet-heading="native">
          <div className={styles.headingTitle}>
            <svg
              viewBox="0 0 40 56"
              fill="none"
              aria-hidden="true"
              focusable="false"
              data-wallet-brand-symbol="approved-gold-p"
            >
              <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
              <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
              <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
              <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
              <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
              <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
            </svg>
            <h1>지갑</h1>
          </div>
          <p>실제 원화 잔액과 금액 기록을 확인하세요.</p>
        </header>
        <div className={styles.summary}>
          <div className={styles.balanceGroup} data-wallet-summary="KRW_ONLY">
            <section aria-label="실제 KRW 지갑">
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
                <Surface as="article" className={styles.heroCard} tone="raised">
                  <div className={styles.heroKicker} data-wallet-balance-labels>
                    <span>실제 지갑</span>
                    <small>출금 가능 잔액</small>
                  </div>
                  <div className={styles.heroOverview}>
                    <div className={styles.heroBalance}>
                      <small className={styles.heroLabel}>사용 가능 잔액</small>
                      <strong className={styles.heroValue}>
                        <WalletAmountText
                          value={formatAtomicAmount(krw.availableAtomic, "KRW")}
                        />
                      </strong>
                    </div>
                  </div>
                  <dl className={styles.breakdown}>
                    <div>
                      <dt>출금 보류</dt>
                      <dd>
                        <WalletAmountText
                          value={formatAtomicAmount(krw.heldAtomic, "KRW")}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>전체</dt>
                      <dd>
                        <WalletAmountText
                          value={formatAtomicAmount(krw.balanceAtomic, "KRW")}
                        />
                      </dd>
                    </div>
                  </dl>
                  {balanceState === "zero" ? (
                    <p className={styles.note}>
                      지금 사용 가능한 원화는 0원이에요. 입금하거나 전환이
                      끝나면 여기에 반영됩니다.
                    </p>
                  ) : null}
                </Surface>
              )}
            </section>

            <section
              className={styles.funding}
              aria-labelledby="wallet-funding-title"
            >
              <header>
                <h2 id="wallet-funding-title">원금과 대기 수익</h2>
                <p className={styles.fundingLead}>
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
              ) : (
                <dl className={styles.metrics} data-wallet-metrics="separate">
                  {(funding.state === "ready"
                    ? funding.rows
                    : [
                        {
                          label: "인정 원금",
                          tone: "separate" as const,
                          value: "아직 없어요",
                        },
                        {
                          label: "정산 전 대기 수익",
                          tone: "separate" as const,
                          value: "아직 없어요",
                        },
                        {
                          label: "아직 확정 전",
                          tone: "unconfirmed" as const,
                          value: "아직 없어요",
                        },
                      ]
                  ).map((row, index) => (
                    <div
                      key={row.label}
                      className={styles.metric}
                      data-funding-tone={row.tone}
                    >
                      <dt>
                        <span className={styles.metricIcon}>
                          <WalletIcon
                            kind={
                              row.tone === "unconfirmed"
                                ? "unconfirmed"
                                : index === 0
                                  ? "principal"
                                  : "pending"
                            }
                          />
                        </span>
                        {row.label}
                      </dt>
                      <dd>
                        <WalletAmountText value={row.value} />
                      </dd>
                      {row.tone === "unconfirmed" ? (
                        <p>확정된 수익이 아니에요.</p>
                      ) : null}
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </div>
          <div className={styles.actions} aria-label="입금과 출금">
            <Link className="button button--primary" href="/wallet/deposit">
              <WalletIcon kind="deposit" />
              입금하기
            </Link>
            <Link className="button button--secondary" href="/wallet/withdraw">
              <WalletIcon kind="withdraw" />
              출금하기
            </Link>
          </div>
        </div>
      </div>

      <div className={styles.ledgerTabs}>
        <div
          className={styles.tabList}
          role="radiogroup"
          aria-label="원금, 수익, 거래내역"
        >
          <label className={styles.tab}>
            <input
              defaultChecked={initialView === "principal"}
              name="wallet-view"
              type="radio"
              value="principal"
            />
            <span className={styles.tabContent}>
              <WalletIcon kind="principal" />
              원금
            </span>
          </label>
          <label className={styles.tab}>
            <input
              defaultChecked={initialView === "profit"}
              name="wallet-view"
              type="radio"
              value="profit"
            />
            <span className={styles.tabContent}>
              <WalletIcon kind="pending" />
              수익
            </span>
          </label>
          <label className={styles.tab}>
            <input
              defaultChecked={initialView === "history"}
              name="wallet-view"
              type="radio"
              value="history"
            />
            <span className={styles.tabContent}>
              <WalletIcon kind="history" />
              거래내역
            </span>
          </label>
        </div>

        <div className={styles.tabPanel} data-panel="principal">
          <p className={styles.fundingLead}>
            {funding.state === "empty"
              ? "원금과 대기 수익은 아직 없어요."
              : "인정 원금은 위 칸에 있어요. 출금 가능 잔액과 합치지 않아요."}
          </p>
        </div>

        <div className={styles.tabPanel} data-panel="profit">
          <Surface as="article" className={styles.trialCard}>
            <div className={styles.heroKicker}>
              <span>체험 보상</span>
              <small>분리 보관</small>
            </div>
            <small className={styles.heroLabel}>PUTDUK START</small>
            <strong>
              <WalletAmountText
                value={
                  trialState === "error"
                    ? "확인할 수 없음"
                    : formatTrialValue(String(trialRewardAtomic ?? "0"))
                }
              />
            </strong>
            <p className={styles.note}>
              체험 값은 원화가 아니에요. 전환된 금액만 실제 지갑에 반영됩니다.
            </p>
            {trialState === "error" ? (
              <WalletReadRecovery label="체험 값 다시 확인" />
            ) : (
              <Link className={styles.trialLink} href="/start">
                전환 자격 안내
              </Link>
            )}
          </Surface>
          <p className={styles.fundingLead}>
            대기 수익과 확정 전 금액은 서로 다른 값이에요.
          </p>
        </div>

        <div className={styles.tabPanel} data-panel="history">
          <div className={styles.history}>
            <section
              className="ledger-history"
              aria-labelledby="ledger-history-title"
            >
              <header>
                <p className="eyebrow">최근</p>
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
                <div className={styles.ledgerList}>
                  {ledgerEntries.map((entry) => (
                    <article
                      className={styles.ledgerRow}
                      data-wallet-entry-direction={entry.direction}
                      key={entry.id}
                    >
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
          </div>

          <section
            className={`wallet-receipts ${styles.receipts}`}
            aria-labelledby="wallet-receipts-title"
          >
            <header>
              <p className="eyebrow">처리 내역</p>
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
                        {formatAtomicAmount(
                          String(receipt.amountAtomic),
                          "KRW",
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>상태</small>
                      <strong>
                        {labelWalletReceiptStatus(receipt.status)}
                      </strong>
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

          <Surface
            as="aside"
            className={`ledger-principle ${styles.historyIntro}`}
            aria-labelledby="wallet-money-guide-title"
          >
            <div>
              <p className="eyebrow">입출금 안내</p>
              <h2 id="wallet-money-guide-title">원화 지갑과 수동 USDT 입금</h2>
            </div>
            <p>
              출금 보류는 사용 가능 금액과 분리됩니다. USDT 입금은 수동 확인 후
              KRW 지갑에 반영돼요. 출금은 사용 가능한 KRW 잔액에서 처리됩니다.
            </p>
            <Link className={styles.guideLink} href="/wallet/deposit">
              수동 USDT 입금 안내
            </Link>
          </Surface>
        </div>
      </div>
    </div>
  );
}
