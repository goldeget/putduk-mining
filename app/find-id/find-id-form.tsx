"use client";

import { useActionState } from "react";

import {
  requestLoginIdLink,
  type FindIdActionState,
} from "@/app/find-id/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";

const INITIAL_STATE: FindIdActionState = { message: "", status: "idle" };

export function FindIdForm() {
  const [state, action] = useActionState(requestLoginIdLink, INITIAL_STATE);
  return (
    <form
      className="auth-form"
      action={action}
      aria-label="아이디 찾기"
      onSubmit={preventOfflineAuthSubmission}
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
        <p
          id="find-id-confirmation"
          className="auth-form__message auth-form__message--confirmation"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <div className="auth-form__actions">
        <AuthSubmitButton
          label="아이디 확인 링크 받기"
          pendingLabel="확인하고 있어요"
        />
      </div>
    </form>
  );
}
