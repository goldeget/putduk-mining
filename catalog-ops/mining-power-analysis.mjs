// Offline analysis only. This module never authorizes or produces rewards.
import { tierForPrincipal } from "./tier-analysis.mjs";
import {
  UNIT,
  decimalBps,
  combineSpeed,
  rational,
  normalizedProduct,
  allocationRate,
} from "./economy-simulate.mjs";

export function publishedChoices(
  access,
  { eligibleMember, publishedAvailableIds },
) {
  if (
    typeof eligibleMember !== "boolean" ||
    !Array.isArray(publishedAvailableIds) ||
    new Set(publishedAvailableIds).size !== publishedAvailableIds.length ||
    publishedAvailableIds.some(
      (id) => !access.products.some((p) => p.proposal_id === id),
    )
  )
    throw new Error("AUTHORITATIVE_ACCESS_INPUT_REQUIRED");
  if (!eligibleMember) return [];
  return access.products.filter((p) =>
    publishedAvailableIds.includes(p.proposal_id),
  );
}

export function openSelectionPreview({
  power,
  access,
  principal,
  selectedIds,
  controls,
  publishedAvailableIds,
}) {
  const choices = publishedChoices(access, {
    eligibleMember: controls?.eligible,
    publishedAvailableIds,
  });
  if (
    !Array.isArray(selectedIds) ||
    new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some((id) => !access.products.some((p) => p.proposal_id === id))
  )
    throw new Error("INVALID_SELECTION");
  const tier = tierForPrincipal(principal, power.source_policy.tiers);
  const unavailable = selectedIds.filter(
    (id) => !choices.some((p) => p.proposal_id === id),
  );
  const status = controls.safeMode
    ? "SAFE_MODE"
    : controls.principalHold
      ? "PAUSED_PRINCIPAL_HOLD"
      : controls.paused
        ? "PAUSED"
        : !controls.eligible
          ? "INELIGIBLE_MEMBER"
          : unavailable.length
            ? "PRODUCT_NOT_PUBLISHED_AVAILABLE"
            : !tier
              ? "BELOW_FUNDED_MINING_MINIMUM_PRODUCT_NOT_LOCKED"
              : selectedIds.length > tier.slots
                ? "PRIMARY_CONTRACT_REQUIRED"
                : !selectedIds.length
                  ? "SELECTION_REQUIRED"
                  : "PROPOSAL_REQUIRES_SERVER_AUTHORIZATION";
  return {
    tier: tier?.code ?? null,
    status,
    slots: tier?.slots ?? 0,
    unavailable_products: unavailable,
    product_tier_lock: false,
    selected_ids: [...selectedIds],
    reset: false,
    automatic_substitution: false,
    money_authority: "NONE_OFFLINE_ANALYSIS",
    slot_resolution: null,
  };
}

export function openDowngradePreview(input) {
  if (!input.state || typeof input.state !== "object")
    throw new Error("MISSING_PRESERVED_STATE");
  return {
    ...openSelectionPreview(input),
    preserved_state: structuredClone(input.state),
    reevaluation: "FUTURE_TIER_ECONOMICS_AT_AUTHORITATIVE_BOUNDARY",
    base_speed_status: "TIER_SPEED_CONTRACT_REQUIRED",
    catch_up: false,
    effective_boundary:
      "AUTHORITATIVE_SERVER_CONDITION_CHANGE_INSTANT_NOT_CLIENT_CLOCK",
  };
}

export function neutralReference(principal, policy) {
  if (
    typeof principal !== "bigint" ||
    principal < BigInt(policy.minimumPrincipalKrw)
  )
    throw new Error("FUNDED_PRINCIPAL_REQUIRED");
  const numerator =
    principal * BigInt(policy.microKrwPerKrw) * BigInt(policy.baseCycleRateBps);
  return {
    base_capacity_micro_krw: rational(numerator, UNIT),
    neutral_daily_base_micro_krw: rational(
      numerator,
      UNIT * BigInt(policy.cycleDays),
    ),
  };
}

const scale = (value, multiplier) =>
  rational(
    BigInt(value.numerator) * BigInt(multiplier.numerator),
    BigInt(value.denominator) * BigInt(multiplier.denominator),
  );
const timeToCap = (cycle, multiplier) =>
  rational(
    cycle * BigInt(multiplier.denominator),
    BigInt(multiplier.numerator),
  );

