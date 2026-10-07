import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
export const UNIT = 10000n;
export const MICRO = 1000000n;

export function decimalBps(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) {
    throw new Error("INVALID_DECIMAL_MULTIPLIER");
  }
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * UNIT + BigInt(fraction) * 100n;
}

export function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function rational(n, d) {
  if (typeof n !== "bigint" || typeof d !== "bigint" || n < 0n || d <= 0n) {
    throw new Error("INVALID_RATIONAL");
  }
  const g = gcd(n, d);
  return { numerator: (n / g).toString(), denominator: (d / g).toString() };
}

export function displayFraction(n, d, places = 6) {
  if (
    n < 0n ||
    d <= 0n ||
    !Number.isInteger(places) ||
    places < 0 ||
    places > 12
  ) {
    throw new Error("INVALID_DISPLAY_FRACTION");
  }
  const scale = 10n ** BigInt(places);
  const scaled = (n * scale) / d;
  return places === 0
    ? scaled.toString()
    : `${scaled / scale}.${(scaled % scale).toString().padStart(places, "0")}`;
}

// Proposal only. Existing funding-entitlement blocks non-default effects.
// Multiply exact rationals first; compare and clamp once at the final stage.
export function combineSpeed(modifiers, capBps = 15000n) {
  if (
    !Array.isArray(modifiers) ||
    modifiers.length !== 4 ||
    capBps !== 15000n ||
    modifiers.some((n) => typeof n !== "bigint" || n <= 0n)
  ) {
    throw new Error("INVALID_SPEED_STACK");
  }
  const rawNumerator = modifiers.reduce((a, b) => a * b, 1n);
  const rawDenominator = UNIT ** BigInt(modifiers.length);
  const capped = rawNumerator * UNIT > capBps * rawDenominator;
  return {
    raw: rational(rawNumerator, rawDenominator),
    final: capped
      ? rational(capBps, UNIT)
      : rational(rawNumerator, rawDenominator),
    capped,
    raw_display: displayFraction(rawNumerator, rawDenominator),
    final_display: capped
      ? "1.500000"
      : displayFraction(rawNumerator, rawDenominator),
    clamp_stage: "FINAL_COMBINED_ONCE",
  };
}

// Exact accrued micro units and fractional carry. Never convert through Number.
export function accrue({
  rateNumerator,
  rateDenominator,
  elapsed,
  carry = 0n,
  accrued = 0n,
  capacity,
}) {
  if (
    [rateNumerator, rateDenominator, elapsed, carry, accrued, capacity].some(
      (x) => typeof x !== "bigint",
    ) ||
    rateNumerator < 0n ||
    rateDenominator <= 0n ||
    elapsed < 0n ||
    carry < 0n ||
    carry >= rateDenominator ||
    accrued < 0n ||
    capacity < accrued
  ) {
    throw new Error("INVALID_ACCRUAL");
  }
  if (accrued === capacity) return { accrued, carry };
  const numerator = rateNumerator * elapsed + carry;
  const whole = numerator / rateDenominator;
  const nextCarry = numerator % rateDenominator;
  // Overflow at a reached global cycle cap is not a future reward. Carry is
  // fractional sub-micro residue only; its runtime rollover needs policy review.
  return {
    accrued: accrued + whole > capacity ? capacity : accrued + whole,
    carry: nextCarry,
  };
}

export function normalizedProduct(
  speedBps,
  capacityBps = UNIT,
  cycleDays = 30n,
) {
  if (speedBps <= 0n || capacityBps <= 0n || cycleDays <= 0n)
    throw new Error("INVALID_PRODUCT_MODEL");
  return {
    speed: rational(speedBps, UNIT),
    capacity_index: rational(100n * capacityBps, UNIT),
    daily_index_rate: rational(100n * speedBps, cycleDays * UNIT),
    days_to_cap: rational(cycleDays * capacityBps, speedBps),
    days_to_cap_display: displayFraction(cycleDays * capacityBps, speedBps),
  };
}

export function allocationRate(products) {
  if (
    !Array.isArray(products) ||
    products.some(
      (x) =>
        typeof x.allocationBps !== "bigint" ||
        x.allocationBps <= 0n ||
        x.allocationBps > UNIT ||
        typeof x.speedBps !== "bigint" ||
        x.speedBps <= 0n,
    ) ||
    products.reduce((s, x) => s + x.allocationBps, 0n) > UNIT
  ) {
    throw new Error("INVALID_GLOBAL_ALLOCATION");
  }
  return rational(
    products.reduce((sum, x) => sum + x.allocationBps * x.speedBps, 0n),
    UNIT * UNIT,
  );
}

