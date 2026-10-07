import test from "node:test";
import assert from "node:assert/strict";
import { loadPackage, validatePackage } from "./validate.mjs";
import {
  tierForPrincipal,
  tierOrdinal,
  availableProducts,
  selectionPreview,
  downgradePreview,
} from "./tier-analysis.mjs";
import {
  combineSpeed,
  rational,
  decimalBps,
  allocationRate,
  simulate,
} from "./economy-simulate.mjs";

const base = loadPackage(),
  eligibility = base.eligibility;
const tiers = eligibility.source_policy.tiers;
const fresh = () => structuredClone(base);
const selected = (slug) =>
  eligibility.products.find((p) => p.slug === slug).proposal_id;

function rejection(name, code, change) {
  test(name, () => {
    const data = fresh();
    change(data);
    const result = validatePackage(data);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.code === code),
      JSON.stringify(result.errors),
    );
  });
}

test("current 25-product proposal validates with 14 real Tier references", () => {
  assert.deepEqual(validatePackage(base).errors, []);
  assert.equal(eligibility.products.length, 25);
  assert.deepEqual(tiers, base.policySource.tiers);
  assert.equal(base.launch.effective_launch_count, 0);
});

for (let i = 0; i < tiers.length; i++) {
  const t = tiers[i],
    minimum = BigInt(t.minimumPrincipalKrw);
  test(`${t.code} immediately below threshold remains in previous Tier`, () =>
    assert.equal(
      tierForPrincipal(minimum - 1n, tiers)?.code ?? null,
      i ? tiers[i - 1].code : null,
    ));
  test(`${t.code} exact threshold unlocks correct Tier`, () =>
    assert.equal(tierForPrincipal(minimum, tiers).code, t.code));
  test(`${t.code} immediately above threshold stays in this Tier`, () =>
    assert.equal(tierForPrincipal(minimum + 1n, tiers).code, t.code));
}

test("arbitrarily large integer principal remains exact at final unbounded Tier", () => {
  assert.equal(tierForPrincipal(9007199254740993123456789n, tiers).code, "L14");
  assert.throws(() => tierForPrincipal(100000, tiers), /INVALID_PRINCIPAL/);
  assert.throws(() => tierForPrincipal(-1n, tiers), /INVALID_PRINCIPAL/);
});

test("invalid and unknown tiers are rejected rather than treated as eligible", () => {
  for (const code of ["L0", "L15", "L01", "", "STARTER", null, "L1.0"])
    assert.throws(() => tierOrdinal(code), /INVALID_FUNDING_TIER/);
});

test("non-contiguous SSOT intervals cannot resolve funding eligibility", () => {
  const copy = structuredClone(tiers);
  copy[1].minimumPrincipalKrw = "500001";
  assert.throws(
    () => tierForPrincipal(500000n, copy),
    /INVALID_PRINCIPAL_OR_TIER_POLICY/,
  );
});

test("product unlock happens at its inherited threshold, not at a rounded amount", () => {
  const minimum = BigInt(tiers[10].minimumPrincipalKrw);
  assert.equal(
    selectionPreview(eligibility, minimum - 1n, [selected("tesla")]).status,
    "PAUSE_INELIGIBLE_SELECTION",
  );
  assert.equal(
    selectionPreview(eligibility, minimum, [selected("tesla")]).status,
    "PROPOSAL_REQUIRES_SERVER_AUTHORIZATION",
  );
});

test("available sets are monotone and all 14 levels add a product", () => {
  let previous = new Set();
  for (const t of tiers) {
    const set = new Set(
      availableProducts(eligibility, t.code).map((p) => p.proposal_id),
    );
    assert.ok([...previous].every((id) => set.has(id)));
    assert.ok(set.size > previous.size);
    previous = set;
  }
  assert.equal(previous.size, 25);
});

test("L1 has four choices and cannot select the highest-stage SpaceX proposal", () => {
  assert.equal(availableProducts(eligibility, "L1").length, 4);
  assert.equal(
    selectionPreview(eligibility, 100000n, [selected("spacex")]).status,
    "PAUSE_INELIGIBLE_SELECTION",
  );
});

test("highest Tier has five equal-fastest choices with distinct scene personalities", () => {
  const top = base.simulation.comparison_bands[0].tiers.at(-1);
  assert.equal(top.fastest_pool_size, 5);
  assert.deepEqual(
    new Set(top.fastest_products),
    new Set(["sk-hynix", "tesla", "rocket-lab", "nvidia", "spacex"]),
  );
  const personalities = base.economy.products
    .filter((p) => top.fastest_products.includes(p.slug))
    .map((p) => p.mining_personality);
  assert.equal(new Set(personalities).size, 5);
});

