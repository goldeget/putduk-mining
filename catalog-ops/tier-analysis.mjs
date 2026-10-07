// HISTORICAL TIER GATE: SUPERSEDED_BY_OWNER_CORRECTION. Used only to replay
// archived evidence/tests. Current proposals use mining-power-analysis.mjs.
// This module is not a financial engine or authority.
import {
  UNIT,
  combineSpeed,
  rational,
  displayFraction,
  decimalBps,
  allocationRate,
  normalizedProduct,
} from "./economy-simulate.mjs";

export function tierOrdinal(code) {
  if (!/^L(?:[1-9]|1[0-4])$/.test(code))
    throw new Error("INVALID_FUNDING_TIER");
  return BigInt(code.slice(1));
}

export function tierForPrincipal(principal, tiers) {
  if (
    typeof principal !== "bigint" ||
    principal < 0n ||
    !Array.isArray(tiers) ||
    tiers.length !== 14
  )
    throw new Error("INVALID_PRINCIPAL_OR_TIER_POLICY");
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (
      tierOrdinal(t.code) !== BigInt(i + 1) ||
      !/^\d+$/.test(t.minimumPrincipalKrw) ||
      (i === 13
        ? t.maximumPrincipalKrw !== null
        : !/^\d+$/.test(t.maximumPrincipalKrw)) ||
      (i > 0 &&
        BigInt(t.minimumPrincipalKrw) !==
          BigInt(tiers[i - 1].maximumPrincipalKrw) + 1n) ||
      (t.maximumPrincipalKrw !== null &&
        BigInt(t.maximumPrincipalKrw) < BigInt(t.minimumPrincipalKrw))
    )
      throw new Error("INVALID_PRINCIPAL_OR_TIER_POLICY");
  }
  return (
    tiers.findLast((t) => principal >= BigInt(t.minimumPrincipalKrw)) ?? null
  );
}

export function availableProducts(eligibility, tierCode) {
  const ordinal = tierOrdinal(tierCode);
  return eligibility.products.filter(
    (p) => tierOrdinal(p.minimum_funding_tier) <= ordinal,
  );
}

export function selectionPreview(
  eligibility,
  principal,
  selectedIds,
  controls = {},
) {
  const tier = tierForPrincipal(principal, eligibility.source_policy.tiers);
  if (
    !Array.isArray(selectedIds) ||
    new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some(
      (id) => !eligibility.products.some((p) => p.proposal_id === id),
    )
  )
    throw new Error("INVALID_SELECTION");
  const allowed = new Set(
    tier
      ? availableProducts(eligibility, tier.code).map((p) => p.proposal_id)
      : [],
  );
  const ineligible = selectedIds.filter((id) => !allowed.has(id));
  const status = controls.safeMode
    ? "SAFE_MODE"
    : controls.principalHold
      ? "PAUSED_PRINCIPAL_HOLD"
      : controls.paused
        ? "PAUSED"
        : controls.eligible === false
          ? "INELIGIBLE"
          : !tier
            ? "BELOW_FUNDING_MINIMUM"
            : ineligible.length
              ? "PAUSE_INELIGIBLE_SELECTION"
              : selectedIds.length > tier.slots
                ? "ALLOCATION_REVIEW_REQUIRED"
                : selectedIds.length === 0
                  ? "SELECTION_REQUIRED"
                  : "PROPOSAL_REQUIRES_SERVER_AUTHORIZATION";
  return {
    tier: tier?.code ?? null,
    status,
    ineligible,
    slots: tier?.slots ?? 0,
    automatic_substitution: false,
    reset: false,
    money_authority: "NONE_OFFLINE_PROPOSAL",
  };
}

export function downgradePreview({
  eligibility,
  newPrincipal,
  selectionIds,
  state,
  controls,
}) {
  if (!state || typeof state !== "object")
    throw new Error("MISSING_PRESERVED_STATE");
  return {
    ...selectionPreview(eligibility, newPrincipal, selectionIds, controls),
    preserved_state: structuredClone(state),
    requires_confirmation: true,
    effective_boundary:
      "AUTHORITATIVE_SERVER_CONDITION_CHANGE_INSTANT_NOT_CLIENT_CLOCK",
    catch_up: false,
    rollback: "FORWARD_REEVALUATE_NO_HISTORY_RESET",
  };
}

