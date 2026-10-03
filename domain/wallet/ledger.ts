export const LEDGER_ENTRY_TYPES = [
  "DEPOSIT",
  "WITHDRAWAL",
  "MINING_REWARD",
  "EVENT_REWARD",
  "TRIAL_REWARD_CONVERSION",
  "WELCOME_REWARD",
  "FUNDING_PROMO_REWARD",
  "REFERRAL_REWARD",
  "UPGRADE_COST",
  "REFUND",
  "REVERSAL",
  "ADMIN_ADJUSTMENT",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
export type LedgerDirection = "CREDIT" | "DEBIT";

export type LedgerEntry = {
  amountAtomic: bigint;
  direction: LedgerDirection;
  entryType: LedgerEntryType;
  idempotencyKey: string;
};

export function calculateLedgerBalance(
  entries: readonly LedgerEntry[],
): bigint {
  const idempotencyKeys = new Set<string>();

  return entries.reduce((balance, entry) => {
    if (entry.amountAtomic <= 0n) {
      throw new RangeError("Ledger entry amounts must be positive.");
    }
    if (!entry.idempotencyKey.trim()) {
      throw new Error("Every ledger entry requires an idempotency key.");
    }
    if (idempotencyKeys.has(entry.idempotencyKey)) {
      throw new Error(
        `Duplicate ledger idempotency key: ${entry.idempotencyKey}`,
      );
    }

    idempotencyKeys.add(entry.idempotencyKey);
    return entry.direction === "CREDIT"
      ? balance + entry.amountAtomic
      : balance - entry.amountAtomic;
  }, 0n);
}

/** 원화 입금 승인이 지갑 투영에 남기는 대변. 금액은 승인액이며 소수점을 받지 않는다. */
export function krwDepositProjectionCredit(input: {
  amountAtomic: bigint;
  idempotencyKey: string;
}): LedgerEntry {
  if (typeof input.amountAtomic !== "bigint" || input.amountAtomic <= 0n) {
    throw new RangeError(
      "KRW deposit projection amount must be a positive bigint.",
    );
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("KRW deposit projection requires an idempotency key.");
  }

  return {
    amountAtomic: input.amountAtomic,
    direction: "CREDIT",
    entryType: "DEPOSIT",
    idempotencyKey: input.idempotencyKey,
  };
}
