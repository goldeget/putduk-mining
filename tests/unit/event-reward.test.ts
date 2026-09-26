import { describe, expect, it } from "vitest";

import { evaluateEventReward } from "@/domain/events/reward";

const rule = {
  activeFrom: new Date("2026-09-27T00:00:00.000Z"),
  activeUntil: new Date("2026-10-01T00:00:00.000Z"),
  budgetRemainingKrw: 100_000n,
  conditions: [
    { fact: "missionsCompleted", operator: "GTE" as const, value: 3n },
    { fact: "kycApproved", operator: "EQ" as const, value: true },
  ],
  eventId: "autumn-1",
  perUserCapKrw: 5_000n,
  rewardId: "three-missions",
  rewardKrw: 5_000n,
  ruleVersion: 1,
};

const input = {
  authority: "RULE_ENGINE" as const,
  claimedIdempotencyKeys: new Set<string>(),
  facts: { kycApproved: true, missionsCompleted: 3n },
  occurredAt: new Date("2026-09-28T00:00:00.000Z"),
  rule,
  userId: "member-1",
};

describe("evaluateEventReward", () => {
  it("produces a deterministic versioned qualification snapshot", () => {
    expect(evaluateEventReward(input)).toEqual({
      idempotencyKey: "event-reward:autumn-1:three-missions:member-1:v1",
      outcome: "REWARD",
      qualificationSnapshot: {
        kycApproved: true,
        missionsCompleted: 3n,
      },
      rewardKrw: 5_000n,
    });
  });

  it("blocks reward creation when the campaign budget cannot cover it", () => {
    expect(
      evaluateEventReward({
        ...input,
        rule: { ...rule, budgetRemainingKrw: 4_999n },
      }),
    ).toEqual({ outcome: "INELIGIBLE", reason: "BUDGET_EXHAUSTED" });
  });

  it("deduplicates the same user, event, reward and rule version", () => {
    expect(
      evaluateEventReward({
        ...input,
        claimedIdempotencyKeys: new Set([
          "event-reward:autumn-1:three-missions:member-1:v1",
        ]),
      }),
    ).toEqual({ outcome: "INELIGIBLE", reason: "ALREADY_CLAIMED" });
  });

  it("never treats an AI proposal as balance-mutation authority", () => {
    expect(evaluateEventReward({ ...input, authority: "AI_PROPOSAL" })).toEqual(
      { outcome: "INELIGIBLE", reason: "AI_NOT_AUTHORITY" },
    );
  });
});
