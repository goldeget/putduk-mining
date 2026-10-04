"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { authenticateAction, type AuthActionState } from "@/app/login/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";

const INITIAL_AUTH_STATE: AuthActionState = { message: "", status: "idle" };

export function AuthForm({ nextPath }: { nextPath: string }) {
  const [state, action] = useActionState(
    authenticateAction,
    INITIAL_AUTH_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const hasError = state.status === "error";

  return (
    <form
      className="auth-form"
      action={action}
      aria-label="계정 로그인"
      onSubmit={preventOfflineAuthSubmission}
      data-ui-state={hasError ? "error" : "loaded"}
    >
      <input type="hidden" name="next" value={nextPath} />
      <AuthConnectionNotice />
      <label>
        <span>아이디 또는 복구 이메일</span>
        <input
          id="login-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={4}
          maxLength={254}
          aria-invalid={hasError}
          aria-describedby={hasError ? "login-error" : undefined}
          required
        />
      </label>
      <div className="auth-form__field">
        <label htmlFor="login-password">비밀번호</label>
        <div className="auth-form__password">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            minLength={10}
            maxLength={128}
            aria-invalid={hasError}
            aria-describedby={hasError ? "login-error" : undefined}
            required
          />
          <button
            type="button"
            aria-controls="login-password"
            aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? "숨기기" : "보기"}
          </button>
        </div>
      </div>
      <nav className="auth-form__recovery ko-copy" aria-label="계정 찾기">
        <Link href="/find-id">아이디 찾기</Link>
        <Link href="/recover">비밀번호 재설정</Link>
      </nav>
      {state.status !== "idle" ? (
        <p
          id="login-error"
          className="auth-form__message auth-form__message--error"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <div className="auth-form__actions">
        <AuthSubmitButton label="로그인" pendingLabel="로그인하고 있어요" />
        <Link className="button button--secondary" href="/signup">
          새 계정 만들기
        </Link>
      </div>
    </form>
  );
}
