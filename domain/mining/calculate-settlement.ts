import { calculateFixedPointAmount } from "@/domain/shared/fixed-point";

export type SettlementRuleVersion = {
  baseRateAtomicPerSecond: bigint;
  effectiveAt: Date;
  equipmentEfficiencyBps: number;
  eventMultiplierBps: number;
  statusMultiplierBps: number;
  versionId: string;
  worldMultiplierBps: number;
};

export type SettlementSegment = {
  amountAtomic: bigint;
  elapsedMilliseconds: number;
  endedAt: Date;
  ruleVersionId: string;
  startedAt: Date;
};

export type SettlementResult = {
  segments: readonly SettlementSegment[];
  totalAmountAtomic: bigint;
};

function compareRules(
  left: SettlementRuleVersion,
  right: SettlementRuleVersion,
) {
  return left.effectiveAt.getTime() - right.effectiveAt.getTime();
}

export function calculateSettlement({
  lastSettledAt,
  ruleVersions,
  serverNow,
}: {
  lastSettledAt: Date;
  ruleVersions: readonly SettlementRuleVersion[];
  serverNow: Date;
}): SettlementResult {
  const startMs = lastSettledAt.getTime();
  const endMs = serverNow.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new RangeError(
      "Settlement interval must use valid, increasing server time.",
    );
  }

  if (endMs === startMs) {
    return { segments: [], totalAmountAtomic: 0n };
  }

  const rules = [...ruleVersions].sort(compareRules);
  const uniqueVersionIds = new Set(rules.map((rule) => rule.versionId));
  if (uniqueVersionIds.size !== rules.length) {
    throw new Error("Settlement rule version IDs must be unique.");
  }

  const initialRuleIndex = rules.findLastIndex(
    (rule) => rule.effectiveAt.getTime() <= startMs,
  );
  if (initialRuleIndex < 0) {
    throw new Error("No settlement rule applies at lastSettledAt.");
  }

  const applicableRules = rules
    .slice(initialRuleIndex)
    .filter(
      (rule, index) =>
        index === 0 ||
        (rule.effectiveAt.getTime() > startMs &&
          rule.effectiveAt.getTime() < endMs),
    );

  const segments = applicableRules.map((rule, index): SettlementSegment => {
    const segmentStartMs = index === 0 ? startMs : rule.effectiveAt.getTime();
    const nextRule = applicableRules[index + 1];
    const segmentEndMs = nextRule ? nextRule.effectiveAt.getTime() : endMs;
    const elapsedMilliseconds = segmentEndMs - segmentStartMs;

    const amountAtomic = calculateFixedPointAmount({
      baseRateAtomicPerSecond: rule.baseRateAtomicPerSecond,
      elapsedMilliseconds: BigInt(elapsedMilliseconds),
      multipliersBps: [
        rule.equipmentEfficiencyBps,
        rule.worldMultiplierBps,
        rule.eventMultiplierBps,
        rule.statusMultiplierBps,
      ],
    });

    return {
      amountAtomic,
      elapsedMilliseconds,
      endedAt: new Date(segmentEndMs),
      ruleVersionId: rule.versionId,
      startedAt: new Date(segmentStartMs),
    };
  });

  return {
    segments,
    totalAmountAtomic: segments.reduce(
      (total, segment) => total + segment.amountAtomic,
      0n,
    ),
  };
}

export function settlementIdempotencyKey({
  miningSessionId,
  settledFrom,
  settledTo,
}: {
  miningSessionId: string;
  settledFrom: Date;
  settledTo: Date;
}): string {
  if (!miningSessionId.trim()) {
    throw new Error("miningSessionId is required.");
  }

  return [
    miningSessionId,
    settledFrom.toISOString(),
    settledTo.toISOString(),
  ].join(":");
}
