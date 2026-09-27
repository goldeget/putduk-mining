"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import {
  formatAtomicAmount,
  parseDisplayAmount,
} from "@/domain/wallet/format-amount";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

type Feedback = { message: string; tone: "error" | "success" } | null;

const quickAmounts = ["10000", "30000", "50000", "100000"] as const;

export function DepositForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);

  let amountAtomic: string | null = null;
  if (amount) {
    try {
      amountAtomic = parseDisplayAmount(amount, "KRW");
    } catch {
      amountAtomic = null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    let parsedAmount: string;
    try {
      parsedAmount = parseDisplayAmount(amount, "KRW");
    } catch (error) {
      setFeedback({
        message:
          error instanceof RangeError
            ? "0원보다 큰 금액을 입력해 주세요."
            : "원 단위 숫자로 금액을 입력해 주세요.",
        tone: "error",
      });
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/v1/deposits", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ amountAtomic: parsedAmount, currency: "KRW" }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        setFeedback({
          message:
            payload?.error?.message ??
            "입금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
          tone: "error",
        });
        return;
      }

      setFeedback({
        message:
          "입금 요청을 접수했어요. 안내 계좌로 본인 명의 이체를 진행해 주세요.",
        tone: "success",
      });
      setAmount("");
      void trackAnalyticsEvent("deposit_start", { currency: "KRW" }).catch(
        () => undefined,
      );
      router.refresh();
    } catch {
      setFeedback({
        message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        tone: "error",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <header className={styles.stepHeader}>
        <span className={styles.stepNumber}>KRW</span>
        <span>
          <h2>원화 입금 금액</h2>
          <p>본인 명의 계좌로 이체한 뒤 확인됩니다.</p>
        </span>
      </header>

      <label className={styles.fieldGroup} htmlFor="deposit-amount">
        <span>입금 요청 금액</span>
        <span className={styles.amountField}>
          <input
            id="deposit-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) =>
              setAmount(event.target.value.replace(/[^0-9]/g, ""))
            }
            aria-invalid={Boolean(amount && !amountAtomic)}
            aria-describedby="deposit-amount-help"
            disabled={pending}
            required
          />
          <strong className={styles.currencySuffix}>KRW</strong>
        </span>
      </label>

      <div className={styles.quickAmounts} aria-label="빠른 금액 선택">
        {quickAmounts.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setAmount(value)}
            disabled={pending}
          >
            +{Number(value).toLocaleString("ko-KR")}
          </button>
        ))}
      </div>

      <dl className={styles.policySummary} aria-label="입금 요청 요약">
        <div>
          <dt>입금 방식</dt>
          <dd>원화 계좌이체</dd>
        </div>
        <div>
          <dt>요청 금액</dt>
          <dd>
            {amountAtomic ? formatAtomicAmount(amountAtomic, "KRW") : "—"}
          </dd>
        </div>
        <div>
          <dt>잔액 반영</dt>
          <dd>입금 확인 후</dd>
        </div>
      </dl>

      <div className={styles.formNotice} id="deposit-amount-help">
        <PutdukIcon name="shield" size={19} />
        <p>
          요청만으로 자산이 늘어나지 않습니다. 안내된 계좌·금액과 실제 입금이
          확인된 뒤 KRW 지갑에 반영됩니다.
        </p>
      </div>

      <button
        className={`button button--primary ${styles.submitButton}`}
        type="submit"
        disabled={pending || !amountAtomic}
      >
        {pending ? "입금 요청 접수 중" : "입금 요청하기"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>

      {feedback ? (
        <p
          className={`${styles.feedback} ${
            feedback.tone === "success"
              ? styles.feedbackSuccess
              : styles.feedbackError
          }`}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
