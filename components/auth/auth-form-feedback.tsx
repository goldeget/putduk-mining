"use client";

import { useSyncExternalStore, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { PutdukIcon } from "@/components/icons/putduk-icon";

function subscribeConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useAuthOnline() {
  return useSyncExternalStore(
    subscribeConnection,
    () => navigator.onLine,
    () => true,
  );
}

/** Presentation guard only; all validation and authorization remain server-owned. */
export function preventOfflineAuthSubmission(
  event: FormEvent<HTMLFormElement>,
) {
  if (navigator.onLine === false) event.preventDefault();
}

export function AuthConnectionNotice() {
  const online = useAuthOnline();
  return online ? null : (
    <p className="auth-form__message auth-form__message--offline" role="status">
      인터넷 연결이 끊겼어요. 연결을 확인한 뒤 다시 시도해 주세요.
    </p>
  );
}

export function AuthSubmitButton({
  label,
  pendingLabel,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const online = useAuthOnline();
  return (
    <>
      <button
        className="button button--primary ko-copy"
        type="submit"
        disabled={pending || !online || disabled}
        aria-busy={pending}
      >
        {pending ? pendingLabel : label}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      {pending ? (
        <span className="auth-form__pending" role="status">
          {pendingLabel}
        </span>
      ) : null}
    </>
  );
}
