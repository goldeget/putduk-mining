import "server-only";

/** These canonical original event names come from DOMAIN-EVENTS-OUTBOX.md. */
export const NONMONEY_MISSION_SOURCES = [
  "MINING_STARTED.v1",
  "MINING_SETTLEMENT_COMPLETED.v1",
  "TRIAL_COMPLETED.v1",
  "TRIAL_REWARD_CONVERTED.v1",
  "DEPOSIT_CONFIRMED.v1",
  "WITHDRAWAL_COMPLETED.v1",
  "REFERRAL_REWARD_PAID.v1",
] as const;
export type NonmoneyMissionSource = (typeof NONMONEY_MISSION_SOURCES)[number];
export type NonmoneyRewardPolicy = {
  eventId: string;
  ruleId: string;
  revisionId: string;
  version: number;
  state: "APPROVED";
  scope: "LOCAL_QA" | "PRODUCTION";
  auditId: string;
  approvedBy: string;
  sourceType: NonmoneyMissionSource;
  startsAt: string;
  endsAt: string;
  rewardKind: "BADGE" | "PROFILE_TITLE";
  rewardCode: string;
};
export type VerifiedMissionOriginal = {
  eventId: string;
  eventType: NonmoneyMissionSource;
  memberId: string;
  occurredAt: string;
  digest: string;
  originalVerified: boolean;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server-only pure decision. Database consumer must verify operator approval and
 * canonical original source seals, derive membership from that original, and
 * atomically claim+grant+outbox. Client counters and AI proposals are not inputs.
 */
export function evaluateNonmoneyMission(input: {
  authority: "RULE_ENGINE" | "AI_PROPOSAL";
  policy: NonmoneyRewardPolicy;
  source: VerifiedMissionOriginal;
  memberId: string;
  joinedAt: string;
  expectedRevisionId: string;
  claimedKeys: ReadonlySet<string>;
  runtimeScope: "LOCAL_QA" | "PRODUCTION";
}):
  | {
      outcome: "GRANT";
      claimKey: string;
      rewardKind: "BADGE" | "PROFILE_TITLE";
      rewardCode: string;
      qualification: Readonly<Record<string, string>>;
    }
  | { outcome: "INELIGIBLE"; reason: string } {
  const { policy, source } = input;
  if (input.authority !== "RULE_ENGINE")
    return { outcome: "INELIGIBLE", reason: "AI_NOT_AUTHORITY" };
  if (
    ![
      policy.eventId,
      policy.ruleId,
      policy.revisionId,
      policy.auditId,
      policy.approvedBy,
      source.eventId,
      input.memberId,
    ].every((value) => uuid.test(value)) ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    policy.state !== "APPROVED" ||
    policy.scope !== input.runtimeScope ||
    !["BADGE", "PROFILE_TITLE"].includes(policy.rewardKind) ||
    !/^[A-Z][A-Z0-9_]{1,47}$/.test(policy.rewardCode) ||
    !NONMONEY_MISSION_SOURCES.includes(policy.sourceType)
  )
    return { outcome: "INELIGIBLE", reason: "UNAPPROVED_RULE" };
  if (input.expectedRevisionId !== policy.revisionId)
    return { outcome: "INELIGIBLE", reason: "REVISION_CHANGED" };
  if (
    !source.originalVerified ||
    !/^[a-f0-9]{64}$/.test(source.digest) ||
    source.memberId !== input.memberId ||
    source.eventType !== policy.sourceType
  )
    return { outcome: "INELIGIBLE", reason: "ORIGINAL_NOT_VERIFIED" };
  const start = Date.parse(policy.startsAt),
    end = Date.parse(policy.endsAt),
    occurred = Date.parse(source.occurredAt),
    joined = Date.parse(input.joinedAt);
  if (
    ![start, end, occurred, joined].every(Number.isFinite) ||
    end <= start ||
    occurred < start ||
    occurred < joined ||
    occurred >= end
  )
    return { outcome: "INELIGIBLE", reason: "OUTSIDE_SCHEDULE" };
  // The rule identity remains stable across revisions; replay cannot mint another award.
  const claimKey = `event-reward:${policy.eventId}:${input.memberId}:${policy.ruleId}`;
  if (input.claimedKeys.has(claimKey))
    return { outcome: "INELIGIBLE", reason: "ALREADY_CLAIMED" };
  return {
    outcome: "GRANT",
    claimKey,
    rewardKind: policy.rewardKind,
    rewardCode: policy.rewardCode,
    qualification: Object.freeze({
      sourceEventId: source.eventId,
      sourceDigest: source.digest,
      sourceType: source.eventType,
      sourceOccurredAt: source.occurredAt,
      policyRevisionId: policy.revisionId,
      policyAuditId: policy.auditId,
      memberId: input.memberId,
    }),
  };
}
