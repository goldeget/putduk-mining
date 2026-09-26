import { describe, expect, it } from "vitest";

import { calculateLedgerBalance } from "@/domain/wallet/ledger";

describe("calculateLedgerBalance", () => {
  it("derives balance from immutable credit and debit entries", () => {
    const balance = calculateLedgerBalance([
      {
        amountAtomic: 50_000n,
        direction: "CREDIT",
        entryType: "DEPOSIT",
        idempotencyKey: "deposit:1",
      },
      {
        amountAtomic: 12_000n,
        direction: "DEBIT",
        entryType: "WITHDRAWAL",
        idempotencyKey: "withdrawal:1",
      },
      {
        amountAtomic: 3_000n,
        direction: "CREDIT",
        entryType: "MINING_REWARD",
        idempotencyKey: "settlement:1",
      },
    ]);

    expect(balance).toBe(41_000n);
  });

  it("rejects duplicated idempotency keys", () => {
    const duplicated = {
      amountAtomic: 1_000n,
      direction: "CREDIT" as const,
      entryType: "DEPOSIT" as const,
      idempotencyKey: "same-operation",
    };

    expect(() => calculateLedgerBalance([duplicated, duplicated])).toThrow(
      /duplicate/i,
    );
  });
});
