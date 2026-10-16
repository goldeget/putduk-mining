import { describe, expect, it } from "vitest";
import {
  exactAtomicRead,
  principalWithdrawalReadSchema,
  parsePrincipalWithdrawalRead,
  principalWithdrawalSnapshotSchema,
  withdrawalInstantMicros,
} from "@/lib/wallet/principal-withdrawal-read";
const ready = () => ({
  schemaVersion: 1,
  available: true,
  ownerId: "11111111-1111-4111-8111-111111111111",
  evaluatedAt: "2026-10-06T00:00:00.123456Z",
  eligiblePrincipalKrw: "100000",
  heldPrincipalKrw: "30000",
  walletAvailableKrw: "9007199254740993",
  stateRevision: "4",
  conditionRevision: "3",
  allocationBps: "2500",
  policy: {
    id: "44444444-4444-4444-8444-444444444444",
    version: 1,
    minimumAmountKrw: "1000",
    feeKrw: "0",
  },
  destinations: [
    { id: "33333333-3333-4333-8333-333333333333", displayHint: "KB ****1234" },
  ],
});
describe("principal current facts strict public envelope", () => {
  it("keeps principal eligibility, held principal and wallet funds separate and exact", () => {
    const r = principalWithdrawalReadSchema.parse(ready());
    expect(r).toEqual(ready());
  });
  it.each([
    { schemaVersion: 2 },
    { eligiblePrincipalKrw: null },
    { walletAvailableKrw: 9007199254740993 },
    { allocationBps: "10001" },
    { currentConditionId: "private" },
    { evaluatedAt: "2026-10-06T00:00:00Z" },
    { policy: { ...ready().policy, feeKrw: "1" } },
    { destinations: [{ ...ready().destinations[0], ciphertext: "secret" }] },
    {
      destinations: [
        { ...ready().destinations[0], displayHint: "KB 123456789012" },
      ],
    },
  ])("rejects unknown/unsafe facts %j", (extra) => {
    expect(
      principalWithdrawalReadSchema.safeParse({ ...ready(), ...extra }).success,
    ).toBe(false);
  });
  it("unavailable cannot carry guessed zero balances or private failure text", () => {
    expect(
      principalWithdrawalReadSchema.safeParse({
        schemaVersion: 1,
        available: false,
      }).success,
    ).toBe(true);
    expect(
      principalWithdrawalReadSchema.safeParse({
        schemaVersion: 1,
        available: false,
        eligiblePrincipalKrw: "0",
      }).success,
    ).toBe(false);
  });
  it("protection comparison preserves the exact one-microsecond boundary and timezone", () => {
    const earlier = withdrawalInstantMicros("2026-10-06T00:00:00.123455Z")!;
    const later = withdrawalInstantMicros("2026-10-06T09:00:00.123456+09:00")!;
    expect(later - earlier).toBe(1n);
    expect(later).toBe(withdrawalInstantMicros("2026-10-06T00:00:00.123456Z"));
  });
  it.each([null, "bad", "2026-10-06T00:00:00.1234567Z", "2026-10-06T00:00:00"])(
    "unknown timestamp cannot authorize maturity %j",
    (v) => expect(withdrawalInstantMicros(v)).toBeNull(),
  );
  it("never converts unsafe floating/JSON numbers to exact amounts", () => {
    expect(exactAtomicRead(9007199254740992)).toBeNull();
    expect(exactAtomicRead(1.5)).toBeNull();
    expect(exactAtomicRead("9007199254740993")).toBe("9007199254740993");
  });
  it("does not accept destination material or checked=false as principal consent", () => {
    const s = {
      method: "KRW_BANK",
      amountKrw: "1000",
      policyId: ready().policy.id,
      policyVersion: 1,
      destinationId: ready().destinations[0]!.id,
      destination: null,
      confirmation: { version: 1, source: "PRINCIPAL", confirmed: true },
    };
    expect(principalWithdrawalSnapshotSchema.safeParse(s).success).toBe(true);
    expect(
      principalWithdrawalSnapshotSchema.safeParse({
        ...s,
        destination: { accountNumber: "secret" },
      }).success,
    ).toBe(false);
    expect(
      principalWithdrawalSnapshotSchema.safeParse({
        ...s,
        confirmation: { ...s.confirmation, confirmed: false },
      }).success,
    ).toBe(false);
  });
  it("a stale member page cannot adopt a different session owner's current facts", () => {
    expect(
      parsePrincipalWithdrawalRead(
        ready(),
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBeNull();
    expect(parsePrincipalWithdrawalRead(ready(), ready().ownerId)).toEqual(
      ready(),
    );
  });
});
