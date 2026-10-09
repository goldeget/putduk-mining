import { describe, expect, it } from "vitest";
import {
  parsePrincipalCryptoWithdrawalRead,
  readMaskedCryptoHint,
} from "@/lib/wallet/principal-crypto-withdrawal-read";
import {
  principalWithdrawalSnapshotSchema,
  parsePrincipalWithdrawalRead,
} from "@/lib/wallet/principal-withdrawal-read";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  dest = "33333333-3333-4333-8333-333333333333",
  policy = "44444444-4444-4444-8444-444444444444";
function read(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    available: true,
    method: "USDT_ADDRESS",
    ownerId: owner,
    evaluatedAt: "2026-10-06T00:00:00.123456Z",
    eligiblePrincipalKrw: "100000",
    heldPrincipalKrw: "1000",
    walletAvailableKrw: "99000",
    stateRevision: "1",
    conditionRevision: "1",
    allocationBps: "5000",
    policy: { id: policy, version: 1, minimumAmountKrw: "1000", feeKrw: "0" },
    destinations: [
      { id: dest, network: "TRC20", displayHint: "TRC20 TABCDE…abcdef" },
    ],
    ...extra,
  };
}
function snapshot(method = "USDT_ADDRESS") {
  return {
    method,
    amountKrw: "1000",
    policyId: policy,
    policyVersion: 1,
    destinationId: dest,
    destination: null,
    confirmation: { version: 1, source: "PRINCIPAL", confirmed: true },
  };
}
describe("strict current manual-USDT principal facts", () => {
  it("keeps KRW principal/wallet/held separate without a USD balance or quote", () => {
    const v = parsePrincipalCryptoWithdrawalRead(read(), owner);
    expect(v?.available).toBe(true);
    if (!v?.available) throw new Error("expected exact facts");
    expect(v.eligiblePrincipalKrw).toBe("100000");
    expect(v.walletAvailableKrw).toBe("99000");
    expect(v.heldPrincipalKrw).toBe("1000");
    expect(v).not.toHaveProperty("amountUsdt");
    expect(v).not.toHaveProperty("rate");
  });
  it.each([
    "TRC20 TABCDE…abcdef",
    "ERC20 0xabCD…abcdef",
    "BEP20 0xABcd…ABCDEF",
  ])("accepts canonical masked network hint %s", (hint) => {
    expect(readMaskedCryptoHint(hint)?.displayHint).toBe(hint);
  });
  it.each([
    "TRC20 T123456789012345678901234567890123",
    "ERC20 0x1234567890123456789012345678901234567890",
    "BTC 0xabcd…abcdef",
    "TRC20 TABCDE...abcdef",
    "TRC20 T00000…abcdef",
    "ERC20 TABCDE…abcdef",
  ])("rejects raw/unknown/invalid hint %s", (hint) =>
    expect(readMaskedCryptoHint(hint)).toBeNull(),
  );
  it("binds recognized network to exact same masked hint", () => {
    expect(
      parsePrincipalCryptoWithdrawalRead(
        read({
          destinations: [
            { id: dest, network: "ERC20", displayHint: "BEP20 0xabcd…abcdef" },
          ],
        }),
        owner,
      ),
    ).toBeNull();
  });
  it("never exposes a foreign owner", () =>
    expect(parsePrincipalCryptoWithdrawalRead(read(), other)).toBeNull());
  it.each([
    { rate: "1000" },
    { amountUsdt: "1.00" },
    { rawAddress: "secret" },
    { availableBalanceUsdt: "1000" },
    { internalConditionId: other },
  ])("rejects uncontracted read material %j", (extra) =>
    expect(parsePrincipalCryptoWithdrawalRead(read(extra), owner)).toBeNull(),
  );
  it("rejects nonzero fee without overriding approved policy", () =>
    expect(
      parsePrincipalCryptoWithdrawalRead(
        read({
          policy: {
            id: policy,
            version: 1,
            minimumAmountKrw: "1000",
            feeKrw: "1",
          },
        }),
        owner,
      ),
    ).toBeNull());
  it("rejects unsafe numeric principal rather than rounding it", () =>
    expect(
      parsePrincipalCryptoWithdrawalRead(
        read({ eligiblePrincipalKrw: 9007199254740992 }),
        owner,
      ),
    ).toBeNull());
  it("preserves unavailable without fabricated money", () =>
    expect(
      parsePrincipalCryptoWithdrawalRead(
        { schemaVersion: 1, available: false },
        owner,
      ),
    ).toEqual({ schemaVersion: 1, available: false }));
  it("initial current state revision1 accepts facts without prior principal recovery", () =>
    expect(parsePrincipalCryptoWithdrawalRead(read(), owner)?.available).toBe(
      true,
    ));
  it.each(["KRW_BANK", "USDT_ADDRESS"])(
    "same explicit consent snapshot supports existing method %s",
    (method) =>
      expect(
        principalWithdrawalSnapshotSchema.safeParse(snapshot(method)).success,
      ).toBe(true),
  );
  it.each(["USDT_BALANCE", "BTC_ADDRESS", ""])(
    "does not invent a method %s",
    (method) =>
      expect(
        principalWithdrawalSnapshotSchema.safeParse(snapshot(method)).success,
      ).toBe(false),
  );
  it("KRW facts retain their separate bank-only envelope", () =>
    expect(parsePrincipalWithdrawalRead(read(), owner)).toBeNull());
});
