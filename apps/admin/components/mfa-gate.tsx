"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { createAdminBrowserClient } from "@/lib/supabase/browser";
import { waitForAdminResult } from "@/lib/ui/abortable";

type Enrolment = { id: string; qrCode: string; secret: string };

const isTestApp = process.env.NEXT_PUBLIC_APP_ENV === "test";

/** GoTrue·로컬 Supabase가 CI 8-shard 병렬 부하에서 15초를 넘길 수 있다. */
export const ADMIN_MFA_PREPARE_TIMEOUT_MS = isTestApp ? 90_000 : 45_000;

/** E2E는 UI "다시 확인" 전에 GoTrue 지연·Docker rate limit을 흡수한다. */
export const ADMIN_MFA_INTERNAL_PREPARE_ATTEMPTS = isTestApp ? 4 : 1;

function prepareBackoffMs(attemptIndex: number) {
  return 1_500 * (attemptIndex + 1);
}

const adminSessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function MfaGate({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("인증 수단을 확인하고 있습니다.");
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const alive = useRef(true);
  const verifying = useRef(false);
  const confirmation = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    alive.current = true;
    let preparation: AbortController | null = null;

    async function prepareOnce(): Promise<
      "ready" | "retry" | "session_missing"
    > {
      preparation = new AbortController();
      const signal = preparation.signal;
      const preparationTimeout = window.setTimeout(
        () => preparation?.abort(),
        ADMIN_MFA_PREPARE_TIMEOUT_MS,
      );
      try {
        const supabase = createAdminBrowserClient();
        const {
          data: { session },
          error: sessionError,
        } = await waitForAdminResult(supabase.auth.getSession(), signal);
        if (!active) return "retry";
        if (sessionError || !session) {
          setPrepareFailed(true);
          setMessage(
            "로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.",
          );
          return "session_missing";
        }
        const { data: factors, error } = await waitForAdminResult(
          supabase.auth.mfa.listFactors(),
          signal,
        );
        if (!active) return "retry";
        if (error || !factors) {
          setMessage(
            "다중 인증 정보를 불러오지 못했습니다. 잠시 후 다시 시도합니다.",
          );
          return "retry";
        }
        const totpFactors = factors.totp ?? [];
        const allFactors = factors.all ?? [];
        const verified = totpFactors.find(
          (factor) => factor.status === "verified",
        );
        if (verified) {
          if (typeof verified.id !== "string" || !verified.id.trim()) {
            throw new Error("MFA_FACTOR_UNAVAILABLE");
          }
          setFactorId(verified.id);
          setEnrolment(null);
          setPrepareFailed(false);
          setMessage("인증 앱에 표시된 6자리 코드를 입력해 주세요.");
          return "ready";
        }
        const staleUnverified = allFactors.filter(
          (factor) =>
            factor.factor_type === "totp" && factor.status === "unverified",
        );
        const cleanup = await waitForAdminResult(
          Promise.all(
            staleUnverified.map((factor) =>
              supabase.auth.mfa.unenroll({ factorId: factor.id }),
            ),
          ),
          signal,
        );
        if (!active) return "retry";
        if (cleanup.some(({ error: cleanupError }) => cleanupError)) {
          setMessage(
            "이전 인증 앱 등록을 정리하지 못했습니다. 잠시 후 다시 시도합니다.",
          );
          return "retry";
        }
        const { data, error: enrollError } = await waitForAdminResult(
          supabase.auth.mfa.enroll({
            factorType: "totp",
            friendlyName: `PUTDUK Admin ${Date.now().toString(36)}`,
            issuer: "PUTDUK MINING",
          }),
          signal,
        );
        if (!active) return "retry";
        if (enrollError || !data || data.type !== "totp") {
          setMessage(
            "인증 앱 등록을 시작하지 못했습니다. 잠시 후 다시 시도합니다.",
          );
          return "retry";
        }
        setFactorId(data.id);
        setEnrolment({
          id: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
        });
        setPrepareFailed(false);
        setMessage("인증 앱에 QR을 등록한 뒤 6자리 코드를 입력해 주세요.");
        return "ready";
      } catch {
        if (!active) return "retry";
        setFactorId(null);
        setEnrolment(null);
        setMessage(
          "인증 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도합니다.",
        );
        return "retry";
      } finally {
        window.clearTimeout(preparationTimeout);
      }
    }

    async function runPrepare() {
      setBusy(true);
      setPrepareFailed(false);
      setMessage("인증 수단을 확인하고 있습니다.");
      for (
        let internalAttempt = 0;
        internalAttempt < ADMIN_MFA_INTERNAL_PREPARE_ATTEMPTS;
        internalAttempt += 1
      ) {
        if (!active) return;
        const outcome = await prepareOnce();
        if (!active) return;
        if (outcome === "ready" || outcome === "session_missing") {
          if (active) setBusy(false);
          return;
        }
        if (internalAttempt < ADMIN_MFA_INTERNAL_PREPARE_ATTEMPTS - 1) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, prepareBackoffMs(internalAttempt)),
          );
        }
      }
      if (!active) return;
      setPrepareFailed(true);
      setMessage(
        "인증 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
      );
      setBusy(false);
    }

    void runPrepare();
    return () => {
      active = false;
      preparation?.abort();
      alive.current = false;
      confirmation.current?.abort();
    };
  }, [attempt]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || verifying.current) return;
    if (!factorId || !/^\d{6}$/.test(code)) {
      setMessage("6자리 인증 코드를 확인해 주세요.");
      return;
    }
    setBusy(true);
    verifying.current = true;
    setMessage("인증을 확인하고 있습니다.");
    const controller = new AbortController();
    confirmation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      if (!navigator.onLine) throw new Error("OFFLINE");
      const verified = await waitForAdminResult(
        fetch("/api/v1/admin/session/totp-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            purpose: "SESSION",
            factorId,
          }),
          signal: controller.signal,
        }),
        controller.signal,
      );
      const verifiedPayload = (await waitForAdminResult(
        verified.json().catch(() => null),
        controller.signal,
      )) as { data?: { verified?: boolean }; error?: { code?: string } } | null;
      if (!alive.current || controller.signal.aborted) return;
      if (verifiedPayload?.error?.code === "RATE_LIMITED") {
        setMessage("잠시 후 다시 시도해 주세요.");
        setBusy(false);
        return;
      }
      if (!verified.ok || verifiedPayload?.data?.verified !== true) {
        setMessage(
          verified.status === 401
            ? "인증 코드가 올바르지 않거나 만료되었습니다."
            : "인증 결과를 확인하지 못했습니다. 다시 로그인해 주세요.",
        );
        setBusy(false);
        return;
      }
      const recorded = await waitForAdminResult(
        fetch("/api/v1/admin/session/mfa-confirmed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        }),
        controller.signal,
      );
      const payload = await waitForAdminResult(
        recorded.json().catch(() => null),
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      if (
        !recorded.ok ||
        payload?.data?.recorded !== true ||
        typeof payload?.data?.adminSessionId !== "string" ||
        !adminSessionIdPattern.test(payload.data.adminSessionId)
      ) {
        setMessage("보안 기록을 확인하지 못했습니다. 다시 로그인해 주세요.");
        setBusy(false);
        return;
      }
      router.replace(returnTo as Route);
      router.refresh();
    } catch {
      if (alive.current)
        setMessage(
          "인증 결과를 확인하지 못했습니다. 연결을 확인하고 코드를 다시 입력해 주세요.",
        );
    } finally {
      window.clearTimeout(timeout);
      confirmation.current = null;
      verifying.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="mfa-flow">
      {enrolment ? (
        <div className="mfa-enrolment">
          {/* Supabase returns a data URI generated for this one-time enrolment. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="PUTDUK 운영자 인증 앱 등록 QR"
            height="188"
            src={enrolment.qrCode}
            width="188"
          />
          <p>
            <span>수동 등록 키</span>
            <code>{enrolment.secret}</code>
          </p>
        </div>
      ) : null}
      <p className="form-note" aria-live="polite">
        {message}
      </p>
      {prepareFailed ? (
        <div>
          <button
            className="ghost-button"
            disabled={busy}
            type="button"
            onClick={() => {
              setBusy(true);
              setPrepareFailed(false);
              setFactorId(null);
              setEnrolment(null);
              setMessage("인증 수단을 확인하고 있습니다.");
              setAttempt((value) => value + 1);
            }}
          >
            다시 확인
          </button>
          <Link className="text-link" href="/login">
            다시 로그인
          </Link>
        </div>
      ) : null}
      <form className="auth-form" onSubmit={verify}>
        <label>
          <span>6자리 인증 코드</span>
          <input
            disabled={busy || !factorId}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            pattern="[0-9]{6}"
            value={code}
          />
        </label>
        <button
          className="gold-button"
          disabled={busy || !factorId}
          type="submit"
        >
          인증 완료
        </button>
      </form>
    </div>
  );
}
