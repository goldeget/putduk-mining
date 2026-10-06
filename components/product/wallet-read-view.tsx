import Link from "next/link";
import type { CSSProperties } from "react";

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

/** 금속 지갑과 칩은 장식이다. 잔액·보안 상태·수익을 나타내지 않는다. */
function WalletArtwork() {
  return (
    <svg
      aria-hidden="true"
      className={styles.heroArtwork}
      data-wallet-decoration="metal-wallet"
      focusable="false"
      viewBox="0 0 240 190"
    >
      <defs>
        <linearGradient
          id="wallet-read-metal-front"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop className={styles.metalHighlight} />
          <stop className={styles.metalGold} offset="0.36" />
          <stop className={styles.metalShadow} offset="0.72" />
          <stop className={styles.metalGold} offset="1" />
        </linearGradient>
        <linearGradient id="wallet-read-metal-edge" x1="0" y1="0" x2="0" y2="1">
          <stop className={styles.metalGold} />
          <stop className={styles.metalShadow} offset="1" />
        </linearGradient>
        <linearGradient id="wallet-read-glass" x1="0" y1="0" x2="1" y2="1">
          <stop className={styles.glassHighlight} />
          <stop className={styles.glassShadow} offset="1" />
        </linearGradient>
      </defs>
      <g className={styles.vaultLines} fill="none" stroke="currentColor">
        <circle cx="142" cy="91" r="75" />
        <circle cx="142" cy="91" r="65" strokeDasharray="3 10" />
        <path d="M142 9v12m70 70h12m-82 70v12M60 91H48" />
      </g>
      <ellipse
        className={styles.artworkShadow}
        cx="126"
        cy="169"
        rx="80"
        ry="9"
      />
      <g
        className={styles.chipLines}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m138 39 41-11 27 17-41 11Zm0 0v43l27 17V56m41-11v43l-41 11" />
        <path d="m148 39 22-6 15 10-22 6Zm-2 6v30m7-28v28m23-20 20-5m-20 13 20-5m-20 13 20-5" />
      </g>
      <path
        d="m51 66 103-24 20 13v97l-20 13-103 10Z"
        fill="url(#wallet-read-metal-edge)"
      />
      <path
        d="m49 64 99-23q14-3 14 11v96q0 9-10 11l-99 23q-12 3-12-10V78q0-11 8-14Z"
        fill="url(#wallet-read-metal-front)"
      />
      <path
        className={styles.walletGlass}
        d="m55 73 92-21q5-1 5 5v85q0 5-5 6l-92 21q-5 1-5-5V79q0-5 5-6Z"
        fill="url(#wallet-read-glass)"
      />
      <path
        className={styles.walletStitch}
        d="m58 80 82-19m-82 99 82-19M59 85v66"
        fill="none"
        stroke="currentColor"
        strokeDasharray="2 5"
      />
      <path
        d="m134 103 39-9q8-2 8 7v22q0 6-7 8l-40 9q-8 2-8-7v-21q0-7 8-9Z"
        fill="url(#wallet-read-metal-front)"
      />
      <circle className={styles.walletClasp} cx="161" cy="116" r="7" />
      <path
        className={styles.walletEdgeLight}
        d="m49 65 99-23q10-2 12 5M51 173l103-24m-20-46 39-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
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
    <div className={styles.page}>
      <PageHeading
        eyebrow="지갑"
        title="출금 가능 잔액"
        lead="사용 가능 원화와 출금 보류를 나눠 보여 드려요. 체험 값은 아래에 따로 있어요."
      />

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
            <div className={styles.heroKicker}>
              <span>실제 지갑</span>
              <small>출금 가능</small>
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
              <WalletArtwork />
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
                지금 사용 가능한 원화는 0원이에요. 입금하거나 전환이 끝나면
                여기에 반영됩니다.
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

      <div className={styles.actions}>
        <Link className="button button--primary" href="/wallet/deposit">
          <WalletIcon kind="deposit" />
          입금하기
        </Link>
        <Link className="button button--secondary" href="/wallet/withdraw">
          <WalletIcon kind="withdraw" />
          출금하기
        </Link>
      </div>

      <div className={styles.ledgerTabs}>
        <div
          className={styles.tabList}
          role="tablist"
          aria-label="원금, 수익, 거래내역"
        >
          <label className={styles.tab}>
            <input
              defaultChecked
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
            <input name="wallet-view" type="radio" value="profit" />
            <span className={styles.tabContent}>
              <WalletIcon kind="pending" />
              수익
            </span>
          </label>
          <label className={styles.tab}>
            <input name="wallet-view" type="radio" value="history" />
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
          <Surface
            as="section"
            className={`ledger-principle ${styles.historyIntro}`}
          >
            <p className="eyebrow">금액 기록</p>
            <h2>금액 변화는 이유와 상태를 함께 남겨요.</h2>
            <p>
              출금 보류는 사용 가능 금액과 분리됩니다. 수동 USDT 입금과 KRW 잔액
              출금도 이곳에 기록돼요.
            </p>
          </Surface>

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
                    <article className={styles.ledgerRow} key={entry.id}>
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
        </div>
      </div>
    </div>
  );
}
