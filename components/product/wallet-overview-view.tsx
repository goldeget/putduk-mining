import Link from "next/link";
import type { CSSProperties } from "react";

import { WalletReadRecovery } from "@/components/product/wallet-read-recovery";
import type { WalletReadViewProps } from "@/components/product/wallet-read-view";
import { WalletScene } from "@/components/product/wallet-scene";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import {
  formatWalletEvidenceTime,
  labelWalletEntryType,
  labelWalletReceiptStatus,
  labelWalletReceiptType,
} from "@/domain/wallet/wallet-read";

import styles from "./wallet-overview-view.module.css";

function formatKrw(atomic: string) {
  return formatAtomicAmount(atomic, "KRW").replace(/ KRW$/, "원");
}

function Amount({ value, hero = false }: { value: string; hero?: boolean }) {
  const parts = /^(-?[\d,]+(?:\.\d+)?)(원| KRW| 체험 단위)$/.exec(value);
  return (
    <strong
      className={hero ? styles.heroAmount : styles.amount}
      data-wallet-value={value}
      style={
        {
          "--amount-characters": parts?.[1]?.length ?? value.length,
        } as CSSProperties
      }
    >
      {parts ? (
        <>
          <span>{parts[1]}</span>
          <small>{parts[2] === " KRW" ? "원" : parts[2]}</small>
        </>
      ) : (
        value
      )}
    </strong>
  );
}

function Icon({
  kind,
}: {
  kind: "coins" | "profit" | "wallet" | "deposit" | "withdraw" | "history";
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "coins" ? (
        <>
          <ellipse cx="14" cy="8" rx="9" ry="4" />
          <path d="M5 8v6c0 2 4 4 9 4s9-2 9-4V8M5 14v6c0 2 4 4 9 4M20 20c-4 0-7 1.6-7 3.5s3 3.5 7 3.5 7-1.6 7-3.5-3-3.5-7-3.5Z" />
        </>
      ) : null}
      {kind === "profit" ? (
        <>
          <path d="M5 26V17h5v9M14 26V11h5v15M23 26V5h5v21" />
        </>
      ) : null}
      {kind === "wallet" ? (
        <>
          <path d="M5 10V7c0-1 1-2 2-2h17v5M5 10h22v17H7c-1 0-2-1-2-2V10Z" />
          <path d="M27 15h-8v7h8M22 18.5h.1" />
        </>
      ) : null}
      {kind === "deposit" || kind === "withdraw" ? (
        <>
          <path d="M5 23v5h22v-5M16 4v16" />
          <path d={kind === "deposit" ? "m10 14 6 6 6-6" : "m10 10 6-6 6 6"} />
        </>
      ) : null}
      {kind === "history" ? (
        <>
          <rect x="7" y="3" width="18" height="26" rx="2" />
          <path d="M12 10h8M12 16h8M12 22h5" />
        </>
      ) : null}
    </svg>
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 40 56"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-wallet-brand-symbol="approved-gold-p"
    >
      <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="var(--brand-mineral)" />
      <path d="M3 10v36l16 9V18L3 10Z" fill="var(--brand-strong)" />
      <path d="m19 18 18-9v37l-18 9V18Z" fill="var(--brand-primary)" />
      <path d="m10 14 7 4v32l-7-4V14Z" fill="var(--brand-mineral)" />
      <path d="m24 20 7-4v26l-7 4V20Z" fill="var(--surface-sunken)" />
      <path
        d="m3 10 18-9 16 8v37l-18 9-16-9V10Z"
        stroke="var(--brand-primary)"
      />
    </svg>
  );
}

