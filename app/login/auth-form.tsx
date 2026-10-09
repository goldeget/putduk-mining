"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { authenticateAction, type AuthActionState } from "@/app/login/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/auth/login-experience.module.css";

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
      className={`auth-form ${styles.form}`}
      action={action}
      aria-label="계정 로그인"
      onSubmit={preventOfflineAuthSubmission}
      data-ui-state={hasError ? "error" : "loaded"}
    >
      <input type="hidden" name="next" value={nextPath} />
      <AuthConnectionNotice />
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="login-identifier">
          아이디 또는 복구 이메일
        </label>
        <div className={styles.inputShell}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m4 7 8 6 8-6" />
          </svg>
          <input
            id="login-identifier"
            name="identifier"
            type="text"
            placeholder="아이디 또는 복구 이메일"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={4}
            maxLength={254}
            aria-invalid={hasError}
            aria-describedby={hasError ? "login-error" : undefined}
            required
          />
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="login-password">
          비밀번호
        </label>
        <div className={`${styles.inputShell} auth-form__password`}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3" />
          </svg>
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder="비밀번호"
            autoComplete="current-password"
            minLength={10}
            maxLength={128}
            aria-invalid={hasError}
            aria-describedby={hasError ? "login-error" : undefined}
            required
          />
          <button
            className={styles.passwordToggle}
            type="button"
            aria-controls="login-password"
            aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword ? null : <path d="m3 21 18-18" />}
            </svg>
          </button>
        </div>
      </div>
      {state.status !== "idle" ? (
        <p
          id="login-error"
          className="auth-form__message auth-form__message--error"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <nav
        className={`auth-form__recovery ${styles.recovery}`}
        aria-label="계정 찾기"
      >
        <Link href="/find-id">아이디 찾기</Link>
        <span aria-hidden="true" />
        <Link href="/recover">비밀번호 재설정</Link>
      </nav>
      <div className={`auth-form__actions ${styles.submitActions}`}>
        <AuthSubmitButton label="로그인" pendingLabel="로그인하고 있어요" />
        <Link
          className={`button button--secondary ${styles.signup}`}
          href="/signup"
        >
          회원가입
        </Link>
      </div>
      <details className={styles.help}>
        <summary>
          <PutdukIcon name="shield" size={24} />
          <span>로그인 도움말</span>
          <PutdukIcon name="arrow-right" size={16} />
        </summary>
        <div className={styles.helpBody}>
          <p>가입한 아이디 또는 복구 이메일과 비밀번호를 입력해 주세요.</p>
          <p>
            아이디를 잊었다면 아이디 찾기, 비밀번호를 잊었다면 비밀번호 재설정을
            이용해 주세요.
          </p>
          <Link href="/support">
            고객지원 보기 <PutdukIcon name="arrow-right" size={14} />
          </Link>
        </div>
      </details>
    </form>
  );
}
