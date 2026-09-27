"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  requestPasswordRecovery,
  type RecoveryActionState,
} from "@/app/recover/actions";
import { PutdukIcon } from "@/components/icons/putduk-icon";

const INITIAL_STATE: RecoveryActionState = { message: "", status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button--primary" type="submit" disabled={pending}>
      {pending ? "안내를 준비하고 있어요" : "재설정 안내 받기"}
      <PutdukIcon name="arrow-right" size={18} />
    </button>
  );
}

export function RecoveryForm() {
  const [state, action] = useActionState(
    requestPasswordRecovery,
    INITIAL_STATE,
  );
  return (
    <form className="auth-form" action={action}>
      <label>
        <span>복구 이메일</span>
        <input
          id="recovery-email"
          name="email"
          type="email"
          autoComplete="email"
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
        <SubmitButton />
      </div>
    </form>
  );
}
