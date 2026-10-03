import "server-only";

export const DEFAULT_FIRST_FUNDING_REWARD_CAP_KRW = 10_000n;

export type FundingPromotionRule = {
  activeFrom?: Date;
  activeUntil?: Date;
  campaignBudgetRemainingKrw: bigint;
  campaignType: "FIRST_FUNDING" | "FUNDING_ONLY";
  fixedRewardKrw?: bigint;
  minimumFundingKrw: bigint;
  operatorApprovedException: boolean;
  rewardCapKrw: bigint;
  rewardRateBps?: number;
  tiers?: readonly { minimumFundingKrw: bigint; rewardKrw: bigint }[];
};

export type FundingPromotionDecision =
  | {
      outcome: "INELIGIBLE";
      reason: "BELOW_MINIMUM" | "BUDGET_EXHAUSTED" | "OUTSIDE_SCHEDULE";
    }
  | { outcome: "REWARD"; rewardKrw: bigint };

export function calculateFundingPromotionReward(
  fundingAmountKrw: bigint,
  rule: FundingPromotionRule,
  occurredAt?: Date,
): FundingPromotionDecision {
  if (fundingAmountKrw <= 0n || rule.minimumFundingKrw <= 0n) {
    throw new RangeError("Funding amounts and minimums must be positive.");
  }
  if (rule.rewardCapKrw <= 0n || rule.campaignBudgetRemainingKrw < 0n) {
    throw new RangeError("Campaign caps and budgets must be valid.");
  }
  if (
    rule.campaignType === "FIRST_FUNDING" &&
    rule.rewardCapKrw > DEFAULT_FIRST_FUNDING_REWARD_CAP_KRW &&
    (!rule.operatorApprovedException || !rule.activeFrom || !rule.activeUntil)
  ) {
    throw new Error(
      "A first-funding cap above 10,000 KRW needs approval and a schedule.",
    );
  }
  if (
    (rule.activeFrom && !Number.isFinite(rule.activeFrom.getTime())) ||
    (rule.activeUntil && !Number.isFinite(rule.activeUntil.getTime())) ||
    (occurredAt && !Number.isFinite(occurredAt.getTime())) ||
    ((rule.activeFrom || rule.activeUntil) && !occurredAt)
  ) {
    throw new RangeError(
      "Promotion evaluation requires valid schedule and event times.",
    );
  }
  if (
    rule.activeFrom &&
    rule.activeUntil &&
    rule.activeUntil <= rule.activeFrom
  ) {
    throw new RangeError("Promotion end time must be after its start time.");
  }
  if (
    occurredAt &&
    ((rule.activeFrom && occurredAt < rule.activeFrom) ||
      (rule.activeUntil && occurredAt >= rule.activeUntil))
  ) {
    return { outcome: "INELIGIBLE", reason: "OUTSIDE_SCHEDULE" };
  }
  if (fundingAmountKrw < rule.minimumFundingKrw) {
    return { outcome: "INELIGIBLE", reason: "BELOW_MINIMUM" };
  }
  if (rule.campaignBudgetRemainingKrw === 0n) {
    return { outcome: "INELIGIBLE", reason: "BUDGET_EXHAUSTED" };
  }

  const hasFixed = rule.fixedRewardKrw !== undefined;
  const hasRate = rule.rewardRateBps !== undefined;
  const hasTiers = rule.tiers !== undefined;
  if ([hasFixed, hasRate, hasTiers].filter(Boolean).length !== 1) {
    throw new Error("Define exactly one promotion reward formula.");
  }

  let calculated: bigint;
  if (rule.fixedRewardKrw !== undefined) {
    if (rule.fixedRewardKrw <= 0n) {
      throw new RangeError("Fixed rewards must be positive.");
    }
    calculated = rule.fixedRewardKrw;
  } else if (rule.rewardRateBps !== undefined) {
    const rateBps = rule.rewardRateBps;
    if (
      rateBps === undefined ||
      !Number.isSafeInteger(rateBps) ||
      rateBps <= 0 ||
      rateBps > 10_000
    ) {
      throw new RangeError("Reward rate must be 1 through 10,000 bps.");
    }
    calculated = (fundingAmountKrw * BigInt(rateBps)) / 10_000n;
  } else {
    const tiers = rule.tiers ?? [];
    if (tiers.length === 0) {
      throw new Error("Tiered promotions require at least one tier.");
    }
    const sorted = [...tiers].sort((a, b) =>
      a.minimumFundingKrw < b.minimumFundingKrw ? -1 : 1,
    );
    for (let index = 0; index < sorted.length; index += 1) {
      const tier = sorted[index];
      if (!tier || tier.minimumFundingKrw <= 0n || tier.rewardKrw <= 0n) {
        throw new RangeError("Promotion tiers must contain positive values.");
      }
      if (
        index > 0 &&
        sorted[index - 1]?.minimumFundingKrw === tier.minimumFundingKrw
      ) {
        throw new Error("Promotion tier minimums must be unique.");
      }
    }
    calculated = sorted.reduce(
      (reward, tier) =>
        fundingAmountKrw >= tier.minimumFundingKrw ? tier.rewardKrw : reward,
      0n,
    );
  }

  const rewardKrw = [
    calculated,
    rule.rewardCapKrw,
    rule.campaignBudgetRemainingKrw,
  ].reduce((minimum, value) => (value < minimum ? value : minimum));

  return rewardKrw > 0n
    ? { outcome: "REWARD", rewardKrw }
    : { outcome: "INELIGIBLE", reason: "BUDGET_EXHAUSTED" };
}