export function simulateOpen(proposal, candidates, policy, context) {
  if (proposal.schema_version !== 3 || !context?.power || !context?.access)
    throw new Error("OPEN_PRODUCT_POWER_MODEL_REQUIRED");
  const { power, access } = context;
  const cycle = BigInt(policy.cycleDays);
  const productRows = proposal.products.map((p) => ({
    proposal_id: p.proposal_id,
    slug: p.slug,
    proposed_speed: p.proposed_product_speed_multiplier,
    product_access_policy: "ALL_ELIGIBLE_MEMBERS",
    tier_capacity: "INHERITED",
    A: normalizedProduct(
      decimalBps(p.proposed_product_speed_multiplier),
      UNIT,
      cycle,
    ),
    reference_scope:
      "CONDITIONAL_NEUTRAL_BASE_PRODUCT_ONLY_NOT_EFFECTIVE_REWARD_FORECAST",
    stack_examples: [
      {
        name: "product_only",
        ...combineSpeed([
          decimalBps(p.proposed_product_speed_multiplier),
          UNIT,
          UNIT,
          UNIT,
        ]),
      },
      {
        name: "user_event_temporary",
        ...combineSpeed([
          decimalBps(p.proposed_product_speed_multiplier),
          11500n,
          11000n,
          10500n,
        ]),
      },
      {
        name: "cap_pressure",
        ...combineSpeed([
          decimalBps(p.proposed_product_speed_multiplier),
          12000n,
          12500n,
          11000n,
        ]),
      },
    ],
  }));
  const tiers = power.source_policy.tiers.map((t) => {
    const principal = BigInt(t.minimumPrincipalKrw),
      reference = neutralReference(principal, policy);
    return {
      tier: t.code,
      reference_eligible_principal_krw: principal.toString(),
      maximum_eligible_principal_krw: t.maximumPrincipalKrw,
      slots: t.slots,
      product_access: "ALL_PUBLISHED_PRODUCTS",
      conditional_proposed_choice_count_if_all_published:
        access.products.length,
      current_effective_proposal_choice_count: 0,
      tier_base_speed_multiplier: null,
      tier_base_speed_status: "TIER_SPEED_CONTRACT_REQUIRED",
      actual_effective_daily_reward: null,
      ...reference,
      conditional_retention_capacity_micro_krw: rational(
        principal * BigInt(policy.microKrwPerKrw) * BigInt(t.retentionBonusBps),
        UNIT,
      ),
      retention_qualification: "SEPARATE_NOT_SETTLEMENT_READY",
      per_product_reference: productRows.map((p) => {
        const modifier = p.stack_examples[0].final;
        return {
          slug: p.slug,
          product_access_policy: "ALL_ELIGIBLE_MEMBERS",
          global_capacity_micro_krw: reference.base_capacity_micro_krw,
          conditional_daily_base_micro_krw: scale(
            reference.neutral_daily_base_micro_krw,
            modifier,
          ),
          conditional_days_to_base_cap: timeToCap(cycle, modifier),
        };
      }),
      slot_examples: Array.from({ length: t.slots }, (_, index) => {
        const count = index + 1;
        const slugs = [
          "gold",
          "nvidia",
          "spy",
          "ethereum",
          "samsung-electronics",
        ].slice(0, count);
        const allocations = slugs.map(
          (_, i) =>
            10000n / BigInt(count) +
            (BigInt(i) < 10000n % BigInt(count) ? 1n : 0n),
        );
        const rate = allocationRate(
          slugs.map((slug, i) => ({
            allocationBps: allocations[i],
            speedBps: decimalBps(
              proposal.products.find((p) => p.slug === slug)
                .proposed_product_speed_multiplier,
            ),
          })),
        );
        return {
          slots_used: count,
          slugs,
          allocation_bps: allocations.map(String),
          total_allocation_bps: "10000",
          weighted_modifier: rate,
          global_capacity_micro_krw: reference.base_capacity_micro_krw,
          conditional_daily_base_micro_krw: scale(
            reference.neutral_daily_base_micro_krw,
            rate,
          ),
          capacity_multiplied_by_slots: false,
        };
      }),
    };
  });
  const comparisonBands = [11000n, 11200n, 11800n].map((maximum) => {
    const values = proposal.products.map(
      (p) =>
        UNIT +
        (((decimalBps(p.proposed_product_speed_multiplier) - UNIT) *
          (maximum - UNIT)) /
          1000n /
          100n) *
          100n,
    );
    return {
      name: `1.00–1.${(maximum - UNIT) / 100n}`,
      maximum_bps: maximum.toString(),
      policy_band_change_required:
        maximum > BigInt(policy.productMultiplier.maximumBps),
      global_capacity_changes: false,
      tier_product_access_changes: false,
      fastest_days_to_base_cap_neutral_reference: rational(
        cycle * UNIT,
        maximum,
      ),
      fastest_headroom: rational(15000n, maximum),
      moderate_stack_capped_count: values.filter(
        (v) => combineSpeed([v, 11500n, 11000n, 10500n]).capped,
      ).length,
      actual_effective_rate: null,
    };
  });
  const lowerPrincipal = BigInt(policy.tiers[0].minimumPrincipalKrw),
    higherPrincipal = BigInt(policy.tiers[1].minimumPrincipalKrw);
  const neighborLower = BigInt(policy.tiers[0].maximumPrincipalKrw);
  return {
    schema_version: 3,
    scope: "OFFLINE_SSOT_REFERENCE_AND_UNAPPROVED_MODIFIER_SCENARIOS_ONLY",
    live_policy_confirmed: false,
    market_price_inputs: [],
    recommended_policy: "A",
    recommended_band: "1.00–1.10",
    product_access_policy: "ALL_ELIGIBLE_MEMBERS",
    tier_base_speed_status: "TIER_SPEED_CONTRACT_REQUIRED",
    source_policy_version: power.source_policy.policy_version,
    products: productRows,
    tiers,
    comparison_bands: comparisonBands,
    same_product_across_tiers: ["gold", "nvidia"].map((slug) => ({
      slug,
      rows: tiers.map((t) => ({
        tier: t.tier,
        principal_krw: t.reference_eligible_principal_krw,
        ...t.per_product_reference.find((p) => p.slug === slug),
        slots: t.slots,
      })),
    })),
    tier_vs_product: {
      tier_minimum_L2_gold_vs_L1_nvidia: {
        scope:
          "CONDITIONAL_NEUTRAL_BASE_REFERENCE_NOT_DISTINCT_TIER_SPEED_RULE",
        base_capacity_ratio: rational(higherPrincipal, lowerPrincipal),
        daily_rate_ratio: rational(
          higherPrincipal * 10000n,
          lowerPrincipal * 11000n,
        ),
        capacity_independent_of_product: true,
      },
      adjacent_boundary_L1_nvidia_vs_L2_gold: {
        lower_principal_krw: neighborLower.toString(),
        higher_principal_krw: higherPrincipal.toString(),
        lower_tier_rate_over_higher_tier_rate_neutral_reference: rational(
          neighborLower * 11000n,
          higherPrincipal * 10000n,
        ),
        finding: "DISTINCT_TIER_BASE_SPEED_DOMINANCE_NOT_PROVEN_NEAR_BOUNDARY",
      },
    },
    principal_growth_question: {
      base_capacity_with_more_eligible_principal:
        "STRICTLY_INCREASES_IN_DOCUMENT_NEUTRAL_REFERENCE",
      neutral_absolute_base_rate_with_same_product_and_conditions:
        "PRINCIPAL_PROPORTIONAL",
      concurrent_slot_count:
        "NONDECREASING_STEPWISE_WITH_PLATEAUS_NOT_EVERY_TIER",
      retention: "SEPARATE_CONDITIONAL_NONDECREASING_BPS_WITH_PLATEAUS",
      distinct_tier_base_speed_progression: "TIER_SPEED_CONTRACT_REQUIRED",
      tier_base_economics_dominate_product_near_every_boundary:
        "UNVERIFIED_PRIMARY_CONTRACT_REQUIRED",
      product_access_restriction_required_for_growth: false,
    },
    cap_example_requested: combineSpeed([12000n, 11500n, 11000n, UNIT]),
    once_only_order_example: {
      input_bps: ["11000", "12000", "12500", "8000"],
      final_once: combineSpeed([11000n, 12000n, 12500n, 8000n]),
      naive_intermediate_clamp_result: "1.200000",
    },
    final_cap_scope: power.final_cap_scope,
    concentration: {
      observed_member_distribution: "UNKNOWN",
      observed_fastest_share: null,
      tier_gated_model_status: "SUPERSEDED_BY_OWNER_CORRECTION",
      remaining_preference_risk:
        "A 1.10 group can still dominate speed-only preference; no observed behavior or balance claim.",
    },
    runtime_blocker: "EFFECT_SCOPE_UNRESOLVED",
    production_ready: false,
  };
}
