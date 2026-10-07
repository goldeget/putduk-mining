import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MICROSECONDS_PER_DAY,
  policyTextDigest,
  validateEconomyPolicy,
  type EconomyPolicyDocument,
  type PolicyPublicationIdentity,
} from "@/domain/mining/economy-policy";
import {
  createFundingEntitlementPreview,
  exactMicroKrw,
  fundingPreviewStatus,
  previewFundingInterval,
  type FundingConditionInput,
  type FundingEntitlementPreview,
  type FundingForwardChange,
} from "@/domain/mining/funding-entitlement";

const manifestText = readFileSync(
  new URL(
    "../../docs/product/economy-v1-approved-2026-10-03.json",
    import.meta.url,
  ),
  "utf8",
);
const approvalEvidenceText = readFileSync(
  new URL(
    "../../docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md",
    import.meta.url,
  ),
  "utf8",
);
const source = JSON.parse(manifestText) as EconomyPolicyDocument;
const configText = JSON.stringify(source);
const expected: PolicyPublicationIdentity = {
  policyId: "00000000-0000-4000-8000-000000000001",
  publicationId: "00000000-0000-4000-8000-000000000002",
  policyVersion: source.policyVersion,
  revisionId: "00000000-0000-4000-8000-000000000003",
  publishedAtMicroseconds: 0n,
  effectiveFromMicroseconds: 0n,
  effectiveUntilMicroseconds: null,
  configDigest: policyTextDigest(configText),
  manifestDigest: policyTextDigest(manifestText),
  approvalEvidence: source.approvalEvidence,
  approvalEvidenceDigest: policyTextDigest(approvalEvidenceText),
};
const policy = validateEconomyPolicy({
  configuration: source,
  configText,
  manifestText,
  approvalEvidenceText,
  publication: { ...expected, state: "PUBLISHED" },
  expected,
  sourceComplete: true,
  serverNowMicroseconds: 0n,
});
const microPerKrw = BigInt(source.microKrwPerKrw);
const cycle = BigInt(source.cycleDays) * MICROSECONDS_PER_DAY;
const day = MICROSECONDS_PER_DAY;

function condition(principal = 100000n, revision = 1n): FundingConditionInput {
  return {
    policy,
    expectedPrincipalRevision: revision,
    funding: {
      principalRevision: revision,
      sourceComplete: true,
      eligiblePrincipalKrw: principal,
      lots: [
        {
          lotId: "confirmed-lot-1",
          remainingEligiblePrincipalKrw: principal,
          effectiveFromMicroseconds: 0n,
        },
      ],
    },
    controls: { safeMode: false, paused: false, eligible: true },
    allocations: [
      {
        productId: "published-product-fixture",
        allocationBps: source.allocation.maximumTotalBps,
        published: true,
        sourceComplete: true,
      },
    ],
  };
}
function deposit(
  previous: FundingConditionInput,
  principal: bigint,
  effectiveFromMicroseconds: bigint,
): FundingConditionInput {
  const revision = previous.funding.principalRevision + 1n;
  const input = condition(principal, revision);
  return {
    ...input,
    funding: {
      ...input.funding,
      lots: [
        ...previous.funding.lots,
        {
          lotId: `new-deposit-${revision}`,
          remainingEligiblePrincipalKrw:
            principal - previous.funding.eligiblePrincipalKrw,
          effectiveFromMicroseconds,
        },
      ],
    },
  };
}
function start(input = condition()) {
  return createFundingEntitlementPreview({
    condition: input,
    serverNowMicroseconds: 0n,
    expectedEntitlementRevision: 1n,
  });
}
function run(
  state: FundingEntitlementPreview,
  end: bigint,
  changes: readonly FundingForwardChange[] = [],
) {
  return previewFundingInterval({
    state,
    serverNowMicroseconds: end,
    expectedEntitlementRevision: state.entitlementRevision,
    changes,
  });
}
function change(
  at: bigint,
  input: FundingConditionInput,
  prior = 1n,
): FundingForwardChange {
  return {
    effectiveFromMicroseconds: at,
    condition: input,
    expectedEntitlementRevision: prior,
    entitlementRevision: prior + 1n,
  };
}
function exhausted(at = 5n * day, input = condition()) {
  const original = start(input);
  return createFundingEntitlementPreview({
    condition: input,
    serverNowMicroseconds: at,
    expectedEntitlementRevision: 1n,
    existingCycle: {
      ...original,
      cursorMicroseconds: at,
      baseUsed: original.baseCapacity,
      conditionalRetentionUsed: original.conditionalRetentionCapacity,
    },
  });
}
function wholeMicro(value: { numerator: bigint; denominator: bigint }) {
  return value.numerator / value.denominator;
}
function publication(
  document: EconomyPolicyDocument,
  overrides: Partial<PolicyPublicationIdentity>,
  now: bigint,
) {
  const text = JSON.stringify(document);
  const identity = {
    ...expected,
    policyVersion: document.policyVersion,
    configDigest: policyTextDigest(text),
    manifestDigest: policyTextDigest(text),
    ...overrides,
  };
  return validateEconomyPolicy({
    configuration: document,
    configText: text,
    manifestText: text,
    approvalEvidenceText,
    publication: { ...identity, state: "PUBLISHED" },
    expected: identity,
    sourceComplete: true,
    serverNowMicroseconds: now,
  });
}

