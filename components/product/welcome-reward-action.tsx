"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { presentConversionStatus } from "@/lib/product/home-start-display";
import {
  readWelcomeConversionRejection,
  readWelcomeConversionSuccess,
  waitForWelcomeConversionResult,
  welcomeConversionWaitLimitMs,
} from "@/lib/product/welcome-conversion-response";

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
  const [unconfirmedResponse, setUnconfirmedResponse] = useState(false);
  const serverReadKey = JSON.stringify([
    conversion?.id ?? null,
    conversion?.status ?? null,
    conversion?.converted_amount_atomic ?? null,
  ]);
  const [lastServerReadKey, setLastServerReadKey] = useState(serverReadKey);
  if (lastServerReadKey !== serverReadKey) {
    setLastServerReadKey(serverReadKey);
    setResult(conversion ?? null);
    setMessage("");
    setPending(false);
    setUnconfirmedResponse(false);
  }
  const alive = useRef(true);
  const issuing = useRef(false);
  const requestSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const presentation = presentConversionStatus(result?.status);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestSequence.current += 1;
      issuing.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(
    () => () => {
      requestSequence.current += 1;
      issuing.current = false;
      controllerRef.current?.abort();
    },
    [serverReadKey],
  );

  async function verifyEligibility() {
    if (issuing.current || unconfirmedResponse) return;
    issuing.current = true;
    const sequence = ++requestSequence.current;
    const current = () => alive.current && sequence === requestSequence.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      welcomeConversionWaitLimitMs,
    );
    setPending(true);
    setMessage("");

    try {
      const response = await waitForWelcomeConversionResult(
        fetch("/api/v1/trial/convert", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (!current() || controller.signal.aborted) return;
      const payload: unknown = await waitForWelcomeConversionResult(
        response.json().catch(() => null),
        controller.signal,
      );
      if (!current() || controller.signal.aborted) return;

      if (!response.ok) {
        const rejection = readWelcomeConversionRejection(
          response.status,
          payload,
        );
        if (rejection) {
          setMessage(rejection);
        } else {
          setUnconfirmedResponse(true);
          setMessage(
            "보상 전환 결과를 확인하지 못했어요. 화면을 다시 불러와 상태를 확인해 주세요.",
          );
        }
        return;
      }

      const next = readWelcomeConversionSuccess(payload);
      if (!next) {
        setUnconfirmedResponse(true);
        setMessage(
          "보상 전환 결과를 확인하지 못했어요. 화면을 다시 불러와 상태를 확인해 주세요.",
        );
        return;
      }

      setResult(next);
      setMessage("자격 확인 결과를 안전하게 반영했어요.");
    } catch {
      if (current()) {
        setUnconfirmedResponse(true);
        setMessage(
          "보상 전환 결과를 확인하지 못했어요. 화면을 다시 불러와 상태를 확인해 주세요.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (current()) {
        controllerRef.current = null;
        issuing.current = false;
        setPending(false);
      }
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
      {unconfirmedResponse ? (
        <RouteReloadButton
          className="button button--primary"
          label="화면 다시 불러오기"
        />
      ) : (
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
      )}
      <p className={styles.actionMessage}>
        자격을 통과하면 최대 5,000원이 실제 KRW 지갑으로 전환될 수 있어요. 해당
        첫 출금에 사전 입금은 필요하지 않습니다.
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
