import { describe, expect, it } from "vitest";

import {
  evaluateReferralAttribution,
  evaluateReferralQualification,
  REFERRAL_PAIR_MAX_REWARD_KRW,
  transitionReferralReward,
} from "@/domain/referral/qualification";

describe("evaluateReferralQualification", () => {
  it("automatically pays both 5,000 KRW stages after qualification", () => {
    const result = evaluateReferralQualification({
      hasCompletedFirstPaidCycle: true,
      hasVerifiedIdentity: true,
      invitationAccepted: true,
      riskSignals: [],
    });

    expect(result.decision).toBe("QUALIFIED");
    expect(
      result.automaticPayouts.reduce((sum, item) => sum + item.amountKrw, 0n),
    ).toBe(REFERRAL_PAIR_MAX_REWARD_KRW);
  });

  it("does not reject a qualified referral solely for a shared IP", () => {
    expect(
      evaluateReferralQualification({
        hasCompletedFirstPaidCycle: true,
        hasVerifiedIdentity: true,
        invitationAccepted: true,
        riskSignals: [{ code: "SHARED_IP", severity: "HIGH" }],
      }).decision,
    ).toBe("QUALIFIED");
  });

  it("routes corroborated high risk to automatic hold", () => {
    expect(
      evaluateReferralQualification({
        hasCompletedFirstPaidCycle: true,
        hasVerifiedIdentity: true,
        invitationAccepted: true,
        riskSignals: [
          { code: "SHARED_IP", severity: "MEDIUM" },
          { code: "DEVICE_FARM", severity: "HIGH" },
        ],
      }).decision,
    ).toBe("AUTO_HOLD");
  });

  it("does not issue an already-paid stage twice", () => {
    const result = evaluateReferralQualification({
      hasCompletedFirstPaidCycle: true,
      hasVerifiedIdentity: true,
      invitationAccepted: true,
      paidStages: ["STAGE_1"],
      riskSignals: [],
    });

    expect(result.automaticPayouts).toEqual([
      {
        amountKrw: 5_000n,
        beneficiary: "REFERRER",
        stage: "FIRST_PAID_CYCLE",
      },
    ]);
  });

  it("rejects self and circular attribution before qualification", () => {
    expect(
      evaluateReferralAttribution({
        referredUserId: "member-a",
        referrerAncestorIds: [],
        referrerUserId: "member-a",
      }),
    ).toEqual({ outcome: "REJECT", reason: "SELF_REFERRAL" });
    expect(
      evaluateReferralAttribution({
        referredUserId: "member-a",
        referrerAncestorIds: ["member-a"],
        referrerUserId: "member-b",
      }),
    ).toEqual({ outcome: "REJECT", reason: "RING_REFERRAL" });
  });

  it("supports hold, recheck, pay and reversal without skipping states", () => {
    expect(transitionReferralReward("PENDING", "HOLD")).toBe("AUTO_HOLD");
    expect(transitionReferralReward("AUTO_HOLD", "RECHECK_CLEAR")).toBe(
      "QUALIFIED",
    );
    expect(transitionReferralReward("QUALIFIED", "PAY")).toBe("PAID");
    expect(transitionReferralReward("PAID", "REVERSE")).toBe("REVERSED");
    expect(() => transitionReferralReward("PENDING", "PAY")).toThrow(
      /invalid/i,
    );
  });
});
