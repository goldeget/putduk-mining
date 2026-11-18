"use client";
import { FeedbackMessage } from "@/components/ui/feedback-message";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { UpdatePasswordActionState } from "@/app/auth/update-password/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
} from "@/components/auth/auth-form-feedback";

const INITIAL_STATE: UpdatePasswordActionState = {
  message: "",
  status: "idle",
};

export function UpdatePasswordForm() {
  const router = useRouter();
  const [state, setState] = useState<UpdatePasswordActionState>(INITIAL_STATE);
  const [isPending, setIsPending] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const mismatch = confirmation.length > 0 && password !== confirmation;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    preventOfflineAuthSubmission(event);
    if (navigator.onLine === false) return;

    const formData = new FormData(event.currentTarget);
    const passwordValue = String(formData.get("password") ?? "");
    const passwordConfirmation = String(
      formData.get("passwordConfirmation") ?? "",
    );

    setIsPending(true);
    setState({ message: "", status: "idle" });

    try {
      const response = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: passwordValue,
          passwordConfirmation,
        }),
      });

      const data = (await response.json()) as UpdatePasswordActionState & {
        redirectUrl?: string;
      };

      if (response.ok && data.redirectUrl) {
        router.push(data.redirectUrl);
        return;
      }

      setState({
        message:
          data.message || "비밀번호를 변경하지 못했어요. 다시 시도해 주세요.",
        status: "error",
      });
    } catch {
      setState({
        message: "네트워크 연결을 확인해 주세요.",
        status: "error",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      className="auth-form"
      aria-label="새 비밀번호 설정"
      onSubmit={handleSubmit}
      data-ui-state={state.status === "error" || mismatch ? "error" : "loaded"}
    >
      <AuthConnectionNotice />
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
        <FeedbackMessage
          id="password-mismatch"
          className="auth-form__message auth-form__message--error"
          role="alert"
        >
          비밀번호가 서로 일치하지 않습니다.
        </FeedbackMessage>
      ) : null}
      {state.status === "error" ? (
        <FeedbackMessage
          className="auth-form__message auth-form__message--error"
          role="alert"
        >
          {state.message}
        </FeedbackMessage>
      ) : null}
      <div className="auth-form__actions">
        <AuthSubmitButton
          label="새 비밀번호 저장"
          pendingLabel="변경하고 있어요"
          disabled={isPending || mismatch}
          pending={isPending}
        />
      </div>
    </form>
  );
}