test("tier downgrade pauses ineligible selection and preserves all old state", () => {
  const state = {
    cycle: "TEST_CYCLE",
    mining_age: "12",
    used_micro: "1111111",
    carry: "2/3",
    verified_ledger: ["TEST_ID"],
  };
  const result = downgradePreview({
    eligibility,
    newPrincipal: 100000n,
    selectionIds: [selected("nvidia")],
    state,
  });
  assert.equal(result.status, "PAUSE_INELIGIBLE_SELECTION");
  assert.deepEqual(result.preserved_state, state);
  assert.equal(result.reset, false);
  assert.equal(result.catch_up, false);
  assert.equal(result.automatic_substitution, false);
  result.preserved_state.verified_ledger.push("TEST_NEW");
  assert.equal(state.verified_ledger.length, 1);
});

test("principal hold pauses even an eligible gold selection without reset", () => {
  const result = selectionPreview(eligibility, 100000n, [selected("gold")], {
    principalHold: true,
  });
  assert.equal(result.status, "PAUSED_PRINCIPAL_HOLD");
  assert.equal(result.reset, false);
});

test("hold release reevaluates forward and is not an automatic authorization", () => {
  assert.equal(
    selectionPreview(eligibility, 100000n, [selected("gold")], {
      principalHold: false,
    }).status,
    "PROPOSAL_REQUIRES_SERVER_AUTHORIZATION",
  );
});

test("safe mode wins over hold, pause and capacity-driven eligibility", () => {
  assert.equal(
    selectionPreview(eligibility, 5000000000n, [selected("nvidia")], {
      safeMode: true,
      principalHold: true,
      paused: true,
    }).status,
    "SAFE_MODE",
  );
});

test("Tier slots restrict allocations without multiplying cycle capacity", () => {
  assert.equal(
    selectionPreview(eligibility, 100000n, [
      selected("gold"),
      selected("silver"),
    ]).status,
    "ALLOCATION_REVIEW_REQUIRED",
  );
  assert.deepEqual(
    allocationRate([
      { speedBps: 11000n, allocationBps: 5000n },
      { speedBps: 11000n, allocationBps: 5000n },
    ]),
    rational(11n, 10n),
  );
  assert.equal(base.simulation.two_slots_example.total_capacity_index, "100");
});

test("empty, duplicate and unknown selections never become authorization", () => {
  assert.equal(
    selectionPreview(eligibility, 100000n, []).status,
    "SELECTION_REQUIRED",
  );
  assert.throws(
    () =>
      selectionPreview(eligibility, 100000n, [
        selected("gold"),
        selected("gold"),
      ]),
    /INVALID_SELECTION/,
  );
  assert.throws(
    () => selectionPreview(eligibility, 100000n, ["FAKE_PRODUCT"]),
    /INVALID_SELECTION/,
  );
});

test("1.10 recommended band retains moderate modifier headroom; 1.18 pressures final cap", () => {
  const bands = base.simulation.comparison_bands;
  assert.deepEqual(
    bands.map((b) => b.maximum_speed),
    ["1.10", "1.12", "1.18"],
  );
  assert.equal(bands[0].moderate_stack_capped_count, 0);
  assert.ok(bands[2].moderate_stack_capped_count > 0);
  assert.deepEqual(bands[0].fastest_headroom, rational(15n, 11n));
  assert.deepEqual(bands[1].fastest_headroom, rational(75n, 56n));
  assert.deepEqual(bands[2].fastest_headroom, rational(75n, 59n));
});

test("requested modifier stack is exact and clamped once at final 1.50", () => {
  const stack = combineSpeed([12000n, 11500n, 11000n, 10000n]);
  assert.deepEqual(stack.raw, rational(759n, 500n));
  assert.deepEqual(stack.final, rational(3n, 2n));
  assert.equal(stack.capped, true);
  assert.deepEqual(
    combineSpeed([11800n, 12000n, 12500n, 8000n]).final,
    rational(177n, 125n),
  );
});

test("normalized days-to-cap uses exact rational arithmetic, with no KRW payout forecast", () => {
  const row = base.simulation.comparison_bands[0].tiers.at(-1);
  assert.deepEqual(row.days_to_base_cap_fastest, rational(300n, 11n));
  assert.deepEqual(base.simulation.market_price_inputs, []);
  assert.equal(base.simulation.money_authority, "NONE_OFFLINE_PROPOSAL");
});

test("speed-only ties do not fabricate actual member distribution", () => {
  const c = base.simulation.concentration.after;
  assert.equal(c.observed_member_distribution, "UNKNOWN");
  assert.equal(c.observed_fastest_share, null);
  assert.deepEqual(c.top_pool_modeled_share, rational(1n, 1n));
  assert.deepEqual(c.hypothetical_equal_tie_share_each, rational(1n, 5n));
});

