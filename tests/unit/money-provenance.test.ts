import { describe, expect, it } from "vitest";

import {
  projectMoneySources,
  sourceForCredit,
  type CreditOrigin,
  type MoneySourceMovement,
} from "@/domain/wallet/money-provenance";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 3, 0, 0, seconds));
function credit(
  origin: CreditOrigin,
  amount: bigint,
  sequence: number,
): MoneySourceMovement {
  return {
    id: `credit-${sequence}`,
    ledgerTransactionId: `journal-${sequence}`,
    sourceEventId: `event-${sequence}`,
    sequence,
    effectiveAt: at(sequence),
    source: sourceForCredit(origin),
    kind: "CREDIT",
    origin,
    amountAtomic: amount,
  };
}
function withdrawal(
  kind: "RESERVE" | "RELEASE" | "FINALIZE",
  source: "PRINCIPAL" | "MINING_REWARD" | "BONUS",
  amount: bigint,
  sequence: number,
): MoneySourceMovement {
  return {
    id: `withdrawal-${sequence}`,
    ledgerTransactionId: `journal-${sequence}`,
    sourceEventId: `event-${sequence}`,
    sequence,
    effectiveAt: at(sequence),
    source,
    kind,
    amountAtomic: amount,
    reservationId: "withdrawal-request-one",
  };
}
const project = (movements: MoneySourceMovement[], time = at(59)) =>
  projectMoneySources({
    movements,
    asOf: time,
    coverage: "COMPLETE",
  });

