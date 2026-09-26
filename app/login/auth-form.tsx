"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { authenticateAction, type AuthActionState } from "@/app/login/actions";
import { PutdukIcon } from "@/components/icons/putduk-icon";

const INITIAL_AUTH_STATE: AuthActionState = {
  message: "",
  status: "idle",
};

function AuthButtons() {
  const { pending } = useFormStatus();

  return (
    <div className="auth-form__actions">
      <button
        className="button button--primary"
        type="submit"
        name="intent"
        value="sign-in"
        disabled={pending}
      >
        {pending ? "확인 중" : "로그인"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      <button
        className="button button--secondary"
        type="submit"
        name="intent"
        value="sign-up"
        disabled={pending}
      >
        새 계정 만들기
      </button>
    </div>
  );
}

export function AuthForm({ nextPath }: { nextPath: string }) {
  const [state, action] = useActionState(
    authenticateAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form className="auth-form" action={action}>
      <input type="hidden" name="next" value={nextPath} />
      <label>
        <span>이메일</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
      </label>
      <label>
        <span>비밀번호</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={10}
          maxLength={128}
          required
        />
      </label>
      {state.status !== "idle" ? (
        <p
          className={`auth-form__message auth-form__message--${state.status}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <AuthButtons />
    </form>
  );
}
