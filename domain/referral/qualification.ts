import "server-only";

export const REFERRAL_REFERRER_REWARD_KRW = 5_000n;
export const REFERRAL_REFERRER_MAX_PER_REFERRAL_KRW = 10_000n;

export type ReferralRiskSignal = {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export type ReferralQualificationInput = {
  hasVerifiedIdentity: boolean;
  // Trusted server facts from canonical transaction originals, never client assertions.
  // Missing evidence fails closed for older callers.
  hasVerifiedFunding?: boolean;
  hasStartedRealMining?: boolean;
  hasFirstRealSettlement?: boolean;
  // The configured distinct settlement after the actual stage-one payout and
  // its current risk recheck must both pass. The native producer owns timing.
  hasLaterQualifiedActivity?: boolean;
  hasLaterRiskRecheckClear?: boolean;
  invitationAccepted: boolean;
  paidStages?: readonly ("STAGE_1" | "STAGE_2")[];
  riskSignals: readonly ReferralRiskSignal[];
};

export type ReferralQualification = {
  // Decision candidates only. Database approval, unique claims, budget and a
  // balanced ledger transaction are still mandatory before actual payment.
  automaticPayouts: readonly {
    amountKrw: bigint;
    beneficiary: "REFERRED" | "REFERRER";
    // Same identifiers as the canonical per-referral database claim stages.
    stage: "STAGE_1" | "STAGE_2";
  }[];
  decision: "AUTO_HOLD" | "PENDING" | "QUALIFIED";
  reason: string;
};

export type ReferralAttributionDecision =
  | { outcome: "ACCEPT" }
  | { outcome: "REJECT"; reason: "RING_REFERRAL" | "SELF_REFERRAL" };

export function evaluateReferralAttribution({
  referredUserId,
  referrerAncestorIds,
  referrerUserId,
}: {
  referredUserId: string;
  referrerAncestorIds: readonly string[];
  referrerUserId: string;
}): ReferralAttributionDecision {
  if (!referredUserId.trim() || !referrerUserId.trim()) {
    throw new Error("Referral attribution requires both member identifiers.");
  }
  if (referredUserId === referrerUserId) {
    return { outcome: "REJECT", reason: "SELF_REFERRAL" };
  }
  if (referrerAncestorIds.includes(referredUserId)) {
    return { outcome: "REJECT", reason: "RING_REFERRAL" };
  }
  return { outcome: "ACCEPT" };
}

export function evaluateReferralQualification(
  input: ReferralQualificationInput,
): ReferralQualification {
  if (!input.invitationAccepted) {
    return {
      automaticPayouts: [],
      decision: "PENDING",
      reason: "INVITATION_NOT_ACCEPTED",
    };
  }

  const blockingSignals = input.riskSignals.filter(
    ({ code, severity }) =>
      code !== "SHARED_IP" && (severity === "HIGH" || severity === "CRITICAL"),
  );
  if (blockingSignals.length > 0) {
    return {
      automaticPayouts: [],
      decision: "AUTO_HOLD",
      reason: "CORROBORATED_BLOCKING_RISK",
    };
  }

  if (!input.hasVerifiedIdentity) {
    return {
      automaticPayouts: [],
      decision: "PENDING",
      reason: "IDENTITY_NOT_VERIFIED",
    };
  }

  if (
    input.hasVerifiedFunding !== true ||
    input.hasStartedRealMining !== true ||
    input.hasFirstRealSettlement !== true
  ) {
    return {
      automaticPayouts: [],
      decision: "PENDING",
      reason: "REAL_TRANSACTION_QUALIFICATION_INCOMPLETE",
    };
  }

  const paidStages = new Set(input.paidStages ?? []);
  const automaticPayouts: Array<{
    amountKrw: bigint;
    beneficiary: "REFERRED" | "REFERRER";
    stage: "STAGE_1" | "STAGE_2";
  }> = [];

  if (!paidStages.has("STAGE_1")) {
    automaticPayouts.push({
      amountKrw: REFERRAL_REFERRER_REWARD_KRW,
      beneficiary: "REFERRER",
      stage: "STAGE_1",
    });
  }
  const laterStageQualified =
    paidStages.has("STAGE_1") &&
    input.hasLaterQualifiedActivity === true &&
    input.hasLaterRiskRecheckClear === true;
  if (laterStageQualified && !paidStages.has("STAGE_2")) {
    automaticPayouts.push({
      amountKrw: REFERRAL_REFERRER_REWARD_KRW,
      beneficiary: "REFERRER",
      stage: "STAGE_2",
    });
  }

  const total = automaticPayouts.reduce(
    (sum, payout) => sum + payout.amountKrw,
    0n,
  );
  if (total > REFERRAL_REFERRER_MAX_PER_REFERRAL_KRW) {
    throw new Error("Referrer payout exceeds the per-referral hard cap.");
  }

  return {
    automaticPayouts,
    decision: automaticPayouts.length > 0 ? "QUALIFIED" : "PENDING",
    reason:
      automaticPayouts.length > 0
        ? laterStageQualified
          ? "QUALIFIED_STAGES_AVAILABLE"
          : "REAL_SETTLEMENT_STAGE_AVAILABLE"
        : paidStages.has("STAGE_1") && paidStages.has("STAGE_2")
          ? "ALL_STAGES_ALREADY_PAID"
          : "LATER_ACTIVITY_OR_RISK_RECHECK_INCOMPLETE",
  };
}

export type ReferralRewardStatus =
  "PENDING" | "QUALIFIED" | "AUTO_HOLD" | "PAID" | "REJECTED" | "REVERSED";

export type ReferralRewardEvent =
  "QUALIFY" | "HOLD" | "RECHECK_CLEAR" | "RECHECK_REJECT" | "PAY" | "REVERSE";

const REFERRAL_TRANSITIONS: Readonly<
  Record<
    ReferralRewardStatus,
    Partial<Record<ReferralRewardEvent, ReferralRewardStatus>>
  >
> = {
  AUTO_HOLD: { RECHECK_CLEAR: "QUALIFIED", RECHECK_REJECT: "REJECTED" },
  PAID: { REVERSE: "REVERSED" },
  PENDING: { HOLD: "AUTO_HOLD", QUALIFY: "QUALIFIED" },
  QUALIFIED: { HOLD: "AUTO_HOLD", PAY: "PAID" },
  REJECTED: {},
  REVERSED: {},
};

export function transitionReferralReward(
  status: ReferralRewardStatus,
  event: ReferralRewardEvent,
): ReferralRewardStatus {
  const next = REFERRAL_TRANSITIONS[status][event];
  if (!next) {
    throw new Error(`Invalid referral transition: ${status} -> ${event}.`);
  }
  return next;
}
