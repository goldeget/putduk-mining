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

export type KrwDepositJournalInput = {
  approvalAmountAtomic: bigint;
  cashAccountId: string;
  correlationId: string;
  currency: string;
  idempotencyKey: string;
  liabilityAccountId: string;
  reference: string;
};

/**
 * 원화 입금 승인액으로 균형 분개를 만든다.
 * 차변은 운영 현금, 대변은 회원 부채다. 요청액과 승인액의 차이는 여기서 정책으로 만들지 않는다.
 */
export function buildKrwDepositJournal(
  input: KrwDepositJournalInput,
): BalancedLedgerTransaction {
  if (input.currency !== "KRW") {
    throw new Error("KRW deposit journal currency must be KRW.");
  }
  if (typeof input.approvalAmountAtomic !== "bigint") {
    throw new TypeError("approvalAmountAtomic must be a bigint.");
  }

  const transaction: BalancedLedgerTransaction = {
    correlationId: input.correlationId,
    currency: "KRW",
    idempotencyKey: input.idempotencyKey,
    lines: [
      {
        accountId: input.cashAccountId,
        amountAtomic: input.approvalAmountAtomic,
        currency: "KRW",
        side: "DEBIT",
      },
      {
        accountId: input.liabilityAccountId,
        amountAtomic: input.approvalAmountAtomic,
        currency: "KRW",
        side: "CREDIT",
      },
    ],
    reference: input.reference,
  };

  validateBalancedLedgerTransaction(transaction);
  return transaction;
}

/**
 * 출금 hold 중에는 부채 순액이 지갑 총잔액보다 작다.
 * 총잔액과 부채를 그대로 같게 보면 오탐이므로, 열린 hold를 더한 값과 비교한다.
 */
export function krwWalletMatchesLiabilityPlusOpenHold(input: {
  liabilityNetAtomic: bigint;
  openHoldAtomic: bigint;
  walletTotalAtomic: bigint;
}): boolean {
  if (input.openHoldAtomic < 0n) {
    throw new RangeError("Open hold must be zero or positive.");
  }

  return (
    input.liabilityNetAtomic + input.openHoldAtomic === input.walletTotalAtomic
  );
}
