export const LEDGER_ENTRY_TYPES = [
  "DEPOSIT",
  "WITHDRAWAL",
  "MINING_REWARD",
  "EVENT_REWARD",
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
