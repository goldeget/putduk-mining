"use client";

import { useState } from "react";
import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { presentConversionStatus } from "@/lib/product/home-start-display";

import styles from "./start-actions.module.css";

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
  const presentation = presentConversionStatus(result?.status);

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

      const next = payload.data?.conversion ?? null;
      if (!next?.id || next.status !== "CONVERTED") {
        setMessage(
          "환영 보상 자격을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
        if (next) {
          setResult(next);
        }
        return;
      }

      setResult(next);
      setMessage("자격 확인 결과를 안전하게 반영했어요.");
    } catch {
      setMessage("인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (result?.status === "CONVERTED" && result.id) {
    return (
      <div className={styles.convertedBlock}>
        <span className={styles.convertedBadge}>
          <PutdukIcon name="shield" size={18} />
          실제 KRW 환영 보상으로 전환 완료
        </span>
        <Link
          className="button button--primary"
          href={`/wallet/withdraw?welcome=${result.id}`}
        >
          입금 없이 첫 출금 이어가기
          <PutdukIcon name="arrow-right" size={18} />
        </Link>
        {message ? (
          <p className={styles.actionMessage} role="status">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  if (result?.status && result.status !== "REJECTED") {
    return (
      <div className={styles.pendingBlock}>
        <ProductStatusPill
          label={presentation.label}
          tone={presentation.tone}
        />
        <p className={styles.pendingStatus}>{presentation.description}</p>
        <p className={styles.actionMessage}>
          확인 결과가 갱신되면 이곳에 다음 행동이 표시돼요.
        </p>
        {message ? (
          <p className={styles.actionMessage} role="status">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.actionBlock}>
      <button
        className="button button--primary"
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={verifyEligibility}
      >
        {pending ? "자격 확인 중" : "환영 보상 자격 확인하기"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      <p className={styles.actionMessage}>
        자격을 통과하면 최대 5,000원이 실제 KRW 지갑으로 전환될 수 있어요.
        해당 첫 출금에 사전 입금은 필요하지 않습니다.
      </p>
      {result?.status === "REJECTED" ? (
        <p className={`${styles.actionMessage} ${styles.actionMessageError}`}>
          {presentation.description}
        </p>
      ) : null}
      {message ? (
        <p
          className={`${styles.actionMessage} ${styles.actionMessageError}`}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