/** Presentation consumes the existing owner-bound, integer financial read model. */
export function WalletOverviewView({
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
  const balanceKnown = balanceState !== "error" && krw !== null;
  const principal =
    funding.state === "ready"
      ? funding.rows.find((row) => row.label === "인정 원금")?.value
      : undefined;
  const pending =
    funding.state === "ready"
      ? funding.rows.find((row) => row.label === "정산 전 대기 수익")?.value
      : undefined;
  const unconfirmed =
    funding.state === "ready"
      ? funding.rows.find((row) => row.tone === "unconfirmed")?.value
      : undefined;
  const fundingMissing =
    funding.state === "empty" ? "아직 없음" : "확인할 수 없음";
  const displayEntries =
    initialView === "history" ? ledgerEntries : ledgerEntries.slice(0, 4);
  return (
    <div
      className={styles.page}
      data-wallet-presentation="wallet-overview-scene"
      data-wallet-active-view={initialView}
    >
      <section
        className={styles.overview}
        aria-labelledby="wallet-overview-title"
      >
        <div className={styles.scene}>
          <WalletScene priority />
          <div className={styles.sceneShade} />
        </div>
        <header className={styles.heading}>
          <div>
            <BrandMark />
            <h1 id="wallet-overview-title">지갑</h1>
          </div>
          <p>내 자산과 거래 내역을 한눈에 확인하세요.</p>
        </header>
        <div className={styles.console}>
          <section
            className={styles.balance}
            aria-label="원화 지갑 잔액"
            data-wallet-balance-state={balanceState}
          >
            <div className={styles.balanceArt} aria-hidden="true">
              <WalletScene sizes="(min-width: 1100px) 300px, 180px" />
            </div>
            <div className={styles.balanceTop}>
              <span>총 원화 잔액</span>
              <span className={styles.currency}>원화 지갑</span>
            </div>
            <Amount
              hero
              value={
                balanceKnown
                  ? formatKrw(krw.balanceAtomic)
                  : balanceState === "error"
                    ? "확인할 수 없음"
                    : "아직 지갑 내역이 없어요"
              }
            />
            <p>
              {balanceKnown ? (
                <>
                  출금 보류 <b>{formatKrw(krw.heldAtomic)}</b> · 보류 금액은
                  출금할 수 없어요.
                </>
              ) : balanceState === "error" ? (
                "연결을 확인한 뒤 다시 시도해 주세요."
              ) : (
                "입출금이나 확정된 보상이 생기면 이곳에 표시돼요."
              )}
            </p>
            {balanceState === "error" ? (
              <WalletReadRecovery label="잔액 다시 확인" />
            ) : null}
            <dl className={styles.metrics}>
              <div>
                <Icon kind="coins" />
                <dt>인정 원금</dt>
                <dd>
                  <Amount value={principal ?? fundingMissing} />
                </dd>
              </div>
              <div>
                <Icon kind="profit" />
                <dt>대기 수익</dt>
                <dd>
                  <Amount value={pending ?? fundingMissing} />
                </dd>
              </div>
              <div>
                <Icon kind="wallet" />
                <dt>출금 가능</dt>
                <dd>
                  <Amount
                    value={
                      balanceKnown
                        ? formatKrw(krw.availableAtomic)
                        : "확인할 수 없음"
                    }
                  />
                </dd>
              </div>
            </dl>
          </section>
          <div className={styles.actions}>
            <Link href="/wallet/deposit">
              <Icon kind="deposit" />
              <span>입금하기</span>
              <span aria-hidden="true">›</span>
            </Link>
            <Link href="/wallet/withdraw">
              <Icon kind="withdraw" />
              <span>출금하기</span>
              <span aria-hidden="true">›</span>
            </Link>
          </div>
        </div>
      </section>
      <div className={styles.content}>
        <div className={styles.main}>
          <nav className={styles.tabs} aria-label="지갑 내역 선택">
            {(["principal", "profit", "history"] as const).map(
              (view, index) => (
                <Link
                  href={`/wallet?view=${view}`}
                  key={view}
                  aria-current={initialView === view ? "page" : undefined}
                >
                  <Icon
                    kind={
                      index === 0 ? "coins" : index === 1 ? "profit" : "history"
                    }
                  />
                  {["원금", "수익", "거래내역"][index]}
                </Link>
              ),
            )}
          </nav>
          {initialView !== "history" ? (
            <section
              className={styles.viewNote}
              aria-label={
                initialView === "principal" ? "원금 현황" : "수익 현황"
              }
            >
              <div>
                <span>
                  {initialView === "principal"
                    ? "인정 원금"
                    : "정산 전 대기 수익"}
                </span>
                <Amount
                  value={
                    (initialView === "principal" ? principal : pending) ??
                    fundingMissing
                  }
                />
              </div>
              <p>
                {initialView === "principal"
                  ? "인정 원금과 출금 가능한 원화는 서로 다른 값이에요."
                  : "대기 수익은 정산된 뒤 원화 지갑에 반영돼요."}
              </p>
              {funding.state === "error" ? (
                <WalletReadRecovery label="원금과 수익 다시 확인" />
              ) : null}
              {unconfirmed ? (
                <p>
                  아직 확정 전 <b>{unconfirmed}</b> · 잔액에 합치지 않아요.
                </p>
              ) : null}
            </section>
          ) : null}
          {initialView === "profit" ? (
            <section
              className={styles.trial}
              aria-label="원화와 분리된 체험 보상"
            >
              <div>
                <span>PUTDUK START 체험 보상</span>
                <Amount
                  value={
                    trialState === "error"
                      ? "확인할 수 없음"
                      : trialRewardAtomic === null
                        ? "아직 없음"
                        : formatTrialValue(trialRewardAtomic)
                  }
                />
              </div>
              <p>체험 값은 원화가 아니에요. 전환된 금액만 지갑에 반영돼요.</p>
              {trialState === "error" ? (
                <WalletReadRecovery label="체험 값 다시 확인" />
              ) : (
                <Link href="/start">
                  전환 자격 안내 <span aria-hidden="true">›</span>
                </Link>
              )}
            </section>
          ) : null}
          <section
            className={styles.history}
            aria-labelledby="wallet-ledger-title"
          >
            <header>
              <h2 id="wallet-ledger-title">최근 거래 내역</h2>
              {initialView !== "history" ? (
                <Link href="/wallet?view=history">
                  전체보기 <span aria-hidden="true">›</span>
                </Link>
              ) : (
                <small>최근 12건</small>
              )}
            </header>
            <div className={styles.tableHead} aria-hidden="true">
              <span>거래</span>
              <span>일시</span>
              <span>금액</span>
            </div>
            {ledgerState === "error" ? (
              <div className={styles.empty}>
                <p>거래 내역을 불러오지 못했어요.</p>
                <WalletReadRecovery label="거래 내역 다시 확인" />
              </div>
            ) : ledgerState === "ready" ? (
              <ul className={styles.ledgerList}>
                {displayEntries.map((entry) => (
                  <li
                    key={entry.id}
                    data-wallet-entry-direction={entry.direction}
                  >
                    <span className={styles.entryIcon}>
                      <Icon
                        kind={
                          entry.direction === "CREDIT" ? "deposit" : "withdraw"
                        }
                      />
                    </span>
                    <strong>{labelWalletEntryType(entry.entryType)}</strong>
                    <time dateTime={entry.createdAt}>
                      {formatWalletEvidenceTime(entry.createdAt)}
                    </time>
                    <span className={styles.entryAmount}>
                      {entry.direction === "CREDIT" ? "+" : "−"}
                      {formatKrw(entry.amountAtomic)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <Icon kind="history" />
                <p>아직 거래 내역이 없어요.</p>
                <small>채굴 보상이나 입출금이 생기면 이곳에 표시돼요.</small>
              </div>
            )}
          </section>
          {initialView === "history" ? (
            <section
              className={styles.receipts}
              aria-labelledby="wallet-receipts-title"
            >
              <header>
                <h2 id="wallet-receipts-title">입출금 처리 내역</h2>
                <small>요청 번호로 확인하세요.</small>
              </header>
              {receiptState === "error" ? (
                <div className={styles.empty}>
                  <p>처리 내역을 불러오지 못했어요.</p>
                  <WalletReadRecovery label="처리 내역 다시 확인" />
                </div>
              ) : receiptState === "ready" ? (
                <ul>
                  {receipts.map((receipt) => (
                    <li key={receipt.id}>
                      <div>
                        <strong>
                          {labelWalletReceiptType(receipt.transactionType)}
                        </strong>
                        <time
                          dateTime={receipt.completedAt ?? receipt.requestedAt}
                        >
                          {formatWalletEvidenceTime(
                            receipt.completedAt ?? receipt.requestedAt,
                          )}
                        </time>
                        <span className={styles.receiptNumber}>
                          요청 번호 {receipt.receiptNumber}
                        </span>
                      </div>
                      <div>
                        <Amount
                          value={
                            receipt.currency === "KRW"
                              ? formatKrw(receipt.amountAtomic)
                              : "원화 반영액 확인 중"
                          }
                        />
                        <span className={styles.status}>
                          {labelWalletReceiptStatus(receipt.status)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>아직 입출금 처리 내역이 없어요.</p>
              )}
            </section>
          ) : null}
        </div>
        <aside className={styles.guide} aria-labelledby="wallet-guide-title">
          <span className={styles.guideIcon}>
            <Icon kind="wallet" />
          </span>
          <h2 id="wallet-guide-title">입출금 안내</h2>
          <p>USDT 입금은 수동 확인 후 원화 지갑에 반영돼요.</p>
          <Link className={styles.guideAction} href="/wallet/deposit">
            입금 방법 확인 <span aria-hidden="true">›</span>
          </Link>
          <ul>
            <li>
              <Icon kind="coins" />
              <span>
                원금과 대기 수익은
                <br />
                출금 가능 잔액과 분리돼요.
              </span>
            </li>
            <li>
              <Icon kind="wallet" />
              <span>
                출금은 사용 가능한
                <br />
                원화 잔액에서 처리돼요.
              </span>
            </li>
            <li>
              <Icon kind="history" />
              <span>
                요청 상태는
                <br />
                거래내역에서 확인하세요.
              </span>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
