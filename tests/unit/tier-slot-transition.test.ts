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
  previewFundingInterval,
  previewFundingSlotDowngrade,
  type FundingConditionInput,
  type FundingSlotAllocationOriginal,
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
const document = JSON.parse(manifestText) as EconomyPolicyDocument;
const configText = JSON.stringify(document);
const expected: PolicyPublicationIdentity = {
  policyId: "00000000-0000-4000-8000-000000000001",
  publicationId: "00000000-0000-4000-8000-000000000002",
  policyVersion: document.policyVersion,
  revisionId: "00000000-0000-4000-8000-000000000003",
  publishedAtMicroseconds: 0n,
  effectiveFromMicroseconds: 0n,
  effectiveUntilMicroseconds: null,
  configDigest: policyTextDigest(configText),
  manifestDigest: policyTextDigest(manifestText),
  approvalEvidence: document.approvalEvidence,
  approvalEvidenceDigest: policyTextDigest(approvalEvidenceText),
};
const policy = validateEconomyPolicy({
  configuration: document,
  configText,
  manifestText,
  approvalEvidenceText,
  publication: { ...expected, state: "PUBLISHED" },
  expected,
  sourceComplete: true,
  serverNowMicroseconds: 0n,
});
const day = MICROSECONDS_PER_DAY;
const micro = BigInt(document.microKrwPerKrw);

function fixture(boundary = day + 1n, principal = 100000n) {
  const allocationOriginal: FundingSlotAllocationOriginal = {
    originalId: "native-original-fixture",
    revision: 7n,
    catalogVersionId: "published-catalog-fixture",
    effectiveFromMicroseconds: 0n,
    sourceComplete: true,
    products: [
      { productId: "product-z", ruleVersionId: "rule-z", allocationBps: 2000 },
      { productId: "product-a", ruleVersionId: "rule-a", allocationBps: 3000 },
      { productId: "product-m", ruleVersionId: "rule-m", allocationBps: 5000 },
    ],
  };
  const condition: FundingConditionInput = {
    policy,
    expectedPrincipalRevision: 1n,
    funding: {
      principalRevision: 1n,
      sourceComplete: true,
      eligiblePrincipalKrw: 10000000n,
      lots: [
        {
          lotId: "original-lot",
          remainingEligiblePrincipalKrw: 10000000n,
          effectiveFromMicroseconds: 0n,
        },
      ],
    },
    controls: { paused: false, safeMode: false, eligible: true },
    allocations: allocationOriginal.products.map((product) => ({
      productId: product.productId,
      allocationBps: product.allocationBps,
      published: true,
      sourceComplete: true,
    })),
  };
  const state = createFundingEntitlementPreview({
    condition,
    serverNowMicroseconds: 0n,
    expectedEntitlementRevision: 1n,
  });
  const next: FundingConditionInput = {
    ...condition,
    expectedPrincipalRevision: 2n,
    funding: {
      ...condition.funding,
      principalRevision: 2n,
      eligiblePrincipalKrw: principal,
      lots: [
        {
          ...condition.funding.lots[0]!,
          remainingEligiblePrincipalKrw: principal,
        },
      ],
    },
  };
  return {
    state,
    allocationOriginal,
    expectedAllocationOriginalId: allocationOriginal.originalId,
    expectedAllocationRevision: allocationOriginal.revision,
    change: {
      effectiveFromMicroseconds: boundary,
      expectedEntitlementRevision: 1n,
      entitlementRevision: 2n,
      condition: next,
    },
  };
}

function interval(state: ReturnType<typeof fixture>["state"], end: bigint) {
  return previewFundingInterval({
    state,
    expectedEntitlementRevision: state.entitlementRevision,
    serverNowMicroseconds: end,
  });
}