export type FundingPromotionCandidate = {
  campaignId: string;
  exclusiveGroup?: string;
  stackingPriority: number;
  rule: FundingPromotionRule;
};

export type FundingPromotionClaim = {
  campaignId: string;
  idempotencyKey: string;
  rewardKrw: bigint;
};

export function resolveFundingPromotionClaims({
  candidates,
  claimedIdempotencyKeys,
  eventId,
  fundingAmountKrw,
  occurredAt,
}: {
  candidates: readonly FundingPromotionCandidate[];
  claimedIdempotencyKeys: ReadonlySet<string>;
  eventId: string;
  fundingAmountKrw: bigint;
  occurredAt: Date;
}): readonly FundingPromotionClaim[] {
  if (!eventId.trim()) {
    throw new Error("Deposit event ID is required.");
  }
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new RangeError("Promotion event time is invalid.");
  }
  const campaignIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      !candidate.campaignId.trim() ||
      candidate.campaignId !== candidate.campaignId.trim() ||
      campaignIds.has(candidate.campaignId) ||
      !Number.isSafeInteger(candidate.stackingPriority)
    ) {
      throw new Error(
        "Promotion candidates require unique IDs and valid priorities.",
      );
    }
    campaignIds.add(candidate.campaignId);
  }

  const consumedGroups = new Set<string>();
  const claims: FundingPromotionClaim[] = [];
  const ordered = [...candidates].sort(
    (a, b) => a.stackingPriority - b.stackingPriority,
  );

  for (const candidate of ordered) {
    if (
      candidate.exclusiveGroup &&
      consumedGroups.has(candidate.exclusiveGroup)
    ) {
      continue;
    }
    const idempotencyKey = `funding-promotion:${candidate.campaignId}:${eventId}`;
    if (claimedIdempotencyKeys.has(idempotencyKey)) {
      continue;
    }
    const decision = calculateFundingPromotionReward(
      fundingAmountKrw,
      candidate.rule,
      occurredAt,
    );
    if (decision.outcome !== "REWARD") {
      continue;
    }
    claims.push({
      campaignId: candidate.campaignId,
      idempotencyKey,
      rewardKrw: decision.rewardKrw,
    });
    if (candidate.exclusiveGroup) {
      consumedGroups.add(candidate.exclusiveGroup);
    }
  }

  return claims;
}
