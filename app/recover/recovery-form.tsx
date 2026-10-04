"use client";

import { useActionState } from "react";

import {
  requestPasswordRecovery,
  type RecoveryActionState,
} from "@/app/recover/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";

const INITIAL_STATE: RecoveryActionState = { message: "", status: "idle" };

export function RecoveryForm() {
  const [state, action] = useActionState(
    requestPasswordRecovery,
    INITIAL_STATE,
  );
  return (
    <form
      className="auth-form"
      action={action}
      aria-label="비밀번호 재설정 요청"
      onSubmit={preventOfflineAuthSubmission}
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
        <p
          id="recovery-confirmation"
          className="auth-form__message auth-form__message--confirmation"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <div className="auth-form__actions">
        <AuthSubmitButton
          label="재설정 안내 받기"
          pendingLabel="안내를 준비하고 있어요"
        />
      </div>
    </form>
  );
}
