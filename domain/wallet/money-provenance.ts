import "server-only";

export const MONEY_SOURCES = [
  "PRINCIPAL",
  "MINING_REWARD",
  "BONUS",
  "OTHER_NON_PRINCIPAL",
] as const;
export type MoneySource = (typeof MONEY_SOURCES)[number];
export type CreditOrigin =
  | "KRW_DEPOSIT"
  | "USDT_KRW_DEPOSIT"
  | "PRINCIPAL_CORRECTION"
  | "MINING_REWARD"
  | "WELCOME_REWARD"
  | "SIGNUP_BONUS"
  | "EVENT_BONUS"
  | "FUNDING_PROMOTION"
  | "REFERRAL_REWARD"
  | "ADMIN_BONUS"
  | "CAMPAIGN_REWARD"
  | "OTHER_NON_PRINCIPAL";

const creditSources: Record<CreditOrigin, MoneySource> = {
  KRW_DEPOSIT: "PRINCIPAL",
  USDT_KRW_DEPOSIT: "PRINCIPAL",
  PRINCIPAL_CORRECTION: "PRINCIPAL",
  MINING_REWARD: "MINING_REWARD",
  WELCOME_REWARD: "BONUS",
  SIGNUP_BONUS: "BONUS",
  EVENT_BONUS: "BONUS",
  FUNDING_PROMOTION: "BONUS",
  REFERRAL_REWARD: "BONUS",
  ADMIN_BONUS: "BONUS",
  CAMPAIGN_REWARD: "BONUS",
  OTHER_NON_PRINCIPAL: "OTHER_NON_PRINCIPAL",
};
export function sourceForCredit(origin: CreditOrigin): MoneySource {
  if (!Object.hasOwn(creditSources, origin))
    throw new Error("MONEY_SOURCE_ORIGIN_UNKNOWN");
  return creditSources[origin];
}

type Receipt = {
  id: string;
  ledgerTransactionId: string;
  sourceEventId: string;
  source: MoneySource;
  amountAtomic: bigint;
  effectiveAt: Date;
  sequence: number;
};
export type MoneySourceMovement = Receipt &
  (
    | { kind: "CREDIT"; origin: CreditOrigin }
    | {
        kind: "RESERVE" | "RELEASE" | "FINALIZE";
        reservationId: string;
      }
    | { kind: "REVERSE"; originalMovementId: string }
  );

function nonblank(value: string) {
  return (
    typeof value === "string" && value.trim() !== "" && value === value.trim()
  );
}
const MAX_JOURNAL_ATOMIC = 9_223_372_036_854_775_807n;
const MAX_PROJECTION_ATOMIC = 10n ** 38n - 1n;

/** Arithmetic preflight for validated server receipts, never a money writer.
 * The current DB capture connects CREDIT only. Other kinds require the
 * source-aware transactional withdrawal/correction contracts before execution.
 */
