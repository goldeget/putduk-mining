"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import type { AdminCommandFamily } from "@/lib/auth/command-families";
import { createAdminBrowserClient } from "@/lib/supabase/browser";
import { waitForAdminResult } from "@/lib/ui/abortable";

/**
 * 고위험 명령용 일회성 step-up 토큰.
 * 최근 TOTP AMR만으로는 머니 RPC를 호출하지 않습니다.
 *
 * onTokenIssued 가 있으면 부모가 토큰 사본을 보관할 수 있다.
 */
export function StepUpTokenField({
  commandFamily,
  onTokenIssued,
  submissionPending = false,
}: {
  commandFamily: AdminCommandFamily;
  onTokenIssued?: (token: string) => void;
  submissionPending?: boolean;
}) {
  const { pending: formPending } = useFormStatus();
  const parentPending = formPending || submissionPending;
  const [token, setToken] = useState("");
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(
    "인증 앱 코드로 작업 확인을 완료해 주세요.",
  );
  const [busy, setBusy] = useState(false);
  const issuing = useRef(false);
  const requestSequence = useRef(0);
  const alive = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const expiryTimer = useRef<number | null>(null);
  const tokenCallback = useRef(onTokenIssued);
  tokenCallback.current = onTokenIssued;

  useEffect(() => {
    alive.current = true;
    function invalidate() {
      requestSequence.current += 1;
      issuing.current = false;
      setBusy(false);
      controllerRef.current?.abort();
      if (expiryTimer.current !== null)
        window.clearTimeout(expiryTimer.current);
      if (tokenInputRef.current) tokenInputRef.current.value = "";
      setToken("");
      tokenCallback.current?.("");
      setMessage("작업 확인이 필요합니다. 인증 앱 코드를 다시 입력해 주세요.");
    }
    invalidate();
    window.addEventListener("offline", invalidate);
    window.addEventListener("pagehide", invalidate);
    let unsubscribe: (() => void) | undefined;
    try {
      const listener = createAdminBrowserClient().auth.onAuthStateChange?.(
        (event) => {
          if (event === "SIGNED_OUT" || event === "USER_UPDATED") invalidate();
        },
      );
      unsubscribe = () => listener?.data.subscription.unsubscribe();
    } catch {
      invalidate();
    }
    return () => {
      alive.current = false;
      requestSequence.current += 1;
      unsubscribe?.();
      controllerRef.current?.abort();
      if (expiryTimer.current !== null)
        window.clearTimeout(expiryTimer.current);
      tokenCallback.current?.("");
      window.removeEventListener("offline", invalidate);
      window.removeEventListener("pagehide", invalidate);
    };
  }, [commandFamily]);

  useEffect(() => {
    if (!parentPending) return;
    // A form action has already captured FormData before pending is published.
    // A manual parent supplies pending only after it captures its token snapshot.
    // Clear the UI copy for the next command; this does not cancel that snapshot.
    function clearSubmittedConfirmation() {
      requestSequence.current += 1;
      issuing.current = false;
      controllerRef.current?.abort();
      if (expiryTimer.current !== null)
        window.clearTimeout(expiryTimer.current);
      if (tokenInputRef.current) tokenInputRef.current.value = "";
      setToken("");
      tokenCallback.current?.("");
      setBusy(false);
      setMessage("작업을 보냈습니다. 다음 작업에는 다시 확인해 주세요.");
    }
    clearSubmittedConfirmation();
  }, [parentPending]);

  async function issueGrant() {
    if (issuing.current || parentPending) return;
    writeToken("");
    if (!/^\d{6}$/.test(code)) {
      setMessage("6자리 인증 코드를 확인해 주세요.");
      return;
    }
    setBusy(true);
    issuing.current = true;
    const sequence = ++requestSequence.current;
    const current = () => alive.current && sequence === requestSequence.current;
    setMessage("인증을 확인하고 있습니다.");
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      if (!navigator.onLine) throw new Error("OFFLINE");
      const verified = await waitForAdminResult(
        fetch("/api/v1/admin/session/totp-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, purpose: "STEP_UP" }),
          signal: controller.signal,
        }),
        controller.signal,
      );
      const verifiedPayload = (await waitForAdminResult(
        verified.json().catch(() => null),
        controller.signal,
      )) as { data?: { verified?: boolean }; error?: { code?: string } } | null;
      if (!current() || controller.signal.aborted) return;
      if (verifiedPayload?.error?.code === "RATE_LIMITED") {
        setBusy(false);
        setMessage("잠시 후 다시 시도해 주세요.");
        return;
      }
      if (!verified.ok || verifiedPayload?.data?.verified !== true) {
        setBusy(false);
        setMessage(
          verified.status === 401
            ? "인증 코드가 올바르지 않거나 만료되었습니다."
            : "인증 결과를 확인하지 못했습니다. 다시 시도해 주세요.",
        );
        return;
      }
      const response = await waitForAdminResult(
        fetch("/api/v1/admin/session/step-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandFamily }),
          signal: controller.signal,
        }),
        controller.signal,
      );
      const payload = (await waitForAdminResult(
        response.json().catch(() => null),
        controller.signal,
      )) as {
        data?: { token?: string; commandFamily?: string };
        error?: { code?: string };
      } | null;
      if (!current() || controller.signal.aborted) return;
      setBusy(false);
      if (
        !response.ok ||
        typeof payload?.data?.token !== "string" ||
        payload.data.token.length < 16 ||
        payload.data.commandFamily !== commandFamily
      ) {
        writeToken("");
        setMessage(
          payload?.error?.code === "STEP_UP_REQUIRED"
            ? "인증 앱으로 다시 확인한 뒤 시도해 주세요."
            : "작업 확인 토큰을 발급하지 못했습니다.",
        );
        return;
      }
      // 성공 문구보다 먼저 DOM에 넣는다. useEffect면 제출이 빈 토큰을 보낸다.
      writeToken(payload.data.token);
      setCode("");
      setMessage(
        "이번 작업을 한 번 실행할 수 있습니다. 다음 작업에는 다시 확인해 주세요.",
      );
      // Conservatively discard client confirmation before the server's 10-minute TTL.
      // This only clears UI state; the server remains authoritative for validity/consumption.
      expiryTimer.current = window.setTimeout(() => {
        writeToken("");
        setMessage(
          "작업 확인 시간이 지났습니다. 인증 앱 코드로 다시 확인해 주세요.",
        );
      }, 5 * 60_000);
    } catch {
      if (current()) {
        writeToken("");
        setMessage(
          "작업 확인 결과를 받지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (current()) {
        controllerRef.current = null;
        issuing.current = false;
        setBusy(false);
      }
    }
  }

  function writeToken(next: string) {
    if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
    if (tokenInputRef.current) {
      tokenInputRef.current.value = next;
    }
    setToken(next);
    tokenCallback.current?.(next);
  }

  return (
    <div className="operator-step-up">
      <input
        ref={tokenInputRef}
        name="stepUpToken"
        type="hidden"
        value={token}
      />
      <label className="operator-field">
        <span>인증 앱 코드 (작업 확인)</span>
        <input
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          disabled={busy || parentPending}
          onChange={(event) => {
            writeToken("");
            setCode(event.target.value.replace(/\D/g, ""));
          }}
          pattern="[0-9]{6}"
          value={code}
        />
      </label>
      <button
        className="ghost-button"
        disabled={busy || parentPending}
        onClick={() => void issueGrant()}
        type="button"
      >
        작업 확인
      </button>
      <p className="panel-note" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