describe("approved remaining principal preflight", () => {
  it.each<CreditOrigin>([
    "WELCOME_REWARD",
    "SIGNUP_BONUS",
    "EVENT_BONUS",
    "FUNDING_PROMOTION",
    "REFERRAL_REWARD",
    "ADMIN_BONUS",
    "CAMPAIGN_REWARD",
    "MINING_REWARD",
    "OTHER_NON_PRINCIPAL",
  ])("excludes %s from funding principal", (origin) => {
    expect(project([credit(origin, 5000n, 0)]).eligibleFundingPrincipal).toBe(
      0n,
    );
  });
  it("includes actual KRW, manual USDT-to-KRW and explicit principal correction separately", () => {
    const result = project([
      credit("KRW_DEPOSIT", 10000n, 0),
      credit("USDT_KRW_DEPOSIT", 20000n, 1),
      credit("PRINCIPAL_CORRECTION", 3000n, 2),
      credit("ADMIN_BONUS", 9000n, 3),
    ]);
    expect(result.eligibleFundingPrincipal).toBe(33000n);
    expect(result.lifetimeKrwPrincipalDeposits).toBe(10000n);
    expect(result.lifetimeUsdtPrincipalCredits).toBe(20000n);
    expect(result.available.BONUS).toBe(9000n);
  });
  it("a 90m principal recovery leaves 10m power basis and preserves 100m lifetime deposits", () => {
    const result = project([
      credit("KRW_DEPOSIT", 100000000n, 0),
      withdrawal("RESERVE", "PRINCIPAL", 90000000n, 1),
      withdrawal("FINALIZE", "PRINCIPAL", 90000000n, 2),
    ]);
    expect(result.eligibleFundingPrincipal).toBe(10000000n);
    expect(result.lifetimeKrwPrincipalDeposits).toBe(100000000n);
    expect(result.finalizedPrincipalDebits).toBe(90000000n);
    expect(result.held.PRINCIPAL).toBe(0n);
  });
  it("reward withdrawal never changes principal", () => {
    const result = project([
      credit("KRW_DEPOSIT", 10000n, 0),
      credit("MINING_REWARD", 2000n, 1),
      withdrawal("RESERVE", "MINING_REWARD", 2000n, 2),
      withdrawal("FINALIZE", "MINING_REWARD", 2000n, 3),
    ]);
    expect(result.eligibleFundingPrincipal).toBe(10000n);
    expect(result.available.MINING_REWARD).toBe(0n);
    expect(result.finalizedPrincipalDebits).toBe(0n);
  });
  it("principal reservation excludes held money immediately and release restores only prospectively", () => {
    const movements = [
      credit("KRW_DEPOSIT", 10000n, 0),
      withdrawal("RESERVE", "PRINCIPAL", 7000n, 1),
      withdrawal("RELEASE", "PRINCIPAL", 7000n, 2),
    ];
    expect(project(movements, at(0)).eligibleFundingPrincipal).toBe(10000n);
    expect(project(movements, at(1)).eligibleFundingPrincipal).toBe(3000n);
    expect(project(movements, at(1)).held.PRINCIPAL).toBe(7000n);
    expect(project(movements, at(2)).eligibleFundingPrincipal).toBe(10000n);
    expect(project(movements, at(2)).finalizedPrincipalDebits).toBe(0n);
  });
  it("unknown legacy coverage never returns a guessed principal", () => {
    const result = projectMoneySources({
      movements: [credit("KRW_DEPOSIT", 9000n, 0)],
      asOf: at(59),
      coverage: "UNRESOLVED",
    });
    expect(result.eligibleFundingPrincipal).toBeNull();
    expect(result.lifetimeKrwPrincipalDeposits).toBe(9000n);
  });
  it("keeps exact integer precision above Number.MAX_SAFE_INTEGER", () => {
    const amount = 9007199254740993n;
    expect(
      project([credit("KRW_DEPOSIT", amount, 0)]).eligibleFundingPrincipal,
    ).toBe(amount);
  });
  it("never silently spends principal when a reward source is short", () => {
    expect(() =>
      project([
        credit("KRW_DEPOSIT", 10000n, 0),
        withdrawal("RESERVE", "MINING_REWARD", 1n, 1),
      ]),
    ).toThrow("MONEY_SOURCE_INSUFFICIENT");
  });
  it("rejects a bonus relabelled as principal", () => {
    expect(() =>
      project([{ ...credit("WELCOME_REWARD", 5000n, 0), source: "PRINCIPAL" }]),
    ).toThrow("MONEY_SOURCE_CREDIT_MISMATCH");
  });
  it.each(["RELEASE", "FINALIZE"] as const)(
    "rejects %s without its original reservation",
    (kind) => {
      expect(() =>
        project([
          credit("KRW_DEPOSIT", 10000n, 0),
          withdrawal(kind, "PRINCIPAL", 100n, 1),
        ]),
      ).toThrow("MONEY_SOURCE_RESERVATION_MISMATCH");
    },
  );
  it("rejects a changed or repeated reservation resolution", () => {
    const base = [
      credit("KRW_DEPOSIT", 10000n, 0),
      withdrawal("RESERVE", "PRINCIPAL", 100n, 1),
    ];
    expect(() =>
      project([...base, withdrawal("FINALIZE", "PRINCIPAL", 99n, 2)]),
    ).toThrow("MONEY_SOURCE_RESERVATION_MISMATCH");
    expect(() =>
      project([
        ...base,
        withdrawal("RELEASE", "PRINCIPAL", 100n, 2),
        withdrawal("FINALIZE", "PRINCIPAL", 100n, 3),
      ]),
    ).toThrow("MONEY_SOURCE_RESERVATION_MISMATCH");
  });
  it("a principal reversal preserves historical deposit statistics and requires the original source", () => {
    const original = credit("KRW_DEPOSIT", 10000n, 0);
    const reverse: MoneySourceMovement = {
      id: "reverse",
      ledgerTransactionId: "journal-reverse",
      sourceEventId: "event-reverse",
      effectiveAt: at(1),
      sequence: 1,
      source: "PRINCIPAL",
      kind: "REVERSE",
      originalMovementId: original.id,
      amountAtomic: 2000n,
    };
    const result = project([original, reverse]);
    expect(result.eligibleFundingPrincipal).toBe(8000n);
    expect(result.lifetimeKrwPrincipalDeposits).toBe(10000n);
    expect(() => project([original, { ...reverse, source: "BONUS" }])).toThrow(
      "MONEY_SOURCE_REVERSAL_MISMATCH",
    );
    expect(() =>
      project([
        original,
        reverse,
        {
          ...reverse,
          id: "reverse-two",
          ledgerTransactionId: "journal-reverse-two",
          sourceEventId: "event-reverse-two",
          sequence: 2,
          effectiveAt: at(2),
          amountAtomic: 9000n,
        },
      ]),
    ).toThrow("MONEY_SOURCE_REVERSAL_MISMATCH");
  });
  it("rejects duplicate receipt identity and server ordering, including future data", () => {
    const original = credit("KRW_DEPOSIT", 10000n, 0);
    expect(() =>
      project([original, { ...credit("KRW_DEPOSIT", 1n, 1), id: original.id }]),
    ).toThrow("MONEY_SOURCE_DUPLICATE_RECEIPT");
    expect(() => project([original, credit("KRW_DEPOSIT", 1n, 0)])).toThrow(
      "MONEY_SOURCE_DUPLICATE_RECEIPT",
    );
    expect(() =>
      project([
        original,
        {
          ...credit("KRW_DEPOSIT", 1n, 1),
          ledgerTransactionId: original.ledgerTransactionId,
        },
      ]),
    ).toThrow("MONEY_SOURCE_DUPLICATE_RECEIPT");
    expect(() =>
      project([
        original,
        {
          ...credit("KRW_DEPOSIT", 1n, 1),
          sourceEventId: original.sourceEventId,
        },
      ]),
    ).toThrow("MONEY_SOURCE_DUPLICATE_RECEIPT");
    expect(() =>
      project([
        original,
        { ...credit("KRW_DEPOSIT", 1n, 1), effectiveAt: at(-1) },
      ]),
    ).toThrow("MONEY_SOURCE_TIME_ORDER_INVALID");
    expect(() =>
      project(
        [
          original,
          { ...credit("KRW_DEPOSIT", 1n, 1), effectiveAt: new Date("invalid") },
        ],
        at(0),
      ),
    ).toThrow("MONEY_SOURCE_RECEIPT_INVALID");
  });
});
