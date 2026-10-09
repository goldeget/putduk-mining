import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  evaluateNonmoneyMission,
  type NonmoneyRewardPolicy,
  type VerifiedMissionOriginal,
} from "@/domain/events/nonmoney-reward";
const id = "11111111-1111-4111-8111-111111111111",
  sourceId = "22222222-2222-4222-8222-222222222222";
const policy: NonmoneyRewardPolicy = {
  eventId: id,
  ruleId: id,
  revisionId: id,
  version: 1,
  state: "APPROVED",
  scope: "LOCAL_QA",
  auditId: id,
  approvedBy: id,
  sourceType: "MINING_STARTED.v1",
  startsAt: "2026-10-09T00:00:00Z",
  endsAt: "2026-10-10T00:00:00Z",
  rewardKind: "BADGE",
  rewardCode: "LOCAL_QA_FIRST_MINING",
};
const source: VerifiedMissionOriginal = {
  eventId: sourceId,
  eventType: "MINING_STARTED.v1",
  memberId: id,
  occurredAt: "2026-10-09T01:00:00Z",
  digest: "a".repeat(64),
  originalVerified: true,
};
const base = {
  authority: "RULE_ENGINE" as const,
  policy,
  source,
  memberId: id,
  joinedAt: "2026-10-09T00:30:00Z",
  expectedRevisionId: id,
  claimedKeys: new Set<string>(),
  runtimeScope: "LOCAL_QA" as const,
};
describe("operator approved nonmoney original mission evaluator", () => {
  it("grants a deterministic original-bound nonfinancial claim and freezes evidence", () => {
    const decision = evaluateNonmoneyMission(base);
    expect(decision.outcome).toBe("GRANT");
    if (decision.outcome !== "GRANT") return;
    expect(decision.claimKey).toBe(`event-reward:${id}:${id}:${id}`);
    expect(decision.rewardKind).toBe("BADGE");
    expect(Object.isFrozen(decision.qualification)).toBe(true);
    expect(decision.qualification.sourceDigest).toBe(source.digest);
    expect(decision).not.toHaveProperty("rewardKrw");
  });
  it("never promotes local QA rules into production or accepts AI approval", () => {
    expect(
      evaluateNonmoneyMission({ ...base, runtimeScope: "PRODUCTION" }).outcome,
    ).toBe("INELIGIBLE");
    expect(
      evaluateNonmoneyMission({ ...base, authority: "AI_PROPOSAL" }).outcome,
    ).toBe("INELIGIBLE");
    expect(
      evaluateNonmoneyMission({
        ...base,
        policy: { ...policy, state: "DRAFT" as never },
      }).outcome,
    ).toBe("INELIGIBLE");
  });
  it("rejects stale approval, other member, forged original and wrong mission event", () => {
    for (const patch of [
      { expectedRevisionId: sourceId },
      { source: { ...source, memberId: sourceId } },
      { source: { ...source, originalVerified: false } },
      { source: { ...source, digest: "bad" } },
      { source: { ...source, eventType: "WITHDRAWAL_COMPLETED.v1" as const } },
    ])
      expect(evaluateNonmoneyMission({ ...base, ...patch }).outcome).toBe(
        "INELIGIBLE",
      );
  });
  it("does not retroactively qualify pre-join or out-of-schedule originals", () => {
    for (const occurredAt of [
      "2026-10-09T00:10:00Z",
      "2026-10-08T23:00:00Z",
      "2026-10-10T00:00:00Z",
      "broken",
    ])
      expect(
        evaluateNonmoneyMission({ ...base, source: { ...source, occurredAt } })
          .outcome,
      ).toBe("INELIGIBLE");
  });
  it("deduplicates by stable rule identity even when an approved revision version changes", () => {
    const key = `event-reward:${id}:${id}:${id}`;
    expect(
      evaluateNonmoneyMission({
        ...base,
        claimedKeys: new Set([key]),
        policy: { ...policy, version: 2 },
      }),
    ).toEqual({ outcome: "INELIGIBLE", reason: "ALREADY_CLAIMED" });
  });
});