test("each comparison band uses accessible sets per Tier instead of all 25 everywhere", () => {
  for (const b of base.simulation.comparison_bands) {
    assert.equal(b.tiers[0].available_product_count, 4);
    assert.equal(b.tiers[13].available_product_count, 25);
    assert.ok(
      b.tiers[0].fastest_products.every(
        (s) => !["nvidia", "tesla", "spacex"].includes(s),
      ),
    );
    assert.equal(b.policy_version_change_required, true);
  }
});

test("bands above existing 1.10 document require an explicit policy band change", () => {
  assert.deepEqual(
    base.simulation.comparison_bands.map(
      (b) => b.approved_document_band_change_required,
    ),
    [false, true, true],
  );
});

test("high proposed speeds never populate any approved field", () => {
  assert.ok(
    base.economy.products.every(
      (p) => p.approved_product_speed_multiplier === null,
    ),
  );
  assert.equal(
    base.economy.products.reduce(
      (m, p) => Math.max(m, p.proposed_product_speed_bps),
      0,
    ),
    11000,
  );
  assert.equal(decimalBps("1.10"), 11000n);
});

rejection("missing eligibility row", "ELIGIBILITY_COVERAGE_MISSING", (d) =>
  d.eligibility.products.pop(),
);
rejection("duplicate eligibility row", "DUPLICATE_ELIGIBILITY", (d) =>
  d.eligibility.products.push(structuredClone(d.eligibility.products[0])),
);
rejection(
  "unknown Tier in product profile",
  "UNKNOWN_FUNDING_TIER",
  (d) => (d.eligibility.products[0].minimum_funding_tier = "L15"),
);
rejection(
  "missing minimum Funding Tier",
  "UNKNOWN_FUNDING_TIER",
  (d) => delete d.eligibility.products[0].minimum_funding_tier,
);
rejection(
  "raw KRW threshold in eligibility",
  "RAW_PRODUCT_PRINCIPAL_THRESHOLD",
  (d) => (d.eligibility.products[0].minimum_principal_krw = "100000"),
);
rejection(
  "raw KRW threshold in catalog",
  "RAW_PRODUCT_PRINCIPAL_THRESHOLD",
  (d) => (d.launch.products[0].minimum_funding_krw = "100000"),
);
rejection(
  "raw KRW threshold in economy",
  "RAW_PRODUCT_PRINCIPAL_THRESHOLD",
  (d) => (d.economy.products[0].unlock_amount_krw = "100000"),
);
rejection(
  "derived principal replaced by copied threshold",
  "RAW_PRODUCT_PRINCIPAL_THRESHOLD",
  (d) => (d.eligibility.products[0].minimum_eligible_principal = "100000"),
);
rejection(
  "published document Tier threshold edited in proposal",
  "TIER_SSOT_MISMATCH",
  (d) => (d.eligibility.source_policy.tiers[0].minimumPrincipalKrw = "200000"),
);
rejection(
  "unproven live publication timestamp",
  "UNPROVEN_LIVE_POLICY_PUBLICATION",
  (d) => (d.eligibility.source_policy.effective_from = "2026-10-07T00:00:00Z"),
);
rejection(
  "populated approved minimum Tier",
  "UNPROVEN_ELIGIBILITY_POLICY",
  (d) => (d.eligibility.products[0].approved_minimum_funding_tier = "L1"),
);
rejection(
  "higher speed moved to entry Tier without reviewed rationale",
  "HIGH_SPEED_LOW_TIER_WITHOUT_RATIONALE",
  (d) => {
    const id = selected("nvidia"),
      p = d.eligibility.products.find((p) => p.proposal_id === id);
    p.minimum_funding_tier = "L1";
    d.launch.products.find((p) => p.proposal_id === id).minimum_funding_tier =
      "L1";
    d.economy.products.find((p) => p.proposal_id === id).minimum_funding_tier =
      "L1";
  },
);
rejection(
  "missing individual Tier rationale",
  "MISSING_TIER_RATIONALE",
  (d) => (d.eligibility.products[0].why_this_tier_ko = ""),
);
rejection(
  "missing per-product downgrade behavior",
  "MISSING_DOWNGRADE_BEHAVIOR",
  (d) => delete d.eligibility.products[0].downgrade_behavior,
);
rejection(
  "downgrade reset substituted for PAUSE",
  "UNSAFE_TIER_DOWNGRADE",
  (d) => (d.eligibility.downgrade.reset = true),
);
rejection(
  "principal HOLD behavior removed",
  "UNSAFE_TIER_DOWNGRADE",
  (d) => (d.eligibility.downgrade.principal_withdrawal_hold = "RESET"),
);
rejection(
  "automatic substitute product on downgrade",
  "UNSAFE_TIER_DOWNGRADE",
  (d) => (d.eligibility.downgrade.automatic_substitution = true),
);
rejection(
  "source carry history lost on downgrade",
  "UNSAFE_TIER_DOWNGRADE",
  (d) =>
    (d.eligibility.downgrade.preserves =
      d.eligibility.downgrade.preserves.filter(
        (x) => x !== "EXACT_FRACTIONAL_CARRY",
      )),
);
rejection(
  "product available despite effective HOLD",
  "AVAILABLE_DESPITE_EFFECTIVE_HOLD",
  (d) => (d.launch.products[0].selection_available = true),
);
rejection(
  "eligibility available despite effective HOLD",
  "AVAILABLE_DESPITE_EFFECTIVE_HOLD",
  (d) => (d.eligibility.products[0].effective_selection_available = true),
);
rejection(
  "invalid unlock set",
  "INVALID_TIER_UNLOCK_SET",
  (d) => (d.eligibility.products[0].available_in_tiers = ["L1"]),
);
rejection(
  "technical Tier code in member copy",
  "UNSAFE_TIER_MEMBER_COPY",
  (d) =>
    (d.eligibility.products[0].unlock_copy_ko = "L14 단계에서 고를 수 있어요."),
);
rejection(
  "extra funding solicitation in unlock copy",
  "UNSAFE_TIER_MEMBER_COPY",
  (d) =>
    (d.eligibility.products[0].unlock_copy_ko = "입금하면 더 벌 수 있어요."),
);
rejection(
  "Tier gate policy version omitted",
  "NEW_TIER_POLICY_VERSION_REQUIRED",
  (d) => (d.economy.policy_version_change_required = false),
);
rejection(
  "final cap headroom analysis omitted",
  "FINAL_CAP_HEADROOM_ANALYSIS_MISSING",
  (d) => delete d.simulation.comparison_bands[0].fastest_headroom,
);
rejection(
  "fake actual concentration",
  "FABRICATED_ACTUAL_CONCENTRATION",
  (d) => (d.simulation.concentration.after.observed_fastest_share = "20%"),
);
rejection(
  "unresolved identity promoted into P0",
  "P0_IDENTITY_UNRESOLVED",
  (d) =>
    (d.candidates.candidates.find((p) => p.slug === "nvidia").proposed_wave =
      "P0_LAUNCH_CORE"),
);
rejection(
  "canonical ticker differs from actual SEC directory",
  "SEC_DIRECTORY_IDENTITY_MISMATCH",
  (d) =>
    (d.candidates.candidates.find((p) => p.slug === "spacex").canonical_ticker =
      "SPACE_FAKE"),
);
rejection(
  "fabricated official quote does not occur in original bytes",
  "OFFICIAL_QUOTE_NOT_IN_RESPONSE",
  (d) =>
    (d.candidates.candidates[0].verified_facts[0].quote =
      "FICTIONAL CURRENT OFFICIAL FACT"),
);
rejection(
  "legacy UNKNOWN added to current research",
  "LEGACY_UNKNOWN_IN_CURRENT_RESEARCH",
  (d) => (d.candidates.candidates[0].identity_status = "UNKNOWN"),
);
rejection(
  "unapproved speed incorrectly activated",
  "UNAPPROVED_PRODUCT_ECONOMY",
  (d) => (d.economy.products[0].approved_product_speed_multiplier = "1.00"),
);
rejection(
  "non-inherited product capacity",
  "UNAPPROVED_CAPACITY_OVERRIDE",
  (d) => (d.economy.products[0].product_capacity_override = "200"),
);
rejection(
  "market linked economy value",
  "MARKET_LINKED_ECONOMY",
  (d) => (d.economy.products[0].market_linked = true),
);
rejection(
  "legal review omitted",
  "UNPROVEN_LEGAL_OR_PARTNERSHIP",
  (d) => delete d.candidates.candidates[0].legal_brand_review,
);
rejection(
  "final cap raised to 1.60",
  "INVALID_FINAL_CAP",
  (d) => (d.economy.combined_speed_cap_bps = 16000),
);
rejection(
  "above-document speed loses required band change acknowledgement",
  "POLICY_BAND_CHANGE_UNACKNOWLEDGED",
  (d) => {
    d.economy.products[0].proposed_product_speed_multiplier = "1.12";
    d.economy.products[0].proposed_product_speed_bps = 11200;
  },
);

test("fresh simulation reproduces the stored full Tier analysis", () => {
  assert.deepEqual(
    simulate(
      base.economy,
      base.candidates,
      base.currentEvidence.current_policy,
      base.eligibility,
    ),
    base.simulation,
  );
});
