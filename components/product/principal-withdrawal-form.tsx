"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import styles from "@/components/product/product-experience.module.css";
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
      className={styles.fundingPanel}
    >
      <header className={styles.stepHeader}>
        <div>
          <h2 id="principal-withdrawal-heading">원금 회수</h2>
          <p>
            채굴 수익 출금과 별도로, 입금한 원금에서 회수할 금액을 직접 확인해
            주세요.
          </p>
        </div>
      </header>
      {facts ? (
        <>
          <dl
            className={styles.policySummary}
            aria-label="서버에서 확인한 현재 원금 정보"
          >
            <div>
              <dt>현재 인정 원금</dt>
              <dd>{formatAtomicAmount(facts.eligiblePrincipalKrw, "KRW")}</dd>
            </div>
            <div>
              <dt>보류 중 원금</dt>
              <dd>{formatAtomicAmount(facts.heldPrincipalKrw, "KRW")}</dd>
            </div>
            <div>
              <dt>지갑 사용 가능</dt>
              <dd>{formatAtomicAmount(facts.walletAvailableKrw, "KRW")}</dd>
            </div>
          </dl>
          <p>
            조회 시각:{" "}
            {new Date(facts.evaluatedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
            . 조회값은 접수 보장이 아니며, 요청할 때 자격을 다시 확인해요.
          </p>
        </>
      ) : (
        <p role="status">
          현재 원금 회수 조건을 확인하지 못했어요. 이전 요청 확인은 계속 이용할
          수 있어요.
        </p>
      )}
      {otherPrincipalPending ? (
        <p role="status">
          이전 원금 회수 요청의 수단이 은행 계좌와 달라요. 이전 요청 확인을
          이용해 주세요.
        </p>
      ) : null}
      {ordinaryPending ? (
        <p role="status">
          채굴 수익 출금의 이전 요청을 먼저 위에서 확인해 주세요.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate className={styles.form}>
        <label
          className={styles.fieldGroup}
          htmlFor="principal-withdrawal-amount"
        >
          <span>회수할 원금 (원)</span>
          <input
            id="principal-withdrawal-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            required
            disabled={pending || Boolean(record)}
          />
        </label>
        <label
          className={styles.fieldGroup}
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
          <p>
            최소 {formatAtomicAmount(facts.policy.minimumAmountKrw, "KRW")} ·
            수수료 {formatAtomicAmount(facts.policy.feeKrw, "KRW")}. 새 계좌는
            위의 계좌 등록 절차에서 본인 확인과 보호 시간을 마친 뒤 사용할 수
            있어요.
          </p>
        ) : null}
        <label className={styles.fieldGroup}>
          <span>
            <input
              type="checkbox"
              checked={consent}
              disabled={pending || ordinaryPending || otherPrincipalPending}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            원금 회수임을 확인하고 요청합니다.
          </span>
          <small>
            회수 보류된 원금 부분의 유지기간만 멈춰요. 기존 적격 기간은
            보존되고, 취소로 보류가 해제되면 이후부터 다시 누적돼요. 보류 중
            기간은 소급해 더하지 않아요.
          </small>
        </label>
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
      </form>
      {feedback ? (
        <p className={styles.feedback} role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
