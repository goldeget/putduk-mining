"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { createAdminBrowserClient } from "@/lib/supabase/browser";

type Enrolment = { id: string; qrCode: string; secret: string };

export function MfaGate({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("인증 수단을 확인하고 있습니다.");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const supabase = createAdminBrowserClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session) {
        setMessage("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
        setBusy(false);
        return;
      }
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (error || !factors) {
        setMessage(
          "다중 인증 정보를 불러오지 못했습니다. 다시 로그인해 주세요.",
        );
        setBusy(false);
        return;
      }
      const totpFactors = factors.totp ?? [];
      const allFactors = factors.all ?? [];
      const verified = totpFactors.find(
        (factor) => factor.status === "verified",
      );
      if (verified) {
        setFactorId(verified.id);
        setMessage("인증 앱에 표시된 6자리 코드를 입력해 주세요.");
        setBusy(false);
        return;
      }
      const staleUnverified = allFactors.filter(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "unverified",
      );
      const cleanup = await Promise.all(
        staleUnverified.map((factor) =>
          supabase.auth.mfa.unenroll({ factorId: factor.id }),
        ),
      );
      if (cleanup.some(({ error: cleanupError }) => cleanupError)) {
        setMessage(
          "이전 인증 앱 등록을 정리하지 못했습니다. 다시 로그인해 주세요.",
        );
        setBusy(false);
        return;
      }
      // 재시도마다 고유 friendlyName → GoTrue 이름 충돌로 enroll UI가 비는 것을 방지
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `PUTDUK Admin ${Date.now().toString(36)}`,
        issuer: "PUTDUK MINING",
      });
      if (!active) return;
      if (enrollError || !data || data.type !== "totp") {
        setMessage(
          enrollError?.message?.trim()
            ? `인증 앱 등록을 시작하지 못했습니다. (${enrollError.message})`
            : "인증 앱 등록을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      } else {
        setFactorId(data.id);
        setEnrolment({
          id: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
        });
        setMessage("인증 앱에 QR을 등록한 뒤 6자리 코드를 입력해 주세요.");
      }
      setBusy(false);
    }
    void prepare();
    return () => {
      active = false;
    };
  }, []);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) {
      setMessage("6자리 인증 코드를 확인해 주세요.");
      return;
    }
    setBusy(true);
    const { error } =
      await createAdminBrowserClient().auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
    if (error) {
      setMessage("인증 코드가 올바르지 않거나 만료되었습니다.");
      setBusy(false);
      return;
    }
    const recorded = await fetch("/api/v1/admin/session/mfa-confirmed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!recorded.ok) {
      setMessage("보안 기록을 확인하지 못했습니다. 다시 로그인해 주세요.");
      setBusy(false);
      return;
    }
    router.replace(returnTo as Route);
    router.refresh();
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
      <form className="auth-form" onSubmit={verify}>
        <label>
          <span>6자리 인증 코드</span>
          <input
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
