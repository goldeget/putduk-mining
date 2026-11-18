"use client";
import { FeedbackMessage } from "@/components/ui/feedback-message";

import { useState } from "react";

import type { RecoveryActionState } from "@/app/recover/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";

const INITIAL_STATE: RecoveryActionState = { message: "", status: "idle" };

export function RecoveryForm() {
  const [state, setState] = useState<RecoveryActionState>(INITIAL_STATE);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    preventOfflineAuthSubmission(event);
    if (navigator.onLine === false) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    setIsPending(true);
    setState({ message: "", status: "idle" });

    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = (await response.json()) as RecoveryActionState;
      setState({
        message: data.message,
        status: data.status,
      });
    } catch {
      setState({
        message: "네트워크 연결을 확인해 주세요.",
        status: "confirmation" as RecoveryActionState["status"],
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit}
      aria-label="비밀번호 재설정 요청"
    >
      <AuthConnectionNotice />
      <label>
        <span>복구 이메일</span>
        <input
          id="recovery-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          aria-describedby={
            state.status === "confirmation"
              ? "recovery-confirmation"
              : undefined
          }
          required
        />
      </label>
      {state.status === "confirmation" ? (
        <FeedbackMessage
          id="recovery-confirmation"
          className="auth-form__message auth-form__message--confirmation"
          role="status"
        >
          {state.message}
        </FeedbackMessage>
      ) : null}
      <div className="auth-form__actions">
        <AuthSubmitButton
          label="재설정 안내 받기"
          pendingLabel="안내를 준비하고 있어요"
          disabled={isPending}
          pending={isPending}
        />
      </div>
    </form>
  );
}
