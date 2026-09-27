"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import {
  formatAtomicAmount,
  parseDisplayAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

export type WithdrawalAccount = {
  availableBalanceAtomic: string;
  currency: DisplayCurrency;
  id: string;
};

export type WithdrawalPolicy = {
  allowedDestinations: readonly string[];
  currency: DisplayCurrency;
  destinationType: "BANK_ACCOUNT" | "USDT_ADDRESS";
  feeAtomic: string;
  id: string;
  minimumAmountAtomic: string;
};

type Feedback = { message: string; tone: "error" | "success" } | null;

const bankNames: Record<string, string> = {
  IBK: "IBK기업은행",
  KB: "KB국민은행",
  KAKAO: "카카오뱅크",
  KEB_HANA: "하나은행",
  NH: "NH농협은행",
  SC: "SC제일은행",
  SHINHAN: "신한은행",
  TOSS: "토스뱅크",
  WOORI: "우리은행",
};

function atomicToInput(value: string, currency: DisplayCurrency) {
  if (currency === "KRW") {
    return BigInt(value).toString();
  }

  const padded = BigInt(value).toString().padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function WithdrawalForm({
  accounts,
  policies,
}: {
  accounts: readonly WithdrawalAccount[];
  policies: readonly WithdrawalPolicy[];
}) {
  const initialCurrency =
    policies.find((candidate) =>
      accounts.some((account) => account.currency === candidate.currency),
    )?.currency ?? "KRW";
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<DisplayCurrency>(initialCurrency);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const policy = policies.find((candidate) => candidate.currency === currency);
  const account = accounts.find((candidate) => candidate.currency === currency);

  let amountAtomic: string | null = null;
  try {
    amountAtomic = amount ? parseDisplayAmount(amount, currency) : null;
  } catch {
    amountAtomic = null;
  }

  const totalAtomic =
    amountAtomic && policy
      ? (BigInt(amountAtomic) + BigInt(policy.feeAtomic)).toString()
      : null;
  const meetsMinimum = Boolean(
    amountAtomic &&
    policy &&
    BigInt(amountAtomic) >= BigInt(policy.minimumAmountAtomic),
  );
  const hasEnoughBalance = Boolean(
    totalAtomic &&
    account &&
    BigInt(totalAtomic) <= BigInt(account.availableBalanceAtomic),
  );
  const canSubmit = Boolean(
    amountAtomic && policy && account && meetsMinimum && hasEnoughBalance,
  );

  function changeCurrency(nextCurrency: DisplayCurrency) {
    setCurrency(nextCurrency);
    setAmount("");
    setFeedback(null);
  }

  function chooseMinimum() {
    if (policy) {
      setAmount(atomicToInput(policy.minimumAmountAtomic, currency));
    }
  }

  function chooseAll() {
    if (!account || !policy) {
      return;
    }
    const available = BigInt(account.availableBalanceAtomic);
    const fee = BigInt(policy.feeAtomic);
    if (available > fee) {
      setAmount(atomicToInput((available - fee).toString(), currency));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !account || !amountAtomic || !canSubmit) {
      setFeedback({
        message: !meetsMinimum
          ? "최소 출금 금액을 확인해 주세요."
          : !hasEnoughBalance
            ? "수수료를 포함한 사용 가능 금액을 확인해 주세요."
            : "출금 정보를 다시 확인해 주세요.",
        tone: "error",
      });
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setFeedback(null);

    const destination =
      currency === "KRW"
        ? {
            accountHolder: String(formData.get("accountHolder") ?? ""),
            accountNumber: String(formData.get("accountNumber") ?? ""),
            bankCode: String(formData.get("bankCode") ?? ""),
          }
        : {
            address: String(formData.get("address") ?? ""),
            network: String(formData.get("network") ?? ""),
          };

    try {
      const response = await fetch("/api/v1/withdrawals", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          amountAtomic,
          currency,
          destination,
          policyId: policy.id,
          walletAccountId: account.id,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        setFeedback({
          message:
            payload?.error?.message ??
            "출금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
          tone: "error",
        });
        return;
      }

      setFeedback({
        message:
          "출금 요청을 접수했어요. 아래 처리 내역에서 현재 상태를 확인할 수 있어요.",
        tone: "success",
      });
      setAmount("");
      form.reset();
      void trackAnalyticsEvent("withdrawal_start", { currency }).catch(
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
        <span className={styles.stepNumber}>01</span>
        <span>
          <h2>출금할 금액을 입력해 주세요</h2>
          <p>사용 가능한 실제 잔액과 현재 출금 조건을 기준으로 확인합니다.</p>
        </span>
      </header>

      {policies.length > 1 ? (
        <fieldset>
          <legend className={styles.assetLegend}>출금 자산</legend>
          <div className={styles.segmented}>
            {policies.map((candidate) => (
              <label key={candidate.id}>
                <input
                  type="radio"
                  name="currency"
                  value={candidate.currency}
                  checked={currency === candidate.currency}
                  onChange={() => changeCurrency(candidate.currency)}
                  disabled={pending}
                />
                <span>
                  {candidate.currency === "KRW" ? "원화 출금" : "USDT 출금"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <dl className={styles.policySummary} aria-label="현재 출금 조건">
        <div>
          <dt>사용 가능</dt>
          <dd>
            {account
              ? formatAtomicAmount(account.availableBalanceAtomic, currency)
              : "—"}
          </dd>
        </div>
        <div>
          <dt>최소 출금</dt>
          <dd>
            {policy
              ? formatAtomicAmount(policy.minimumAmountAtomic, currency)
              : "—"}
          </dd>
        </div>
        <div>
          <dt>수수료</dt>
          <dd>
            {policy ? formatAtomicAmount(policy.feeAtomic, currency) : "—"}
          </dd>
        </div>
      </dl>

      <label className={styles.fieldGroup} htmlFor="withdrawal-amount">
        <span>출금 금액</span>
        <span className={styles.amountField}>
          <input
            id="withdrawal-amount"
            name="amount"
            type="text"
            inputMode={currency === "KRW" ? "numeric" : "decimal"}
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) =>
              setAmount(
                currency === "KRW"
                  ? event.target.value.replace(/[^0-9]/g, "")
                  : event.target.value.replace(/[^0-9.]/g, ""),
              )
            }
            aria-invalid={Boolean(
              amount && (!amountAtomic || !meetsMinimum || !hasEnoughBalance),
            )}
            aria-describedby="withdrawal-amount-help"
            disabled={pending}
            required
          />
          <strong className={styles.currencySuffix}>{currency}</strong>
        </span>
      </label>

      <div className={styles.quickAmounts} aria-label="빠른 금액 선택">
        <button type="button" onClick={chooseMinimum} disabled={pending}>
          최소 금액
        </button>
        {currency === "KRW" ? (
          <>
            <button
              type="button"
              onClick={() => setAmount("5000")}
              disabled={pending}
            >
              5천원
            </button>
            <button
              type="button"
              onClick={() => setAmount("10000")}
              disabled={pending}
            >
              1만원
            </button>
          </>
        ) : null}
        <button type="button" onClick={chooseAll} disabled={pending}>
          전액
        </button>
      </div>

      <header className={styles.stepHeader}>
        <span className={styles.stepNumber}>02</span>
        <span>
          <h2>{currency === "KRW" ? "받을 계좌" : "받을 주소"}</h2>
          <p>
            {currency === "KRW"
              ? "본인 명의와 일치하는 계좌를 정확히 입력해 주세요."
              : "선택한 네트워크와 주소가 일치하는지 다시 확인해 주세요."}
          </p>
        </span>
      </header>

      {currency === "KRW" ? (
        <div className={styles.destinationGrid}>
          <label className={styles.field}>
            <span>은행</span>
            <select name="bankCode" required defaultValue="" disabled={pending}>
              <option value="" disabled>
                은행 선택
              </option>
              {policy?.allowedDestinations.map((bankCode) => (
                <option value={bankCode} key={bankCode}>
                  {bankNames[bankCode] ?? bankCode}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>예금주</span>
            <input
              name="accountHolder"
              maxLength={60}
              autoComplete="name"
              disabled={pending}
              required
            />
          </label>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>계좌번호</span>
            <input
              name="accountNumber"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9-]{6,32}"
              placeholder="숫자만 입력"
              disabled={pending}
              required
            />
          </label>
        </div>
      ) : (
        <div className={styles.destinationGrid}>
          <label className={styles.field}>
            <span>네트워크</span>
            <select name="network" required defaultValue="" disabled={pending}>
              <option value="" disabled>
                네트워크 선택
              </option>
              {policy?.allowedDestinations.map((network) => (
                <option value={network} key={network}>
                  {network}
                </option>
              ))}
            </select>
          </label>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>받을 주소</span>
            <input
              name="address"
              minLength={20}
              maxLength={128}
              autoComplete="off"
              disabled={pending}
              required
            />
          </label>
        </div>
      )}

      <dl className={styles.summaryList} aria-label="출금 요청 요약">
        <div>
          <dt>출금 금액</dt>
          <dd>
            {amountAtomic ? formatAtomicAmount(amountAtomic, currency) : "—"}
          </dd>
        </div>
        <div>
          <dt>수수료</dt>
          <dd>
            {policy ? formatAtomicAmount(policy.feeAtomic, currency) : "—"}
          </dd>
        </div>
        <div>
          <dt>총 차감 예정</dt>
          <dd>
            {totalAtomic ? formatAtomicAmount(totalAtomic, currency) : "—"}
          </dd>
        </div>
      </dl>

      <div className={styles.formNotice} id="withdrawal-amount-help">
        <PutdukIcon name="shield" size={19} />
        <p>
          요청 금액과 수수료는 처리 중 사용할 수 있는 금액에서 분리됩니다.
          계좌·주소 정보는 안전하게 보호되며 확인 가능한 일부만 표시됩니다.
        </p>
      </div>

      <button
        className={`button button--primary ${styles.submitButton}`}
        type="submit"
        disabled={pending || !canSubmit}
      >
        {pending ? "출금 요청 접수 중" : "출금 내용 확인"}
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
