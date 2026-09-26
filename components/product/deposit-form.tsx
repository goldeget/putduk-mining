"use client";

import { useState, type FormEvent } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  parseDisplayAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

export function DepositForm() {
  const [currency, setCurrency] = useState<DisplayCurrency>("KRW");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");

    const formData = new FormData(form);
    const displayAmount = String(formData.get("amount") ?? "");

    try {
      const amountAtomic = parseDisplayAmount(displayAmount, currency);
      const response = await fetch("/api/v1/deposits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ amountAtomic, currency }),
      });
      const payload = (await response.json()) as {
        data?: { requestId?: string };
        error?: { message?: string };
      };

      if (!response.ok) {
        setMessage(payload.error?.message ?? "입금 요청을 만들지 못했습니다.");
        return;
      }

      setMessage(
        currency === "KRW"
          ? "입금 요청이 생성되었습니다. 운영자가 확인할 계좌 안내는 승인된 운영 설정에서 표시됩니다."
          : "USDT 요청이 생성되었습니다. 네트워크와 주소는 운영 확인 후 안내됩니다.",
      );
      void trackAnalyticsEvent("deposit_start", { currency }).catch(
        () => undefined,
      );
      form.reset();
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? "0보다 큰 금액을 입력해 주세요."
          : currency === "KRW"
            ? "원 단위의 정수 금액을 입력해 주세요."
            : "USDT는 소수점 6자리까지 입력할 수 있습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="funding-form" onSubmit={submit}>
      <fieldset>
        <legend>입금 방식</legend>
        <div className="segmented-control">
          {(["KRW", "USDT"] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="currency"
                value={value}
                checked={currency === value}
                onChange={() => setCurrency(value)}
              />
              <span>{value === "KRW" ? "원화 계좌이체" : "USDT"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="funding-form__amount">
        <span>요청 금액</span>
        <div>
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={currency === "KRW" ? "예: 10000" : "예: 10.5"}
            required
          />
          <strong>{currency}</strong>
        </div>
      </label>
      <div className="funding-form__notice">
        <PutdukIcon name="shield" size={19} />
        <p>
          요청 생성만으로 잔액이 증가하지 않습니다. 운영 확인과 원장 기록이
          완료된 뒤 반영됩니다.
        </p>
      </div>
      <button
        className="button button--primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "요청 생성 중" : "입금 요청 만들기"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      {message ? (
        <p className="funding-form__message" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
