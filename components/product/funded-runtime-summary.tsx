import "server-only";

import Link from "next/link";
import type { Route } from "next";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  fundedRuntimeDisplaySchema,
  type FundedRuntimeDisplay,
} from "@/lib/product/mining-server-display";

import styles from "./funded-runtime-summary.module.css";
import { RouteReloadButton } from "./route-reload-button";

export type FundedRuntimeSummaryProps = {
  runtime?: FundedRuntimeDisplay | null | undefined;
  error?: boolean;
  loading?: boolean;
  placement?: "home" | "mining";
};

const recordTime = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Seoul",
});

/** Unit formatting of an authoritative proportion, never a mining calculation. */
function allocationPercent(bps: string) {
  const value = BigInt(bps);
  const fraction = (value % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${value / 100n}${fraction ? `.${fraction}` : ""}%`;
}

/** Conditional server amount only; truncate display, never round a credit. */
function conditionalAmount(
  ratio: FundedRuntimeDisplay["conditional_maintenance"],
) {
  const numerator = BigInt(ratio.numerator);
  const denominator = BigInt(ratio.denominator);
  const whole = numerator / denominator;
  if (numerator > 0n && whole === 0n) return "1원 미만";
  const amount = `${whole.toLocaleString("ko-KR")}원`;
  return numerator % denominator === 0n ? amount : `약 ${amount}`;
}

function ServerTime({ instant }: { instant: string }) {
  return <time dateTime={instant}>{recordTime.format(new Date(instant))}</time>;
}

/** Server-rendered receipt summary. This DTO does not prove a running state. */
export function FundedRuntimeSummary({
  runtime,
  error = false,
  loading = false,
  placement = "mining",
}: FundedRuntimeSummaryProps) {
  const parsed =
    !loading && !error ? fundedRuntimeDisplaySchema.safeParse(runtime) : null;
  const receipt = parsed?.success ? parsed.data : null;
  const state = loading
    ? "loading"
    : error
      ? "error"
      : receipt
        ? "confirmed"
        : "unknown";

  return (
    <section
      className={styles.summary}
      aria-label="확인된 실제 채굴 기록"
      aria-busy={loading || undefined}
      data-funded-runtime-state={state}
      data-placement={placement}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <PutdukIcon name="mining" size={16} aria-hidden="true" />
            실제 채굴
          </span>
          <h2>확인된 채굴 기록</h2>
        </div>
        {receipt ? (
          <span className={styles.receiptLabel}>확정 기록</span>
        ) : null}
      </header>

      {loading ? (
        <div
          className={styles.loading}
          role="status"
          aria-label="채굴 기록 불러오는 중"
        >
          <p>채굴 기록을 불러오고 있어요.</p>
          <div className={styles.skeleton} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : receipt ? (
        <>
          <div className={styles.content}>
            <div className={styles.confirmed}>
              <dl className={styles.figures}>
                <div className={styles.total}>
                  <dt>확정된 채굴 누계</dt>
                  <dd>
                    <span>
                      {BigInt(
                        receipt.committed_reward_total_atomic,
                      ).toLocaleString("ko-KR")}
                    </span>
                    <small>원</small>
                  </dd>
                </div>
                <div className={styles.allocation}>
                  <dt>채굴 배분 비율</dt>
                  <dd>{allocationPercent(receipt.allocation_bps)}</dd>
                </div>
              </dl>
              <p className={styles.explanation}>
                현재 채굴에서 확정된 금액의 합계예요.
              </p>
              <p className={styles.explanation}>
                사용 가능 잔액은 자산에서 확인해 주세요.
              </p>
              {BigInt(receipt.reward_carry.numerator) > 0n ? (
                <p className={styles.carry}>
                  1원 미만의 남은 금액은 누계에 포함되지 않았어요.
                </p>
              ) : null}
            </div>

            <section
              className={styles.conditional}
              aria-label="조건 확인 전 원금 유지 혜택"
            >
              <span className={styles.conditionalLabel}>조건 확인 전</span>
              <h3>원금 유지 혜택</h3>
              <p className={styles.conditionalAmount}>
                {conditionalAmount(receipt.conditional_maintenance)}
              </p>
              <p>아직 확정된 금액이 아니에요.</p>
              <p>사용 가능 잔액에 포함되지 않아요.</p>
            </section>
          </div>

          <footer className={styles.footer}>
            <dl className={styles.times}>
              <div>
                <dt>기록 반영 시각</dt>
                <dd>
                  <ServerTime instant={receipt.accepted_cursor_at} />
                </dd>
              </div>
              <div>
                <dt>조회 시각</dt>
                <dd>
                  <ServerTime instant={receipt.evaluated_at} />
                </dd>
              </div>
            </dl>
            <p className={styles.timeZone}>한국 시간 기준</p>
            <nav className={styles.actions} aria-label="채굴 기록 관련 화면">
              <Link href="/wallet" prefetch={false}>
                자산 확인
                <PutdukIcon name="arrow-right" size={16} aria-hidden="true" />
              </Link>
              <Link href={"/products/allocation" as Route} prefetch={false}>
                상품 선택
                <PutdukIcon name="arrow-right" size={16} aria-hidden="true" />
              </Link>
            </nav>
          </footer>
        </>
      ) : (
        <div className={styles.unavailable} role="status">
          <p className={styles.unavailableTitle}>
            {error
              ? "채굴 기록을 불러오지 못했어요."
              : "실제 채굴 기록을 확인할 수 없어요."}
          </p>
          <p>확정 금액은 확인된 기록이 있을 때 표시해요.</p>
          <RouteReloadButton
            className={styles.recovery ?? "button button--secondary"}
          />
        </div>
      )}
    </section>
  );
}
