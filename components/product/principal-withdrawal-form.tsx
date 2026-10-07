"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/principal-recovery.module.css";
import { PrincipalMoney } from "@/components/product/principal-money";
import {
  isMemberFacingWithdrawalCopy,
  MEMBER_WITHDRAWAL_NETWORK_FALLBACK,
} from "@/components/product/member-withdrawal-errors";
import {
  formatAtomicAmount,
  parseDisplayAmount,
} from "@/domain/wallet/format-amount";
import {
  browserWithdrawalLogicalRequestStore,
  LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY,
  WithdrawalLogicalSafetyError,
  WITHDRAWAL_RECONCILIATION_COPY,
} from "@/lib/wallet/withdrawal-logical-request";
import {
  recoverWithdrawalLogicalRecord,
  resolveWithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-recovery";
import { submitPrincipalWithdrawal } from "@/lib/wallet/principal-withdrawal-client";
import {
  parsePrincipalWithdrawalRead,
  type PrincipalWithdrawalRead,
} from "@/lib/wallet/principal-withdrawal-read";
import type { WithdrawalLogicalRecord } from "@/lib/wallet/withdrawal-logical-record";

function legacyPresent() {
  try {
    return (
      localStorage.getItem(LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY) !==
        null ||
      sessionStorage.getItem(LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY) !==
        null
    );
  } catch {
    throw new WithdrawalLogicalSafetyError("STORAGE_UNAVAILABLE");
  }
}
function message(error: unknown) {
  if (error instanceof WithdrawalLogicalSafetyError) return error.message;
  return error instanceof Error && isMemberFacingWithdrawalCopy(error.message)
    ? error.message
    : MEMBER_WITHDRAWAL_NETWORK_FALLBACK;
}
const terminal = (record: WithdrawalLogicalRecord) =>
  ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(record.state);

/** An explicit principal action; mount/reconnect is read-only and never submits a hold. */
export function PrincipalWithdrawalForm({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const pointer = useRef<string | null>(null);
  const [read, setRead] = useState<PrincipalWithdrawalRead | null>(null);
  const [record, setRecord] = useState<WithdrawalLogicalRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [amount, setAmount] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [consent, setConsent] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshFacts = useCallback(async () => {
    const response = await fetch("/api/v1/withdrawals/intents?principal=1", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    const principal =
      body &&
      typeof body === "object" &&
      "data" in body &&
      body.data &&
      typeof body.data === "object" &&
      "principal" in body.data
        ? body.data.principal
        : null;
    const parsed = parsePrincipalWithdrawalRead(principal, ownerId);
    if (!response.ok || !parsed)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    return parsed;
  }, [ownerId]);
  const acceptRecovery = useCallback((next: WithdrawalLogicalRecord | null) => {
    if (next) pointer.current = next.key;
    setRecord(next && !terminal(next) ? next : null);
    if (next?.v === 3 && !terminal(next)) {
      setAmount(next.amountKrw);
      setDestinationId(next.destinationId!);
      setConsent(false);
    }
    if (next?.state === "CONFIRMED")
      setFeedback(
        next.v === 3
          ? "이전 원금 회수 요청을 확인했어요. 아래 처리 상태를 확인해 주세요."
          : "이전 출금 요청을 확인했어요. 아래 처리 상태를 확인해 주세요.",
      );
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const recovered = await recoverWithdrawalLogicalRecord(
          ownerId,
          browserWithdrawalLogicalRequestStore(),
          fetch,
          legacyPresent(),
        );
        if (!live) return;
        acceptRecovery(recovered);
        setReady(true);
        const facts = await refreshFacts();
        if (!live) return;
        setRead(facts);
        if (!recovered && facts.available)
          setDestinationId(facts.destinations[0]?.id ?? "");
        setReady(true);
      } catch (error) {
        if (live) setFeedback(message(error));
      }
    })();
    return () => {
      live = false;
    };
  }, [ownerId, acceptRecovery, refreshFacts]);

  let atomic: string | null = null;
  try {
    atomic = amount ? parseDisplayAmount(amount, "KRW") : null;
  } catch {
    atomic = null;
  }
  const facts = read?.available ? read : null;
  const anyPrincipalPending = record?.v === 3 ? record : null;
  const principalPending =
    record?.v === 3 && record.method === "KRW_BANK" ? record : null;
  const otherPrincipalPending = record?.v === 3 && record.method !== "KRW_BANK";
  const ordinaryPending = record?.v === 2;
  const freshValid = Boolean(
    facts &&
    atomic &&
    destinationId &&
    facts.destinations.some((d) => d.id === destinationId) &&
    BigInt(atomic) >= BigInt(facts.policy.minimumAmountKrw) &&
    BigInt(atomic) <= BigInt(facts.eligiblePrincipalKrw) &&
    BigInt(atomic) <= BigInt(facts.walletAvailableKrw),
  );
  const canSubmit =
    ready &&
    consent &&
    !ordinaryPending &&
    !otherPrincipalPending &&
    (Boolean(principalPending) || freshValid);

  async function checkPrevious() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const recovered = await recoverWithdrawalLogicalRecord(
        ownerId,
        browserWithdrawalLogicalRequestStore(),
        fetch,
        legacyPresent(),
        pointer.current,
      );
      acceptRecovery(recovered);
      setReady(true);
      setRead(await refreshFacts());
      if (!recovered) {
        pointer.current = null;
        setFeedback("확인을 마쳤어요. 현재 조건을 확인한 뒤 요청해 주세요.");
      }
    } catch (error) {
      setFeedback(message(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function cancelUnsubmitted() {
    if (!anyPrincipalPending || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const resolved = await resolveWithdrawalLogicalRecord(
        ownerId,
        browserWithdrawalLogicalRequestStore(),
        anyPrincipalPending,
        "CANCEL",
      );
      acceptRecovery(resolved);
      if (resolved.state !== "CANCELLED") {
        setFeedback(WITHDRAWAL_RECONCILIATION_COPY);
        return;
      }
      pointer.current = null;
      setAmount("");
      setConsent(false);
      setRead(await refreshFacts());
      setFeedback(
        "접수 전 요청을 정리했어요. 이미 접수된 출금은 처리 상태에서 확인해 주세요.",
      );
      router.refresh();
    } catch (error) {
      setFeedback(message(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || busy.current || !atomic || (!principalPending && !facts))
      return;
    // Capture explicit consent and the complete tuple synchronously before await.
    const snapshot = Object.freeze({
      method: "KRW_BANK" as const,
      amountKrw: principalPending?.amountKrw ?? atomic,
      policyId: principalPending?.policyId ?? facts!.policy.id,
      policyVersion: principalPending?.policyVersion ?? facts!.policy.version,
      destinationId: principalPending?.destinationId ?? destinationId,
      destination: null,
      confirmation: Object.freeze({
        version: 1 as const,
        source: "PRINCIPAL" as const,
        confirmed: true as const,
      }),
    });
    busy.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const resolved = await submitPrincipalWithdrawal({
        ownerId,
        store: browserWithdrawalLogicalRequestStore(),
        snapshot,
        knownKey: principalPending?.key ?? null,
        legacyPresent: legacyPresent(),
        onRecord: (next) => {
          pointer.current = next.key;
          setRecord(next);
        },
      });
      acceptRecovery(resolved);
      if (resolved.state !== "CONFIRMED")
        throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
      pointer.current = null;
      setAmount("");
      setConsent(false);
      setFeedback(
        "원금 회수 요청을 접수했어요. 보류된 원금의 유지기간은 잠시 멈추며, 아래에서 처리 상태를 확인할 수 있어요.",
      );
      router.refresh();
    } catch (error) {
      setFeedback(message(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="principal-withdrawal-heading"
      className={styles.panel}
    >
      <header className={styles.header}>
        <span className={styles.methodIcon} aria-hidden="true">
          <PutdukIcon name="wallet" size={24} />
        </span>
        <div>
          <p className={styles.eyebrow}>은행 계좌</p>
          <h2 id="principal-withdrawal-heading">원금 회수</h2>
          <p className={styles.description}>
            입금한 원금에서 회수할 금액을 확인해 주세요.
          </p>
        </div>
      </header>
      {facts ? (
        <>
          <dl
            className={styles.facts}
            aria-label="서버에서 확인한 현재 원금 정보"
          >
            <div>
              <dt>현재 인정 원금</dt>
              <dd>
                <PrincipalMoney atomic={facts.eligiblePrincipalKrw} />
              </dd>
            </div>
            <div>
              <dt>보류 중 원금</dt>
              <dd>
                <PrincipalMoney atomic={facts.heldPrincipalKrw} />
              </dd>
            </div>
            <div>
              <dt>지갑 사용 가능</dt>
              <dd>
                <PrincipalMoney atomic={facts.walletAvailableKrw} />
              </dd>
            </div>
          </dl>
          <p className={styles.freshness}>
            조회 시각:{" "}
            {new Date(facts.evaluatedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
            . 요청할 때 회수 조건을 다시 확인해요.
          </p>
        </>
      ) : (
        <p className={styles.notice} role="status">
          {read === null && !feedback
            ? "원금 정보를 확인하고 있어요…"
            : "현재 원금 회수 조건을 확인하지 못했어요. 이전 요청 확인은 계속 이용할 수 있어요."}
        </p>
      )}
      {otherPrincipalPending ? (
        <p className={styles.notice} role="status">
          이전 원금 회수 요청의 수단이 은행 계좌와 달라요. 이전 요청 확인을
          이용해 주세요.
        </p>
      ) : null}
      {ordinaryPending ? (
        <p className={styles.notice} role="status">
          채굴 수익 출금의 이전 요청을 먼저 위에서 확인해 주세요.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate className={styles.form}>
        <div className={styles.step}>
          <span aria-hidden="true">01</span>
          <h3>금액과 받을 곳</h3>
        </div>
        <div className={styles.field}>
          <label htmlFor="principal-withdrawal-amount">회수할 원금 (원)</label>
          <span className={styles.amountControl}>
            <input
              id="principal-withdrawal-amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              required
              disabled={pending || Boolean(record)}
              placeholder="0"
            />
            <span aria-hidden="true">원</span>
          </span>
        </div>
        <label
          className={styles.field}
          htmlFor="principal-withdrawal-destination"
        >
          <span>본인 명의 은행 계좌</span>
          <select
            id="principal-withdrawal-destination"
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            disabled={pending || Boolean(record)}
            required
          >
            <option value="">확인된 계좌 선택</option>
            {facts?.destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayHint}
              </option>
            ))}
            {principalPending &&
            !facts?.destinations.some(
              (d) => d.id === principalPending.destinationId,
            ) ? (
              <option value={principalPending.destinationId!}>
                이전 요청에 확인한 계좌
              </option>
            ) : null}
          </select>
        </label>
        {!principalPending && facts ? (
          <>
            <dl className={styles.policy}>
              <div>
                <dt>최소 회수 금액</dt>
                <dd>
                  {formatAtomicAmount(facts.policy.minimumAmountKrw, "KRW")}
                </dd>
              </div>
              <div>
                <dt>수수료</dt>
                <dd>{formatAtomicAmount(facts.policy.feeKrw, "KRW")}</dd>
              </div>
            </dl>
            <p className={styles.hint}>
              새 계좌는 위의 출금 영역에서 등록해 주세요. 본인 확인과 보호
              시간이 끝나야 사용할 수 있어요.
            </p>
          </>
        ) : null}
        <div className={styles.step}>
          <span aria-hidden="true">02</span>
          <h3>원금 회수 확인</h3>
        </div>
        <label className={styles.consent}>
          <input
            type="checkbox"
            aria-label="원금 회수임을 확인하고 요청합니다."
            checked={consent}
            disabled={pending || ordinaryPending || otherPrincipalPending}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            <strong>원금 회수로 요청합니다</strong>
            <small>
              보류한 금액의 유지기간만 멈춰요. 이전 기간은 보존해요. 취소하면
              다시 누적돼요. 보류 기간은 혜택 계산에 더하지 않아요.
            </small>
          </span>
        </label>
        <div className={styles.actions}>
          <button
            type="submit"
            className="button button--primary"
            disabled={pending || !canSubmit}
          >
            {pending
              ? "확인 중…"
              : principalPending
                ? "같은 원금 회수 요청 다시 확인"
                : "원금 회수 확인 후 요청"}
          </button>
          {anyPrincipalPending ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={pending}
              onClick={() => void cancelUnsubmitted()}
            >
              접수 전 요청 정리
            </button>
          ) : null}
          <button
            type="button"
            className="button button--secondary"
            disabled={pending}
            onClick={() => void checkPrevious()}
          >
            이전 요청 확인
          </button>
        </div>
      </form>
      {feedback ? (
        <p className={styles.feedback} role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