export function simulate(proposal, candidates, policy) {
  const cycle = BigInt(policy.cycleDays);
  const values = proposal.products.map((p) =>
    decimalBps(p.proposed_product_speed_multiplier),
  );
  const maximum = values.reduce((a, b) => (a > b ? a : b));
  const minimum = values.reduce((a, b) => (a < b ? a : b));
  const productRows = proposal.products.map((p) => {
    const speed = decimalBps(p.proposed_product_speed_multiplier);
    const bCapacity = { C: 10000n, B: 10500n, A: 11000n, S: 11500n }[p.grade];
    return {
      proposal_id: p.proposal_id,
      slug: p.slug,
      proposed_speed: p.proposed_product_speed_multiplier,
      A: normalizedProduct(speed, UNIT, cycle),
      B: {
        ...normalizedProduct(speed, bCapacity, cycle),
        status: "COMPARISON_ONLY_UNAPPROVED_CAPACITY_CHANGE",
      },
      C: normalizedProduct(UNIT, UNIT, cycle),
      headroom_factor_to_final_cap: rational(15000n, speed),
      headroom_display: displayFraction(15000n, speed),
      stack_examples: [
        {
          name: "product_only",
          modifiers_bps: [speed.toString(), "10000", "10000", "10000"],
          ...combineSpeed([speed, UNIT, UNIT, UNIT]),
        },
        {
          name: "user_event",
          modifiers_bps: [speed.toString(), "11500", "11000", "10000"],
          ...combineSpeed([speed, 11500n, 11000n, UNIT]),
        },
        {
          name: "user_event_temporary",
          modifiers_bps: [speed.toString(), "11500", "11000", "10500"],
          ...combineSpeed([speed, 11500n, 11000n, 10500n]),
        },
        {
          name: "cap_pressure",
          modifiers_bps: [speed.toString(), "12000", "12500", "11000"],
          ...combineSpeed([speed, 12000n, 12500n, 11000n]),
        },
      ],
    };
  });
  const bands = [
    { name: "CONSERVATIVE", maximum: 11200n },
    { name: "BALANCED", maximum: 12000n },
    { name: "AGGRESSIVE", maximum: 12500n },
  ].map((band) => {
    const mapped = values.map(
      (v) =>
        UNIT +
        (((v - UNIT) * (band.maximum - UNIT)) / (maximum - UNIT) / 100n) * 100n,
    );
    return {
      name: band.name,
      status: "SCENARIO_ONLY_NOT_PRODUCT_APPROVAL",
      minimum_speed: "1.00",
      maximum_speed: displayFraction(band.maximum, UNIT, 2),
      mapping: "LINEAR_RANK_REMAP_ROUND_DOWN_TO_0_01",
      fastest_days_to_cap: rational(cycle * UNIT, band.maximum),
      fastest_days_display: displayFraction(cycle * UNIT, band.maximum),
      fastest_headroom: rational(15000n, band.maximum),
      product_speed_bps: proposal.products.map((p, i) => ({
        proposal_id: p.proposal_id,
        bps: mapped[i].toString(),
      })),
      moderate_stack_capped_count: mapped.filter(
        (x) => combineSpeed([x, 11500n, 11000n, 10500n]).capped,
      ).length,
    };
  });
  const categories = [
    ...new Set(candidates.candidates.map((p) => p.asset_class)),
  ].map((asset) => {
    const ids = new Set(
      candidates.candidates
        .filter((p) => p.asset_class === asset)
        .map((p) => p.proposal_id),
    );
    const selected = proposal.products.filter((p) => ids.has(p.proposal_id));
    const sum = selected.reduce(
      (s, p) => s + decimalBps(p.proposed_product_speed_multiplier),
      0n,
    );
    return {
      asset_class: asset,
      product_count: selected.length,
      mean_speed: rational(sum, BigInt(selected.length) * UNIT),
      mean_speed_display: displayFraction(sum, BigInt(selected.length) * UNIT),
    };
  });
  const sum = values.reduce((a, b) => a + b, 0n);
  const baseCapacity =
    (BigInt(policy.minimumPrincipalKrw) *
      MICRO *
      BigInt(policy.baseCycleRateBps)) /
    UNIT;
  return {
    schema_version: 1,
    simulation_type: "NORMALIZED_INDEX_ONLY",
    source_base_sha: candidates.base_sha,
    live_policy_confirmed: false,
    existing_document_cycle_days: policy.cycleDays,
    capacity_index_base: "100",
    internal_micro_krw_per_krw: MICRO.toString(),
    money_authority: "NONE_OFFLINE_PROPOSAL",
    market_price_inputs: [],
    existing_approved_document_capacity_example: {
      principal_krw: policy.minimumPrincipalKrw,
      base_capacity_micro_krw: baseCapacity.toString(),
      scope: "DOCUMENT_ARITHMETIC_ONLY_NOT_LIVE_ENTITLEMENT_OR_PAYOUT_FORECAST",
      retention_included: false,
    },
    recommended_policy: "A",
    recommended_band: "1.00–1.18",
    products: productRows,
    comparison_bands: bands,
    category_averages: categories,
    spread: {
      fastest: "1.18",
      slowest: "1.00",
      full_allocation_rate_ratio: rational(maximum, minimum),
      slowest_days: rational(cycle * UNIT, minimum),
      fastest_days: rational(cycle * UNIT, maximum),
      day_difference: rational(
        cycle * UNIT * (maximum - minimum),
        maximum * minimum,
      ),
      mean_speed: rational(sum, BigInt(values.length) * UNIT),
      fastest_vs_mean: rational(maximum * BigInt(values.length), sum),
    },
    global_capacity_assertion:
      "Capacity stays 100 across products and slots under A; allocations sum <=10000bps.",
    two_slots_example: {
      slots: 2,
      products: ["nvidia", "gold"],
      allocations_bps: ["5000", "5000"],
      total_capacity_index: "100",
      combined_rate: allocationRate([
        { speedBps: 11800n, allocationBps: 5000n },
        { speedBps: 10000n, allocationBps: 5000n },
      ]),
    },
    concentration: {
      observed_member_distribution: "UNKNOWN",
      modeled_behavior: "SPEED_ONLY_RATIONAL_CHOOSER_FULL_ALLOCATION",
      dominant_products: proposal.products
        .filter(
          (p) => decimalBps(p.proposed_product_speed_multiplier) === maximum,
        )
        .map((p) => p.slug),
      modeled_fastest_share: "1/1",
      observed_fastest_share: null,
      fastest_vs_slowest_daily_advantage: rational(maximum - minimum, minimum),
      identical_cycle_maximum_under_A: true,
      risk: "HIGH: equal capacity does not remove faster arrival/preference incentive; lower choices have no compensating economic benefit.",
      mitigation: [
        "Do not publish as balanced by default",
        "Review bounded narrower band 1.00–1.12 or C fallback",
        "Use measured opt-in preference/selection evidence after launch",
        "Do not add random money/capacity/hidden penalties to force diversity",
      ],
    },
    cap_example_requested: combineSpeed([12000n, 11500n, 11000n, UNIT]),
    once_only_order_example: {
      input_bps: ["11800", "12000", "12500", "8000"],
      final_once: combineSpeed([11800n, 12000n, 12500n, 8000n]),
      naive_intermediate_clamp_result: "1.200000",
      caution:
        "Illustrative lower modifier, not a proposed temporary promotion",
    },
    rounding: {
      unit: "MICRO_KRW",
      denominator: "3",
      ticks: ["0", "0", "1"],
      fractional_carry: ["1", "2", "0"],
      whole_krw_main_display: "FLOOR_INTERNAL_MICRO_DIV_1000000",
      remainder_is_not_verified_wallet: true,
    },
    policy_B_warning:
      "Different per-product capacity changes entitlement and payable ceiling; not recommended and not implemented.",
    runtime_blocker:
      "EFFECT_SCOPE_UNRESOLVED; proposal stacking is not established existing backend behavior",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const read = (name) =>
    JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
  const result = simulate(
    read("product-economy-proposal.json"),
    read("product-candidates.json"),
    read("evidence/current-catalog-evidence.json").current_policy,
  );
  const text = JSON.stringify(result, null, 2) + "\n";
  writeFileSync(resolve(root, "economy-simulation-results.json"), text);
  writeFileSync(resolve(root, "evidence/economy-simulation.json"), text);
  console.log(
    JSON.stringify({
      status: "PASS_OFFLINE_SIMULATION",
      products: result.products.length,
      model: result.recommended_policy,
      fastest_days: result.products.find((p) => p.slug === "nvidia").A
        .days_to_cap_display,
      band_cap_counts: result.comparison_bands.map((x) => ({
        band: x.name,
        capped: x.moderate_stack_capped_count,
      })),
      actual_runtime: "UNVERIFIED_NOT_ACTIVATED",
      concentration: "HIGH",
    }),
  );
}
