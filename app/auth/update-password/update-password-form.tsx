"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  updatePasswordAction,
  type UpdatePasswordActionState,
} from "@/app/auth/update-password/actions";
import { PutdukIcon } from "@/components/icons/putduk-icon";

const INITIAL_STATE: UpdatePasswordActionState = {
  message: "",
  status: "idle",
};

function SubmitButton({ mismatch }: { mismatch: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="button button--primary"
      type="submit"
      disabled={pending || mismatch}
    >
      {pending ? "변경하고 있어요" : "새 비밀번호 저장"}
      <PutdukIcon name="arrow-right" size={18} />
    </button>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, INITIAL_STATE);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const mismatch = confirmation.length > 0 && password !== confirmation;

  return (
    <form
      className="auth-form"
      action={action}
      data-ui-state={state.status === "error" || mismatch ? "error" : "loaded"}
    >
      <div className="auth-form__field">
        <label htmlFor="new-password">새 비밀번호</label>
        <div className="auth-form__password">
          <input
            id="new-password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="new-password-help"
            required
          />
          <button
            type="button"
            aria-controls="new-password password-confirmation"
            aria-label={
              show
                ? "새 비밀번호와 확인 값 숨기기"
                : "새 비밀번호와 확인 값 보기"
            }
            aria-pressed={show}
            onClick={() => setShow((value) => !value)}
          >
            {show ? "숨기기" : "보기"}
          </button>
        </div>
        <small id="new-password-help">10자 이상 입력해 주세요.</small>
      </div>
      <label>
        <span>새 비밀번호 확인</span>
        <input
          id="password-confirmation"
          name="passwordConfirmation"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "password-mismatch" : undefined}
          required
        />
      </label>
      {mismatch ? (
        <p
          id="password-mismatch"
          className="auth-form__message auth-form__message--error"
          role="alert"
        >
          비밀번호가 서로 일치하지 않습니다.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p
          className="auth-form__message auth-form__message--error"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <div className="auth-form__actions">
        <SubmitButton mismatch={mismatch} />
      </div>
    </form>
  );
}
