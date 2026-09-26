"use client";

import { useMemo, useState, type FormEvent } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  formatAtomicAmount,
  parseDisplayAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

export type WithdrawalAccount = {
  availableBalanceAtomic: string;
  currency: DisplayCurrency;
  id: string;
};

export type WithdrawalPolicy = {
  allowedDestinations: readonly string[];
  currency: DisplayCurrency;
  destinationType: "BANK_ACCOUNT" | "USDT_ADDRESS";
  feeAtomic: string;
  id: string;
  minimumAmountAtomic: string;
};

export function WithdrawalForm({
  accounts,
  policies,
}: {
  accounts: readonly WithdrawalAccount[];
  policies: readonly WithdrawalPolicy[];
}) {
  const [currency, setCurrency] = useState<DisplayCurrency>(
    policies[0]?.currency ?? "KRW",
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const policy = useMemo(
    () => policies.find((candidate) => candidate.currency === currency),
    [currency, policies],
  );
  const account = useMemo(
    () => accounts.find((candidate) => candidate.currency === currency),
    [accounts, currency],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !account) {
      setMessage("선택한 자산의 출금 정책 또는 지갑을 찾을 수 없습니다.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setMessage("");

    try {
      const amountAtomic = parseDisplayAmount(
        String(formData.get("amount") ?? ""),
        currency,
      );
      const destination =
        currency === "KRW"
          ? {
              accountHolder: String(formData.get("accountHolder") ?? ""),
              accountNumber: String(formData.get("accountNumber") ?? ""),
              bankCode: String(formData.get("bankCode") ?? ""),
            }
          : {
              address: String(formData.get("address") ?? ""),
              network: String(formData.get("network") ?? ""),
            };

      const response = await fetch("/api/v1/withdrawals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          amountAtomic,
          currency,
          destination,
          policyId: policy.id,
          walletAccountId: account.id,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      if (!response.ok) {
        setMessage(
          payload.error?.message ?? "출금 요청을 생성하지 못했습니다.",
        );
        return;
      }

      setMessage("출금 요청이 생성되었습니다. 운영 검증 후 상태가 갱신됩니다.");
      void trackAnalyticsEvent("withdrawal_start", { currency }).catch(
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
    <form className="funding-form withdrawal-form" onSubmit={submit}>
      <fieldset>
        <legend>출금 자산</legend>
        <div className="segmented-control">
          {policies.map((candidate) => (
            <label key={candidate.id}>
              <input
                type="radio"
                name="currency"
                value={candidate.currency}
                checked={currency === candidate.currency}
                onChange={() => setCurrency(candidate.currency)}
              />
              <span>{candidate.currency}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {policy && account ? (
        <dl className="withdrawal-policy-summary">
          <div>
            <dt>사용 가능</dt>
            <dd>
              {formatAtomicAmount(account.availableBalanceAtomic, currency)}
            </dd>
          </div>
          <div>
            <dt>최소 금액</dt>
            <dd>{formatAtomicAmount(policy.minimumAmountAtomic, currency)}</dd>
          </div>
          <div>
            <dt>수수료</dt>
            <dd>{formatAtomicAmount(policy.feeAtomic, currency)}</dd>
          </div>
        </dl>
      ) : null}

      <label className="funding-form__amount">
        <span>출금 금액</span>
        <div>
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
          />
          <strong>{currency}</strong>
        </div>
      </label>

      {currency === "KRW" ? (
        <div className="withdrawal-destination-grid">
          <label>
            <span>은행 코드</span>
            <select name="bankCode" required defaultValue="">
              <option value="" disabled>
                은행 선택
              </option>
              {policy?.allowedDestinations.map((bankCode) => (
                <option value={bankCode} key={bankCode}>
                  {bankCode}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>예금주</span>
            <input
              name="accountHolder"
              maxLength={60}
              autoComplete="name"
              required
            />
          </label>
          <label className="withdrawal-destination-grid__wide">
            <span>계좌번호</span>
            <input
              name="accountNumber"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9-]{6,32}"
              required
            />
          </label>
        </div>
      ) : (
        <div className="withdrawal-destination-grid">
          <label>
            <span>네트워크</span>
            <select name="network" required defaultValue="">
              <option value="" disabled>
                네트워크 선택
              </option>
              {policy?.allowedDestinations.map((network) => (
                <option value={network} key={network}>
                  {network}
                </option>
              ))}
            </select>
          </label>
          <label className="withdrawal-destination-grid__wide">
            <span>받을 주소</span>
            <input
              name="address"
              minLength={20}
              maxLength={128}
              autoComplete="off"
              required
            />
          </label>
        </div>
      )}

      <div className="funding-form__notice">
        <PutdukIcon name="shield" size={19} />
        <p>
          목적지 원문은 서버에서 암호화되고 화면에는 마스킹된 값만 남습니다.
          요청 금액과 수수료는 완료 또는 거절 전까지 사용 가능 잔액에서
          분리됩니다.
        </p>
      </div>
      <button
        className="button button--primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "요청 생성 중" : "출금 요청 만들기"}
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
