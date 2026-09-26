"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

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
      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      if (!response.ok) {
        setMessage(payload.error?.message ?? "체험을 시작하지 못했습니다.");
        return;
      }

      void trackAnalyticsEvent("trial_start").catch(() => undefined);
      router.refresh();
    } catch {
      setMessage("네트워크 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="start-action">
      <button
        className="button button--primary"
        type="button"
        onClick={startTrial}
        disabled={pending}
      >
        {pending ? "체험 준비 중" : "첫 채굴 시작"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
