"use client";
import { FeedbackMessage } from "@/components/ui/feedback-message";

import { useState } from "react";

import type { FindIdActionState } from "@/app/find-id/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";

const INITIAL_STATE: FindIdActionState = { message: "", status: "idle" };

export function FindIdForm() {
  const [state, setState] = useState<FindIdActionState>(INITIAL_STATE);
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
      const response = await fetch("/api/auth/find-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = (await response.json()) as FindIdActionState;

      setState({
        message: data.message,
        status: "confirmation",
      });
    } catch {
      setState({
        message: "네트워크 연결을 확인해 주세요.",
        status: "confirmation",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      className="auth-form"
      aria-label="아이디 찾기"
      onSubmit={handleSubmit}
    >
      <AuthConnectionNotice />
      <label>
        <span>복구 이메일</span>
        <input
          id="find-id-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          aria-describedby={
            state.status === "confirmation" ? "find-id-confirmation" : undefined
          }
          required
        />
      </label>
      {state.status === "confirmation" ? (
        <FeedbackMessage
          id="find-id-confirmation"
          className="auth-form__message auth-form__message--confirmation"
          role="status"
        >
          {state.message}
        </FeedbackMessage>
      ) : null}
      <div className="auth-form__actions">
        <AuthSubmitButton
          label="아이디 확인 링크 받기"
          pendingLabel="확인하고 있어요"
          disabled={isPending}
          pending={isPending}
        />
      </div>
    </form>
  );
}
