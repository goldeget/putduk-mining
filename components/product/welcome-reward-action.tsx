"use client";

import { useState } from "react";
import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";

type ConversionResult = {
  converted_amount_atomic?: number | string | null;
  id?: string;
  status?: string;
};

export function WelcomeRewardAction({
  conversion,
}: {
  conversion?: ConversionResult | null;
}) {
  const [result, setResult] = useState<ConversionResult | null>(
    conversion ?? null,
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function verifyEligibility() {
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/trial/convert", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const payload = (await response.json()) as {
        data?: { conversion?: ConversionResult | null };
        error?: { code?: string; message?: string };
      };

      if (!response.ok) {
        setMessage(
          payload.error?.message ??
            "환영 보상 자격을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }

      const conversion = payload.data?.conversion ?? null;
      if (!conversion?.id || conversion.status !== "CONVERTED") {
        setMessage(
          "환영 보상 자격을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }

      setResult(conversion);
      setMessage("자격 확인 결과를 안전하게 반영했어요.");
    } catch {
      setMessage("인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (result?.status === "CONVERTED" && result.id) {
    return (
      <div className="welcome-reward-action welcome-reward-action--converted">
        <span>
          <PutdukIcon name="shield" size={18} /> 실제 KRW 환영 보상으로 전환
          완료
        </span>
        <Link
          className="button button--primary"
          href={`/wallet/withdraw?welcome=${result.id}`}
        >
          입금 없이 첫 출금 이어가기
          <PutdukIcon name="arrow-right" size={18} />
        </Link>
      </div>
    );
  }

  if (result?.status && result.status !== "REJECTED") {
    return (
      <div className="welcome-reward-action">
        <span>현재 상태 · {result.status}</span>
        <p>
          신원·KYC·이상 이용 방지 확인 결과가 갱신되면 이곳에 다음 행동이
          표시됩니다.
        </p>
        {message ? <p role="status">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="welcome-reward-action">
      <button
        className="button button--primary"
        type="button"
        disabled={pending}
        onClick={verifyEligibility}
      >
        {pending ? "자격 확인 중" : "환영 보상 자격 확인하기"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      <p>
        자격을 통과하면 최대 5,000원이 실제 KRW 지갑으로 전환될 수 있으며, 해당
        첫 출금에 사전 입금은 필요하지 않습니다.
      </p>
      {message ? (
        <p className="welcome-reward-action__message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