describe("read-only V1 funding entitlement engine", () => {
  it.each(source.tiers)(
    "keeps principal-proportional BASE speed without an extra Tier multiplier at $code",
    (tier) => {
      const principal = BigInt(tier.minimumPrincipalKrw);
      const initial = start(condition(principal));
      const baselinePrincipal = BigInt(source.minimumPrincipalKrw);
      const baseline = run(start(condition(baselinePrincipal)), day)
        .segments[0]!.baseAccrued;
      const actual = run(initial, day).segments[0]!.baseAccrued;

      expect(initial.condition.tierCode).toBe(tier.code);
      expect(initial.condition.slots).toBe(tier.slots);
      expect(initial.condition.allocatedBaseSpeedMultiplier).toEqual(
        exactMicroKrw(1n),
      );
      expect(actual.numerator * baseline.denominator * baselinePrincipal).toBe(
        baseline.numerator * actual.denominator * principal,
      );
    },
  );

  it("does not gate a source-confirmed published Product identity by Funding Tier", () => {
    // Preview-only trusted-source fixtures; no real catalog publication or
    // proposed product modifier is implied by these descriptive identities.
    const input = condition(BigInt(source.minimumPrincipalKrw));
    const baseline = run(start(input), day);
    for (const identity of [
      "nvidia",
      "tesla",
      "spacex",
      "sk-hynix",
      "btc",
      "etf",
      "gold",
    ]) {
      const state = start({
        ...input,
        allocations: [
          {
            ...input.allocations[0]!,
            productId: `published-fixture-${identity}`,
          },
        ],
      });
      expect(state.condition.tierCode).toBe("L1");
      expect(state.condition.slots).toBe(1);
      expect(state.baseCapacity).toEqual(baseline.state.baseCapacity);
      expect(run(state, day).segments[0]!.baseAccrued).toEqual(
        baseline.segments[0]!.baseAccrued,
      );
    }
  });

  it("reads base, conditional retention and minimum activation from approved policy data", () => {
    const state = start();
    expect(state.mode).toBe("PREVIEW_ONLY");
    expect(state.condition.tierCode).toBe("L1");
    expect(wholeMicro(state.baseCapacity)).toBe(15000n * microPerKrw);
    expect(wholeMicro(state.conditionalRetentionCapacity)).toBe(
      15000n * microPerKrw,
    );
    expect(() =>
      start(condition(BigInt(source.minimumPrincipalKrw) - 1n)),
    ).toThrow("FUNDING_BELOW_MINIMUM_NOT_ACTIVATED");
    expect(state.condition.input.policy.document.platformFeesKrw.mining).toBe(
      "0",
    );
  });

  it("keeps large integer amounts exact beyond Number precision and the last tier threshold", () => {
    const principal = 9007199254740993123456789n;
    const state = start(condition(principal));
    expect(state.condition.tierCode).toBe("L14");
    expect(state.baseCapacity).toEqual(
      exactMicroKrw(
        principal * microPerKrw * BigInt(source.baseCycleRateBps),
        10000n,
      ),
    );
    expect(() => start(condition(100000 as never))).toThrow(
      "INVALID_ELIGIBLE_PRINCIPAL",
    );
  });

  it("settles whole KRW only while retaining micro and submicro carry", () => {
    const result = run(start(condition(1000000n)), 220_000_000n);
    expect(result.settlementReadyKrw).toBe(12n);
    expect(result.rewardCarryMicroKrw).toBe(731481n);
    expect(result.rewardCarrySubMicroKrw.numerator).toBeGreaterThan(0n);
    expect(result.conditionalRetentionSettlementReadyKrw).toBe(0n);
    expect(result.retentionQualificationRequired).toBe(true);
    expect(result.state.conditionalRetentionUsed.numerator).toBeGreaterThan(0n);
  });

  it("matches the private SQL default 12.73 vector without qualifying maintenance", () => {
    // Same approved reference vector as default_funding_engine_exact_math.sql;
    // this verifier neither accepts earnings nor supplies a command amount.
    const result = run(start(condition(100000n)), 2_199_744_000n);
    expect(result.state.baseUsed).toEqual(exactMicroKrw(12_730_000n));
    expect(result.state.conditionalRetentionUsed).toEqual(
      exactMicroKrw(12_730_000n),
    );
    expect(result.settlementReadyKrw).toBe(12n);
    expect(result.rewardCarryMicroKrw).toBe(730000n);
    expect(result.rewardCarrySubMicroKrw).toEqual(exactMicroKrw(0n));
    expect(result.conditionalRetentionSettlementReadyKrw).toBe(0n);
    expect(result.retentionQualificationRequired).toBe(true);
  });

  it("keeps exact default partial-allocation parity with SQL and independent maintenance", () => {
    const input = condition(100000n);
    const result = run(
      start({
        ...input,
        allocations: [{ ...input.allocations[0]!, allocationBps: 5000 }],
      }),
      2_199_744_000n,
    );
    expect(result.state.baseUsed).toEqual(exactMicroKrw(6_365_000n));
    expect(result.state.conditionalRetentionUsed).toEqual(
      exactMicroKrw(12_730_000n),
    );
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(15_000n * microPerKrw),
    );
    expect(result.settlementReadyKrw).toBe(6n);
    expect(result.rewardCarryMicroKrw).toBe(365000n);
    expect(result.retentionQualificationRequired).toBe(true);
  });

  it("produces identical exact accrual and carry for whole and arbitrarily partitioned intervals", () => {
    const whole = run(start(condition(1000003n)), 701_234_000n);
    let current = start(condition(1000003n));
    let totalCredits = 0n;
    for (const end of [
      1n,
      7n,
      999_000n,
      1_203_000n,
      20_001_000n,
      400_003_000n,
      701_234_000n,
    ]) {
      const result = run(current, end);
      totalCredits += result.settlementReadyKrw;
      current = result.state;
    }
    expect(totalCredits).toBe(whole.settlementReadyKrw);
    expect(totalCredits).toBeGreaterThan(0n);
    expect(current.baseRewardCarry).toEqual(whole.state.baseRewardCarry);
    expect(current.baseUsed).toEqual(whole.state.baseUsed);
    expect(current.conditionalRetentionUsed).toEqual(
      whole.state.conditionalRetentionUsed,
    );
  });

  it("increments used once and returns an idempotent zero interval without mutating inputs", () => {
    const input = condition();
    const original = start(input);
    expect(Object.isFrozen(input.funding)).toBe(false);
    const result = run(original, day);
    expect(original.baseUsed).toEqual(exactMicroKrw(0n));
    expect(input.funding.eligiblePrincipalKrw).toBe(100000n);
    const again = run(result.state, day);
    expect(again.settlementReadyKrw).toBe(0n);
    expect(again.state.baseUsed).toEqual(result.state.baseUsed);
    expect(again.state.baseRewardCarry).toEqual(result.state.baseRewardCarry);
    expect(again.segments).toHaveLength(0);
  });

  it("prorates a deposit forward, keeps the original anchor and resumes only after its boundary", () => {
    const initial = exhausted();
    expect(fundingPreviewStatus(initial)).toBe("CAPACITY_EXHAUSTED");
    const updated = deposit(initial.condition.input, 1000000n, 10n * day);
    const result = run(initial, 11n * day, [change(10n * day, updated)]);
    expect(result.segments[0]!.status).toBe("CAPACITY_EXHAUSTED");
    expect(result.segments[0]!.baseAccrued).toEqual(exactMicroKrw(0n));
    expect(result.segments[1]!.status).toBe("ACTIVE");
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(105000n * microPerKrw),
    );
    expect(result.state.anchorMicroseconds).toBe(initial.anchorMicroseconds);
    expect(result.state.cycleEndMicroseconds).toBe(
      initial.cycleEndMicroseconds,
    );
    expect(result.state.baseUsed.numerator).toBeGreaterThan(
      initial.baseUsed.numerator,
    );
    expect(initial.baseUsed).toEqual(initial.baseCapacity);
  });

  it("preserves used and previous rewards after a downgrade, including used above revised capacity", () => {
    const initial = exhausted(10n * day, condition(1000000n));
    const result = run(initial, 11n * day, [
      change(10n * day, condition(100000n, 2n)),
    ]);
    expect(result.status).toBe("CAPACITY_EXHAUSTED");
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(60000n * microPerKrw),
    );
    expect(result.state.baseUsed).toEqual(initial.baseUsed);
    expect(result.state.conditionalRetentionUsed).toEqual(
      initial.conditionalRetentionUsed,
    );
    expect(result.settlementReadyKrw).toBe(0n);
  });

  it("never exceeds global capacity when one recorded portion is already above its revised limit", () => {
    const original = start();
    const existing = createFundingEntitlementPreview({
      condition: original.condition.input,
      serverNowMicroseconds: 0n,
      expectedEntitlementRevision: 1n,
      existingCycle: {
        ...original,
        baseCapacity: exactMicroKrw(10000n * microPerKrw),
        conditionalRetentionCapacity: exactMicroKrw(10000n * microPerKrw),
        baseUsed: exactMicroKrw(15000n * microPerKrw),
        conditionalRetentionUsed: exactMicroKrw(0n),
      },
    });
    const whole = run(existing, 20n * day);
    expect(whole.state.baseUsed).toEqual(existing.baseUsed);
    expect(whole.state.conditionalRetentionUsed).toEqual(
      exactMicroKrw(5000n * microPerKrw),
    );
    expect(whole.status).toBe("CAPACITY_EXHAUSTED");
    expect(whole.settlementReadyKrw).toBe(0n);
    const split = run(run(existing, 7n * day).state, 20n * day);
    expect(split.state.baseUsed).toEqual(whole.state.baseUsed);
    expect(split.state.conditionalRetentionUsed).toEqual(
      whole.state.conditionalRetentionUsed,
    );
  });

  it("keeps base credits exact when historical conditional used exceeds its revised portion", () => {
    const input = condition(1000000n);
    const original = start(input);
    const recorded = createFundingEntitlementPreview({
      condition: input,
      serverNowMicroseconds: 0n,
      expectedEntitlementRevision: 1n,
      existingCycle: {
        ...original,
        baseCapacity: exactMicroKrw(30000n * microPerKrw),
        conditionalRetentionCapacity: exactMicroKrw(10000n * microPerKrw),
        baseUsed: exactMicroKrw(0n),
        conditionalRetentionUsed: exactMicroKrw(15000n * microPerKrw),
      },
    });
    const whole = run(recorded, 8n * day);
    const first = run(recorded, 3n * day);
    const split = run(first.state, 8n * day);
    expect(whole.state.baseUsed).toEqual(exactMicroKrw(25000n * microPerKrw));
    expect(whole.settlementReadyKrw).toBe(25000n);
    expect(first.settlementReadyKrw + split.settlementReadyKrw).toBe(
      whole.settlementReadyKrw,
    );
    expect(split.state.baseUsed).toEqual(whole.state.baseUsed);
    expect(whole.state.conditionalRetentionUsed).toEqual(
      recorded.conditionalRetentionUsed,
    );
    expect(whole.status).toBe("CAPACITY_EXHAUSTED");
  });

  it("uses only the remaining interval for a last-millisecond deposit", () => {
    const initial = exhausted(cycle - 1n);
    const result = run(initial, cycle - 1n, [
      change(
        cycle - 1n,
        deposit(initial.condition.input, 1000000n, cycle - 1n),
      ),
    ]);
    const fullNew = start(condition(1000000n)).baseCapacity;
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(
        initial.baseCapacity.numerator * cycle +
          (fullNew.numerator - initial.baseCapacity.numerator),
        cycle,
      ),
    );
    expect(result.state.baseUsed).toEqual(initial.baseUsed);
    expect(result.state.cycleEndMicroseconds).toBe(cycle);
    expect(result.settlementReadyKrw).toBe(0n);
  });

  it("applies approved effect scope without allowing speed-only changes to reopen exhausted capacity", () => {
    const initial = exhausted();
    const boosted = {
      ...condition(),
      effects: {
        speedMultipliersBps: [source.campaign.maximumSingleSpeedMultiplierBps],
      },
    };
    const result = run(initial, 6n * day, [change(5n * day, boosted)]);
    expect(result.state.baseCapacity).toEqual(initial.baseCapacity);
    expect(result.state.conditionalRetentionCapacity).toEqual(
      initial.conditionalRetentionCapacity,
    );
    expect(result.status).toBe("CAPACITY_EXHAUSTED");
    expect(result.state.baseUsed).toEqual(initial.baseUsed);
    expect(result.settlementReadyKrw).toBe(0n);
    const capacityBoost = {
      ...condition(),
      effects: {
        capacityBoostsBps: [source.campaign.maximumSingleCapacityBoostBps],
      },
    };
    const reopened = run(initial, 6n * day, [change(5n * day, capacityBoost)]);
    expect(reopened.status).toBe("ACTIVE");
    expect(reopened.state.baseCapacity.numerator).toBeGreaterThan(
      initial.baseCapacity.numerator,
    );
    expect(reopened.state.conditionalRetentionCapacity).toEqual(
      initial.conditionalRetentionCapacity,
    );
  });

  it("caps globally after weighted product and common speed effects, without increasing either capacity or retention", () => {
    const input = condition(1000000n);
    const baseline = run(start(input), day);
    const modified = {
      ...input,
      allocations: [
        {
          ...input.allocations[0]!,
          productId: "product-70",
          allocationBps: 7000,
          productMultiplierBps: 11000,
        },
        {
          ...input.allocations[0]!,
          productId: "product-30",
          allocationBps: 3000,
          productMultiplierBps: 9000,
        },
      ],
      effects: {
        userOverrideMultiplierBps: 12000,
        speedMultipliersBps: [12500],
      },
    };
    const result = run(start(modified), day);
    expect(result.status).toBe("ACTIVE");
    expect(result.state.baseCapacity).toEqual(baseline.state.baseCapacity);
    expect(result.state.conditionalRetentionCapacity).toEqual(
      baseline.state.conditionalRetentionCapacity,
    );
    expect(result.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(7500n * microPerKrw),
    );
    expect(result.segments[0]!.conditionalRetentionAccrued).toEqual(
      baseline.segments[0]!.conditionalRetentionAccrued,
    );
  });

  it("multiplies all speed ratios exactly before one final cap and preserves split interval equivalence", () => {
    const input = {
      ...condition(),
      allocations: [
        { ...condition().allocations[0]!, productMultiplierBps: 10001 },
      ],
      effects: {
        userOverrideMultiplierBps: 10003,
        speedMultipliersBps: [10007, 10009],
      },
    };
    const initial = start(input);
    const whole = run(initial, day);
    const numerator = 500n * microPerKrw * 10001n * 10003n * 10007n * 10009n;
    expect(whole.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(numerator, 10000n ** 4n),
    );
    const first = run(initial, day / 3n);
    const split = run(first.state, day);
    expect(split.state.baseUsed).toEqual(whole.state.baseUsed);
    expect(split.state.baseRewardCarry).toEqual(whole.state.baseRewardCarry);
    expect(first.settlementReadyKrw + split.settlementReadyKrw).toBe(
      whole.settlementReadyKrw,
    );
    const reordered = run(
      start({
        ...input,
        effects: { ...input.effects, speedMultipliersBps: [10009, 10007] },
      }),
      day,
    );
    expect(reordered.state.baseUsed).toEqual(whole.state.baseUsed);
    const capped = run(
      start({
        ...input,
        effects: {
          userOverrideMultiplierBps: 12000,
          speedMultipliersBps: [12500, 12500],
        },
      }),
      day,
    );
    expect(capped.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(750n * microPerKrw),
    );
  });

  it("applies a speed publication only to its future BASE interval and never replenishes cycle usage", () => {
    const initial = start();
    const before = run(initial, 5n * day);
    const input = {
      ...condition(),
      effects: {
        userOverrideMultiplierBps: 12000,
        speedMultipliersBps: [12500],
      },
    };
    const result = run(before.state, 6n * day, [change(5n * day, input)]);
    expect(before.state.baseUsed).toEqual(exactMicroKrw(2500n * microPerKrw));
    expect(result.state.baseUsed).toEqual(exactMicroKrw(3250n * microPerKrw));
    expect(result.state.conditionalRetentionUsed).toEqual(
      exactMicroKrw(3000n * microPerKrw),
    );
    expect(result.settlementReadyKrw).toBe(750n);
    expect(result.state.anchorMicroseconds).toBe(initial.anchorMicroseconds);
    expect(result.state.cycleEndMicroseconds).toBe(
      initial.cycleEndMicroseconds,
    );
    expect(result.state.baseCapacity).toEqual(initial.baseCapacity);
    expect(result.state.conditionalRetentionCapacity).toEqual(
      initial.conditionalRetentionCapacity,
    );
  });

  it("uses explicit capacity boosts only for base ceiling, preserving base speed, retention and individual approved limits", () => {
    const plain = run(start(), day);
    const input = {
      ...condition(),
      effects: { capacityBoostsBps: [1000, 1000] },
    };
    const result = run(start(input), day);
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(18000n * microPerKrw),
    );
    expect(result.state.conditionalRetentionCapacity).toEqual(
      plain.state.conditionalRetentionCapacity,
    );
    expect(result.segments[0]!.baseAccrued).toEqual(
      plain.segments[0]!.baseAccrued,
    );
    expect(result.segments[0]!.conditionalRetentionAccrued).toEqual(
      plain.segments[0]!.conditionalRetentionAccrued,
    );
    expect(() =>
      start({
        ...condition(),
        allocations: [
          { ...condition().allocations[0]!, productMultiplierBps: 12000 },
        ],
      }),
    ).toThrow("PRODUCT_ALLOCATION_INVALID");
    expect(() =>
      start({ ...condition(), effects: { speedMultipliersBps: [12501] } }),
    ).toThrow("SPEED_CAMPAIGN_LIMIT");
    expect(() =>
      start({
        ...condition(),
        effects: { capacityBoostsBps: [1000, 1000, 1] },
      }),
    ).toThrow("CAPACITY_CAMPAIGN_LIMIT");
  });

  it("keeps safe mode, pause and eligibility ahead of a capacity-driven resume", () => {
    const initial = exhausted();
    const input = {
      ...deposit(initial.condition.input, 1000000n, 5n * day),
      controls: { safeMode: true, paused: true, eligible: false },
    };
    const safe = run(initial, 6n * day, [change(5n * day, input)]);
    expect(safe.status).toBe("SAFE_MODE");
    expect(safe.state.baseCapacity.numerator).toBeGreaterThan(
      initial.baseCapacity.numerator,
    );
    expect(safe.state.baseUsed).toEqual(initial.baseUsed);
    const paused = run(safe.state, 7n * day, [
      change(
        6n * day,
        {
          ...input,
          controls: { safeMode: false, paused: true, eligible: false },
        },
        2n,
      ),
    ]);
    expect(paused.status).toBe("PAUSED");
    const ineligible = run(paused.state, 8n * day, [
      change(
        7n * day,
        {
          ...input,
          controls: { safeMode: false, paused: false, eligible: false },
        },
        3n,
      ),
    ]);
    expect(ineligible.status).toBe("INELIGIBLE");
    expect(ineligible.settlementReadyKrw).toBe(0n);
    expect(ineligible.state.baseUsed).toEqual(initial.baseUsed);
  });

  it("resets only at the original end, preserves carry and does not pay unused paused capacity", () => {
    const earned = run(start(condition(1000003n)), 701234n);
    const pausedInput = {
      ...earned.state.condition.input,
      controls: { safeMode: false, paused: true, eligible: true },
    };
    const before = run(earned.state, cycle - 1n, [
      change(701234n, pausedInput),
    ]);
    expect(before.closedCycles).toHaveLength(0);
    const reset = run(before.state, cycle);
    expect(reset.closedCycles).toHaveLength(1);
    expect(reset.state.cycleIndex).toBe(1n);
    expect(reset.state.anchorMicroseconds).toBe(0n);
    expect(reset.state.cycleEndMicroseconds).toBe(cycle * 2n);
    expect(reset.state.baseUsed).toEqual(exactMicroKrw(0n));
    expect(reset.state.baseRewardCarry).toEqual(earned.state.baseRewardCarry);
    expect(reset.settlementReadyKrw).toBe(0n);
    expect(reset.closedCycles[0]!.retentionQualificationRequired).toBe(true);
  });

  it("partitions overdue processing by original cycle boundaries without carrying unused capacity", () => {
    const result = run(start(), cycle * 2n + day);
    expect(result.closedCycles).toHaveLength(2);
    expect(result.segments.map((segment) => segment.cycleIndex)).toEqual([
      0n,
      1n,
      2n,
    ]);
    expect(result.settlementReadyKrw).toBe(30500n);
    expect(result.state.baseUsed).toEqual(exactMicroKrw(500n * microPerKrw));
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(15000n * microPerKrw),
    );
  });

  it("applies a change at the end to the next full cycle without rewriting the closed cycle", () => {
    const initial = start();
    const result = run(initial, cycle, [
      change(cycle, deposit(initial.condition.input, 1000000n, cycle)),
    ]);
    expect(result.closedCycles[0]!.baseUsed).toEqual(initial.baseCapacity);
    expect(result.state.baseCapacity).toEqual(
      start(condition(1000000n)).baseCapacity,
    );
    expect(result.state.cycleIndex).toBe(1n);
    expect(result.state.anchorMicroseconds).toBe(0n);
  });

  it("pins consecutive published policies to the exact effective boundary and never rewrites earlier accrual", () => {
    const boundary = 15n * day;
    const previousPolicy = publication(
      source,
      { effectiveUntilMicroseconds: boundary },
      0n,
    );
    const nextDocument = structuredClone(source);
    nextDocument.policyVersion = "future-approved-fixture";
    nextDocument.baseCycleRateBps = 1000;
    const successor = publication(
      nextDocument,
      {
        policyId: "00000000-0000-4000-8000-000000000004",
        publicationId: "00000000-0000-4000-8000-000000000005",
        revisionId: "00000000-0000-4000-8000-000000000006",
        publishedAtMicroseconds: day,
        effectiveFromMicroseconds: boundary,
      },
      boundary,
    );
    const input = { ...condition(), policy: previousPolicy };
    const initial = start(input);
    const next = { ...input, policy: successor };
    const result = run(initial, cycle, [change(boundary, next)]);
    expect(result.segments.map((segment) => segment.policyVersion)).toEqual([
      source.policyVersion,
      nextDocument.policyVersion,
    ]);
    expect(result.settlementReadyKrw).toBe(12500n);
    expect(result.closedCycles[0]!.baseUsed).toEqual(
      exactMicroKrw(12500n * microPerKrw),
    );
    expect(result.state.anchorMicroseconds).toBe(0n);
    expect(result.state.baseCapacity).toEqual(
      exactMicroKrw(10000n * microPerKrw),
    );
    expect(() => run(initial, boundary)).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
    expect(() => run(start(), cycle, [change(boundary, next)])).toThrow(
      "POLICY_PUBLICATION_BOUNDARY_MISMATCH",
    );
    expect(() => run(initial, cycle, [change(boundary + day, next)])).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
    const reusedPublication = publication(nextDocument, {}, 0n);
    expect(() =>
      run(start(), day, [
        change(0n, { ...condition(), policy: reusedPublication }),
      ]),
    ).toThrow("POLICY_PUBLICATION_ID_REUSED");
    expect(initial.baseUsed).toEqual(exactMicroKrw(0n));
  });

  it("preserves retained lot age when total principal changes and rejects backdated new lots or silent lot increases", () => {
    const initial = run(start(), day).state;
    const added = deposit(initial.condition.input, 1000000n, day);
    expect(
      run(initial, 2n * day, [change(day, added)]).state.condition.input.funding
        .lots,
    ).toEqual(added.funding.lots);
    expect(() =>
      run(initial, 2n * day, [change(day, condition(1000000n, 2n))]),
    ).toThrow("PRINCIPAL_LOT_INCREASE_REQUIRES_CORRECTION_CONTRACT");
    const aged = {
      ...added,
      funding: {
        ...added.funding,
        lots: added.funding.lots.map((lot, index) =>
          index === 0 ? { ...lot, effectiveFromMicroseconds: day } : lot,
        ),
      },
    };
    expect(() => run(initial, 2n * day, [change(day, aged)])).toThrow(
      "PRINCIPAL_LOT_AGE_CHANGED",
    );
    const backdated = {
      ...added,
      funding: {
        ...added.funding,
        lots: added.funding.lots.map((lot, index) =>
          index === 1 ? { ...lot, effectiveFromMicroseconds: 0n } : lot,
        ),
      },
    };
    expect(() => run(initial, 2n * day, [change(day, backdated)])).toThrow(
      "NEW_PRINCIPAL_LOT_EFFECTIVE_BOUNDARY_MISMATCH",
    );
    expect(initial.condition.input.funding.lots).toHaveLength(1);
  });

  it("enforces one global capacity, total allocations and approved tier slots", () => {
    const input = condition(1000000n);
    const allocations = [
      { ...input.allocations[0]!, productId: "product-a", allocationBps: 5000 },
      { ...input.allocations[0]!, productId: "product-b", allocationBps: 5000 },
    ];
    const shared = run(start({ ...input, allocations }), day);
    expect(shared.state.baseUsed).toEqual(
      run(start(input), day).state.baseUsed,
    );
    expect(() =>
      start({
        ...input,
        allocations: [
          ...allocations,
          { ...allocations[0]!, productId: "product-c" },
        ],
      }),
    ).toThrow("GLOBAL_ALLOCATION_OR_SLOT_LIMIT");
    expect(() => start({ ...condition(), allocations })).toThrow(
      "GLOBAL_ALLOCATION_OR_SLOT_LIMIT",
    );
    expect(() =>
      start({ ...input, allocations: [allocations[0]!, allocations[0]!] }),
    ).toThrow("PRODUCT_ALLOCATION_SOURCE_UNCONFIRMED");
    const half = run(start({ ...input, allocations: [allocations[0]!] }), day);
    expect(wholeMicro(half.state.baseUsed) * 2n).toBe(
      wholeMicro(shared.state.baseUsed),
    );
    expect(half.state.baseCapacity).toEqual(shared.state.baseCapacity);
    expect(half.segments[0]!.conditionalRetentionAccrued).toEqual(
      shared.segments[0]!.conditionalRetentionAccrued,
    );
  });

  it("changes partial allocation BASE speed prospectively while maintenance follows eligible principal independently", () => {
    const input = condition();
    const half = {
      ...input,
      allocations: [{ ...input.allocations[0]!, allocationBps: 5000 }],
    };
    const lower = {
      ...input,
      allocations: [{ ...input.allocations[0]!, allocationBps: 3000 }],
    };
    const result = run(start(half), 2n * day, [change(day, lower)]);
    expect(result.segments.map((segment) => segment.baseAccrued)).toEqual([
      exactMicroKrw(250n * microPerKrw),
      exactMicroKrw(150n * microPerKrw),
    ]);
    expect(
      result.segments.map((segment) => segment.conditionalRetentionAccrued),
    ).toEqual([
      exactMicroKrw(500n * microPerKrw),
      exactMicroKrw(500n * microPerKrw),
    ]);
    expect(result.settlementReadyKrw).toBe(400n);
    expect(result.retentionQualificationRequired).toBe(true);
  });

  it("keeps principal-based conditional maintenance independent of partial allocation, speed and capacity effects", () => {
    const input = condition();
    const half = {
      ...input,
      allocations: [{ ...input.allocations[0]!, allocationBps: 5000 }],
    };
    const baseline = run(start(half), day);
    const modified = run(
      start({
        ...half,
        allocations: [{ ...half.allocations[0]!, productMultiplierBps: 11000 }],
        effects: {
          userOverrideMultiplierBps: 12000,
          speedMultipliersBps: [12500],
          capacityBoostsBps: [1000, 1000],
        },
      }),
      day,
    );
    expect(modified.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(412_500_000n),
    );
    expect(modified.state.baseCapacity).toEqual(
      exactMicroKrw(18000n * microPerKrw),
    );
    expect(modified.state.conditionalRetentionCapacity).toEqual(
      baseline.state.conditionalRetentionCapacity,
    );
    expect(modified.segments[0]!.conditionalRetentionAccrued).toEqual(
      exactMicroKrw(500n * microPerKrw),
    );
    expect(modified.settlementReadyKrw).toBe(412n);
    expect(modified.rewardCarryMicroKrw).toBe(500000n);
    expect(modified.retentionQualificationRequired).toBe(true);
  });

  it("applies partial global weights before common speed modifiers and the final cap", () => {
    const input = condition();
    const modified = {
      ...input,
      allocations: [
        {
          ...input.allocations[0]!,
          allocationBps: 5000,
          productMultiplierBps: 11000,
        },
      ],
      effects: {
        userOverrideMultiplierBps: 12000,
        speedMultipliersBps: [12500, 12500],
      },
    };
    const result = run(start(modified), day);
    // 0.50 × 1.10 × 1.20 × 1.25 × 1.25 = 1.03125, below the final1.50cap.
    expect(result.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(515_625_000n),
    );
    expect(result.state.condition.allocatedBaseSpeedMultiplier).toEqual(
      exactMicroKrw(33n, 32n),
    );
    expect(result.state.baseCapacity).toEqual(start(input).baseCapacity);
    expect(result.segments[0]!.conditionalRetentionAccrued).toEqual(
      exactMicroKrw(500n * microPerKrw),
    );
    const capped = run(
      start({
        ...modified,
        effects: {
          ...modified.effects,
          speedMultipliersBps: [12500, 12500, 12500, 12500],
        },
      }),
      day,
    );
    expect(capped.state.condition.allocatedBaseSpeedMultiplier).toEqual(
      exactMicroKrw(3n, 2n),
    );
    expect(capped.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(750n * microPerKrw),
    );
    expect(capped.segments[0]!.conditionalRetentionAccrued).toEqual(
      result.segments[0]!.conditionalRetentionAccrued,
    );
  });

  it("keeps principal maintenance conditional with zero BASE allocation and starts selection prospectively", () => {
    const input = condition();
    const unassigned = { ...input, allocations: [] };
    const original = start(unassigned);
    const result = run(original, 2n * day, [change(day, input)]);
    expect(result.segments.map((segment) => segment.status)).toEqual([
      "NO_ACTIVE_ALLOCATION",
      "ACTIVE",
    ]);
    expect(result.segments.map((segment) => segment.baseAccrued)).toEqual([
      exactMicroKrw(0n),
      exactMicroKrw(500n * microPerKrw),
    ]);
    expect(
      result.segments.map((segment) => segment.conditionalRetentionAccrued),
    ).toEqual([
      exactMicroKrw(500n * microPerKrw),
      exactMicroKrw(500n * microPerKrw),
    ]);
    expect(result.settlementReadyKrw).toBe(500n);
    expect(result.conditionalRetentionSettlementReadyKrw).toBe(0n);
    expect(result.retentionQualificationRequired).toBe(true);
    expect(result.state.anchorMicroseconds).toBe(original.anchorMicroseconds);
    expect(result.state.cycleEndMicroseconds).toBe(
      original.cycleEndMicroseconds,
    );
  });

  it.each([
    ["safe mode", { safeMode: true, paused: false, eligible: true }],
    ["operator pause", { safeMode: false, paused: true, eligible: true }],
    [
      "eligibility restriction",
      { safeMode: false, paused: false, eligible: false },
    ],
  ])(
    "keeps %s distinct from zero allocation and stops both accrual axes",
    (_label, controls) => {
      const result = run(
        start({ ...condition(), allocations: [], controls }),
        day,
      );
      expect(result.segments[0]!.baseAccrued).toEqual(exactMicroKrw(0n));
      expect(result.segments[0]!.conditionalRetentionAccrued).toEqual(
        exactMicroKrw(0n),
      );
      expect(result.settlementReadyKrw).toBe(0n);
      expect(result.conditionalRetentionSettlementReadyKrw).toBe(0n);
    },
  );

  it("rejects missing source, lot coverage, stale revisions and non-published allocations", () => {
    const input = condition();
    expect(() =>
      start({ ...input, funding: { ...input.funding, sourceComplete: false } }),
    ).toThrow("FUNDING_SOURCE_INCOMPLETE");
    expect(() => start({ ...input, expectedPrincipalRevision: 2n })).toThrow(
      "PRINCIPAL_REVISION_MISMATCH",
    );
    expect(() =>
      start({ ...input, funding: { ...input.funding, lots: [] } }),
    ).toThrow("PRINCIPAL_LOT_COVERAGE_MISMATCH");
    expect(() =>
      start({
        ...input,
        allocations: [{ ...input.allocations[0]!, published: false }],
      }),
    ).toThrow("PRODUCT_ALLOCATION_SOURCE_UNCONFIRMED");
    expect(() =>
      previewFundingInterval({
        state: start(),
        expectedEntitlementRevision: 2n,
        serverNowMicroseconds: day,
      }),
    ).toThrow("ENTITLEMENT_REVISION_MISMATCH");
    expect(() => run({ ...start() }, day)).toThrow(
      "ENTITLEMENT_REVISION_MISMATCH",
    );
  });

  it("rejects retroactive or duplicate boundaries and preserves prior facts after failed previews", () => {
    const initial = run(start(), day).state;
    expect(() => run(initial, day - 1n)).toThrow(
      "RETROACTIVE_PREVIEW_INTERVAL",
    );
    expect(() =>
      run(initial, 2n * day, [change(0n, condition(1000000n, 2n))]),
    ).toThrow("RETROACTIVE_OR_AMBIGUOUS_BOUNDARY");
    expect(() =>
      run(initial, 2n * day, [
        change(day, condition()),
        change(day, condition(), 2n),
      ]),
    ).toThrow("RETROACTIVE_OR_AMBIGUOUS_BOUNDARY");
    const stale = deposit(initial.condition.input, 1000000n, day);
    expect(() =>
      run(initial, 2n * day, [
        change(day, {
          ...stale,
          expectedPrincipalRevision: 1n,
          funding: { ...stale.funding, principalRevision: 1n },
        }),
      ]),
    ).toThrow("STALE_PRINCIPAL_REVISION");
    expect(() =>
      run(initial, 2n * day, [
        change(day, {
          ...condition(),
          funding: {
            ...condition().funding,
            lots: [
              {
                ...condition().funding.lots[0]!,
                effectiveFromMicroseconds: day,
              },
            ],
          },
        }),
      ]),
    ).toThrow("PRINCIPAL_LOT_AGE_CHANGED");
    expect(initial.cursorMicroseconds).toBe(day);
  });
});
