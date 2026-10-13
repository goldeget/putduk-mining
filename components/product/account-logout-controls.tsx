"use client";
import { FeedbackMessage } from "@/components/ui/feedback-message";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useFormStatus } from "react-dom";
import {
  logoutAction,
  logoutAllAction,
} from "@/app/(product)/menu/account/actions";
import {
  beginPushLogout,
  cleanupCurrentDevicePush,
  pushCleanupWaitMs,
} from "@/lib/notifications/push-client-coordinator";

function SubmissionLifecycle({ onComplete }: { onComplete: () => void }) {
  const { pending } = useFormStatus();
  const submitted = useRef(false);
  useEffect(() => {
    if (pending) submitted.current = true;
    else if (submitted.current) {
      submitted.current = false;
      onComplete();
    }
  }, [pending, onComplete]);
  return null;
}

export function AccountLogoutControls({
  className,
}: {
  className: string | undefined;
}) {
  const pendingRef = useRef(false);
  const readyForm = useRef<HTMLFormElement | null>(null);
  const mounted = useRef(false);
  const cleanupController = useRef<AbortController | null>(null);
  const release = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const complete = useCallback(() => {
    release.current?.();
    release.current = null;
    readyForm.current = null;
    pendingRef.current = false;
    if (mounted.current) setPending(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cleanupController.current?.abort();
      release.current?.();
      release.current = null;
    };
  }, []);

  async function beforeLogout(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (readyForm.current === form) {
      readyForm.current = null;
      return;
    }
    event.preventDefault();
    if (pendingRef.current) return;
    const unlock = beginPushLogout();
    if (!unlock) return;
    release.current = unlock;
    pendingRef.current = true;
    setPending(true);
    setMessage("");
    const controller = new AbortController();
    cleanupController.current = controller;
    const timer = setTimeout(() => controller.abort(), pushCleanupWaitMs);
    try {
      await cleanupCurrentDevicePush(controller.signal);
    } catch {
      /* Cleanup uncertainty must not prevent the canonical auth action. */
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (!mounted.current || !form.isConnected) {
      complete();
      return;
    }
    readyForm.current = form;
    try {
      form.requestSubmit();
    } catch {
      complete();
      setMessage("로그아웃 요청을 보내지 못했어요. 다시 시도해 주세요.");
    }
  }

  return (
    <div className={className}>
      <form
        action={logoutAction}
        onSubmit={beforeLogout}
        aria-label="이 기기 로그아웃"
      >
        <button
          className="button button--secondary"
          type="submit"
          disabled={pending}
          aria-busy={pending}
        >
          이 기기에서 로그아웃
        </button>
        <SubmissionLifecycle onComplete={complete} />
      </form>
      <form
        action={logoutAllAction}
        onSubmit={beforeLogout}
        aria-label="모든 기기 로그아웃"
      >
        <button
          className="button button--danger"
          type="submit"
          disabled={pending}
          aria-busy={pending}
        >
          모든 기기에서 로그아웃
        </button>
        <SubmissionLifecycle onComplete={complete} />
      </form>
      <p>
        로그아웃 전에 현재 브라우저의 알림 해제를 시도해요. 다른 기기의 알림
        설정은 별도로 확인해 주세요.
      </p>
      {message ? (
        <FeedbackMessage role="status">{message}</FeedbackMessage>
      ) : null}
    </div>
  );
}