export function simulateTiered(proposal, candidates, policy, eligibility) {
  if (
    proposal.schema_version !== 2 ||
    proposal.recommended_band.maximum !== "1.10" ||
    !eligibility
  )
    throw new Error("MISSING_TIER_AWARE_PROPOSAL");
  const cycle = BigInt(policy.cycleDays);
  const candidateMap = new Map(
    candidates.candidates.map((p) => [p.proposal_id, p]),
  );
  const baseValues = proposal.products.map((p) =>
    decimalBps(p.proposed_product_speed_multiplier),
  );
  const productRows = proposal.products.map((p, i) => ({
    proposal_id: p.proposal_id,
    slug: p.slug,
    proposed_speed: p.proposed_product_speed_multiplier,
    minimum_funding_tier: p.minimum_funding_tier,
    A: normalizedProduct(baseValues[i], UNIT, cycle),
    B: { status: "REJECTED_PRODUCT_CAPACITY_VARIATION_NOT_RECOMMENDED" },
    C: {
      ...normalizedProduct(UNIT, UNIT, cycle),
      status: "COMPARISON_ONLY_PERSONALITY_MODEL",
    },
    headroom_factor_to_final_cap: rational(15000n, baseValues[i]),
    stack_examples: [
      {
        name: "product_only",
        ...combineSpeed([baseValues[i], UNIT, UNIT, UNIT]),
      },
      {
        name: "user_event_temporary",
        ...combineSpeed([baseValues[i], 11500n, 11000n, 10500n]),
      },
      {
        name: "cap_pressure",
        ...combineSpeed([baseValues[i], 12000n, 12500n, 11000n]),
      },
    ],
  }));
  const comparisonBands = [11000n, 11200n, 11800n].map((maximum) => {
    const mapped = baseValues.map(
      (v) => UNIT + (((v - UNIT) * (maximum - UNIT)) / 1000n / 100n) * 100n,
    );
    const tiers = eligibility.source_policy.tiers.map((t) => {
      const allowed = new Set(
        availableProducts(eligibility, t.code).map((p) => p.proposal_id),
      );
      const rows = proposal.products.flatMap((p, i) =>
        allowed.has(p.proposal_id) ? [{ ...p, bps: mapped[i] }] : [],
      );
      const speeds = rows.map((p) => p.bps),
        min = speeds.reduce((a, b) => (a < b ? a : b)),
        max = speeds.reduce((a, b) => (a > b ? a : b));
      const sum = speeds.reduce((a, b) => a + b, 0n),
        fastest = rows.filter((p) => p.bps === max);
      const prior = tierOrdinal(t.code) - 1n;
      const unlocked = rows.filter(
        (p) => tierOrdinal(p.minimum_funding_tier) === prior + 1n,
      );
      const classes = [
        ...new Set(
          rows.map((p) => candidateMap.get(p.proposal_id).asset_class),
        ),
      ];
      return {
        tier: t.code,
        principal_range_krw_from_ssot_only: [
          t.minimumPrincipalKrw,
          t.maximumPrincipalKrw,
        ],
        tier_name_from_ssot: t.name,
        slots_from_ssot: t.slots,
        retention_bps_from_ssot: t.retentionBonusBps,
        available_product_count: rows.length,
        eligible_product_ids: rows.map((p) => p.proposal_id),
        newly_unlocked: unlocked.map((p) => p.slug),
        fastest_products: fastest.map((p) => p.slug),
        slowest_speed: displayFraction(min, UNIT, 2),
        fastest_speed: displayFraction(max, UNIT, 2),
        mean_speed: rational(sum, BigInt(rows.length) * UNIT),
        fastest_vs_average: rational(max * BigInt(rows.length), sum),
        spread_ratio: rational(max, min),
        days_to_base_cap_fastest: rational(cycle * UNIT, max),
        days_to_base_cap_slowest: rational(cycle * UNIT, min),
        day_difference: rational(cycle * UNIT * (max - min), max * min),
        fastest_modifier_headroom: rational(15000n, max),
        fastest_pool_size: fastest.length,
        speed_only_top_pool_share: rational(1n, 1n),
        hypothetical_equal_tie_share_each: rational(1n, BigInt(fastest.length)),
        tie_share_assumption:
          "ILLUSTRATIVE_UNIFORM_TIE_BREAK_NOT_OBSERVED_MEMBER_BEHAVIOR",
        asset_classes: classes,
        top_asset_classes: [
          ...new Set(
            fastest.map((p) => candidateMap.get(p.proposal_id).asset_class),
          ),
        ],
        next_unlock:
          eligibility.source_policy.tiers.find(
            (x) => tierOrdinal(x.code) === tierOrdinal(t.code) + 1n,
          )?.code ?? null,
        global_base_capacity_index: "100",
        product_capacity_override: null,
        risk: "SLOWER_AVAILABLE_CHOICES_REMAIN_SPEED_ONLY_DOMINATED_NO_RANDOM_COMPENSATION",
      };
    });
    return {
      name: `1.00–${displayFraction(maximum, UNIT, 2)}`,
      status: "PROPOSED_NOT_APPROVED",
      minimum_speed: "1.00",
      maximum_speed: displayFraction(maximum, UNIT, 2),
      mapping: "LINEAR_REMAP_FROM_1_00_1_10_FLOOR_TO_0_01_FIXED_POINT",
      policy_version_change_required: true,
      approved_document_band_change_required: maximum > 11000n,
      product_speed_bps: proposal.products.map((p, i) => ({
        proposal_id: p.proposal_id,
        bps: mapped[i].toString(),
      })),
      fastest_days_to_cap: rational(cycle * UNIT, maximum),
      fastest_headroom: rational(15000n, maximum),
      moderate_stack_capped_count: mapped.filter(
        (x) => combineSpeed([x, 11500n, 11000n, 10500n]).capped,
      ).length,
      tiers,
    };
  });
  const top = comparisonBands[0].tiers.at(-1);
  return {
    schema_version: 2,
    simulation_type: "NORMALIZED_INDEX_ONLY_TIER_GATED",
    source_base_sha: candidates.base_sha,
    live_policy_confirmed: false,
    money_authority: "NONE_OFFLINE_PROPOSAL",
    market_price_inputs: [],
    existing_document_cycle_days: policy.cycleDays,
    capacity_index_base: "100",
    internal_micro_krw_per_krw: "1000000",
    recommended_policy: "A",
    recommended_band: "1.00–1.10",
    products: productRows,
    comparison_bands: comparisonBands,
    concentration: {
      before: {
        source_ref: "8f68be2005e16f1ac257626b3418cd3b8a96f1e3",
        maximum: "1.18",
        dominant_products: ["nvidia"],
        pool_size: 1,
        assumption:
          "HISTORICAL_UNRESTRICTED_SPEED_ONLY_MODEL_NOT_ACTUAL_RUNTIME",
      },
      after: {
        maximum: top.fastest_speed,
        dominant_products: top.fastest_products,
        pool_size: top.fastest_pool_size,
        economic_unique_winner_removed: top.fastest_pool_size > 1,
        top_pool_modeled_share: rational(1n, 1n),
        hypothetical_equal_tie_share_each:
          top.hypothetical_equal_tie_share_each,
        observed_member_distribution: "UNKNOWN",
        observed_fastest_share: null,
        risk: "TIES_REMOVE_UNIQUE_SPEED_WINNER_BUT_DO_NOT_PROVE_FAIR_OR_DIVERSE_MEMBER_SELECTION",
      },
    },
    global_capacity_assertion:
      "ONE_GLOBAL_BASE_CAPACITY_100; SUM_ALLOCATION_BPS<=10000; NO_SLOT_OR_PRODUCT_MULTIPLICATION; RETENTION_SEPARATE_CONDITIONAL",
    two_slots_example: {
      allocations_bps: ["5000", "5000"],
      total_capacity_index: "100",
      combined_rate: allocationRate([
        { speedBps: 11000n, allocationBps: 5000n },
        { speedBps: 11000n, allocationBps: 5000n },
      ]),
    },
    cap_example_requested: combineSpeed([12000n, 11500n, 11000n, UNIT]),
    once_only_order_example: {
      input_bps: ["11800", "12000", "12500", "8000"],
      final_once: combineSpeed([11800n, 12000n, 12500n, 8000n]),
      naive_intermediate_clamp_result: "1.200000",
    },
    runtime_blocker:
      "EFFECT_SCOPE_UNRESOLVED; NO_APPROVED_PRODUCT_TIER_GATE; NO_LIVE_PUBLICATION_RECEIPT",
    trial_boundary: "START_IS_SEPARATE_NO_FUNDING_REQUIREMENT_INFERRED",
  };
}
