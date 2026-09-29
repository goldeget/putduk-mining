"use client";

import { useRef, useState } from "react";

import type { AdminCommandFamily } from "@/lib/auth/command-families";
import { createAdminBrowserClient } from "@/lib/supabase/browser";

/**
 * 고위험 명령용 일회성 step-up 토큰.
 * 최근 TOTP AMR만으로는 머니 RPC를 호출하지 않습니다.
 */
export function StepUpTokenField({
  commandFamily,
}: {
  commandFamily: AdminCommandFamily;
}) {
  const [token, setToken] = useState("");
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(
    "인증 앱 코드로 작업 확인을 완료해 주세요.",
  );
  const [busy, setBusy] = useState(false);

  async function issueGrant() {
    if (!/^\d{6}$/.test(code)) {
      setMessage("6자리 인증 코드를 확인해 주세요.");
      return;
    }
    setBusy(true);
    setMessage("인증을 확인하고 있습니다.");
    const supabase = createAdminBrowserClient();
    const { data: factors, error: factorError } =
      await supabase.auth.mfa.listFactors();
    if (factorError) {
      setBusy(false);
      setMessage("인증 수단을 불러오지 못했습니다.");
      return;
    }
    const verified = factors.totp.find(
      (factor) => factor.status === "verified",
    );
    if (!verified) {
      setBusy(false);
      setMessage("등록된 인증 앱이 없습니다. 먼저 MFA를 완료해 주세요.");
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: verified.id,
      code,
    });
    if (verifyError) {
      setBusy(false);
      setMessage("인증 코드가 올바르지 않거나 만료되었습니다.");
      return;
    }
    const response = await fetch("/api/v1/admin/session/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandFamily }),
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: { token?: string };
      error?: { code?: string };
    } | null;
    setBusy(false);
    if (!response.ok || !payload?.data?.token) {
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
    setMessage("작업 확인이 완료되었습니다. 이제 명령을 실행할 수 있습니다.");
  }

  function writeToken(next: string) {
    if (tokenInputRef.current) {
      tokenInputRef.current.value = next;
    }
    setToken(next);
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
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          pattern="[0-9]{6}"
          value={code}
        />
      </label>
      <button
        className="ghost-button"
        disabled={busy}
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
