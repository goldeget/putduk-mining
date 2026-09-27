"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";

type Feedback = { message: string; tone: "error" | "success" } | null;

export function WelcomeWithdrawalAction({
  conversionId,
  destinationId,
  disabledReason,
  policyId,
  requested,
}: {
  conversionId?: string;
  destinationId?: string;
  disabledReason?: string;
  policyId?: string;
  requested: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const ready = Boolean(conversionId && destinationId && policyId);

  async function requestWithdrawal() {
    if (!conversionId || !destinationId || !policyId || pending || requested) {
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
        body: JSON.stringify({ conversionId, destinationId, policyId }),
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
            : "입금 없이 첫 출금 요청하기"}
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