export function projectMoneySources({
  movements,
  coverage,
  asOf,
}: {
  movements: readonly MoneySourceMovement[];
  coverage: "COMPLETE" | "UNRESOLVED";
  asOf: Date;
}) {
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("MONEY_SOURCE_TIME_INVALID");
  if (coverage !== "COMPLETE" && coverage !== "UNRESOLVED")
    throw new Error("MONEY_SOURCE_COVERAGE_REQUIRED");
  const ids = new Set<string>();
  const sequences = new Set<number>();
  const journals = new Set<string>();
  const events = new Set<string>();
  for (const move of movements) {
    if (
      !nonblank(move.id) ||
      !nonblank(move.ledgerTransactionId) ||
      !nonblank(move.sourceEventId) ||
      !Number.isFinite(move.effectiveAt.getTime()) ||
      !Number.isSafeInteger(move.sequence) ||
      move.sequence < 0 ||
      !MONEY_SOURCES.includes(move.source) ||
      typeof move.amountAtomic !== "bigint" ||
      move.amountAtomic <= 0n ||
      move.amountAtomic > MAX_JOURNAL_ATOMIC
    )
      throw new Error("MONEY_SOURCE_RECEIPT_INVALID");
    const journalKey = `${move.ledgerTransactionId}:${move.source}:${move.kind}`;
    const eventKey = `${move.sourceEventId}:${move.source}:${move.kind}`;
    if (
      ids.has(move.id) ||
      sequences.has(move.sequence) ||
      journals.has(journalKey) ||
      events.has(eventKey)
    )
      throw new Error("MONEY_SOURCE_DUPLICATE_RECEIPT");
    ids.add(move.id);
    sequences.add(move.sequence);
    journals.add(journalKey);
    events.add(eventKey);
    if (move.kind === "CREDIT") {
      if (sourceForCredit(move.origin) !== move.source)
        throw new Error("MONEY_SOURCE_CREDIT_MISMATCH");
    } else if (move.kind === "REVERSE") {
      if (!nonblank(move.originalMovementId))
        throw new Error("MONEY_SOURCE_ORIGINAL_REQUIRED");
    } else if (["RESERVE", "RELEASE", "FINALIZE"].includes(move.kind)) {
      if (!nonblank(move.reservationId))
        throw new Error("MONEY_SOURCE_RESERVATION_REQUIRED");
    } else throw new Error("MONEY_SOURCE_KIND_UNKNOWN");
  }
  const available: Record<MoneySource, bigint> = {
    PRINCIPAL: 0n,
    MINING_REWARD: 0n,
    BONUS: 0n,
    OTHER_NON_PRINCIPAL: 0n,
  };
  const held = { ...available };
  const reservations = new Map<string, { amount: bigint; resolved: boolean }>();
  const credits = new Map<
    string,
    { source: MoneySource; unreversed: bigint }
  >();
  let lifetimeKrwPrincipalDeposits = 0n;
  let lifetimeUsdtPrincipalCredits = 0n;
  let finalizedPrincipalDebits = 0n;
  const ordered = [...movements].sort((a, b) => a.sequence - b.sequence);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.effectiveAt < ordered[index - 1]!.effectiveAt)
      throw new Error("MONEY_SOURCE_TIME_ORDER_INVALID");
  }
  for (const move of ordered) {
    if (move.effectiveAt > asOf) continue;
    const { source, amountAtomic: amount } = move;
    if (move.kind === "CREDIT") {
      available[source] += amount;
      credits.set(move.id, { source, unreversed: amount });
      if (move.origin === "KRW_DEPOSIT") lifetimeKrwPrincipalDeposits += amount;
      if (move.origin === "USDT_KRW_DEPOSIT")
        lifetimeUsdtPrincipalCredits += amount;
    } else if (move.kind === "RESERVE") {
      const key = `${move.reservationId}:${source}`;
      if (reservations.has(key))
        throw new Error("MONEY_SOURCE_RESERVATION_DUPLICATE");
      if (available[source] < amount)
        throw new Error("MONEY_SOURCE_INSUFFICIENT");
      available[source] -= amount;
      held[source] += amount;
      reservations.set(key, { amount, resolved: false });
    } else if (move.kind === "RELEASE" || move.kind === "FINALIZE") {
      const reservation = reservations.get(`${move.reservationId}:${source}`);
      if (!reservation || reservation.resolved || reservation.amount !== amount)
        throw new Error("MONEY_SOURCE_RESERVATION_MISMATCH");
      reservation.resolved = true;
      held[source] -= amount;
      if (move.kind === "RELEASE") available[source] += amount;
      else if (source === "PRINCIPAL") finalizedPrincipalDebits += amount;
    } else if (move.kind === "REVERSE") {
      const original = credits.get(move.originalMovementId);
      if (
        !original ||
        original.source !== source ||
        original.unreversed < amount
      )
        throw new Error("MONEY_SOURCE_REVERSAL_MISMATCH");
      if (available[source] < amount)
        throw new Error("MONEY_SOURCE_INSUFFICIENT");
      original.unreversed -= amount;
      available[source] -= amount;
    } else throw new Error("MONEY_SOURCE_KIND_UNKNOWN");
    if (
      available[source] > MAX_PROJECTION_ATOMIC ||
      held[source] > MAX_PROJECTION_ATOMIC
    )
      throw new Error("MONEY_SOURCE_PROJECTION_RANGE");
  }
  return {
    coverage,
    eligibleFundingPrincipal:
      coverage === "COMPLETE" ? available.PRINCIPAL : null,
    available,
    held,
    lifetimeKrwPrincipalDeposits,
    lifetimeUsdtPrincipalCredits,
    finalizedPrincipalDebits,
  };
}
