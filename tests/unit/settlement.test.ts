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
  const interval = {
    lastSettledAt: new Date("2026-09-26T00:00:00.000Z"),
    serverNow: new Date("2026-09-26T00:00:01.000Z"),
  };

  it("preserves amounts beyond JavaScript's safe number range", () => {
    expect(
      calculateSettlement({
        ...interval,
        ruleVersions: [
          { ...baseRule, baseRateAtomicPerSecond: 9_007_199_254_740_993n },
        ],
      }).totalAmountAtomic,
    ).toBe(9_007_199_254_740_993n);
  });

  it("rejects overflow of the database amount even when each segment fits", () => {
    const halfRange = 4_611_686_018_427_387_904n;
    expect(() =>
      calculateSettlement({
        ...interval,
        serverNow: new Date("2026-09-26T00:00:02.000Z"),
        ruleVersions: [
          { ...baseRule, baseRateAtomicPerSecond: halfRange },
          {
            ...baseRule,
            baseRateAtomicPerSecond: halfRange,
            versionId: "rule-v2",
            effectiveAt: interval.serverNow,
          },
        ],
      }),
    ).toThrow("amount is outside the database range");
  });

  it("rejects ambiguous equal effective times instead of producing an empty segment", () => {
    expect(() =>
      calculateSettlement({
        ...interval,
        ruleVersions: [baseRule, { ...baseRule, versionId: "different-rule" }],
      }),
    ).toThrow("effective times must be unique");
  });

  it.each<[string, Partial<SettlementRuleVersion>, RegExp]>([
    ["effective time", { effectiveAt: new Date(NaN) }, /valid version ID/],
    ["blank version", { versionId: " " }, /valid version ID/],
    ["padded version", { versionId: " rule-v1" }, /valid version ID/],
    ["world multiplier", { worldMultiplierBps: 100_001 }, /multipliers/],
    ["fractional multiplier", { eventMultiplierBps: 1.5 }, /multipliers/],
    ["negative multiplier", { statusMultiplierBps: -1 }, /multipliers/],
    ["unknown efficiency", { equipmentEfficiencyBps: NaN }, /multipliers/],
    [
      "base rate overflow",
      { baseRateAtomicPerSecond: 9_223_372_036_854_775_808n },
      /base rate/,
    ],
  ])("rejects an invalid future rule: %s", (_label, patch, error) => {
    expect(() =>
      calculateSettlement({
        ...interval,
        ruleVersions: [
          baseRule,
          {
            ...baseRule,
            versionId: "future-rule",
            effectiveAt: new Date("2030-01-01"),
            ...patch,
          },
        ],
      }),
    ).toThrow(error);
  });

  it("rejects an elapsed interval that cannot be represented exactly", () => {
    expect(() =>
      calculateSettlement({
        lastSettledAt: new Date(-8_000_000_000_000_000),
        serverNow: new Date(8_000_000_000_000_001),
        ruleVersions: [
          { ...baseRule, effectiveAt: new Date(-8_000_000_000_000_000) },
        ],
      }),
    ).toThrow(RangeError);
  });

  it("selects the rule exactly at the start and excludes the rule at the end", () => {
    const changed = {
      ...baseRule,
      versionId: "at-start",
      effectiveAt: interval.lastSettledAt,
      baseRateAtomicPerSecond: 200n,
    };
    const result = calculateSettlement({
      ...interval,
      ruleVersions: [
        { ...baseRule, effectiveAt: new Date("2026-09-25") },
        {
          ...baseRule,
          versionId: "at-end",
          effectiveAt: interval.serverNow,
          baseRateAtomicPerSecond: 500n,
        },
        changed,
      ],
    });
    expect(result.totalAmountAtomic).toBe(200n);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.ruleVersionId).toBe("at-start");
  });

  it.each([
    {
      miningSessionId: "session-1",
      settledFrom: new Date(NaN),
      settledTo: interval.serverNow,
    },
    {
      miningSessionId: "session-1",
      settledFrom: interval.serverNow,
      settledTo: interval.lastSettledAt,
    },
    {
      miningSessionId: "session-1",
      settledFrom: interval.lastSettledAt,
      settledTo: interval.lastSettledAt,
    },
    {
      miningSessionId: " session-1",
      settledFrom: interval.lastSettledAt,
      settledTo: interval.serverNow,
    },
  ])("rejects invalid logical interval keys: %j", (input) => {
    expect(() => settlementIdempotencyKey(input)).toThrow();
  });

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