describe("server-only exact slot downgrade preview", () => {
  it("retains sealed JSON ordinal prefix and preserves every paused rule and weight", () => {
    const input = fixture();
    const result = previewFundingSlotDowngrade(input);
    expect(result.mode).toBe("PREVIEW_ONLY");
    expect(result.selectionPolicy).toBe("ALLOCATION_ORIGINAL_ORDINAL_PREFIX");
    expect(result.previousSlots).toBe(3);
    expect(result.nextSlots).toBe(1);
    expect(result.decisions).toEqual([
      {
        ...input.allocationOriginal.products[0]!,
        ordinal: 1,
        state: "RETAINED",
        pauseReason: null,
      },
      {
        ...input.allocationOriginal.products[1]!,
        ordinal: 2,
        state: "PAUSED",
        pauseReason: "SLOT_LIMIT_REDUCED",
      },
      {
        ...input.allocationOriginal.products[2]!,
        ordinal: 3,
        state: "PAUSED",
        pauseReason: "SLOT_LIMIT_REDUCED",
      },
    ]);
    expect(result.allocationOriginal).toEqual(input.allocationOriginal);
    expect(result.activeAllocationBps).toBe(2000);
    expect(result.pausedAllocationBps).toBe(8000);
    expect(result.interval.state.condition.input.allocations).toEqual([
      input.state.condition.input.allocations[0],
    ]);
    expect(Object.isFrozen(result.decisions)).toBe(true);
    expect(Object.isFrozen(input.allocationOriginal.products)).toBe(false);
    expect(input.change.condition.allocations).toHaveLength(3);
    expect(input.state.condition.input.allocations).toHaveLength(3);
  });

  it("closes past accrual under the original conditions and carries history across the future-only boundary", () => {
    const input = fixture();
    const before = interval(
      input.state,
      input.change.effectiveFromMicroseconds,
    );
    const result = previewFundingSlotDowngrade(input);
    expect(result.interval.segments).toEqual(before.segments);
    const after = result.interval.state;
    expect(after.baseUsed).toEqual(before.state.baseUsed);
    expect(after.conditionalRetentionUsed).toEqual(
      before.state.conditionalRetentionUsed,
    );
    expect(after.baseRewardCarry).toEqual(before.state.baseRewardCarry);
    expect(after.baseRewardCarry.numerator).toBeGreaterThan(0n);
    expect(after.anchorMicroseconds).toBe(input.state.anchorMicroseconds);
    expect(after.cycleIndex).toBe(input.state.cycleIndex);
    expect(after.cycleEndMicroseconds).toBe(input.state.cycleEndMicroseconds);
    expect(
      after.condition.input.funding.lots[0]!.effectiveFromMicroseconds,
    ).toBe(0n);
    expect(after.entitlementRevision).toBe(2n);
    expect(after.condition.tierCode).toBe("L1");
    const future = interval(
      after,
      input.change.effectiveFromMicroseconds + day,
    );
    expect(future.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(100n * micro),
    );
    expect(future.segments[0]!.conditionalRetentionAccrued).toEqual(
      exactMicroKrw(500n * micro),
    );
    expect(future.conditionalRetentionSettlementReadyKrw).toBe(0n);
    expect(future.retentionQualificationRequired).toBe(true);
  });

  it("resolves equal weights by immutable original ordinal rather than product identity", () => {
    const input = fixture(day, 1000000n);
    const products = input.allocationOriginal.products.map(
      (product, index) => ({
        ...product,
        allocationBps: index < 2 ? 3000 : 4000,
      }),
    );
    const allocations = input.state.condition.input.allocations.map(
      (product, index) => ({
        ...product,
        allocationBps: products[index]!.allocationBps,
      }),
    );
    const state = createFundingEntitlementPreview({
      condition: { ...input.state.condition.input, allocations },
      serverNowMicroseconds: 0n,
      expectedEntitlementRevision: 1n,
    });
    const result = previewFundingSlotDowngrade({
      ...input,
      state,
      allocationOriginal: { ...input.allocationOriginal, products },
      change: {
        ...input.change,
        condition: { ...input.change.condition, allocations },
      },
    });
    expect(result.nextSlots).toBe(2);
    expect(
      result.decisions
        .filter((decision) => decision.state === "RETAINED")
        .map((decision) => decision.productId),
    ).toEqual(["product-z", "product-a"]);
    expect(result.activeAllocationBps).toBe(6000);
    expect(result.pausedAllocationBps).toBe(4000);
  });

  it("composes retained weight and speed ingredients once while capacity and maintenance stay independent", () => {
    // Trusted preview fixtures exercise math; this is not product publication
    // approval or evidence that the current neutral native producer admits it.
    const input = fixture(day / 24n);
    const allocations = input.state.condition.input.allocations.map(
      (product) => ({
        ...product,
        productMultiplierBps: 11000,
      }),
    );
    const effects = {
      userOverrideMultiplierBps: 12000,
      speedMultipliersBps: [12500, 12500, 12500, 12500],
    };
    const state = createFundingEntitlementPreview({
      condition: { ...input.state.condition.input, allocations, effects },
      serverNowMicroseconds: 0n,
      expectedEntitlementRevision: 1n,
    });
    const result = previewFundingSlotDowngrade({
      ...input,
      state,
      change: {
        ...input.change,
        condition: { ...input.change.condition, allocations, effects },
      },
    });
    // 0.20 × 1.10 × 1.20 × (1.25 ^ 4), without a premature cap.
    expect(
      result.interval.state.condition.allocatedBaseSpeedMultiplier,
    ).toEqual(exactMicroKrw(165n, 256n));
    const neutral = previewFundingSlotDowngrade(input);
    expect(result.interval.state.baseCapacity).toEqual(
      neutral.interval.state.baseCapacity,
    );
    expect(result.interval.state.conditionalRetentionCapacity).toEqual(
      neutral.interval.state.conditionalRetentionCapacity,
    );
    const future = interval(
      result.interval.state,
      input.change.effectiveFromMicroseconds + day,
    );
    expect(future.segments[0]!.baseAccrued).toEqual(
      exactMicroKrw(20625n * micro, 64n),
    );
    expect(future.segments[0]!.conditionalRetentionAccrued).toEqual(
      exactMicroKrw(500n * micro),
    );
  });

  it.each([
    ["SAFE_MODE", { safeMode: true, paused: false, eligible: true }],
    ["PAUSED", { safeMode: false, paused: true, eligible: true }],
    ["INELIGIBLE", { safeMode: false, paused: false, eligible: false }],
  ])(
    "preserves %s precedence instead of restarting mining during slot reconciliation",
    (status, controls) => {
      const input = fixture();
      const result = previewFundingSlotDowngrade({
        ...input,
        change: {
          ...input.change,
          condition: { ...input.change.condition, controls },
        },
      });
      expect(result.interval.status).toBe(status);
      const future = interval(
        result.interval.state,
        input.change.effectiveFromMicroseconds + day,
      );
      expect(future.segments[0]!.baseAccrued).toEqual(exactMicroKrw(0n));
      expect(future.segments[0]!.conditionalRetentionAccrued).toEqual(
        exactMicroKrw(0n),
      );
      expect(future.settlementReadyKrw).toBe(0n);
    },
  );

  it("never multiplies capacity by slots or redistributes the paused eighty percent", () => {
    const input = fixture();
    const result = previewFundingSlotDowngrade(input);
    const manuallyRetained = previewFundingInterval({
      state: input.state,
      expectedEntitlementRevision: input.state.entitlementRevision,
      serverNowMicroseconds: input.change.effectiveFromMicroseconds,
      changes: [
        {
          ...input.change,
          condition: {
            ...input.change.condition,
            allocations: [input.change.condition.allocations[0]!],
          },
        },
      ],
    });
    expect(result.interval.state.baseCapacity).toEqual(
      manuallyRetained.state.baseCapacity,
    );
    expect(result.interval.state.conditionalRetentionCapacity).toEqual(
      manuallyRetained.state.conditionalRetentionCapacity,
    );
    expect(
      result.interval.state.condition.allocatedBaseSpeedMultiplier,
    ).toEqual(exactMicroKrw(1n, 5n));
    expect(
      result.interval.state.condition.input.allocations[0]!.allocationBps,
    ).toBe(2000);
  });

  it("is repeatable from the same original and never credits twice for an already processed interval", () => {
    const input = fixture();
    const first = previewFundingSlotDowngrade(input);
    expect(previewFundingSlotDowngrade(input)).toEqual(first);
    const repeat = interval(
      first.interval.state,
      input.change.effectiveFromMicroseconds,
    );
    expect(repeat.settlementReadyKrw).toBe(0n);
    expect(repeat.segments).toEqual([]);
    expect(repeat.state.baseUsed).toEqual(first.interval.state.baseUsed);
    expect(repeat.state.baseRewardCarry).toEqual(
      first.interval.state.baseRewardCarry,
    );
  });

  it("pauses all declared intent below funding minimum without deleting product availability", () => {
    const input = fixture(day, 99999n);
    const result = previewFundingSlotDowngrade(input);
    expect(result.nextSlots).toBe(0);
    expect(result.activeAllocationBps).toBe(0);
    expect(result.pausedAllocationBps).toBe(10000);
    expect(
      result.decisions.every((decision) => decision.state === "PAUSED"),
    ).toBe(true);
    expect(result.interval.status).toBe("FUNDING_BELOW_MINIMUM");
    expect(result.allocationOriginal.products).toHaveLength(3);
    expect(
      input.change.condition.allocations.every((product) => product.published),
    ).toBe(true);
  });

  it("preserves the same full original intent through repeated three-to-one-to-zero slot downgrades", () => {
    const input = fixture();
    const first = previewFundingSlotDowngrade(input);
    const second = previewFundingSlotDowngrade({
      ...input,
      state: first.interval.state,
      change: {
        effectiveFromMicroseconds: 2n * day,
        expectedEntitlementRevision: 2n,
        entitlementRevision: 3n,
        condition: {
          ...input.change.condition,
          expectedPrincipalRevision: 3n,
          funding: {
            ...input.change.condition.funding,
            principalRevision: 3n,
            eligiblePrincipalKrw: 99999n,
            lots: [
              {
                ...input.change.condition.funding.lots[0]!,
                remainingEligiblePrincipalKrw: 99999n,
              },
            ],
          },
        },
      },
    });
    expect(second.previousSlots).toBe(1);
    expect(second.nextSlots).toBe(0);
    expect(second.allocationOriginal).toEqual(first.allocationOriginal);
    expect(second.decisions.map((decision) => decision.ordinal)).toEqual([
      1, 2, 3,
    ]);
    expect(
      second.decisions.every((decision) => decision.state === "PAUSED"),
    ).toBe(true);
    expect(second.pausedAllocationBps).toBe(10000);
    expect(second.interval.state.condition.input.allocations).toEqual([]);
    expect(second.interval.state.entitlementRevision).toBe(3n);
    expect(second.interval.state.anchorMicroseconds).toBe(
      first.interval.state.anchorMicroseconds,
    );
    expect(second.interval.state.cycleEndMicroseconds).toBe(
      first.interval.state.cycleEndMicroseconds,
    );
  });

  it("does not authorize later Tier recovery or resume paused intent without a new reviewed command", () => {
    const input = fixture(day, 10000000n);
    expect(() => previewFundingSlotDowngrade(input)).toThrow(
      "SLOT_DOWNGRADE_WITH_EXCESS_REQUIRED",
    );
    const downgraded = previewFundingSlotDowngrade(fixture());
    expect(() =>
      previewFundingSlotDowngrade({
        ...fixture(),
        state: downgraded.interval.state,
        change: {
          ...fixture().change,
          expectedEntitlementRevision: 2n,
          entitlementRevision: 3n,
          condition: {
            ...fixture().change.condition,
            funding: fixture().state.condition.input.funding,
          },
        },
      }),
    ).toThrow("SLOT_DOWNGRADE_WITH_EXCESS_REQUIRED");
  });

  it.each([
    ["missing native source", { sourceComplete: false }],
    ["wrong original", { originalId: "other-original" }],
    ["wrong revision", { revision: 8n }],
    ["empty catalog", { catalogVersionId: "" }],
  ])("rejects %s before calculating a transition", (_name, override) => {
    const input = fixture();
    expect(() =>
      previewFundingSlotDowngrade({
        ...input,
        allocationOriginal: { ...input.allocationOriginal, ...override },
      }),
    ).toThrow("SLOT_ALLOCATION_ORIGINAL_UNCONFIRMED");
    expect(input.state.entitlementRevision).toBe(1n);
  });

  it("rejects reordered originals, changed weights, absent rules, stale entitlement and backdated boundaries", () => {
    const input = fixture();
    for (const products of [
      [...input.allocationOriginal.products].reverse(),
      input.allocationOriginal.products.map((product, index) =>
        index === 0 ? { ...product, allocationBps: 2100 } : product,
      ),
      input.allocationOriginal.products.map((product, index) =>
        index === 0 ? { ...product, ruleVersionId: "" } : product,
      ),
    ]) {
      expect(() =>
        previewFundingSlotDowngrade({
          ...input,
          allocationOriginal: { ...input.allocationOriginal, products },
        }),
      ).toThrow("SLOT_ALLOCATION_DECLARATION_MISMATCH");
    }
    expect(() =>
      previewFundingSlotDowngrade({
        ...input,
        allocationOriginal: {
          ...input.allocationOriginal,
          effectiveFromMicroseconds: 1n,
        },
      }),
    ).toThrow("SLOT_ALLOCATION_EFFECTIVE_BOUNDARY_INVALID");
    expect(() =>
      previewFundingSlotDowngrade({
        ...input,
        change: { ...input.change, expectedEntitlementRevision: 9n },
      }),
    ).toThrow("FORWARD_CHANGE_REVISION_MISMATCH");
    expect(() =>
      previewFundingSlotDowngrade({
        ...input,
        change: { ...input.change, effectiveFromMicroseconds: -1n },
      }),
    ).toThrow("SLOT_ALLOCATION_EFFECTIVE_BOUNDARY_INVALID");
  });
});
