"use client";
import { FeedbackMessage } from "../../../components/ui/feedback-message";
import { WorkroomLoading } from "../../../components/ui/workroom-loading";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LoginState } from "@/app/actions";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoginState>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (navigator.onLine === false) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    setIsPending(true);
    setState(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnTo }),
      });

      const data = (await response.json()) as LoginState & {
        redirectUrl?: string;
      };

      if (response.ok && data.redirectUrl) {
        router.push(data.redirectUrl);
        return;
      }

      setState({ message: data.message ?? "로그인에 실패했습니다." });
    } catch {
      setState({ message: "네트워크 연결을 확인해 주세요." });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
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
        disabled={isPending}
        type="submit"
        aria-busy={isPending}
      >
        {isPending ? (
          <WorkroomLoading label="확인 중…" variant="inline" />
        ) : (
          "보안 로그인"
        )}
      </button>
    </form>
  );
}
