"use client";

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
        <span>운영자 이메일</span>
        <input
          autoComplete="username"
          inputMode="email"
          name="email"
          required
          type="email"
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
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button className="gold-button" disabled={pending} type="submit">
        {pending ? "확인 중…" : "보안 로그인"}
      </button>
    </form>
  );
}
