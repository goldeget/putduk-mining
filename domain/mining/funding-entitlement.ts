import "server-only";

import {
  assertEffectiveEconomyPolicy,
  BASIS_POINT_UNIT,
  fundingTierForPrincipal,
  MICROSECONDS_PER_DAY,
  type ValidatedEconomyPolicy,
} from "@/domain/mining/economy-policy";

/** Exact micro-KRW, including the division remainder below one micro-KRW. */
export type ExactMicroKrw = Readonly<{
  numerator: bigint;
  denominator: bigint;
}>;

export class FundingEntitlementError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FundingEntitlementError";
  }
}

function fail(code: string): never {
  throw new FundingEntitlementError(code);
}
function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
export function exactMicroKrw(
  numerator: bigint,
  denominator = 1n,
): ExactMicroKrw {
  if (
    typeof numerator !== "bigint" ||
    typeof denominator !== "bigint" ||
    denominator <= 0n
  )
    fail("INVALID_EXACT_AMOUNT");
  const divisor = gcd(numerator, denominator) || 1n;
  return Object.freeze({
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  });
}
const ZERO = exactMicroKrw(0n);
function add(left: ExactMicroKrw, right: ExactMicroKrw) {
  return exactMicroKrw(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}
function subtract(left: ExactMicroKrw, right: ExactMicroKrw) {
  return add(left, exactMicroKrw(-right.numerator, right.denominator));
}
function scale(value: ExactMicroKrw, numerator: bigint, denominator = 1n) {
  return exactMicroKrw(
    value.numerator * numerator,
    value.denominator * denominator,
  );
}
function compare(left: ExactMicroKrw, right: ExactMicroKrw) {
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function nonnegative(value: ExactMicroKrw) {
  const normalized = exactMicroKrw(value.numerator, value.denominator);
  if (normalized.numerator < 0n) fail("NEGATIVE_ENTITLEMENT_AMOUNT");
  return normalized;
}
function remaining(capacity: ExactMicroKrw, used: ExactMicroKrw) {
  const value = subtract(capacity, used);
  return value.numerator > 0n ? value : ZERO;
}

export type FundingPrincipalSnapshot = {
  readonly principalRevision: bigint;
  readonly sourceComplete: boolean;
  readonly eligiblePrincipalKrw: bigint;
  readonly lots: readonly {
    readonly lotId: string;
    readonly remainingEligiblePrincipalKrw: bigint;
    readonly effectiveFromMicroseconds: bigint;
  }[];
};

export type FundingConditionInput = {
  readonly policy: ValidatedEconomyPolicy;
  readonly funding: FundingPrincipalSnapshot;
  readonly expectedPrincipalRevision: bigint;
  readonly controls: {
    readonly paused: boolean;
    readonly safeMode: boolean;
    readonly eligible: boolean;
  };
  readonly allocations: readonly {
    readonly productId: string;
    readonly allocationBps: number;
    readonly productMultiplierBps?: number;
    readonly published: boolean;
    readonly sourceComplete: boolean;
  }[];
  readonly effects?: {
    readonly capacityBoostsBps?: readonly number[];
    readonly speedMultipliersBps?: readonly number[];
    readonly userOverrideMultiplierBps?: number;
  };
};

type Conditions = {
  readonly input: FundingConditionInput;
  readonly tierCode: string | null;
  readonly slots: number;
  readonly fullBaseCapacity: ExactMicroKrw;
  readonly fullBaseSpeedPerCycle: ExactMicroKrw;
  readonly allocatedBaseSpeedMultiplier: ExactMicroKrw;
  readonly fullConditionalRetentionCapacity: ExactMicroKrw;
  readonly allocationBps: bigint;
  readonly effectScopeUnresolved: boolean;
};

function validBps(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Validate the complete original declaration before any slot prefix is cut. */
function allocationFacts(input: FundingConditionInput) {
  const document = input.policy.document;
  let allocation = 0n;
  let weightedProductSpeed = 0n;
  const products = new Set<string>();
  for (const product of input.allocations) {
    const multiplier =
      product.productMultiplierBps ?? document.productMultiplier.defaultBps;
    if (
      !product.productId.trim() ||
      products.has(product.productId) ||
      product.published !== true ||
      product.sourceComplete !== true
    )
      fail("PRODUCT_ALLOCATION_SOURCE_UNCONFIRMED");
    if (
      !validBps(product.allocationBps) ||
      product.allocationBps <= 0 ||
      product.allocationBps > document.allocation.maximumPerProductBps ||
      !validBps(multiplier) ||
      multiplier < document.productMultiplier.minimumBps ||
      multiplier > document.productMultiplier.maximumBps
    )
      fail("PRODUCT_ALLOCATION_INVALID");
    products.add(product.productId);
    allocation += BigInt(product.allocationBps);
    weightedProductSpeed += BigInt(product.allocationBps) * BigInt(multiplier);
  }
  if (allocation > BigInt(document.allocation.maximumTotalBps))
    fail("GLOBAL_ALLOCATION_OR_SLOT_LIMIT");
  return { allocation, weightedProductSpeed, productCount: products.size };
}

function conditions(input: FundingConditionInput, instant: bigint): Conditions {
  assertEffectiveEconomyPolicy(input.policy, instant);
  const { funding, policy, controls } = input;
  if (funding.sourceComplete !== true) fail("FUNDING_SOURCE_INCOMPLETE");
  if (
    typeof funding.principalRevision !== "bigint" ||
    funding.principalRevision <= 0n ||
    funding.principalRevision !== input.expectedPrincipalRevision
  )
    fail("PRINCIPAL_REVISION_MISMATCH");
  if (
    typeof funding.eligiblePrincipalKrw !== "bigint" ||
    funding.eligiblePrincipalKrw < 0n
  )
    fail("INVALID_ELIGIBLE_PRINCIPAL");
  if (
    [controls.paused, controls.safeMode, controls.eligible].some(
      (value) => typeof value !== "boolean",
    )
  )
    fail("CONTROL_STATE_UNCONFIRMED");
  const lots = new Set<string>();
  let principal = 0n;
  for (const lot of funding.lots) {
    if (
      !lot.lotId.trim() ||
      lots.has(lot.lotId) ||
      typeof lot.remainingEligiblePrincipalKrw !== "bigint" ||
      lot.remainingEligiblePrincipalKrw < 0n ||
      typeof lot.effectiveFromMicroseconds !== "bigint" ||
      lot.effectiveFromMicroseconds < 0n ||
      lot.effectiveFromMicroseconds > instant
    )
      fail("PRINCIPAL_LOT_UNCONFIRMED");
    lots.add(lot.lotId);
    principal += lot.remainingEligiblePrincipalKrw;
  }
  if (principal !== funding.eligiblePrincipalKrw)
    fail("PRINCIPAL_LOT_COVERAGE_MISMATCH");
  const document = policy.document;
  const tier = fundingTierForPrincipal(policy, principal);
  const unresolved = Object.values(document.platformFeesKrw).some(
    (fee) => BigInt(fee) !== 0n,
  );
  const { allocation, weightedProductSpeed, productCount } =
    allocationFacts(input);
  if (tier && productCount > tier.slots)
    fail("GLOBAL_ALLOCATION_OR_SLOT_LIMIT");
  if (
    input.effects &&
    Object.keys(input.effects).some(
      (key) =>
        ![
          "capacityBoostsBps",
          "speedMultipliersBps",
          "userOverrideMultiplierBps",
        ].includes(key),
    )
  )
    fail("UNSUPPORTED_FUNDING_EFFECT");
  const boosts = input.effects?.capacityBoostsBps ?? [
    document.campaign.defaultCapacityBoostBps,
  ];
  let combinedBoost = 0n;
  for (const boost of boosts) {
    if (
      !validBps(boost) ||
      boost > document.campaign.maximumSingleCapacityBoostBps
    )
      fail("CAPACITY_CAMPAIGN_LIMIT");
    combinedBoost += BigInt(boost);
  }
  if (combinedBoost > BigInt(document.campaign.maximumCombinedCapacityBoostBps))
    fail("CAPACITY_CAMPAIGN_LIMIT");
  const speeds = input.effects?.speedMultipliersBps ?? [
    document.campaign.defaultSpeedMultiplierBps,
  ];
  for (const speed of speeds) {
    if (
      !validBps(speed) ||
      speed < document.campaign.defaultSpeedMultiplierBps ||
      speed > document.campaign.maximumSingleSpeedMultiplierBps
    )
      fail("SPEED_CAMPAIGN_LIMIT");
  }
  const override =
    input.effects?.userOverrideMultiplierBps ??
    document.userOverride.defaultMultiplierBps;
  if (
    !validBps(override) ||
    override < document.userOverride.minimumMultiplierBps ||
    override > document.userOverride.maximumMultiplierBps
  )
    fail("USER_OVERRIDE_LIMIT");
  // Weight the product portion before common modifiers, preserving the exact
  // rational. Only the final global BASE speed multiplier is capped.
  let speedMultiplier =
    allocation > 0n
      ? exactMicroKrw(weightedProductSpeed, BASIS_POINT_UNIT * BASIS_POINT_UNIT)
      : ZERO;
  speedMultiplier = scale(speedMultiplier, BigInt(override), BASIS_POINT_UNIT);
  for (const speed of speeds)
    speedMultiplier = scale(speedMultiplier, BigInt(speed), BASIS_POINT_UNIT);
  const speedCap = exactMicroKrw(
    BigInt(document.campaign.maximumCombinedSpeedMultiplierBps),
    BASIS_POINT_UNIT,
  );
  if (compare(speedMultiplier, speedCap) > 0) speedMultiplier = speedCap;
  const common = principal * BigInt(document.microKrwPerKrw);
  const basePerCycle = tier
    ? exactMicroKrw(
        common * BigInt(document.baseCycleRateBps),
        BASIS_POINT_UNIT,
      )
    : ZERO;
  return freeze({
    input: {
      ...input,
      funding: { ...funding, lots: funding.lots.map((lot) => ({ ...lot })) },
      controls: { ...controls },
      allocations: input.allocations.map((product) => ({ ...product })),
      ...(input.effects
        ? {
            effects: {
              ...(input.effects.capacityBoostsBps
                ? { capacityBoostsBps: [...input.effects.capacityBoostsBps] }
                : {}),
              ...(input.effects.speedMultipliersBps
                ? {
                    speedMultipliersBps: [...input.effects.speedMultipliersBps],
                  }
                : {}),
              ...(input.effects.userOverrideMultiplierBps !== undefined
                ? {
                    userOverrideMultiplierBps:
                      input.effects.userOverrideMultiplierBps,
                  }
                : {}),
            },
          }
        : {}),
    },
    tierCode: tier?.code ?? null,
    slots: tier?.slots ?? 0,
    fullBaseCapacity: scale(
      basePerCycle,
      BASIS_POINT_UNIT + combinedBoost,
      BASIS_POINT_UNIT,
    ),
    fullBaseSpeedPerCycle: basePerCycle,
    allocatedBaseSpeedMultiplier: speedMultiplier,
    fullConditionalRetentionCapacity: tier
      ? exactMicroKrw(common * BigInt(tier.retentionBonusBps), BASIS_POINT_UNIT)
      : ZERO,
    allocationBps: allocation,
    effectScopeUnresolved: unresolved,
  });
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export type ExistingFundingCycleSnapshot = {
  readonly entitlementRevision: bigint;
  readonly cycleIndex: bigint;
  readonly anchorMicroseconds: bigint;
  readonly cycleDurationMicroseconds: bigint;
  readonly cursorMicroseconds: bigint;
  readonly baseCapacity: ExactMicroKrw;
  readonly conditionalRetentionCapacity: ExactMicroKrw;
  readonly baseUsed: ExactMicroKrw;
  readonly conditionalRetentionUsed: ExactMicroKrw;
  readonly baseRewardCarry: ExactMicroKrw;
};

export type FundingEntitlementPreview = ExistingFundingCycleSnapshot & {
  readonly mode: "PREVIEW_ONLY";
  readonly cycleIndex: bigint;
  readonly cycleStartMicroseconds: bigint;
  readonly cycleEndMicroseconds: bigint;
  readonly condition: Conditions;
};
const previews = new WeakSet<FundingEntitlementPreview>();
function register(state: FundingEntitlementPreview) {
  const result = freeze(state);
  previews.add(result);
  return result;
}

/** Creates a hypothesis or consumes trusted existing facts; never persists an anchor. */
export function createFundingEntitlementPreview({
  condition,
  serverNowMicroseconds,
  existingCycle,
  expectedEntitlementRevision,
}: {
  condition: FundingConditionInput;
  serverNowMicroseconds: bigint;
  existingCycle?: ExistingFundingCycleSnapshot;
  expectedEntitlementRevision: bigint;
}): FundingEntitlementPreview {
  if (
    typeof serverNowMicroseconds !== "bigint" ||
    serverNowMicroseconds < 0n ||
    typeof expectedEntitlementRevision !== "bigint" ||
    expectedEntitlementRevision <= 0n
  )
    fail("INVALID_PREVIEW_IDENTITY");
  const current = conditions(
    condition,
    existingCycle?.cursorMicroseconds ?? serverNowMicroseconds,
  );
  const duration =
    BigInt(condition.policy.document.cycleDays) * MICROSECONDS_PER_DAY;
  if (!existingCycle && current.tierCode === null)
    fail("FUNDING_BELOW_MINIMUM_NOT_ACTIVATED");
  const anchor = existingCycle?.anchorMicroseconds ?? serverNowMicroseconds;
  const cursor = existingCycle?.cursorMicroseconds ?? serverNowMicroseconds;
  if (
    typeof anchor !== "bigint" ||
    typeof cursor !== "bigint" ||
    anchor < 0n ||
    cursor < anchor ||
    cursor > serverNowMicroseconds ||
    (existingCycle &&
      (existingCycle.entitlementRevision !== expectedEntitlementRevision ||
        existingCycle.cycleDurationMicroseconds !== duration))
  )
    fail("CYCLE_SNAPSHOT_REVISION_OR_TIME_MISMATCH");
  const index = existingCycle?.cycleIndex ?? 0n;
  if (typeof index !== "bigint" || index < 0n) fail("INVALID_CYCLE_INDEX");
  const start = anchor + index * duration;
  if (cursor < start || cursor > start + duration)
    fail("CYCLE_CURSOR_OUTSIDE_RECORDED_CYCLE");
  const carry = nonnegative(existingCycle?.baseRewardCarry ?? ZERO);
  if (
    compare(
      carry,
      exactMicroKrw(BigInt(condition.policy.document.microKrwPerKrw)),
    ) >= 0
  )
    fail("REWARD_CARRY_OUT_OF_RANGE");
  return register({
    mode: "PREVIEW_ONLY",
    entitlementRevision: expectedEntitlementRevision,
    anchorMicroseconds: anchor,
    cycleDurationMicroseconds: duration,
    cursorMicroseconds: cursor,
    cycleIndex: index,
    cycleStartMicroseconds: start,
    cycleEndMicroseconds: start + duration,
    condition: current,
    baseCapacity: nonnegative(
      existingCycle?.baseCapacity ?? current.fullBaseCapacity,
    ),
    conditionalRetentionCapacity: nonnegative(
      existingCycle?.conditionalRetentionCapacity ??
        current.fullConditionalRetentionCapacity,
    ),
    baseUsed: nonnegative(existingCycle?.baseUsed ?? ZERO),
    conditionalRetentionUsed: nonnegative(
      existingCycle?.conditionalRetentionUsed ?? ZERO,
    ),
    baseRewardCarry: carry,
  });
}

export type FundingStopReason =
  | "SAFE_MODE"
  | "PAUSED"
  | "INELIGIBLE"
  | "FUNDING_BELOW_MINIMUM"
  | "EFFECT_SCOPE_UNRESOLVED"
  | "NO_ACTIVE_ALLOCATION"
  | "CAPACITY_EXHAUSTED"
  | "ACTIVE";
export function fundingPreviewStatus(
  state: FundingEntitlementPreview,
): FundingStopReason {
  if (!previews.has(state)) fail("UNVALIDATED_PREVIEW_STATE");
  const current = state.condition;
  if (current.input.controls.safeMode) return "SAFE_MODE";
  if (current.input.controls.paused) return "PAUSED";
  if (!current.input.controls.eligible) return "INELIGIBLE";
  if (current.tierCode === null) return "FUNDING_BELOW_MINIMUM";
  if (current.effectScopeUnresolved) return "EFFECT_SCOPE_UNRESOLVED";
  if (current.allocationBps === 0n) return "NO_ACTIVE_ALLOCATION";
  if (
    compare(
      add(state.baseUsed, state.conditionalRetentionUsed),
      add(state.baseCapacity, state.conditionalRetentionCapacity),
    ) >= 0
  )
    return "CAPACITY_EXHAUSTED";
  return "ACTIVE";
}

export type FundingForwardChange = {
  readonly effectiveFromMicroseconds: bigint;
  readonly expectedEntitlementRevision: bigint;
  readonly entitlementRevision: bigint;
  readonly condition: FundingConditionInput;
};

/** A server-derived sealed declaration, not a browser allocation proposal. */
export type FundingSlotAllocationOriginal = {
  readonly originalId: string;
  readonly revision: bigint;
  readonly catalogVersionId: string;
  readonly effectiveFromMicroseconds: bigint;
  readonly sourceComplete: boolean;
  /** Array position is the immutable ordinal stored in the allocation original. */
  readonly products: readonly {
    readonly productId: string;
    readonly ruleVersionId: string;
    readonly allocationBps: number;
  }[];
};

/**
 * Read-only deterministic downgrade preview using the existing global engine.
 * The caller must verify the native original's seal/catalog/rule receipts before
 * supplying it. This helper neither manufactures that proof nor persists a
 * pause, entitlement, source original, reward or ledger credit. The full intent
 * remains separate from the prospective active condition. Later slot recovery
 * requires a reviewed policy or explicit reselection; it never resumes here.
 */
export function previewFundingSlotDowngrade({
  state,
  change,
  allocationOriginal,
  expectedAllocationOriginalId,
  expectedAllocationRevision,
}: {
  state: FundingEntitlementPreview;
  change: FundingForwardChange;
  allocationOriginal: FundingSlotAllocationOriginal;
  expectedAllocationOriginalId: string;
  expectedAllocationRevision: bigint;
}) {
  if (!previews.has(state)) fail("UNVALIDATED_PREVIEW_STATE");
  if (
    allocationOriginal.sourceComplete !== true ||
    !allocationOriginal.originalId.trim() ||
    !allocationOriginal.catalogVersionId.trim() ||
    typeof allocationOriginal.revision !== "bigint" ||
    allocationOriginal.revision <= 0n ||
    allocationOriginal.originalId !== expectedAllocationOriginalId ||
    allocationOriginal.revision !== expectedAllocationRevision
  )
    fail("SLOT_ALLOCATION_ORIGINAL_UNCONFIRMED");
  if (
    typeof allocationOriginal.effectiveFromMicroseconds !== "bigint" ||
    allocationOriginal.effectiveFromMicroseconds < 0n ||
    allocationOriginal.effectiveFromMicroseconds > state.cursorMicroseconds ||
    typeof change.effectiveFromMicroseconds !== "bigint" ||
    change.effectiveFromMicroseconds < state.cursorMicroseconds
  )
    fail("SLOT_ALLOCATION_EFFECTIVE_BOUNDARY_INVALID");
  const declared = state.condition.input.allocations;
  const incoming = change.condition.allocations;
  if (
    declared.length !==
      Math.min(state.condition.slots, allocationOriginal.products.length) ||
    incoming.length !== allocationOriginal.products.length ||
    allocationOriginal.products.some((product, index) => {
      const previous = declared[index];
      const next = incoming[index]!;
      return (
        !product.ruleVersionId.trim() ||
        next.productId !== product.productId ||
        next.allocationBps !== product.allocationBps ||
        (previous !== undefined &&
          (product.productId !== previous.productId ||
            product.allocationBps !== previous.allocationBps ||
            next.productMultiplierBps !== previous.productMultiplierBps ||
            next.published !== previous.published ||
            next.sourceComplete !== previous.sourceComplete))
      );
    })
  )
    fail("SLOT_ALLOCATION_DECLARATION_MISMATCH");
  assertEffectiveEconomyPolicy(
    change.condition.policy,
    change.effectiveFromMicroseconds,
  );
  // Paused suffix entries are still preserved intent. Validate their source,
  // weights and approved multipliers even when none remain in the active prefix.
  allocationFacts(change.condition);
  const nextTier = fundingTierForPrincipal(
    change.condition.policy,
    change.condition.funding.eligiblePrincipalKrw,
  );
  const nextSlots = nextTier?.slots ?? 0;
  if (
    nextSlots >= state.condition.slots ||
    allocationOriginal.products.length <= nextSlots
  )
    fail("SLOT_DOWNGRADE_WITH_EXCESS_REQUIRED");
  const decisions = allocationOriginal.products.map((product, index) => ({
    ...product,
    ordinal: index + 1,
    state: index < nextSlots ? ("RETAINED" as const) : ("PAUSED" as const),
    pauseReason: index < nextSlots ? null : ("SLOT_LIMIT_REDUCED" as const),
  }));
  const prospectiveChange: FundingForwardChange = {
    ...change,
    condition: {
      ...change.condition,
      allocations: incoming.slice(0, nextSlots),
    },
  };
  const interval = previewFundingInterval({
    state,
    serverNowMicroseconds: change.effectiveFromMicroseconds,
    expectedEntitlementRevision: state.entitlementRevision,
    changes: [prospectiveChange],
  });
  return freeze({
    mode: "PREVIEW_ONLY" as const,
    selectionPolicy: "ALLOCATION_ORIGINAL_ORDINAL_PREFIX" as const,
    allocationOriginal: {
      ...allocationOriginal,
      products: allocationOriginal.products.map((product) => ({ ...product })),
    },
    previousSlots: state.condition.slots,
    nextSlots,
    decisions,
    activeAllocationBps: decisions.reduce(
      (sum, decision) =>
        sum + (decision.state === "RETAINED" ? decision.allocationBps : 0),
      0,
    ),
    pausedAllocationBps: decisions.reduce(
      (sum, decision) =>
        sum + (decision.state === "PAUSED" ? decision.allocationBps : 0),
      0,
    ),
    prospectiveChange: {
      ...prospectiveChange,
      condition: interval.state.condition.input,
    },
    interval,
  });
}

type PreviewSegment = {
  readonly startMicroseconds: bigint;
  readonly endMicroseconds: bigint;
  readonly cycleIndex: bigint;
  readonly policyVersion: string;
  readonly principalRevision: bigint;
  readonly entitlementRevision: bigint;
  readonly status: FundingStopReason;
  readonly baseAccrued: ExactMicroKrw;
  readonly conditionalRetentionAccrued: ExactMicroKrw;
};

/**
 * Read-only as-of calculation. Returned increments are hypotheses, not accepted
 * earnings, ledger credits, PENDING/VERIFIED receipts or source completeness.
 * Conditional retention is never included in settlementReadyKrw here.
 */
export function previewFundingInterval({
  state,
  serverNowMicroseconds,
  expectedEntitlementRevision,
  changes = [],
}: {
  state: FundingEntitlementPreview;
  serverNowMicroseconds: bigint;
  expectedEntitlementRevision: bigint;
  changes?: readonly FundingForwardChange[];
}) {
  if (
    !previews.has(state) ||
    expectedEntitlementRevision !== state.entitlementRevision
  )
    fail("ENTITLEMENT_REVISION_MISMATCH");
  if (
    typeof serverNowMicroseconds !== "bigint" ||
    serverNowMicroseconds < state.cursorMicroseconds
  )
    fail("RETROACTIVE_PREVIEW_INTERVAL");
  changes.forEach((change, index) => {
    if (
      typeof change.effectiveFromMicroseconds !== "bigint" ||
      change.effectiveFromMicroseconds < state.cursorMicroseconds ||
      change.effectiveFromMicroseconds > serverNowMicroseconds ||
      (index > 0 &&
        change.effectiveFromMicroseconds <=
          changes[index - 1]!.effectiveFromMicroseconds)
    )
      fail("RETROACTIVE_OR_AMBIGUOUS_BOUNDARY");
  });
  let current = state;
  let changeIndex = 0;
  let settlementReadyKrw = 0n;
  const segments: PreviewSegment[] = [];
  const closedCycles: {
    cycleIndex: bigint;
    baseUsed: ExactMicroKrw;
    conditionalRetentionUsed: ExactMicroKrw;
    retentionQualificationRequired: true;
  }[] = [];
  while (current.cursorMicroseconds <= serverNowMicroseconds) {
    if (segments.length + closedCycles.length > 2048)
      fail("PREVIEW_INTERVAL_TOO_LARGE");
    const change = changes[changeIndex];
    if (change?.effectiveFromMicroseconds === current.cursorMicroseconds) {
      if (
        change.expectedEntitlementRevision !== current.entitlementRevision ||
        change.entitlementRevision !== current.entitlementRevision + 1n
      )
        fail("FORWARD_CHANGE_REVISION_MISMATCH");
      const next = conditions(
        change.condition,
        change.effectiveFromMicroseconds,
      );
      const priorPublication = current.condition.input.policy.publication;
      const nextPublication = next.input.policy.publication;
      if (
        priorPublication.publicationId === nextPublication.publicationId &&
        [
          "policyId",
          "policyVersion",
          "revisionId",
          "publishedAtMicroseconds",
          "effectiveFromMicroseconds",
          "configDigest",
          "manifestDigest",
          "approvalEvidence",
          "approvalEvidenceDigest",
        ].some(
          (key) =>
            priorPublication[key as keyof typeof priorPublication] !==
            nextPublication[key as keyof typeof nextPublication],
        )
      )
        fail("POLICY_PUBLICATION_ID_REUSED");
      if (
        priorPublication.publicationId !== nextPublication.publicationId &&
        (priorPublication.effectiveUntilMicroseconds !==
          change.effectiveFromMicroseconds ||
          nextPublication.effectiveFromMicroseconds !==
            change.effectiveFromMicroseconds)
      )
        fail("POLICY_PUBLICATION_BOUNDARY_MISMATCH");
      if (
        BigInt(next.input.policy.document.cycleDays) * MICROSECONDS_PER_DAY !==
          current.cycleDurationMicroseconds ||
        next.input.policy.document.microKrwPerKrw !==
          current.condition.input.policy.document.microKrwPerKrw
      )
        fail("IMMUTABLE_CYCLE_UNIT_CHANGED");
      if (
        next.input.funding.principalRevision <
        current.condition.input.funding.principalRevision
      )
        fail("STALE_PRINCIPAL_REVISION");
      const oldFunding = current.condition.input.funding;
      const nextLots = new Map(
        next.input.funding.lots.map((lot) => [lot.lotId, lot]),
      );
      const oldLotIds = new Set(oldFunding.lots.map((lot) => lot.lotId));
      for (const lot of next.input.funding.lots) {
        if (
          !oldLotIds.has(lot.lotId) &&
          lot.effectiveFromMicroseconds !== change.effectiveFromMicroseconds
        )
          fail("NEW_PRINCIPAL_LOT_EFFECTIVE_BOUNDARY_MISMATCH");
      }
      // Always inspect retained lots, including when total principal/lot count changed.
      // A new deposit is a new receipt/lot. An existing lot's increase needs a
      // separate approved principal-correction contract and cannot be inferred.
      for (const lot of oldFunding.lots) {
        const following = nextLots.get(lot.lotId);
        if (!following) continue;
        if (
          following.effectiveFromMicroseconds !== lot.effectiveFromMicroseconds
        )
          fail("PRINCIPAL_LOT_AGE_CHANGED");
        if (
          following.remainingEligiblePrincipalKrw >
          lot.remainingEligiblePrincipalKrw
        )
          fail("PRINCIPAL_LOT_INCREASE_REQUIRES_CORRECTION_CONTRACT");
      }
      const fundingChanged =
        oldFunding.eligiblePrincipalKrw !==
          next.input.funding.eligiblePrincipalKrw ||
        oldFunding.lots.length !== nextLots.size ||
        oldFunding.lots.some((lot) => {
          const following = nextLots.get(lot.lotId);
          return (
            !following ||
            following.remainingEligiblePrincipalKrw !==
              lot.remainingEligiblePrincipalKrw
          );
        });
      if (
        fundingChanged &&
        next.input.funding.principalRevision <= oldFunding.principalRevision
      )
        fail("STALE_PRINCIPAL_REVISION");
      const durationLeft =
        current.cycleEndMicroseconds - current.cursorMicroseconds;
      current = register({
        ...current,
        entitlementRevision: change.entitlementRevision,
        condition: next,
        baseCapacity: nonnegative(
          add(
            current.baseCapacity,
            scale(
              subtract(
                next.fullBaseCapacity,
                current.condition.fullBaseCapacity,
              ),
              durationLeft,
              current.cycleDurationMicroseconds,
            ),
          ),
        ),
        conditionalRetentionCapacity: nonnegative(
          add(
            current.conditionalRetentionCapacity,
            scale(
              subtract(
                next.fullConditionalRetentionCapacity,
                current.condition.fullConditionalRetentionCapacity,
              ),
              durationLeft,
              current.cycleDurationMicroseconds,
            ),
          ),
        ),
      });
      changeIndex += 1;
    }
    if (current.cursorMicroseconds === current.cycleEndMicroseconds) {
      closedCycles.push({
        cycleIndex: current.cycleIndex,
        baseUsed: current.baseUsed,
        conditionalRetentionUsed: current.conditionalRetentionUsed,
        retentionQualificationRequired: true,
      });
      current = register({
        ...current,
        cycleIndex: current.cycleIndex + 1n,
        cycleStartMicroseconds: current.cycleEndMicroseconds,
        cycleEndMicroseconds:
          current.cycleEndMicroseconds + current.cycleDurationMicroseconds,
        baseCapacity: current.condition.fullBaseCapacity,
        conditionalRetentionCapacity:
          current.condition.fullConditionalRetentionCapacity,
        baseUsed: ZERO,
        conditionalRetentionUsed: ZERO,
      });
    }
    assertEffectiveEconomyPolicy(
      current.condition.input.policy,
      current.cursorMicroseconds,
    );
    if (current.cursorMicroseconds === serverNowMicroseconds) break;
    const nextBoundary =
      changes[changeIndex]?.effectiveFromMicroseconds ?? serverNowMicroseconds;
    const expires =
      current.condition.input.policy.publication.effectiveUntilMicroseconds ??
      serverNowMicroseconds;
    const end = [
      serverNowMicroseconds,
      current.cycleEndMicroseconds,
      nextBoundary,
      expires,
    ].reduce((minimum, value) => (value < minimum ? value : minimum));
    const start = current.cursorMicroseconds;
    if (end <= start) fail("UNRESOLVED_EFFECTIVE_BOUNDARY");
    const status = fundingPreviewStatus(current);
    let base = ZERO;
    let retention = ZERO;
    // An absent BASE assignment does not stop principal-based maintenance.
    // The status precedence still excludes pause, safe mode and ineligibility;
    // maintenance remains conditional until separate cycle/portion proof.
    if (status === "ACTIVE" || status === "NO_ACTIVE_ALLOCATION") {
      const elapsed = end - start;
      const baseAtNormalSpeed = scale(
        current.condition.fullBaseSpeedPerCycle,
        elapsed,
        current.cycleDurationMicroseconds,
      );
      const baseCandidate = scale(
        baseAtNormalSpeed,
        current.condition.allocatedBaseSpeedMultiplier.numerator,
        current.condition.allocatedBaseSpeedMultiplier.denominator,
      );
      const retentionCandidate = scale(
        current.condition.fullConditionalRetentionCapacity,
        elapsed,
        current.cycleDurationMicroseconds,
      );
      const baseRemaining = remaining(current.baseCapacity, current.baseUsed);
      const retentionRemaining = remaining(
        current.conditionalRetentionCapacity,
        current.conditionalRetentionUsed,
      );
      base =
        compare(baseCandidate, baseRemaining) < 0
          ? baseCandidate
          : baseRemaining;
      retention =
        compare(retentionCandidate, retentionRemaining) < 0
          ? retentionCandidate
          : retentionRemaining;
      const globalRemaining = remaining(
        add(current.baseCapacity, current.conditionalRetentionCapacity),
        add(current.baseUsed, current.conditionalRetentionUsed),
      );
      if (compare(add(base, retention), globalRemaining) > 0) {
        // Find the exact stopping instant within this interval. Use the actual
        // two portion rates; a portion that hits its own limit stops first.
        const totalCandidate = add(baseCandidate, retentionCandidate);
        const sharedBase = scale(
          baseCandidate,
          globalRemaining.numerator * totalCandidate.denominator,
          globalRemaining.denominator * totalCandidate.numerator,
        );
        const sharedRetention = subtract(globalRemaining, sharedBase);
        if (compare(sharedBase, baseRemaining) > 0) {
          base = baseRemaining;
          retention = subtract(globalRemaining, base);
        } else if (compare(sharedRetention, retentionRemaining) > 0) {
          retention = retentionRemaining;
          base = subtract(globalRemaining, retention);
        } else {
          base = sharedBase;
          retention = sharedRetention;
        }
      }
    }
    const carry = add(current.baseRewardCarry, base);
    const microPerKrw = BigInt(
      current.condition.input.policy.document.microKrwPerKrw,
    );
    const wholeKrw = carry.numerator / (carry.denominator * microPerKrw);
    settlementReadyKrw += wholeKrw;
    segments.push({
      startMicroseconds: start,
      endMicroseconds: end,
      cycleIndex: current.cycleIndex,
      policyVersion: current.condition.input.policy.document.policyVersion,
      principalRevision: current.condition.input.funding.principalRevision,
      entitlementRevision: current.entitlementRevision,
      status,
      baseAccrued: base,
      conditionalRetentionAccrued: retention,
    });
    current = register({
      ...current,
      cursorMicroseconds: end,
      baseUsed: add(current.baseUsed, base),
      conditionalRetentionUsed: add(
        current.conditionalRetentionUsed,
        retention,
      ),
      baseRewardCarry: subtract(carry, exactMicroKrw(wholeKrw * microPerKrw)),
    });
  }
  return freeze({
    mode: "PREVIEW_ONLY" as const,
    state: current,
    segments,
    closedCycles,
    settlementReadyKrw,
    conditionalRetentionSettlementReadyKrw: 0n,
    retentionQualificationRequired: true as const,
    status: fundingPreviewStatus(current),
    rewardCarryMicroKrw:
      current.baseRewardCarry.numerator / current.baseRewardCarry.denominator,
    rewardCarrySubMicroKrw: exactMicroKrw(
      current.baseRewardCarry.numerator % current.baseRewardCarry.denominator,
      current.baseRewardCarry.denominator,
    ),
  });
}
