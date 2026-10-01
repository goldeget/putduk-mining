"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  destinationMethodHint,
  destinationMethodLabel,
  type WithdrawalDestinationMethod,
} from "@/components/product/destination-type";
import {
  isMemberFacingWithdrawalCopy,
  MEMBER_WITHDRAWAL_NETWORK_FALLBACK,
} from "@/components/product/member-withdrawal-errors";
import styles from "@/components/product/product-experience.module.css";
import {
  formatAtomicAmount,
  parseDisplayAmount,
} from "@/domain/wallet/format-amount";
import { trackAnalyticsEvent } from "@/lib/analytics/client";
import {
  browserWithdrawalLogicalRequestStore,
  LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY,
  snapshotWithdrawalInput,
  WithdrawalLogicalSafetyError,
  WITHDRAWAL_RECONCILIATION_COPY,
  type PersistedWithdrawalLogicalRequest,
} from "@/lib/wallet/withdrawal-logical-request";
import {
  recoverWithdrawalLogicalRequest,
  resolveWithdrawalLogicalRequest,
  submitWithdrawalLogicalRequest,
} from "@/lib/wallet/withdrawal-client";

export type WithdrawalAccount = {
  availableBalanceAtomic: string;
  heldBalanceAtomic: string;
  id: string;
};

export type WithdrawalPolicy = {
  allowedDestinations: readonly string[];
  feeAtomic: string;
  id: string;
  method: WithdrawalDestinationMethod;
  minimumAmountAtomic: string;
  version: number;
};

export type RegisteredWithdrawalDestination = {
  displayHint: string;
  id: string;
  method: WithdrawalDestinationMethod;
  protectionActive: boolean;
};

type Feedback = { message: string; tone: "error" | "success" } | null;

const bankNames: Record<string, string> = {
  IBK: "IBK기업은행",
  KB: "KB국민은행",
  KAKAO: "카카오뱅크",
  KEB_HANA: "하나은행",
  NH: "NH농협은행",
  SC: "SC제일은행",
  SHINHAN: "신한은행",
  TOSS: "토스뱅크",
  WOORI: "우리은행",
};

/** Normal withdrawals must use the hold command path — never the legacy money route. */
export const WITHDRAWAL_HOLD_SUBMIT_URL = "/api/v1/withdrawals/hold";
export const WITHDRAWAL_DESTINATION_REGISTER_URL =
  "/api/v1/withdrawals/destinations";
export const LEGACY_WITHDRAWAL_SUBMIT_URL = "/api/v1/withdrawals";

function atomicToInput(value: string) {
  return BigInt(value).toString();
}

