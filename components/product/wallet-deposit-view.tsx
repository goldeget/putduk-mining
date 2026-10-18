import Link from "next/link";

import { DepositForm } from "@/components/product/deposit-form";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import { UsdtManualDepositForm } from "@/components/product/usdt-manual-deposit-form";
import { WalletScene } from "@/components/product/wallet-scene";
import type { UsdtDepositInstruction } from "@/domain/wallet/usdt-manual-deposit";

import styles from "./wallet-deposit-view.module.css";

export type DepositHistoryItem = {
  id: string;
  amount: string;
  status: string;
  description: string;
  tone: ProductStatusTone;
  timestamp: string | null;
  timeLabel: string;
  detail?: string;
};

export type WalletDepositViewProps = {
  instructions: UsdtDepositInstruction[];
  instructionRead: "error" | "empty" | "ready";
  krwHistoryRead: "error" | "empty" | "ready";
  usdtHistoryRead: "error" | "empty" | "ready";
  krwHistory: DepositHistoryItem[];
  usdtHistory: DepositHistoryItem[];
};

function DepositIcon({
  kind,
}: {
  kind: "bank" | "token" | "shield" | "history";
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "bank" ? (
        <>
          <path d="m3 11 13-8 13 8H3ZM5 28h22M6 25V14m7 11V14m6 11V14m7 11V14" />
        </>
      ) : null}
      {kind === "token" ? (
        <>
          <circle cx="16" cy="16" r="13" />
          <path d="M8 9h16M16 9v16M11 14h10M11 18h10" />
        </>
      ) : null}
      {kind === "shield" ? (
        <>
          <path d="m16 3 11 4v9c0 6-6 10-11 13C11 26 5 22 5 16V7l11-4Z" />
          <path d="m10 16 4 4 8-9" />
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

function DepositHistory({
  kind,
  state,
  items,
}: {
  kind: "krw" | "usdt";
  state: "error" | "empty" | "ready";
  items: DepositHistoryItem[];
}) {
  const title = kind === "krw" ? "최근 원화 입금" : "최근 USDT 입금";
  return (
    <section
      className={styles.history}
      aria-labelledby={`${kind}-deposit-history`}
      data-deposit-history-state={state}
    >
      <header>
        <span className={styles.historyIcon}>
          <DepositIcon kind={kind === "krw" ? "bank" : "token"} />
        </span>
        <div>
          <h2 id={`${kind}-deposit-history`}>{title}</h2>
          <p>
            {kind === "krw"
              ? "입금 요청별 처리 상태를 확인하세요."
              : "보낸 USDT의 수동 확인 요청이에요."}
          </p>
        </div>
      </header>
      {state === "error" ? (
        <div className={styles.empty} role="status">
          <DepositIcon kind="history" />
          <p>
            {kind === "krw"
              ? "입금 요청 내역을 불러오지 못했어요."
              : "USDT 입금 내역을 불러오지 못했어요."}
          </p>
          <Link href="/wallet/deposit">
            다시 열기 <span aria-hidden="true">›</span>
          </Link>
        </div>
      ) : state === "ready" ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span className={styles.recordIcon}>
                <DepositIcon kind={kind === "krw" ? "bank" : "token"} />
              </span>
              <div className={styles.recordBody}>
                <strong>{item.amount}</strong>
                <p>{item.description}</p>
                {item.detail ? <small>{item.detail}</small> : null}
                <time {...(item.timestamp ? { dateTime: item.timestamp } : {})}>
                  {item.timeLabel}
                </time>
              </div>
              <ProductStatusPill label={item.status} tone={item.tone} />
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <DepositIcon kind="history" />
          <p>
            {kind === "krw"
              ? "아직 원화 입금 요청이 없어요."
              : "아직 USDT 입금 내역이 없어요."}
          </p>
          <small>
            {kind === "krw"
              ? "입금 요청 후 진행 상태를 이곳에서 확인하세요."
              : "송금 후 거래 정보를 접수하면 표시돼요."}
          </small>
        </div>
      )}
    </section>
  );
}

/** New reference-based presentation; the existing request forms and commands remain authoritative. */
export function WalletDepositView({
  instructions,
  instructionRead,
  krwHistoryRead,
  usdtHistoryRead,
  krwHistory,
  usdtHistory,
}: WalletDepositViewProps) {
  return (
    <div
      className={styles.page}
      data-wallet-presentation="deposit-reference-scene"
    >
      <Link className={styles.back} href="/wallet">
        <span aria-hidden="true">‹</span> 내 자산으로
      </Link>
      <header className={styles.hero}>
        <div className={styles.scene}>
          <WalletScene priority />
          <div className={styles.shade} />
        </div>
        <div className={styles.heroCopy}>
          <span className={styles.heroSymbol}>
            <DepositIcon kind="bank" />
          </span>
          <h1>입금하기</h1>
          <p>
            원화 계좌이체 또는
            <br />
            USDT 수동 입금을 선택하세요.
          </p>
        </div>
        <div className={styles.optional}>
          <DepositIcon kind="shield" />
          <p>
            입금은 선택 사항이에요.
            <br />
            체험 전환과 첫 출금의 조건이 아니에요.
          </p>
        </div>
      </header>
      <section className={styles.workspace} aria-label="입금 방법과 요청">
        <div
          className={styles.methods}
          role="radiogroup"
          aria-label="입금 방법 선택"
        >
          <label>
            <input
              name="wallet-deposit-method"
              value="bank"
              type="radio"
              defaultChecked
            />
            <span className={styles.methodIcon}>
              <DepositIcon kind="bank" />
            </span>
            <span>
              <strong>원화 계좌이체</strong>
              <small>본인 명의로 직접 이체</small>
            </span>
            <span className={styles.selection} aria-hidden="true" />
          </label>
          <label>
            <input name="wallet-deposit-method" value="usdt" type="radio" />
            <span className={styles.methodIcon}>
              <DepositIcon kind="token" />
            </span>
            <span>
              <strong>USDT 수동 입금</strong>
              <small>
                {instructionRead === "error"
                  ? "입금 안내를 다시 확인해 주세요"
                  : instructionRead === "empty"
                    ? "입금 안내 준비 중"
                    : "안내 주소로 송금 후 접수"}
              </small>
            </span>
            <span className={styles.selection} aria-hidden="true" />
          </label>
        </div>
        <div className={styles.formLayout}>
          <div className={styles.formPanel}>
            <section className={styles.bank} aria-label="원화 입금 신청">
              <DepositForm />
            </section>
            <section className={styles.usdt} aria-label="USDT 수동 입금 신청">
              <UsdtManualDepositForm
                instructions={instructions}
                loadFailed={instructionRead === "error"}
              />
            </section>
          </div>
          <aside
            className={styles.steps}
            aria-labelledby="deposit-process-title"
          >
            <span className={styles.stepsIcon}>
              <DepositIcon kind="shield" />
            </span>
            <h2 id="deposit-process-title">확인 후 원화로 반영돼요</h2>
            <p>요청을 접수해도 바로 잔액이 늘어나지 않아요.</p>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>입금 방법 선택</strong>
                  <small>원화 계좌이체 또는 USDT 송금</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div className={styles.bank}>
                  <strong>입금 요청과 직접 이체</strong>
                  <small>본인 명의 계좌를 이용하세요.</small>
                </div>
                <div className={styles.usdt}>
                  <strong>안내 주소로 송금</strong>
                  <small>주소와 네트워크를 확인하세요.</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div className={styles.bank}>
                  <strong>실제 입금 확인</strong>
                  <small>접수 내역에서 상태를 확인하세요.</small>
                </div>
                <div className={styles.usdt}>
                  <strong>거래 정보 접수와 확인</strong>
                  <small>보낸 수량과 거래 해시를 남겨 주세요.</small>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>원화 지갑 반영</strong>
                  <small>확인이 끝난 금액만 반영돼요.</small>
                </div>
              </li>
            </ol>
            <div className={styles.caution}>
              <DepositIcon kind="token" />
              <p>
                USDT를 따로 보관하지 않아요.
                <br />
                확인된 입금만 원화로 반영돼요.
              </p>
            </div>
          </aside>
        </div>
      </section>
      <div className={styles.histories}>
        <DepositHistory kind="krw" state={krwHistoryRead} items={krwHistory} />
        <DepositHistory
          kind="usdt"
          state={usdtHistoryRead}
          items={usdtHistory}
        />
      </div>
    </div>
  );
}
