"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import {
  findUsdtDepositInstruction,
  normalizeUsdtSentAmount,
  sanitizeUsdtSentAmountInput,
  type UsdtDepositInstruction,
} from "@/domain/wallet/usdt-manual-deposit";

type Feedback = { message: string; tone: "error" | "success" } | null;

const USDT_SUBMIT_ERRORS: Record<string, string> = {
  INVALID_IDEMPOTENCY_KEY: "요청을 다시 시도해 주세요.",
  INVALID_USDT_DEPOSIT: "입금 확인 정보를 확인해 주세요.",
  USDT_DEPOSIT_CONFLICT:
    "이 거래는 접수할 수 없어요. 거래 해시를 확인해 주세요.",
  UNAUTHENTICATED: "로그인이 필요해요. 다시 로그인해 주세요.",
  USDT_DEPOSIT_SUBMIT_FAILED:
    "입금 내역을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
  USDT_DEPOSIT_UNAVAILABLE:
    "입금 안내를 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
};

/**
 * USDT 수동 입금 안내·접수.
 * 사용자 USDT 잔액이 아니다. 확인된 금액만 KRW 지갑에 반영된다.
 * 접수는 POST /api/v1/deposits/usdt 만 사용한다.
 */
export function UsdtManualDepositForm({
  instructions,
  loadFailed,
}: {
  instructions: readonly UsdtDepositInstruction[];
  loadFailed: boolean;
}) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [network, setNetwork] = useState(instructions[0]?.network ?? "");
  const [txHash, setTxHash] = useState("");
  const [sentAmount, setSentAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [txTouched, setTxTouched] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);

  const available = loadFailed ? [] : instructions;
  const selectedNetwork = available.some((item) => item.network === network)
    ? network
    : (available[0]?.network ?? "");
  const selected = findUsdtDepositInstruction(available, selectedNetwork);
  const address = selected?.depositAddress ?? null;
  const normalizedAmount = normalizeUsdtSentAmount(sentAmount);
  const trimmedTx = txHash.trim();
  const txReady = trimmedTx.length >= 8 && trimmedTx.length <= 128;
  const canSubmit = Boolean(address && selected && txReady && normalizedAmount);
  const inputsDisabled = pending || !address;
  const amountInvalid =
    amountTouched && sentAmount.length > 0 && !normalizedAmount;
  const txInvalid = txTouched && trimmedTx.length > 0 && !txReady;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !canSubmit || !selected || !normalizedAmount) {
      setAmountTouched(true);
      setTxTouched(true);
      return;
    }

    const fingerprint = `${selected.network}|${trimmedTx}|${normalizedAmount}`;
    if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, key: crypto.randomUUID() };
    }

    pendingRef.current = true;
    setPending(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/v1/deposits/usdt", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attemptRef.current.key,
        },
        body: JSON.stringify({
          network: selected.network,
          sentUsdtAmount: normalizedAmount,
          txHash: trimmedTx,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;

      if (!response.ok) {
        const code = payload?.error?.code;
        setFeedback({
          message:
            (code && USDT_SUBMIT_ERRORS[code]) ||
            "입금 내역을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
          tone: "error",
        });
        return;
      }

      attemptRef.current = null;
      setFeedback({
        message: "입금 내역을 접수했어요. 확인이 끝나면 KRW로 반영돼요.",
        tone: "success",
      });
      setTxHash("");
      setSentAmount("");
      setAmountTouched(false);
      setTxTouched(false);
      router.refresh();
    } catch {
      setFeedback({
        message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        tone: "error",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <header className={styles.stepHeader}>
        <span className={styles.stepNumber}>USDT</span>
        <span>
          <h2>USDT 수동 입금</h2>
          <p>안내된 주소로 보낸 뒤, 거래 정보를 남겨 주세요.</p>
        </span>
      </header>

      <dl className={styles.policySummary} aria-label="입금 안내">
        <div>
          <dt>네트워크</dt>
          <dd>
            {selected?.network ??
              (loadFailed ? "불러오지 못함" : "안내 준비 중")}
          </dd>
        </div>
        <div>
          <dt>반영</dt>
          <dd>확인 후 KRW</dd>
        </div>
      </dl>

      {loadFailed ? (
        <div className={styles.formNotice}>
          <PutdukIcon name="shield" size={19} />
          <p>입금 안내를 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>
        </div>
      ) : address ? (
        <div className={styles.depositAddressBlock}>
          <p>입금 주소 · {selected?.network}</p>
          <code className={styles.depositAddress}>{address}</code>
          <button
            type="button"
            className={`button button--secondary ${styles.copyButton}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setFeedback({
                  message: "입금 주소를 복사했어요.",
                  tone: "success",
                });
              } catch {
                setFeedback({
                  message: "주소를 복사하지 못했어요. 직접 확인해 주세요.",
                  tone: "error",
                });
              }
            }}
          >
            입금 주소 복사
          </button>
          <div className={styles.formNotice}>
            <PutdukIcon name="shield" size={19} />
            <p>
              보낸 USDT는 여기에 쌓이지 않아요. 확인된 금액만 KRW로 반영됩니다.
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.formNotice}>
          <PutdukIcon name="clock" size={19} />
          <p>입금 안내를 준비하고 있어요. 준비되면 이 화면에 표시됩니다.</p>
        </div>
      )}

      <label className={styles.field} htmlFor="usdt-deposit-network">
        <span>네트워크</span>
        <select
          id="usdt-deposit-network"
          name="network"
          value={selectedNetwork}
          onChange={(event) => setNetwork(event.target.value)}
          disabled={inputsDisabled || available.length <= 1}
        >
          {available.length === 0 ? (
            <option value="">안내 준비 중</option>
          ) : (
            available.map((option) => (
              <option key={option.network} value={option.network}>
                {option.network}
              </option>
            ))
          )}
        </select>
      </label>

      <label className={styles.field} htmlFor="usdt-deposit-tx">
        <span>거래 해시</span>
        <input
          id="usdt-deposit-tx"
          className={styles.monoInput}
          name="txHash"
          autoComplete="off"
          minLength={8}
          maxLength={128}
          value={txHash}
          onBlur={() => setTxTouched(true)}
          onChange={(event) => setTxHash(event.target.value.trim())}
          disabled={inputsDisabled}
          aria-invalid={txInvalid}
          aria-describedby={txInvalid ? "usdt-deposit-tx-error" : undefined}
          required
        />
      </label>
      {txInvalid ? (
        <p
          id="usdt-deposit-tx-error"
          className={`${styles.feedback} ${styles.feedbackError}`}
          role="alert"
        >
          거래 해시는 8자 이상 입력해 주세요.
        </p>
      ) : null}

      <label className={styles.field} htmlFor="usdt-deposit-amount">
        <span>보낸 USDT 수량</span>
        <input
          id="usdt-deposit-amount"
          name="sentAmount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={sentAmount}
          onBlur={() => setAmountTouched(true)}
          onChange={(event) =>
            setSentAmount(sanitizeUsdtSentAmountInput(event.target.value))
          }
          disabled={inputsDisabled}
          aria-invalid={amountInvalid}
          aria-describedby={
            amountInvalid ? "usdt-deposit-amount-error" : undefined
          }
          required
        />
      </label>
      {amountInvalid ? (
        <p
          id="usdt-deposit-amount-error"
          className={`${styles.feedback} ${styles.feedbackError}`}
          role="alert"
        >
          {(sentAmount.match(/\./g) ?? []).length > 1 ||
          sentAmount.endsWith(".")
            ? "수량을 숫자로 입력해 주세요."
            : sentAmount.includes(".") &&
                (sentAmount.split(".")[1]?.length ?? 0) > 6
              ? "소수 여섯 자리까지 입력해 주세요."
              : "0보다 큰 수량을 입력해 주세요."}
        </p>
      ) : null}

      <button
        className={`button button--primary ${styles.submitButton}`}
        type="submit"
        disabled={pending || !canSubmit}
      >
        {pending ? "접수 중" : "입금 내역 접수"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>

      {feedback ? (
        <p
          id="usdt-deposit-feedback"
          className={`${styles.feedback} ${
            feedback.tone === "success"
              ? styles.feedbackSuccess
              : styles.feedbackError
          }`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
