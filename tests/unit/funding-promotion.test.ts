import { describe, expect, it } from "vitest";

import {
  calculateFundingPromotionReward,
  resolveFundingPromotionClaims,
} from "@/domain/promotions/funding-promotion";

describe("calculateFundingPromotionReward", () => {
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
      calculateFundingPromotionReward(100_000n, {
        campaignBudgetRemainingKrw: 12_000n,
        campaignType: "FIRST_FUNDING",
        fixedRewardKrw: 15_000n,
        minimumFundingKrw: 10_000n,
        operatorApprovedException: true,
        rewardCapKrw: 15_000n,
      }),
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
