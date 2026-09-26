import { describe, expect, it } from "vitest";

import {
  calculateSettlement,
  settlementIdempotencyKey,
  type SettlementRuleVersion,
} from "@/domain/mining/calculate-settlement";

const baseRule: SettlementRuleVersion = {
  baseRateAtomicPerSecond: 100n,
  effectiveAt: new Date("2026-09-26T00:00:00.000Z"),
  equipmentEfficiencyBps: 10_000,
  eventMultiplierBps: 10_000,
  statusMultiplierBps: 10_000,
  versionId: "rule-v1",
  worldMultiplierBps: 10_000,
};

describe("calculateSettlement", () => {
  it("calculates elapsed server time without per-second writes", () => {
    const result = calculateSettlement({
      lastSettledAt: new Date("2026-09-26T00:00:00.000Z"),
      ruleVersions: [baseRule],
      serverNow: new Date("2026-09-26T00:01:00.000Z"),
    });

    expect(result.totalAmountAtomic).toBe(6_000n);
    expect(result.segments).toHaveLength(1);
  });

  it("splits the interval when a rule becomes effective", () => {
    const result = calculateSettlement({
      lastSettledAt: new Date("2026-09-26T00:00:00.000Z"),
      ruleVersions: [
        baseRule,
        {
          ...baseRule,
          baseRateAtomicPerSecond: 200n,
          effectiveAt: new Date("2026-09-26T00:01:00.000Z"),
          versionId: "rule-v2",
        },
      ],
      serverNow: new Date("2026-09-26T00:02:00.000Z"),
    });

    expect(result.segments.map((segment) => segment.amountAtomic)).toEqual([
      6_000n,
      12_000n,
    ]);
    expect(result.totalAmountAtomic).toBe(18_000n);
  });

  it("applies the event multiplier exactly once", () => {
    const result = calculateSettlement({
      lastSettledAt: new Date("2026-09-26T00:00:00.000Z"),
      ruleVersions: [{ ...baseRule, eventMultiplierBps: 15_000 }],
      serverNow: new Date("2026-09-26T00:00:10.000Z"),
    });

    expect(result.totalAmountAtomic).toBe(1_500n);
  });

  it("produces a stable interval idempotency key", () => {
    const input = {
      miningSessionId: "session-1",
      settledFrom: new Date("2026-09-26T00:00:00.000Z"),
      settledTo: new Date("2026-09-26T00:01:00.000Z"),
    };

    expect(settlementIdempotencyKey(input)).toBe(
      settlementIdempotencyKey(input),
    );
  });
});
