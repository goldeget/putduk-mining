"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";

export function DepositApprovalForm({
  amountAtomic,
  currency,
  requestId,
}: {
  amountAtomic: string;
  currency: DisplayCurrency;
  requestId: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/admin/deposits/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          confirmation: formData.get("confirmation"),
          depositRequestId: requestId,
          reason: formData.get("reason"),
          receivedAmountAtomic: formData.get("receivedAmountAtomic"),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "승인을 완료하지 못했습니다.");
        return;
      }

      setMessage("원장 반영과 감사 기록을 완료했습니다.");
      router.refresh();
    } catch {
      setMessage("네트워크 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (!expanded) {
    return (
      <button
        className="admin-inline-action"
        type="button"
        onClick={() => setExpanded(true)}
      >
        검토
      </button>
    );
  }

  return (
    <form className="admin-approval-form" onSubmit={submit}>
      <label>
        <span>실제 수신 금액</span>
        <input
          name="receivedAmountAtomic"
          defaultValue={amountAtomic}
          required
        />
        <small>{formatAtomicAmount(amountAtomic, currency)} 요청</small>
      </label>
      <label>
        <span>감사 사유</span>
        <textarea name="reason" minLength={10} maxLength={500} required />
      </label>
      <label>
        <span>확인 문구</span>
        <input
          name="confirmation"
          autoComplete="off"
          placeholder="APPROVE_DEPOSIT"
          required
        />
      </label>
      <div>
        <button type="button" onClick={() => setExpanded(false)}>
          취소
        </button>
        <button type="submit" disabled={pending}>
          {pending ? "처리 중" : "원장 반영 승인"}
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
