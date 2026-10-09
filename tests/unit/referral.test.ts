import { describe, expect, it } from "vitest";

import {
  evaluateReferralAttribution,
  evaluateReferralQualification,
  REFERRAL_REFERRER_MAX_PER_REFERRAL_KRW,
  transitionReferralReward,
} from "@/domain/referral/qualification";

describe("evaluateReferralQualification", () => {
  it("qualifies the later-activity stage without an unapproved first-cycle prerequisite", () => {
    const canonicalFacts = {
      hasCompletedFirstPaidCycle: false,
      hasVerifiedIdentity: true,
      hasVerifiedFunding: true,
      hasStartedRealMining: true,
      hasFirstRealSettlement: true,
      hasLaterQualifiedActivity: true,
      hasLaterRiskRecheckClear: true,
      invitationAccepted: true,
      paidStages: ["STAGE_1"] as const,
      riskSignals: [],
    };
    expect(
      evaluateReferralQualification(canonicalFacts).automaticPayouts,
    ).toEqual([
      { amountKrw: 5_000n, beneficiary: "REFERRER", stage: "STAGE_2" },
    ]);
  });

  it.each(["hasLaterQualifiedActivity", "hasLaterRiskRecheckClear"] as const)(
    "does not substitute legacy cycle completion for missing %s",
    (missingFact) => {
      const legacyCycleOnly = {
        hasCompletedFirstPaidCycle: true,
        hasVerifiedIdentity: true,
        hasVerifiedFunding: true,
        hasStartedRealMining: true,
        hasFirstRealSettlement: true,
        hasLaterQualifiedActivity: true,
        hasLaterRiskRecheckClear: true,
        invitationAccepted: true,
        paidStages: ["STAGE_1"] as const,
        riskSignals: [],
      };
      expect(
        evaluateReferralQualification({
          ...legacyCycleOnly,
          [missingFact]: undefined,
        }).automaticPayouts,
      ).toEqual([]);
    },
  );

  it.each([
    "hasVerifiedFunding",
    "hasStartedRealMining",
    "hasFirstRealSettlement",
  ] as const)("does not qualify stage one without %s", (missingFact) => {
    const evidence = {
      hasVerifiedIdentity: true,
      hasVerifiedFunding: true,
      hasStartedRealMining: true,
      hasFirstRealSettlement: true,
      hasLaterQualifiedActivity: true,
      hasLaterRiskRecheckClear: true,
      invitationAccepted: true,
      riskSignals: [],
    };
    expect(
      evaluateReferralQualification({ ...evidence, [missingFact]: false })
        .automaticPayouts,
    ).toEqual([]);
  });

  it("does not interpret absent real transaction evidence as qualified", () => {
    expect(
      evaluateReferralQualification({
        hasVerifiedIdentity: true,
        invitationAccepted: true,
        riskSignals: [],
      }).automaticPayouts,
    ).toEqual([]);
  });

  it("requires a fresh later-stage risk recheck even when activity qualifies", () => {
    expect(
      evaluateReferralQualification({
        hasVerifiedIdentity: true,
        hasVerifiedFunding: true,
        hasStartedRealMining: true,
        hasFirstRealSettlement: true,
        hasLaterQualifiedActivity: true,
        hasLaterRiskRecheckClear: false,
        invitationAccepted: true,
        paidStages: ["STAGE_1"],
        riskSignals: [],
      }).automaticPayouts,
    ).toEqual([]);
  });

  it("requires later qualified activity for stage two after the first stage was paid", () => {
    expect(
      evaluateReferralQualification({
        hasVerifiedIdentity: true,
        hasVerifiedFunding: true,
        hasStartedRealMining: true,
        hasFirstRealSettlement: true,
        hasLaterQualifiedActivity: false,
        hasLaterRiskRecheckClear: true,
        invitationAccepted: true,
        paidStages: ["STAGE_1"],
        riskSignals: [],
      }).automaticPayouts,
    ).toEqual([]);
  });

  it("never offers stage two before an actual recorded stage-one payment", () => {
    const result = evaluateReferralQualification({
      hasVerifiedIdentity: true,
      hasVerifiedFunding: true,
      hasStartedRealMining: true,
      hasFirstRealSettlement: true,
      hasLaterQualifiedActivity: true,
      hasLaterRiskRecheckClear: true,
      invitationAccepted: true,
      riskSignals: [],
    });

    expect(result.decision).toBe("QUALIFIED");
    expect(result.automaticPayouts).toEqual([
      {
        amountKrw: 5_000n,
        beneficiary: "REFERRER",
        stage: "STAGE_1",
      },
    ]);

    expect(
      result.automaticPayouts.reduce((sum, item) => sum + item.amountKrw, 0n),
    ).toBe(REFERRAL_REFERRER_MAX_PER_REFERRAL_KRW / 2n);
  });

  it("does not reject a qualified referral solely for a shared IP", () => {
    expect(
      evaluateReferralQualification({
        hasVerifiedIdentity: true,
        hasVerifiedFunding: true,
        hasStartedRealMining: true,
        hasFirstRealSettlement: true,
        hasLaterQualifiedActivity: true,
        hasLaterRiskRecheckClear: true,
        invitationAccepted: true,
        riskSignals: [{ code: "SHARED_IP", severity: "HIGH" }],
      }).decision,
    ).toBe("QUALIFIED");
  });

  it("routes corroborated high risk to automatic hold", () => {
    expect(
      evaluateReferralQualification({
        hasVerifiedIdentity: true,
        hasVerifiedFunding: true,
        hasStartedRealMining: true,
        hasFirstRealSettlement: true,
        hasLaterQualifiedActivity: true,
        hasLaterRiskRecheckClear: true,
        invitationAccepted: true,
        riskSignals: [
          { code: "SHARED_IP", severity: "MEDIUM" },
          { code: "DEVICE_FARM", severity: "HIGH" },
        ],
      }).decision,
    ).toBe("AUTO_HOLD");
  });

  it("does not return an already-paid stage candidate twice", () => {
    const result = evaluateReferralQualification({
      hasVerifiedIdentity: true,
      hasVerifiedFunding: true,
      hasStartedRealMining: true,
      hasFirstRealSettlement: true,
      hasLaterQualifiedActivity: true,
      hasLaterRiskRecheckClear: true,
      invitationAccepted: true,
      paidStages: ["STAGE_1"],
      riskSignals: [],
    });

    expect(result.automaticPayouts).toEqual([
      {
        amountKrw: 5_000n,
        beneficiary: "REFERRER",
        stage: "STAGE_2",
      },
    ]);
  });

  it("keeps an unpaid first stage assigned to the referrer after stage two is paid", () => {
    const result = evaluateReferralQualification({
      hasVerifiedIdentity: true,
      hasVerifiedFunding: true,
      hasStartedRealMining: true,
      hasFirstRealSettlement: true,
      hasLaterQualifiedActivity: true,
      hasLaterRiskRecheckClear: true,
      invitationAccepted: true,
      paidStages: ["STAGE_2"],
      riskSignals: [],
    });
    expect(result.automaticPayouts).toEqual([
      {
        amountKrw: 5_000n,
        beneficiary: "REFERRER",
        stage: "STAGE_1",
      },
    ]);
  });

  it("returns no new payout when both referral stages were already paid", () => {
    const result = evaluateReferralQualification({
      hasVerifiedIdentity: true,
      hasVerifiedFunding: true,
      hasStartedRealMining: true,
      hasFirstRealSettlement: true,
      hasLaterQualifiedActivity: true,
      hasLaterRiskRecheckClear: true,
      invitationAccepted: true,
      paidStages: ["STAGE_1", "STAGE_2"],
      riskSignals: [],
    });
    expect(result.automaticPayouts).toEqual([]);
    expect(result.decision).toBe("PENDING");
    expect(result.reason).toBe("ALL_STAGES_ALREADY_PAID");
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
