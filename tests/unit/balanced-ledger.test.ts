import { describe, expect, it } from "vitest";

import { validateBalancedLedgerTransaction } from "@/domain/wallet/balanced-ledger";

const base = {
  correlationId: "corr-1",
  currency: "KRW",
  idempotencyKey: "welcome:user-1",
  reference: "trial-conversion:1",
};

describe("validateBalancedLedgerTransaction", () => {
  it("accepts a balanced multi-line transaction", () => {
    const totals = validateBalancedLedgerTransaction({
      ...base,
      lines: [
        {
          accountId: "platform-expense",
          amountAtomic: 5_000n,
          currency: "KRW",
          side: "DEBIT",
        },
        {
          accountId: "member-liability",
          amountAtomic: 5_000n,
          currency: "KRW",
          side: "CREDIT",
        },
      ],
    });

    expect(totals).toEqual({ creditAtomic: 5_000n, debitAtomic: 5_000n });
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      validateBalancedLedgerTransaction({
        ...base,
        lines: [
          {
            accountId: "platform-expense",
            amountAtomic: 4_999n,
            currency: "KRW",
            side: "DEBIT",
          },
          {
            accountId: "member-liability",
            amountAtomic: 5_000n,
            currency: "KRW",
            side: "CREDIT",
          },
        ],
      }),
    ).toThrow(/unbalanced/i);
  });

  it("rejects mixed currencies", () => {
    expect(() =>
      validateBalancedLedgerTransaction({
        ...base,
        lines: [
          {
            accountId: "one",
            amountAtomic: 1n,
            currency: "KRW",
            side: "DEBIT",
          },
          {
            accountId: "two",
            amountAtomic: 1n,
            currency: "POINT",
            side: "CREDIT",
          },
        ],
      }),
    ).toThrow(/currency/i);
  });
});
