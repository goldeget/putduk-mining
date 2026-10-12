"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

import styles from "./start-actions.module.css";

function startFailureCopy(payload: unknown, status: number) {
  const unconfirmed =
    "체험 시작 결과를 확인하지 못했어요. 현재 체험 상태를 확인한 뒤 다시 시도해 주세요.";
  if (!payload || typeof payload !== "object" || !("error" in payload))
    return unconfirmed;
  const error = payload.error;
  if (
    !error ||
    typeof error !== "object" ||
    Array.isArray(error) ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    ("message" in error && typeof error.message !== "string")
  )
    return unconfirmed;
  if (status === 401 && error.code === "UNAUTHENTICATED")
    return "다시 로그인한 뒤 체험을 시작해 주세요.";
  if (status === 400 && error.code === "INVALID_IDEMPOTENCY_KEY")
    return "화면을 다시 열고 체험 시작을 눌러 주세요.";
  if (status === 409 && error.code === "TRIAL_NOT_CONFIGURED")
    return "지금은 체험을 시작할 수 없어요. 잠시 후 다시 확인해 주세요.";
  return unconfirmed;
}

export function StartTrialButton() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function startTrial() {
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/trial/start", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        setMessage(startFailureCopy(payload, response.status));
        return;
      }

      void trackAnalyticsEvent("trial_start").catch(() => undefined);
      router.refresh();
    } catch {
      setMessage(
        "체험 시작 결과를 받지 못했어요. 연결과 현재 체험 상태를 확인해 주세요.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionBlock}>
      <button
        className="button button--primary"
        type="button"
        onClick={startTrial}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "체험 준비 중" : "첫 채굴 시작"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      {message ? (
        <p
          className={`${styles.actionMessage} ${styles.actionMessageError}`}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
