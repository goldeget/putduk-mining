import "server-only";

export type EventRewardFact = boolean | bigint | string;

export type EventRewardCondition = {
  fact: string;
  operator: "EQ" | "GTE";
  value: EventRewardFact;
};

export type EventRewardRule = {
  activeFrom: Date;
  activeUntil: Date;
  budgetRemainingKrw: bigint;
  conditions: readonly EventRewardCondition[];
  eventId: string;
  perUserCapKrw: bigint;
  rewardId: string;
  rewardKrw: bigint;
  ruleVersion: number;
};

export type EventRewardDecision =
  | {
      idempotencyKey: string;
      outcome: "REWARD";
      qualificationSnapshot: Readonly<Record<string, EventRewardFact>>;
      rewardKrw: bigint;
    }
  | {
      outcome: "INELIGIBLE";
      reason:
        | "AI_NOT_AUTHORITY"
        | "ALREADY_CLAIMED"
        | "BUDGET_EXHAUSTED"
        | "CONDITIONS_NOT_MET"
        | "OUTSIDE_SCHEDULE";
    };

function conditionMatches(
  actual: EventRewardFact | undefined,
  condition: EventRewardCondition,
): boolean {
  if (actual === undefined || typeof actual !== typeof condition.value) {
    return false;
  }
  if (condition.operator === "EQ") {
    return actual === condition.value;
  }
  return (
    typeof actual === "bigint" &&
    typeof condition.value === "bigint" &&
    actual >= condition.value
  );
}

export function evaluateEventReward({
  authority,
  claimedIdempotencyKeys,
  facts,
  occurredAt,
  rule,
  userId,
}: {
  authority: "AI_PROPOSAL" | "RULE_ENGINE";
  claimedIdempotencyKeys: ReadonlySet<string>;
  facts: Readonly<Record<string, EventRewardFact>>;
  occurredAt: Date;
  rule: EventRewardRule;
  userId: string;
}): EventRewardDecision {
  if (!rule.eventId.trim() || !rule.rewardId.trim() || !userId.trim()) {
    throw new Error("Event, reward and user identifiers are required.");
  }
  if (
    !Number.isSafeInteger(rule.ruleVersion) ||
    rule.ruleVersion <= 0 ||
    rule.rewardKrw <= 0n ||
    rule.perUserCapKrw <= 0n ||
    rule.budgetRemainingKrw < 0n ||
    !Number.isFinite(rule.activeFrom.getTime()) ||
    !Number.isFinite(rule.activeUntil.getTime()) ||
    !Number.isFinite(occurredAt.getTime()) ||
    rule.activeUntil <= rule.activeFrom
  ) {
    throw new RangeError("Event reward rule configuration is invalid.");
  }
  if (authority !== "RULE_ENGINE") {
    return { outcome: "INELIGIBLE", reason: "AI_NOT_AUTHORITY" };
  }

  const idempotencyKey = `event-reward:${rule.eventId}:${rule.rewardId}:${userId}:v${rule.ruleVersion}`;
  if (claimedIdempotencyKeys.has(idempotencyKey)) {
    return { outcome: "INELIGIBLE", reason: "ALREADY_CLAIMED" };
  }
  if (occurredAt < rule.activeFrom || occurredAt >= rule.activeUntil) {
    return { outcome: "INELIGIBLE", reason: "OUTSIDE_SCHEDULE" };
  }
  if (
    !rule.conditions.every((condition) =>
      conditionMatches(facts[condition.fact], condition),
    )
  ) {
    return { outcome: "INELIGIBLE", reason: "CONDITIONS_NOT_MET" };
  }
  if (
    rule.rewardKrw > rule.perUserCapKrw ||
    rule.rewardKrw > rule.budgetRemainingKrw
  ) {
    return { outcome: "INELIGIBLE", reason: "BUDGET_EXHAUSTED" };
  }

  return {
    idempotencyKey,
    outcome: "REWARD",
    qualificationSnapshot: Object.freeze({ ...facts }),
    rewardKrw: rule.rewardKrw,
  };
}
