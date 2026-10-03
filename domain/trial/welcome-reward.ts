import "server-only";

export const WELCOME_REWARD_MAX_KRW = 5_000n;

export type WelcomeRewardRiskSignal = {
  code:
    | "DEVICE_ACCOUNT_CLUSTER"
    | "IDENTITY_REUSE"
    | "RAPID_ACCOUNT_ROTATION"
    | "SHARED_IP";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export function assessWelcomeRewardRisk(
  signals: readonly WelcomeRewardRiskSignal[],
): "ALLOW" | "AUTO_HOLD" {
  const material = signals.filter(({ code, severity }) => {
    if (code === "SHARED_IP") {
      return false;
    }
    return severity === "HIGH" || severity === "CRITICAL";
  });
  const identityReuse = signals.some(
    ({ code, severity }) =>
      code === "IDENTITY_REUSE" &&
      (severity === "MEDIUM" || severity === "HIGH" || severity === "CRITICAL"),
  );
  return identityReuse || material.length >= 1 ? "AUTO_HOLD" : "ALLOW";
}

export type WelcomeRewardConversionInput = {
  existingConversion?: {
    amountKrw: bigint;
    idempotencyKey: string;
  };
  hasBlockingRisk: boolean;
  idempotencyKey: string;
  isKycApproved: boolean;
  isTrialComplete: boolean;
  trialRewardKrw: bigint;
};

export type WelcomeRewardConversionDecision =
  | {
      amountKrw: bigint;
      outcome: "CONVERT";
    }
  | {
      amountKrw: bigint;
      outcome: "REPLAY";
    }
  | {
      outcome: "INELIGIBLE";
      reason:
        "BLOCKING_RISK" | "KYC_REQUIRED" | "TRIAL_INCOMPLETE" | "ZERO_REWARD";
    };

export function decideWelcomeRewardConversion(
  input: WelcomeRewardConversionInput,
): WelcomeRewardConversionDecision {
  if (!input.idempotencyKey.trim()) {
    throw new Error("A welcome-reward idempotency key is required.");
  }
  if (input.trialRewardKrw < 0n) {
    throw new RangeError("Trial reward cannot be negative.");
  }

  if (input.existingConversion) {
    if (
      input.existingConversion.amountKrw <= 0n ||
      input.existingConversion.amountKrw > WELCOME_REWARD_MAX_KRW
    ) {
      throw new RangeError(
        "The existing welcome reward is outside the approved cap.",
      );
    }
    if (input.existingConversion.idempotencyKey !== input.idempotencyKey) {
      throw new Error(
        "The trial reward was already converted by another request.",
      );
    }
    return {
      amountKrw: input.existingConversion.amountKrw,
      outcome: "REPLAY",
    };
  }

  if (!input.isTrialComplete) {
    return { outcome: "INELIGIBLE", reason: "TRIAL_INCOMPLETE" };
  }
  if (!input.isKycApproved) {
    return { outcome: "INELIGIBLE", reason: "KYC_REQUIRED" };
  }
  if (input.hasBlockingRisk) {
    return { outcome: "INELIGIBLE", reason: "BLOCKING_RISK" };
  }
  if (input.trialRewardKrw === 0n) {
    return { outcome: "INELIGIBLE", reason: "ZERO_REWARD" };
  }

  return {
    amountKrw:
      input.trialRewardKrw > WELCOME_REWARD_MAX_KRW
        ? WELCOME_REWARD_MAX_KRW
        : input.trialRewardKrw,
    outcome: "CONVERT",
  };
}

export type WelcomeWithdrawalEligibility = {
  conversionAmountKrw: bigint;
  hasBlockingRisk: boolean;
  isDestinationCooldownComplete: boolean;
  isDestinationVerified: boolean;
  isKycApproved: boolean;
};

export function canRequestWelcomeWithdrawal(
  input: WelcomeWithdrawalEligibility,
): boolean {
  return (
    input.conversionAmountKrw > 0n &&
    input.conversionAmountKrw <= WELCOME_REWARD_MAX_KRW &&
    input.isKycApproved &&
    !input.hasBlockingRisk &&
    input.isDestinationVerified &&
    input.isDestinationCooldownComplete
  );
}
