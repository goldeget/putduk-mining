"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  destinationMethodHint,
  destinationMethodLabel,
  type WithdrawalDestinationMethod,
} from "@/components/product/destination-type";
import styles from "@/components/product/product-experience.module.css";

type Feedback = { message: string; tone: "error" | "success" } | null;

export type WelcomeDestinationOption = {
  id: string;
  method: WithdrawalDestinationMethod;
  displayHint: string;
  policyId: string;
};

export function WelcomeWithdrawalAction({
  conversionId,
  destinations,
  disabledReason,
  requested,
}: {
  conversionId?: string;
  destinations: readonly WelcomeDestinationOption[];
  disabledReason?: string;
  requested: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<WithdrawalDestinationMethod>(
    destinations.find((item) => item.method === "KRW_BANK")?.method ??
      destinations[0]?.method ??
      "KRW_BANK",
  );
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);

  const selected = destinations.find((item) => item.method === method);
  const ready = Boolean(conversionId && selected?.id && selected.policyId);

  async function requestWithdrawal() {
    if (!conversionId || !selected || pending || requested) {
      return;
    }

    setPending(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/v1/withdrawals/welcome", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          conversionId,
          destinationId: selected.id,
          policyId: selected.policyId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        setFeedback({
          message:
            payload?.error?.message ??
            "첫 출금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
          tone: "error",
        });
        return;
      }

      setFeedback({
        message:
          "첫 출금 요청을 접수했어요. 아래 처리 내역에서 진행 상태를 확인할 수 있어요.",
        tone: "success",
      });
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
    <div className={styles.welcomeAction}>
      {destinations.length > 0 && !requested ? (
        <fieldset className={styles.welcomeMethodField}>
          <legend>받을 방법</legend>
          <div className={styles.segmented}>
            {destinations.map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name="welcomeMethod"
                  value={option.method}
                  checked={method === option.method}
                  onChange={() => setMethod(option.method)}
                  disabled={pending}
                />
                <span>
                  {destinationMethodLabel(option.method)}
                  <small>
                    {option.displayHint || destinationMethodHint(option.method)}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <button
        className="button button--primary"
        type="button"
        disabled={!ready || pending || requested}
        onClick={requestWithdrawal}
      >
        {requested
          ? "첫 출금 접수 완료"
          : pending
            ? "첫 출금 접수 중"
            : "입금 없이 첫 출금 요청"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      {!requested && disabledReason ? <p>{disabledReason}</p> : null}
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
    </div>
  );
}
