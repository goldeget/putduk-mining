import { describe, expect, it } from "vitest";

import {
  manualUsdtFullPayoutEvidenceSchema,
  manualUsdtPayoutFailure,
  normalizeManualUsdtAmount,
  parseManualUsdtFullPayoutEvidence,
} from "../../apps/admin/lib/withdrawals/usdt-manual-payout-contract";

const withdrawalId = "c9fc23dd-228a-4a8f-9f38-7182378678f6";
const evidence = {
  version: 1,
  basis: "OPERATOR_MANUAL_FULL_PAYOUT",
  withdrawalId,
  requestedKrwAmount: "5000",
  actualUsdtAmount: "3.5",
  network: "TRC20",
  feeKrw: "0",
  fullPayoutConfirmed: true,
} as const;
const original = {
  withdrawalId,
  requestedKrwAmount: "5000",
  actualUsdtAmount: "03.500000",
  network: "TRC20",
} as const;

describe("manual USDT full-payment evidence contract", () => {
  it("binds the operator confirmation without inventing an FX quote", () => {
    expect(parseManualUsdtFullPayoutEvidence(evidence, original)).toEqual(
      evidence,
    );
    expect(evidence).not.toHaveProperty("rate");
    expect(evidence).not.toHaveProperty("quoteId");
  });

  it.each([
    { withdrawalId: "9960e9fb-456e-4d7d-aace-2fc61e78b661" },
    { requestedKrwAmount: "4999" },
    { actualUsdtAmount: "3.49" },
    { network: "ERC20" },
    { feeKrw: "1" },
    { fullPayoutConfirmed: false },
  ])("rejects a changed binding or payment declaration: %j", (change) => {
    expect(
      parseManualUsdtFullPayoutEvidence({ ...evidence, ...change }, original),
    ).toBeNull();
  });

  it.each([null, { note: "historical operator record" }])(
    "does not reinterpret legacy evidence as a new full-payment declaration: %j",
    (legacy) => {
      expect(manualUsdtFullPayoutEvidenceSchema.safeParse(legacy).success).toBe(
        false,
      );
    },
  );

  it.each(["0", "00.1", "3.50", "3.0000010", "1e2", "NaN", "-1"])(
    "rejects noncanonical or invalid evidence amount %s",
    (amount) => {
      expect(
        manualUsdtFullPayoutEvidenceSchema.safeParse({
          ...evidence,
          actualUsdtAmount: amount,
        }).success,
      ).toBe(false);
    },
  );

  it("keeps exact subunit precision and large amounts without Number conversion", () => {
    expect(normalizeManualUsdtAmount("000.000001")).toBe("0.000001");
    expect(normalizeManualUsdtAmount("9007199254740993.123456")).toBe(
      "9007199254740993.123456",
    );
    expect(normalizeManualUsdtAmount("0.0000001")).toBeNull();
  });

  it("rejects noncanonical KRW, bigint overflow and unknown evidence fields", () => {
    for (const amount of ["05000", "5000.0", "9223372036854775808"]) {
      expect(
        manualUsdtFullPayoutEvidenceSchema.safeParse({
          ...evidence,
          requestedKrwAmount: amount,
        }).success,
      ).toBe(false);
    }
    expect(
      manualUsdtFullPayoutEvidenceSchema.safeParse({ ...evidence, rate: "1500" })
        .success,
    ).toBe(false);
    expect(
      manualUsdtFullPayoutEvidenceSchema.safeParse({
        ...evidence,
        withdrawalId: withdrawalId.toUpperCase(),
      }).success,
    ).toBe(false);
  });

  it("does not rewrite the original evidence while checking equivalent amounts", () => {
    const frozen = Object.freeze({ ...evidence });
    const before = JSON.stringify(frozen);
    expect(parseManualUsdtFullPayoutEvidence(frozen, original)).not.toBeNull();
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("provides actionable conflicts and preserves unknown infrastructure failures", () => {
    expect(
      manualUsdtPayoutFailure("USDT_SEND_NETWORK_MISMATCH"),
    ).toMatchObject({ code: "USDT_SEND_NETWORK_MISMATCH" });
    expect(
      manualUsdtPayoutFailure("USDT_MANUAL_FULL_PAYOUT_EVIDENCE_REQUIRED")
        ?.message,
    ).toContain("다시 송금하지 말고");
    expect(manualUsdtPayoutFailure("gateway timeout")).toBeNull();
  });
});
