import "server-only";

import { calculateFixedPointAmount } from "@/domain/shared/fixed-point";

const MAX_DATABASE_ATOMIC = 9_223_372_036_854_775_807n;

function validateRule(rule: SettlementRuleVersion) {
  if (
    !rule.versionId.trim() ||
    rule.versionId !== rule.versionId.trim() ||
    !Number.isFinite(rule.effectiveAt.getTime())
  ) {
    throw new Error(
      "Settlement rules need a valid version ID and effective time.",
    );
  }
  if (
    rule.baseRateAtomicPerSecond < 0n ||
    rule.baseRateAtomicPerSecond > MAX_DATABASE_ATOMIC
  ) {
    throw new RangeError("Settlement base rate is outside the database range.");
  }
  for (const multiplier of [
    rule.equipmentEfficiencyBps,
    rule.worldMultiplierBps,
    rule.eventMultiplierBps,
    rule.statusMultiplierBps,
  ]) {
    if (
      !Number.isSafeInteger(multiplier) ||
      multiplier < 0 ||
      multiplier > 100_000
    ) {
      throw new RangeError(
        "Settlement multipliers are outside the database range.",
      );
    }
  }
}

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

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs < startMs ||
    !Number.isSafeInteger(endMs - startMs)
  ) {
    throw new RangeError(
      "Settlement interval must use valid, increasing server time.",
    );
  }

  ruleVersions.forEach(validateRule);
  const rules = [...ruleVersions].sort(compareRules);
  const uniqueVersionIds = new Set(rules.map((rule) => rule.versionId));
  if (uniqueVersionIds.size !== rules.length) {
    throw new Error("Settlement rule version IDs must be unique.");
  }
  if (
    rules.some(
      (rule, index) =>
        index > 0 &&
        rule.effectiveAt.getTime() === rules[index - 1]!.effectiveAt.getTime(),
    )
  ) {
    throw new Error("Settlement rule effective times must be unique.");
  }

  if (endMs === startMs) {
    return { segments: [], totalAmountAtomic: 0n };
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

  const totalAmountAtomic = segments.reduce(
    (total, segment) => total + segment.amountAtomic,
    0n,
  );
  if (totalAmountAtomic > MAX_DATABASE_ATOMIC) {
    throw new RangeError("Settlement amount is outside the database range.");
  }
  return { segments, totalAmountAtomic };
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
  if (!miningSessionId.trim() || miningSessionId !== miningSessionId.trim()) {
    throw new Error("miningSessionId is required.");
  }
  if (
    !Number.isFinite(settledFrom.getTime()) ||
    !Number.isFinite(settledTo.getTime()) ||
    settledTo.getTime() <= settledFrom.getTime()
  ) {
    throw new RangeError(
      "Settlement keys require a valid, increasing interval.",
    );
  }

  return [
    miningSessionId,
    settledFrom.toISOString(),
    settledTo.toISOString(),
  ].join(":");
}
