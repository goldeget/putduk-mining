export const LEDGER_SIDES = ["DEBIT", "CREDIT"] as const;

export type BalancedLedgerSide = (typeof LEDGER_SIDES)[number];

export type BalancedLedgerLine = {
  accountId: string;
  amountAtomic: bigint;
  currency: string;
  memo?: string;
  side: BalancedLedgerSide;
};

export type BalancedLedgerTotals = {
  creditAtomic: bigint;
  debitAtomic: bigint;
};

export type BalancedLedgerTransaction = {
  correlationId: string;
  currency: string;
  idempotencyKey: string;
  lines: readonly BalancedLedgerLine[];
  reference: string;
};

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

export function calculateBalancedLedgerTotals(
  lines: readonly BalancedLedgerLine[],
): BalancedLedgerTotals {
  return lines.reduce<BalancedLedgerTotals>(
    (totals, line) => {
      if (line.amountAtomic <= 0n) {
        throw new RangeError("Ledger line amounts must be positive.");
      }

      return line.side === "DEBIT"
        ? { ...totals, debitAtomic: totals.debitAtomic + line.amountAtomic }
        : { ...totals, creditAtomic: totals.creditAtomic + line.amountAtomic };
    },
    { creditAtomic: 0n, debitAtomic: 0n },
  );
}

export function validateBalancedLedgerTransaction(
  transaction: BalancedLedgerTransaction,
): BalancedLedgerTotals {
  requireIdentifier(transaction.correlationId, "correlationId");
  requireIdentifier(transaction.currency, "currency");
  requireIdentifier(transaction.idempotencyKey, "idempotencyKey");
  requireIdentifier(transaction.reference, "reference");

  if (transaction.lines.length < 2) {
    throw new Error("A balanced transaction requires at least two lines.");
  }

  for (const line of transaction.lines) {
    requireIdentifier(line.accountId, "accountId");
    if (line.currency !== transaction.currency) {
      throw new Error("Every ledger line must use the transaction currency.");
    }
  }

  const totals = calculateBalancedLedgerTotals(transaction.lines);
  if (totals.debitAtomic !== totals.creditAtomic) {
    throw new Error(
      `Unbalanced ledger transaction: debit=${totals.debitAtomic} credit=${totals.creditAtomic}.`,
    );
  }

  return totals;
}
