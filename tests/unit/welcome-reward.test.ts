import { describe, expect, it } from "vitest";

import {
  assessWelcomeRewardRisk,
  canRequestWelcomeWithdrawal,
  decideWelcomeRewardConversion,
  WELCOME_REWARD_MAX_KRW,
} from "@/domain/trial/welcome-reward";

describe("welcome reward conversion", () => {
  it("caps a completed eligible trial at 5,000 KRW", () => {
    expect(
      decideWelcomeRewardConversion({
        hasBlockingRisk: false,
        idempotencyKey: "trial:one:convert",
        isKycApproved: true,
        isTrialComplete: true,
        trialRewardKrw: 9_500n,
      }),
    ).toEqual({ amountKrw: WELCOME_REWARD_MAX_KRW, outcome: "CONVERT" });
  });

  it("replays the same operation without issuing a second reward", () => {
    expect(
      decideWelcomeRewardConversion({
        existingConversion: {
          amountKrw: 4_000n,
          idempotencyKey: "trial:one:convert",
        },
        hasBlockingRisk: false,
        idempotencyKey: "trial:one:convert",
        isKycApproved: true,
        isTrialComplete: true,
        trialRewardKrw: 4_000n,
      }),
    ).toEqual({ amountKrw: 4_000n, outcome: "REPLAY" });
  });

  it("allows a verified withdrawal without any funding input", () => {
    expect(
      canRequestWelcomeWithdrawal({
        conversionAmountKrw: 5_000n,
        hasBlockingRisk: false,
        isDestinationCooldownComplete: true,
        isDestinationVerified: true,
        isKycApproved: true,
      }),
    ).toBe(true);
  });

  it("holds corroborated multi-account signals but not shared IP alone", () => {
    expect(
      assessWelcomeRewardRisk([{ code: "SHARED_IP", severity: "HIGH" }]),
    ).toBe("ALLOW");
    expect(
      assessWelcomeRewardRisk([
        { code: "SHARED_IP", severity: "MEDIUM" },
        { code: "DEVICE_ACCOUNT_CLUSTER", severity: "HIGH" },
      ]),
    ).toBe("AUTO_HOLD");
    expect(
      assessWelcomeRewardRisk([{ code: "IDENTITY_REUSE", severity: "MEDIUM" }]),
    ).toBe("AUTO_HOLD");
  });
});