export function WithdrawalForm({
  account,
  destinations = [],
  policies,
  ownerId,
}: {
  account: WithdrawalAccount | null;
  destinations?: readonly RegisteredWithdrawalDestination[];
  policies: readonly WithdrawalPolicy[];
  ownerId: string;
}) {
  const router = useRouter();
  const submittingRef = useRef(false);
  const initialMethod =
    policies.find((policy) => policy.method === "KRW_BANK")?.method ??
    policies[0]?.method ??
    "KRW_BANK";
  const [method, setMethod] =
    useState<WithdrawalDestinationMethod>(initialMethod);
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const [revealAddress, setRevealAddress] = useState(false);
  const [useNewDestination, setUseNewDestination] = useState(false);
  const [bankCode, setBankCode] = useState("");
  const [network, setNetwork] = useState("");
  const [showReauthPassword, setShowReauthPassword] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [recovery, setRecovery] =
    useState<PersistedWithdrawalLogicalRequest | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);

  function legacyPresent() {
    try {
      return (
        localStorage.getItem(LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY) !==
          null ||
        sessionStorage.getItem(
          LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY,
        ) !== null
      );
    } catch {
      throw new WithdrawalLogicalSafetyError("STORAGE_UNAVAILABLE");
    }
  }

  useEffect(() => {
    let live = true;
    async function recover() {
      try {
        const record = await recoverWithdrawalLogicalRequest(
          ownerId,
          browserWithdrawalLogicalRequestStore(),
          fetch,
          legacyPresent(),
        );
        if (!live) return;
        if (
          record &&
          ["PREPARED", "DESTINATION_REGISTERED", "OUTCOME_UNCERTAIN"].includes(
            record.state,
          )
        ) {
          setRecovery(record);
          setAmount(record.amountKrw);
          setMethod(record.method);
        } else if (record?.state === "CONFIRMED") {
          setFeedback({
            tone: "success",
            message:
              "이전 출금 요청을 접수했어요. 아래에서 상태를 확인해 주세요.",
          });
        } else if (record?.state === "CANCELLED" && record.destinationId) {
          setMethod(record.method);
          setFeedback({
            tone: "success",
            message:
              "이전 요청을 정리했어요. 등록된 계좌·주소와 보호 시간을 확인해 주세요.",
          });
        }
        setRecoveryReady(true);
      } catch (error) {
        if (live)
          setFeedback({
            tone: "error",
            message:
              error instanceof WithdrawalLogicalSafetyError
                ? error.message
                : WITHDRAWAL_RECONCILIATION_COPY,
          });
      }
    }
    void recover();
    return () => {
      live = false;
    };
  }, [ownerId]);

  const policy = useMemo(
    () => policies.find((candidate) => candidate.method === method),
    [method, policies],
  );

  const eligibleDestination = useMemo(
    () =>
      destinations.find(
        (destination) =>
          destination.method === method && !destination.protectionActive,
      ),
    [destinations, method],
  );

  const protectedDestination = useMemo(
    () =>
      destinations.find(
        (destination) =>
          destination.method === method && destination.protectionActive,
      ),
    [destinations, method],
  );

  const needsNewDestination = recovery
    ? !recovery.destinationId
    : (!eligibleDestination && !protectedDestination) || useNewDestination;
  const needsReauth =
    needsNewDestination &&
    (reauthRequired || destinations.some((item) => item.method === method));
  const lockIntent = Boolean(recovery);

  let amountAtomic: string | null = null;
  try {
    amountAtomic = amount ? parseDisplayAmount(amount, "KRW") : null;
  } catch {
    amountAtomic = null;
  }

  const totalAtomic =
    amountAtomic && policy
      ? (BigInt(amountAtomic) + BigInt(policy.feeAtomic)).toString()
      : null;
  const meetsMinimum = Boolean(
    recoveryReady &&
    amountAtomic &&
    policy &&
    BigInt(amountAtomic) >= BigInt(policy.minimumAmountAtomic),
  );
  const hasEnoughBalance = Boolean(
    totalAtomic &&
    account &&
    BigInt(totalAtomic) <= BigInt(account.availableBalanceAtomic),
  );
  const canSubmit = Boolean(
    recoveryReady &&
    amountAtomic &&
    policy &&
    account &&
    (recovery || (meetsMinimum && hasEnoughBalance)) &&
    (recovery || needsNewDestination || eligibleDestination),
  );

  async function resetLogicalRequest() {
    if (!recovery || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    try {
      const resolved = await resolveWithdrawalLogicalRequest(
        ownerId,
        browserWithdrawalLogicalRequestStore(),
        recovery,
        "CANCEL",
      );
      if (resolved.state !== "CANCELLED") {
        setRecovery(resolved);
        setFeedback({ tone: "error", message: WITHDRAWAL_RECONCILIATION_COPY });
        return;
      }
      setRecovery(null);
      setAmount("");
      setFeedback(null);
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof WithdrawalLogicalSafetyError
            ? error.message
            : WITHDRAWAL_RECONCILIATION_COPY,
      });
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  function changeMethod(next: WithdrawalDestinationMethod) {
    setMethod(next);
    setAmount("");
    setFeedback(null);
    setRevealAddress(false);
    setUseNewDestination(false);
    setBankCode("");
    setNetwork("");
    setReauthRequired(false);
    setShowReauthPassword(false);
  }

  function chooseMinimum() {
    if (policy) {
      setAmount(atomicToInput(policy.minimumAmountAtomic));
    }
  }

  function chooseAll() {
    if (!account || !policy) return;
    const available = BigInt(account.availableBalanceAtomic);
    const fee = BigInt(policy.feeAtomic);
    if (available > fee) {
      setAmount(atomicToInput((available - fee).toString()));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !account || !amountAtomic || !canSubmit) {
      setFeedback({
        message: !meetsMinimum
          ? "최소 출금 금액을 확인해 주세요."
          : !hasEnoughBalance
            ? "수수료를 포함한 사용 가능 금액을 확인해 주세요."
            : protectedDestination && !eligibleDestination
              ? "등록한 목적지 보호 시간이 끝난 뒤 출금할 수 있어요."
              : "출금 정보를 다시 확인해 주세요.",
        tone: "error",
      });
      return;
    }

    if (submittingRef.current) {
      return;
    }

    const form = event.currentTarget;
    const requestStore = browserWithdrawalLogicalRequestStore();
    // The entire snapshot precedes pending, disabled controls and the first await.
    const snapshot = snapshotWithdrawalInput(form, {
      method,
      amountKrw: amountAtomic,
      policyId: recovery?.policyId ?? policy.id,
      policyVersion: recovery?.policyVersion ?? policy.version,
      destinationId:
        recovery?.destinationId ??
        (!needsNewDestination ? (eligibleDestination?.id ?? null) : null),
    });
    const passwordField = form.elements.namedItem(
      "destinationReauthPassword",
    ) as HTMLInputElement | null;
    const totpField = form.elements.namedItem(
      "destinationReauthTotp",
    ) as HTMLInputElement | null;
    const destinationReauth = needsReauth
      ? {
          password: passwordField?.value ?? "",
          ...(totpField?.value ? { totpCode: totpField.value } : {}),
        }
      : undefined;
    // Clear credentials immediately; do not keep them in React state or storage.
    if (passwordField) passwordField.value = "";
    if (totpField) totpField.value = "";
    submittingRef.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const resolved = await submitWithdrawalLogicalRequest({
        ownerId,
        store: requestStore,
        snapshot,
        legacyPresent: legacyPresent(),
        knownKey: recovery?.key ?? null,
        onRecord: setRecovery,
        destinationReauth,
      });
      if (resolved.state !== "CONFIRMED" && resolved.state !== "CANCELLED")
        throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
      setRecovery(null);

      setFeedback({
        message:
          resolved.state === "CANCELLED"
            ? "계좌·주소를 변경했어요. 보호 시간이 끝난 뒤 출금할 수 있어요."
            : "출금 요청을 접수했어요. 사용 가능 금액에서 보류되며, 아래에서 상태를 확인할 수 있어요.",
        tone: "success",
      });
      setAmount("");
      form.reset();
      setRevealAddress(false);
      setUseNewDestination(false);
      setBankCode("");
      setNetwork("");
      setReauthRequired(false);
      setShowReauthPassword(false);
      if (resolved.state === "CONFIRMED")
        void trackAnalyticsEvent("withdrawal_start", { currency: "KRW" }).catch(
          () => undefined,
        );
      router.refresh();
    } catch (error) {
      const candidate =
        error instanceof Error
          ? error.message
          : MEMBER_WITHDRAWAL_NETWORK_FALLBACK;
      setFeedback({
        message:
          error instanceof WithdrawalLogicalSafetyError ||
          isMemberFacingWithdrawalCopy(candidate)
            ? candidate
            : MEMBER_WITHDRAWAL_NETWORK_FALLBACK,
        tone: "error",
      });
      if (
        error instanceof Error &&
        error.message === "비밀번호를 다시 확인해 주세요."
      )
        setReauthRequired(true);
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  if (!policies.length || !account) {
    return null;
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <header className={styles.stepHeader}>
        <span className={styles.stepNumber}>01</span>
        <div>
          <h2>출금 방법과 금액</h2>
          <p>사용 가능한 원화에서만 출금할 수 있어요.</p>
        </div>
      </header>

      <fieldset>
        <legend className={styles.assetLegend}>출금 방법</legend>
        <div className={styles.segmented}>
          {policies.map((candidate) => (
            <label key={candidate.id}>
              <input
                type="radio"
                name="withdrawalMethod"
                value={candidate.method}
                checked={method === candidate.method}
                onChange={() => changeMethod(candidate.method)}
                disabled={pending || lockIntent}
              />
              <span>
                {destinationMethodLabel(candidate.method)}
                <small>{destinationMethodHint(candidate.method)}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <dl className={styles.policySummary} aria-label="현재 출금 조건">
        <div>
          <dt>사용 가능</dt>
          <dd>{formatAtomicAmount(account.availableBalanceAtomic, "KRW")}</dd>
        </div>
        <div>
          <dt>출금 보류</dt>
          <dd>{formatAtomicAmount(account.heldBalanceAtomic, "KRW")}</dd>
        </div>
        <div>
          <dt>최소 · 수수료</dt>
          <dd>
            {policy
              ? `${formatAtomicAmount(policy.minimumAmountAtomic, "KRW")} · ${formatAtomicAmount(policy.feeAtomic, "KRW")}`
              : "—"}
          </dd>
        </div>
      </dl>

      <label className={styles.fieldGroup} htmlFor="withdrawal-amount">
        <span>출금 금액 (원)</span>
        <span className={styles.amountField}>
          <input
            id="withdrawal-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) =>
              setAmount(event.target.value.replace(/[^0-9]/g, ""))
            }
            aria-invalid={Boolean(
              !recovery &&
              amount &&
              (!amountAtomic || !meetsMinimum || !hasEnoughBalance),
            )}
            aria-describedby="withdrawal-amount-help"
            disabled={pending || lockIntent}
            required
          />
          <strong className={styles.currencySuffix}>원</strong>
        </span>
      </label>

      <div className={styles.quickAmounts} aria-label="빠른 금액 선택">
        <button
          type="button"
          onClick={chooseMinimum}
          disabled={pending || lockIntent}
        >
          최소 금액
        </button>
        <button
          type="button"
          onClick={() => setAmount("5000")}
          disabled={pending || lockIntent}
        >
          5천원
        </button>
        <button
          type="button"
          onClick={() => setAmount("10000")}
          disabled={pending || lockIntent}
        >
          1만원
        </button>
        <button
          type="button"
          onClick={chooseAll}
          disabled={pending || lockIntent}
        >
          전액
        </button>
      </div>

      <header className={styles.stepHeader}>
        <span className={styles.stepNumber}>02</span>
        <div>
          <h2>{method === "KRW_BANK" ? "받을 계좌" : "받을 USDT 주소"}</h2>
          <p>
            {method === "KRW_BANK"
              ? "본인 명의 계좌만 사용할 수 있어요."
              : "주소는 평소 일부만 보이고, 확인 시에만 전체를 열어 주세요."}
          </p>
        </div>
      </header>

      {eligibleDestination && !useNewDestination ? (
        <div className={styles.formNotice}>
          <PutdukIcon name="shield" size={19} />
          <div className={styles.formNoticeBody}>
            등록된 목적지: {eligibleDestination.displayHint}
            <button
              type="button"
              className={styles.inlineReveal}
              onClick={() => setUseNewDestination(true)}
              disabled={pending || lockIntent}
            >
              다른 목적지로 변경
            </button>
          </div>
        </div>
      ) : null}

      {needsReauth ? (
        <section
          aria-labelledby="destination-reauth-heading"
          className={styles.destinationGrid}
        >
          <div className={styles.wideField}>
            <h3 id="destination-reauth-heading">변경 전 비밀번호 확인</h3>
            <p id="destination-reauth-help">
              계좌·주소를 바꾸면 24시간 보호 시간이 적용돼요.
            </p>
          </div>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>현재 비밀번호</span>
            <input
              name="destinationReauthPassword"
              type={showReauthPassword ? "text" : "password"}
              autoComplete="current-password"
              maxLength={1024}
              required
              disabled={pending}
              aria-describedby="destination-reauth-help"
            />
            <button
              type="button"
              className={styles.inlineReveal}
              disabled={pending}
              onClick={() => setShowReauthPassword((value) => !value)}
              aria-pressed={showReauthPassword}
            >
              {showReauthPassword ? "비밀번호 가리기" : "비밀번호 보기"}
            </button>
          </label>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>인증 앱 코드 (설정한 경우)</span>
            <input
              name="destinationReauthTotp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              disabled={pending}
            />
          </label>
        </section>
      ) : null}

      {protectedDestination && !eligibleDestination && !useNewDestination ? (
        <div className={styles.formNotice}>
          <PutdukIcon name="shield" size={19} />
          <p>
            방금 변경한 목적지는 보호 시간이 끝난 뒤 출금할 수 있어요. (
            {protectedDestination.displayHint})
          </p>
        </div>
      ) : null}

      {needsNewDestination ? (
        method === "KRW_BANK" ? (
          <div className={styles.destinationGrid}>
            <label className={styles.field}>
              <span>은행</span>
              <select
                name="bankCode"
                required
                value={bankCode}
                onChange={(event) => setBankCode(event.target.value)}
                disabled={pending}
              >
                <option value="" disabled>
                  은행 선택
                </option>
                {policy?.allowedDestinations.map((bankCode) => (
                  <option value={bankCode} key={bankCode}>
                    {bankNames[bankCode] ?? bankCode}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>예금주</span>
              <input
                name="accountHolder"
                maxLength={60}
                autoComplete="name"
                disabled={pending}
                required
              />
            </label>
            <label className={`${styles.field} ${styles.wideField}`}>
              <span>계좌번호</span>
              <input
                name="accountNumber"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9-]{6,32}"
                placeholder="숫자만 입력"
                disabled={pending}
                required
              />
            </label>
          </div>
        ) : (
          <div className={styles.destinationGrid}>
            <label className={styles.field}>
              <span>네트워크</span>
              <select
                name="network"
                required
                value={network}
                onChange={(event) => setNetwork(event.target.value)}
                disabled={pending}
              >
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
            <label className={`${styles.field} ${styles.wideField}`}>
              <span>받을 주소</span>
              <input
                name="address"
                minLength={20}
                maxLength={128}
                autoComplete="off"
                type={revealAddress ? "text" : "password"}
                disabled={pending}
                required
              />
              <button
                type="button"
                className={styles.inlineReveal}
                onClick={() => setRevealAddress((value) => !value)}
                disabled={pending}
              >
                {revealAddress ? "주소 가리기" : "확인 시 전체 보기"}
              </button>
            </label>
          </div>
        )
      ) : null}

      <dl className={styles.summaryList} aria-label="출금 요청 요약">
        <div>
          <dt>출금 금액</dt>
          <dd>
            {amountAtomic ? formatAtomicAmount(amountAtomic, "KRW") : "—"}
          </dd>
        </div>
        <div>
          <dt>수수료</dt>
          <dd>{policy ? formatAtomicAmount(policy.feeAtomic, "KRW") : "—"}</dd>
        </div>
        <div>
          <dt>총 차감 예정</dt>
          <dd>{totalAtomic ? formatAtomicAmount(totalAtomic, "KRW") : "—"}</dd>
        </div>
      </dl>

      <div className={styles.formNotice} id="withdrawal-amount-help">
        <PutdukIcon name="shield" size={19} />
        <p>
          요청한 금액이 사용 가능에서 보류로 옮겨집니다. USDT 주소 출금도 KRW
          기준이며, USDT를 따로 보관하지 않습니다.
        </p>
      </div>

      <button
        className={`button button--primary ${styles.submitButton}`}
        type="submit"
        disabled={pending || !canSubmit}
      >
        {needsReauth
          ? pending
            ? "변경 확인 중"
            : "변경 확인"
          : pending
            ? "출금 요청 접수 중"
            : "출금 요청하기"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>

      {recovery ? (
        <div className={styles.formNotice}>
          <p>
            이전 요청을 확인하고 있어요. 다시 보내도 같은 요청으로 처리돼요.
          </p>
          {!recovery.withdrawalId ? (
            <button
              type="button"
              onClick={resetLogicalRequest}
              disabled={pending}
            >
              입력 다시하기
            </button>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <p
          id="withdrawal-request-feedback"
          className={`${styles.feedback} ${
            feedback.tone === "success"
              ? styles.feedbackSuccess
              : styles.feedbackError
          }`}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
