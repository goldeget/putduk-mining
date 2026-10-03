import { describe, expect, it } from "vitest";

import {
  calculateFundingPromotionReward,
  resolveFundingPromotionClaims,
  type FundingPromotionRule,
} from "@/domain/promotions/funding-promotion";

describe("calculateFundingPromotionReward", () => {
  const scheduled: FundingPromotionRule = {
    activeFrom: new Date("2026-09-27T00:00:00Z"),
    activeUntil: new Date("2026-09-28T00:00:00Z"),
    campaignBudgetRemainingKrw: 100_000n,
    campaignType: "FUNDING_ONLY",
    fixedRewardKrw: 3_000n,
    minimumFundingKrw: 10_000n,
    operatorApprovedException: false,
    rewardCapKrw: 3_000n,
  };
  const occurredAt = new Date("2026-09-27T12:00:00Z");

  it("cannot evaluate a scheduled campaign without the deposit event time", () => {
    expect(() => calculateFundingPromotionReward(20_000n, scheduled)).toThrow(
      /times/,
    );
  });

  it.each<[string, Partial<FundingPromotionRule>, Date]>([
    ["start", { activeFrom: new Date(NaN) }, occurredAt],
    ["end", { activeUntil: new Date(NaN) }, occurredAt],
    ["event", {}, new Date(NaN)],
  ])(
    "rejects an unknown %s time rather than granting a reward",
    (_label, patch, time) => {
      expect(() =>
        calculateFundingPromotionReward(
          20_000n,
          { ...scheduled, ...patch },
          time,
        ),
      ).toThrow(/times/);
    },
  );

  it("requires the approved special exception to have an explicit schedule", () => {
    const unscheduled = { ...scheduled };
    delete unscheduled.activeFrom;
    delete unscheduled.activeUntil;
    expect(() =>
      calculateFundingPromotionReward(
        20_000n,
        {
          ...unscheduled,
          campaignType: "FIRST_FUNDING",
          operatorApprovedException: true,
          fixedRewardKrw: 15_000n,
          rewardCapKrw: 15_000n,
        },
        occurredAt,
      ),
    ).toThrow(/approval and a schedule/);
  });

  it("rejects duplicate candidates before returning two claims for one deposit", () => {
    const candidate = {
      campaignId: "campaign-1",
      rule: scheduled,
      stackingPriority: 1,
    };
    expect(() =>
      resolveFundingPromotionClaims({
        candidates: [candidate, candidate],
        claimedIdempotencyKeys: new Set(),
        eventId: "deposit-1",
        fundingAmountKrw: 20_000n,
        occurredAt,
      }),
    ).toThrow(/unique IDs/);
  });

  it("applies the default first-funding hard cap", () => {
    expect(
      calculateFundingPromotionReward(100_000n, {
        campaignBudgetRemainingKrw: 1_000_000n,
        campaignType: "FIRST_FUNDING",
        minimumFundingKrw: 10_000n,
        operatorApprovedException: false,
        rewardCapKrw: 10_000n,
        rewardRateBps: 2_000,
      }),
    ).toEqual({ outcome: "REWARD", rewardKrw: 10_000n });
  });

  it("requires explicit operator approval above 10,000 KRW", () => {
    expect(() =>
      calculateFundingPromotionReward(100_000n, {
        campaignBudgetRemainingKrw: 1_000_000n,
        campaignType: "FIRST_FUNDING",
        fixedRewardKrw: 15_000n,
        minimumFundingKrw: 10_000n,
        operatorApprovedException: false,
        rewardCapKrw: 15_000n,
      }),
    ).toThrow(/approval/i);
  });

  it("allows an approved special campaign and enforces its budget", () => {
    expect(
      calculateFundingPromotionReward(
        100_000n,
        {
          activeFrom: new Date("2026-09-27T00:00:00Z"),
          activeUntil: new Date("2026-09-28T00:00:00Z"),
          campaignBudgetRemainingKrw: 12_000n,
          campaignType: "FIRST_FUNDING",
          fixedRewardKrw: 15_000n,
          minimumFundingKrw: 10_000n,
          operatorApprovedException: true,
          rewardCapKrw: 15_000n,
        },
        occurredAt,
      ),
    ).toEqual({ outcome: "REWARD", rewardKrw: 12_000n });
  });

  it("supports a funding-only campaign", () => {
    expect(
      calculateFundingPromotionReward(20_000n, {
        campaignBudgetRemainingKrw: 1_000_000n,
        campaignType: "FUNDING_ONLY",
        fixedRewardKrw: 3_000n,
        minimumFundingKrw: 20_000n,
        operatorApprovedException: false,
        rewardCapKrw: 3_000n,
      }),
    ).toEqual({ outcome: "REWARD", rewardKrw: 3_000n });
  });

  it("supports deterministic tiered rewards", () => {
    expect(
      calculateFundingPromotionReward(75_000n, {
        campaignBudgetRemainingKrw: 1_000_000n,
        campaignType: "FUNDING_ONLY",
        minimumFundingKrw: 10_000n,
        operatorApprovedException: false,
        rewardCapKrw: 10_000n,
        tiers: [
          { minimumFundingKrw: 10_000n, rewardKrw: 1_000n },
          { minimumFundingKrw: 50_000n, rewardKrw: 5_000n },
          { minimumFundingKrw: 100_000n, rewardKrw: 10_000n },
        ],
      }),
    ).toEqual({ outcome: "REWARD", rewardKrw: 5_000n });
  });

  it("uses a half-open campaign schedule boundary", () => {
    const rule = {
      activeFrom: new Date("2026-09-27T00:00:00.000Z"),
      activeUntil: new Date("2026-09-28T00:00:00.000Z"),
      campaignBudgetRemainingKrw: 1_000_000n,
      campaignType: "FUNDING_ONLY" as const,
      fixedRewardKrw: 3_000n,
      minimumFundingKrw: 10_000n,
      operatorApprovedException: false,
      rewardCapKrw: 3_000n,
    };

    expect(
      calculateFundingPromotionReward(
        20_000n,
        rule,
        new Date("2026-09-27T00:00:00.000Z"),
      ).outcome,
    ).toBe("REWARD");
    expect(
      calculateFundingPromotionReward(
        20_000n,
        rule,
        new Date("2026-09-28T00:00:00.000Z"),
      ),
    ).toEqual({ outcome: "INELIGIBLE", reason: "OUTSIDE_SCHEDULE" });
  });

  it("deduplicates a deposit event and applies exclusive stacking priority", () => {
    const baseRule = {
      campaignBudgetRemainingKrw: 100_000n,
      campaignType: "FUNDING_ONLY" as const,
      fixedRewardKrw: 2_000n,
      minimumFundingKrw: 10_000n,
      operatorApprovedException: false,
      rewardCapKrw: 2_000n,
    };
    const claims = resolveFundingPromotionClaims({
      candidates: [
        {
          campaignId: "lower-priority",
          exclusiveGroup: "FIRST_FUNDING",
          stackingPriority: 20,
          rule: baseRule,
        },
        {
          campaignId: "winner",
          exclusiveGroup: "FIRST_FUNDING",
          stackingPriority: 10,
          rule: baseRule,
        },
        {
          campaignId: "duplicate",
          stackingPriority: 1,
          rule: baseRule,
        },
      ],
      claimedIdempotencyKeys: new Set([
        "funding-promotion:duplicate:deposit-event-1",
      ]),
      eventId: "deposit-event-1",
      fundingAmountKrw: 20_000n,
      occurredAt: new Date("2026-09-27T00:00:00.000Z"),
    });

    expect(claims).toEqual([
      {
        campaignId: "winner",
        idempotencyKey: "funding-promotion:winner:deposit-event-1",
        rewardKrw: 2_000n,
      },
    ]);
  });
});
