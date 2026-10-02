import { describe, expect, it } from "vitest";

import {
  buildKrwDepositJournal,
  krwWalletMatchesLiabilityPlusOpenHold,
} from "@/domain/wallet/balanced-ledger";
import { classifyApprovedDepositJournal } from "@/domain/wallet/deposit-read";
import { krwDepositProjectionCredit } from "@/domain/wallet/ledger";

describe("KRW deposit journal contract", () => {
  it("posts the approval amount as cash debit and member liability credit", () => {
    const journal = buildKrwDepositJournal({
      approvalAmountAtomic: 4_000n,
      cashAccountId: "cash",
      correlationId: "corr-deposit",
      currency: "KRW",
      idempotencyKey: "deposit-ledger-0001",
      liabilityAccountId: "liability",
      reference: "deposit-request-1",
    });

    expect(journal.lines).toEqual([
      {
        accountId: "cash",
        amountAtomic: 4_000n,
        currency: "KRW",
        side: "DEBIT",
      },
      {
        accountId: "liability",
        amountAtomic: 4_000n,
        currency: "KRW",
        side: "CREDIT",
      },
    ]);
    expect(krwDepositProjectionCredit({
      amountAtomic: 4_000n,
      idempotencyKey: "deposit-ledger-0001",
    })).toEqual({
      amountAtomic: 4_000n,
      direction: "CREDIT",
      entryType: "DEPOSIT",
      idempotencyKey: "deposit-ledger-0001",
    });
  });

  it("rejects a non-KRW currency and a non-bigint amount", () => {
    expect(() =>
      buildKrwDepositJournal({
        approvalAmountAtomic: 1_000n,
        cashAccountId: "cash",
        correlationId: "corr-deposit",
        currency: "USDT",
        idempotencyKey: "deposit-ledger-0002",
        liabilityAccountId: "liability",
        reference: "deposit-request-2",
      }),
    ).toThrow(/KRW/);

    expect(() =>
      buildKrwDepositJournal({
        approvalAmountAtomic: 1000 as unknown as bigint,
        cashAccountId: "cash",
        correlationId: "corr-deposit",
        currency: "KRW",
        idempotencyKey: "deposit-ledger-0003",
        liabilityAccountId: "liability",
        reference: "deposit-request-3",
      }),
    ).toThrow(TypeError);
  });

  it("does not treat liability net as the wallet total while a withdrawal is held", () => {
    const liabilityNetAtomic = 80_000n;
    const openHoldAtomic = 20_000n;
    const walletTotalAtomic = 100_000n;

    expect(liabilityNetAtomic === walletTotalAtomic).toBe(false);
    expect(
      krwWalletMatchesLiabilityPlusOpenHold({
        liabilityNetAtomic,
        openHoldAtomic,
        walletTotalAtomic,
      }),
    ).toBe(true);
    expect(
      krwWalletMatchesLiabilityPlusOpenHold({
        liabilityNetAtomic: 80_000n,
        openHoldAtomic: 0n,
        walletTotalAtomic: 80_000n,
      }),
    ).toBe(true);
  });
});

describe("approved deposit journal read", () => {
  it("matches only when debit, credit and projection equal the approval amount", () => {
    expect(
      classifyApprovedDepositJournal({
        approvedAmountAtomic: "4000",
        currency: "KRW",
        journalCreditAtomic: "4000",
        journalDebitAtomic: "4000",
        projectionCreditAtomic: "4000",
        status: "APPROVED",
      }),
    ).toBe("matched");
    expect(
      classifyApprovedDepositJournal({
        approvedAmountAtomic: null,
        currency: "KRW",
        journalCreditAtomic: null,
        journalDebitAtomic: null,
        projectionCreditAtomic: "7000",
        status: "APPROVED",
      }),
    ).toBe("missing");
    expect(
      classifyApprovedDepositJournal({
        approvedAmountAtomic: "4000",
        currency: "KRW",
        journalCreditAtomic: "10000",
        journalDebitAtomic: "10000",
        projectionCreditAtomic: "10000",
        status: "APPROVED",
      }),
    ).toBe("mismatch");
    expect(
      classifyApprovedDepositJournal({
        approvedAmountAtomic: "4000",
        currency: "USDT",
        journalCreditAtomic: "4000",
        journalDebitAtomic: "4000",
        projectionCreditAtomic: "4000",
        status: "APPROVED",
      }),
    ).toBe("mismatch");
    expect(
      classifyApprovedDepositJournal({
        approvedAmountAtomic: "4000",
        currency: "KRW",
        journalCreditAtomic: "4000",
        journalDebitAtomic: "4000",
        projectionCreditAtomic: "4000",
        status: "AWAITING_TRANSFER",
      }),
    ).toBe("not_approved");
    expect(() =>
      classifyApprovedDepositJournal({
        approvedAmountAtomic: "4000.5",
        currency: "KRW",
        journalCreditAtomic: "4000",
        journalDebitAtomic: "4000",
        projectionCreditAtomic: "4000",
        status: "APPROVED",
      }),
    ).toThrow(TypeError);
  });
});
