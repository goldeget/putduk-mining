"use client";
import { FeedbackMessage } from "../../../components/ui/feedback-message";
import { WorkroomLoading } from "../../../components/ui/workroom-loading";

import { useActionState } from "react";

import { loginAction, type LoginState } from "@/app/actions";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    null,
  );
  return (
    <form action={action} className="auth-form">
      <input name="returnTo" type="hidden" value={returnTo} />
      <label>
        <span>운영자 아이디 또는 이메일</span>
        <input
          autoComplete="username"
          name="email"
          required
          type="text"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label>
        <span>비밀번호</span>
        <input
          autoComplete="current-password"
          name="password"
          required
          type="password"
        />
      </label>
      {state?.message ? (
        <FeedbackMessage className="form-error" role="alert">
          {state.message}
        </FeedbackMessage>
      ) : null}
      <button
        className="gold-button"
        disabled={pending}
        type="submit"
        aria-busy={pending}
      >
        {pending ? (
          <WorkroomLoading label="확인 중…" variant="inline" />
        ) : (
          "보안 로그인"
        )}
      </button>
    </form>
  );
}
