import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadPackage, validatePackage } from "./validate.mjs";
import {
  publishedChoices,
  openSelectionPreview,
  openDowngradePreview,
  neutralReference,
} from "./mining-power-analysis.mjs";
import {
  combineSpeed,
  allocationRate,
  rational,
  UNIT,
} from "./economy-simulate.mjs";
import { tierForPrincipal } from "./tier-analysis.mjs";

const base = loadPackage();
const ids = base.access.products.map((p) => p.proposal_id);
const id = (slug) =>
  base.access.products.find((p) => p.slug === slug).proposal_id;
const controls = {
  eligible: true,
  safeMode: false,
  principalHold: false,
  paused: false,
};
const preview = (principal, selectedIds = [id("nvidia")], extra = {}) =>
  openSelectionPreview({
    power: base.power,
    access: base.access,
    principal,
    selectedIds,
    controls,
    publishedAvailableIds: ids,
    ...extra,
  });
const ratioNumber = (r) => Number(r.numerator) / Number(r.denominator);

test("current Owner proposal validates without product Tier thresholds", () => {
  assert.deepEqual(validatePackage(base).errors, []);
  assert.equal(base.economy.schema_version, 3);
  assert.equal(base.economy.products.length, 25);
});

for (const t of base.power.tiers) {
  test(`${t.tier} can preview NVIDIA, Tesla, SK hynix, SpaceX, BTC and ETF if actually published`, () => {
    for (const slug of [
      "nvidia",
      "tesla",
      "sk-hynix",
      "spacex",
      "bitcoin",
      "spy",
    ]) {
      const result = preview(BigInt(t.minimum_eligible_principal_krw), [
        id(slug),
      ]);
      assert.equal(result.status, "PROPOSAL_REQUIRES_SERVER_AUTHORIZATION");
      assert.equal(result.product_tier_lock, false);
      assert.deepEqual(result.unavailable_products, []);
    }
    assert.equal(
      publishedChoices(base.access, {
        eligibleMember: true,
        publishedAvailableIds: ids,
      }).length,
      25,
    );
  });
  test(`${t.tier} derives exact principal-proportional base capacity without inventing Tier speed`, () => {
    const row = base.simulation.tiers.find((r) => r.tier === t.tier);
    const reference = neutralReference(
      BigInt(t.minimum_eligible_principal_krw),
      base.policySource,
    );
    assert.deepEqual(
      row.base_capacity_micro_krw,
      reference.base_capacity_micro_krw,
    );
    assert.deepEqual(
      reference.base_capacity_micro_krw,
      rational(
        BigInt(t.minimum_eligible_principal_krw) * 1000000n * 1500n,
        10000n,
      ),
    );
    assert.equal(row.tier_base_speed_multiplier, null);
    assert.equal(row.tier_base_speed_status, "TIER_SPEED_CONTRACT_REQUIRED");
    assert.equal(row.actual_effective_daily_reward, null);
    assert.equal(row.current_effective_proposal_choice_count, 0);
  });
  test(`${t.tier} product modifiers and concurrent slots never multiply global capacity`, () => {
    const row = base.simulation.tiers.find((r) => r.tier === t.tier);
    for (const p of row.per_product_reference)
      assert.deepEqual(
        p.global_capacity_micro_krw,
        row.base_capacity_micro_krw,
      );
    for (const slot of row.slot_examples) {
      assert.equal(slot.slots_used <= t.slots, true);
      assert.deepEqual(
        slot.global_capacity_micro_krw,
        row.base_capacity_micro_krw,
      );
      assert.equal(slot.capacity_multiplied_by_slots, false);
      assert.equal(
        slot.allocation_bps.reduce((a, b) => a + BigInt(b), 0n),
        10000n,
      );
      assert.ok(
        ratioNumber(slot.weighted_modifier) >= 1 &&
          ratioNumber(slot.weighted_modifier) <= 1.1,
      );
    }
  });
}

test("all actually unpublished draft products remain unavailable even at L14", () => {
  const result = preview(5000000000n, [id("spacex")], {
    publishedAvailableIds: [],
  });
  assert.equal(result.status, "PRODUCT_NOT_PUBLISHED_AVAILABLE");
  assert.equal(result.product_tier_lock, false);
});
test("publication or account eligibility cannot be inferred from proposed access metadata", () => {
  assert.throws(
    () => publishedChoices(base.access, { eligibleMember: true }),
    /AUTHORITATIVE_ACCESS_INPUT/,
  );
  assert.throws(
    () => publishedChoices(base.access, { publishedAvailableIds: ids }),
    /AUTHORITATIVE_ACCESS_INPUT/,
  );
  assert.throws(
    () =>
      publishedChoices(base.access, {
        eligibleMember: true,
        publishedAvailableIds: ["UNKNOWN_ID"],
      }),
    /AUTHORITATIVE_ACCESS_INPUT/,
  );
  assert.deepEqual(
    publishedChoices(base.access, {
      eligibleMember: false,
      publishedAvailableIds: ids,
    }),
    [],
  );
});
test("below funding minimum does not create a specific product access lock", () => {
  const result = preview(99999n);
  assert.equal(result.status, "BELOW_FUNDED_MINING_MINIMUM_PRODUCT_NOT_LOCKED");
  assert.deepEqual(result.unavailable_products, []);
});
test("Tier downgrade keeps selected NVIDIA and all historical state", () => {
  const state = {
    history: ["HISTORY"],
    eligibleAge: "999",
    cycle: "CYCLE",
    carry: "2/3",
    used: "50000000",
    verifiedLedger: ["LEDGER"],
  };
  const result = openDowngradePreview({
    power: base.power,
    access: base.access,
    principal: 100000n,
    selectedIds: [id("nvidia")],
    controls,
    publishedAvailableIds: ids,
    state,
  });
  assert.equal(result.status, "PROPOSAL_REQUIRES_SERVER_AUTHORIZATION");
  assert.deepEqual(result.selected_ids, [id("nvidia")]);
  assert.deepEqual(result.preserved_state, state);
  assert.notEqual(result.preserved_state, state);
  assert.equal(result.catch_up, false);
  assert.equal(result.reset, false);
});
test("slot reduction needs Primary policy and never selects or stops allocations automatically", () => {
  const result = preview(100000n, [id("nvidia"), id("spacex")]);
  assert.equal(result.status, "PRIMARY_CONTRACT_REQUIRED");
  assert.equal(result.slot_resolution, null);
  assert.deepEqual(result.selected_ids, [id("nvidia"), id("spacex")]);
  assert.deepEqual(result.unavailable_products, []);
  assert.equal(result.automatic_substitution, false);
});
test("principal withdrawal HOLD retains PAUSE_NOT_RESET independently of product access", () => {
  const result = preview(100000n, [id("nvidia")], {
    controls: { ...controls, principalHold: true },
  });
  assert.equal(result.status, "PAUSED_PRINCIPAL_HOLD");
  assert.equal(result.reset, false);
  assert.deepEqual(result.unavailable_products, []);
  assert.equal(
    base.power.downgrade.principal_withdrawal_hold,
    "PAUSE_NOT_RESET",
  );
});
test("safe mode and account ineligibility remain independent authoritative guards", () => {
  assert.equal(
    preview(100000n, undefined, {
      controls: { ...controls, safeMode: true, principalHold: true },
    }).status,
    "SAFE_MODE",
  );
  assert.equal(
    preview(100000n, undefined, { controls: { ...controls, eligible: false } })
      .status,
    "INELIGIBLE_MEMBER",
  );
});
test("unknown and duplicate selections fail rather than silently substituting", () => {
  assert.throws(() => preview(100000n, ["UNKNOWN"]), /INVALID_SELECTION/);
  assert.throws(
    () => preview(100000n, [id("nvidia"), id("nvidia")]),
    /INVALID_SELECTION/,
  );
});
test("same product scales across 14 tiers with actual principal and no product unlock progression", () => {
  for (const group of base.simulation.same_product_across_tiers) {
    assert.equal(group.rows.length, 14);
    for (let i = 1; i < group.rows.length; i++) {
      const earlier = group.rows[i - 1],
        later = group.rows[i];
      assert.ok(
        ratioNumber(later.global_capacity_micro_krw) >
          ratioNumber(earlier.global_capacity_micro_krw),
      );
      assert.ok(
        ratioNumber(later.conditional_daily_base_micro_krw) >
          ratioNumber(earlier.conditional_daily_base_micro_krw),
      );
    }
  }
});
test("L2 minimum Gold has five times L1 minimum NVIDIA capacity regardless of product modifier", () => {
  const comparison =
    base.simulation.tier_vs_product.tier_minimum_L2_gold_vs_L1_nvidia;
  assert.deepEqual(comparison.base_capacity_ratio, {
    numerator: "5",
    denominator: "1",
  });
  assert.deepEqual(comparison.daily_rate_ratio, {
    numerator: "50",
    denominator: "11",
  });
});
test("near a Tier boundary the missing distinct Tier speed rule remains a blocker", () => {
  const comparison =
    base.simulation.tier_vs_product.adjacent_boundary_L1_nvidia_vs_L2_gold;
  assert.ok(
    ratioNumber(
      comparison.lower_tier_rate_over_higher_tier_rate_neutral_reference,
    ) > 1,
  );
  assert.equal(
    comparison.finding,
    "DISTINCT_TIER_BASE_SPEED_DOMINANCE_NOT_PROVEN_NEAR_BOUNDARY",
  );
  assert.equal(
    base.simulation.principal_growth_question
      .tier_base_economics_dominate_product_near_every_boundary,
    "UNVERIFIED_PRIMARY_CONTRACT_REQUIRED",
  );
});
test("within one Tier, Gold vs NVIDIA changes reference time, not entitlement ceiling", () => {
  const row = base.simulation.tiers[0];
  const gold = row.per_product_reference.find((p) => p.slug === "gold"),
    nvidia = row.per_product_reference.find((p) => p.slug === "nvidia");
  assert.deepEqual(
    gold.global_capacity_micro_krw,
    nvidia.global_capacity_micro_krw,
  );
  assert.deepEqual(gold.conditional_days_to_base_cap, {
    numerator: "30",
    denominator: "1",
  });
  assert.deepEqual(nvidia.conditional_days_to_base_cap, {
    numerator: "300",
    denominator: "11",
  });
});
test("two half allocations combine to 1.05 rather than 2.10 or doubled capacity", () => {
  assert.deepEqual(
    allocationRate([
      { speedBps: 10000n, allocationBps: 5000n },
      { speedBps: 11000n, allocationBps: 5000n },
    ]),
    { numerator: "21", denominator: "20" },
  );
});
test("more principal within same Tier increases exact capacity continuously", () => {
  const a = neutralReference(100000n, base.policySource),
    b = neutralReference(100001n, base.policySource);
  assert.deepEqual(
    b.base_capacity_micro_krw,
    rational(100001n * 1000000n * 1500n, 10000n),
  );
  assert.equal(
    tierForPrincipal(100001n, base.power.source_policy.tiers).code,
    "L1",
  );
  assert.ok(
    ratioNumber(b.base_capacity_micro_krw) >
      ratioNumber(a.base_capacity_micro_krw),
  );
});
test("very large principal is never narrowed to floating point in current power analysis", () => {
  const value = 9007199254740993123456789n;
  const reference = neutralReference(value, base.policySource);
  assert.deepEqual(
    reference.base_capacity_micro_krw,
    rational(value * 1000000n * 1500n, 10000n),
  );
  assert.equal(preview(value).tier, "L14");
});
test("conditional retention is separate and never promoted to settlement-ready base", () => {
  assert.equal(base.power.retention.included_in_base_capacity, false);
  assert.equal(base.power.retention.included_in_settlement_ready, false);
  assert.equal(
    base.power.retention.product_modifier_scope,
    "PRIMARY_CONTRACT_REQUIRED",
  );
});
test("1.20 times 1.15 times 1.10 is clamped once to 1.50 after exact multiplication", () => {
  const result = combineSpeed([12000n, 11500n, 11000n, UNIT]);
  assert.deepEqual(result.raw, { numerator: "759", denominator: "500" });
  assert.deepEqual(result.final, { numerator: "3", denominator: "2" });
  assert.equal(result.clamp_stage, "FINAL_COMBINED_ONCE");
});
test("a final lower modifier can bring the exact product below cap; intermediate clamp is wrong", () => {
  const result = combineSpeed([11000n, 12000n, 12500n, 8000n]);
  assert.deepEqual(result.final, { numerator: "33", denominator: "25" });
  assert.equal(result.capped, false);
  assert.notEqual(result.final_display, "1.200000");
});
test("all 28 archived files are byte-identical to the preserved exact Git HEAD", () => {
  for (const f of base.archive.files) {
    const original = execFileSync("git", [
      "show",
      `${base.archive.source_head}:${f.source_path}`,
    ]);
    assert.deepEqual(readFileSync(f.archive_path), original, f.source_path);
  }
});
test("all 18 affected content drafts retain stable IDs but no Tier unlock publication meaning", () => {
  const rows = Object.values(base.delta)
    .flat()
    .filter((p) => p.slug.startsWith("catalog-tier-"));
  assert.equal(rows.length, 18);
  assert.ok(
    rows.every(
      (p) =>
        p.metadata.owner_access_policy === "ALL_ELIGIBLE_MEMBERS" &&
        p.metadata.historical_draft_status === "SUPERSEDED_BY_OWNER_CORRECTION",
    ),
  );
});

const mutations = [
  [
    "reintroduced product minimum Tier",
    "PRODUCT_TIER_GATE_REINTRODUCED",
    (d) => (d.economy.products[0].minimum_funding_tier = "L1"),
  ],
  [
    "reintroduced principal access threshold",
    "PRODUCT_TIER_GATE_REINTRODUCED",
    (d) => (d.launch.products[0].minimum_eligible_principal = "100000"),
  ],
  [
    "Tier access policy changed",
    "PRODUCT_TIER_GATE_REINTRODUCED",
    (d) => (d.access.product_access_policy = "FUNDING_TIER"),
  ],
  [
    "Tier-specific published subset",
    "PRODUCT_TIER_GATE_REINTRODUCED",
    (d) => (d.power.tiers[0].product_access = "ONLY_L1_PRODUCTS"),
  ],
  [
    "invented Tier speed",
    "INVENTED_TIER_SPEED",
    (d) => (d.power.tiers[13].base_speed_multiplier = "2.00"),
  ],
  [
    "invented top-level Tier speed",
    "INVENTED_TIER_SPEED",
    (d) => (d.power.tier_base_speed_multiplier = "1.00"),
  ],
  [
    "forged speed contract approval",
    "INVENTED_TIER_SPEED",
    (d) => (d.power.approved_distinct_tier_speed_rule = "OWNER_APPROVED"),
  ],
  [
    "changed Tier principal bound",
    "TIER_SSOT_MISMATCH",
    (d) => (d.power.tiers[0].minimum_eligible_principal_krw = "99999"),
  ],
  [
    "changed Tier slots",
    "TIER_SSOT_MISMATCH",
    (d) => (d.power.tiers[0].slots = 5),
  ],
  [
    "changed retention",
    "TIER_SSOT_MISMATCH",
    (d) => (d.power.tiers[0].retention_bonus_bps = 3000),
  ],
  [
    "forged source policy hash",
    "TIER_SSOT_MISMATCH",
    (d) => (d.power.source_policy.sha256 = "0".repeat(64)),
  ],
  [
    "forged live publication",
    "UNPROVEN_LIVE_POLICY_PUBLICATION",
    (d) => (d.power.source_policy.live_publication_status = "PUBLISHED"),
  ],
  [
    "unverified effective date",
    "UNPROVEN_LIVE_POLICY_PUBLICATION",
    (d) => (d.power.source_policy.effective_from = "2026-10-07T00:00:00Z"),
  ],
  [
    "slot capacity multiplication",
    "UNAPPROVED_CAPACITY_OVERRIDE",
    (d) => (d.power.global_capacity.slots_multiply_capacity = true),
  ],
  [
    "unsourced capacity formula",
    "POWER_FORMULA_UNSOURCED",
    (d) => (d.power.global_capacity.formula = "Principal * slots"),
  ],
  [
    "unsourced retention formula",
    "POWER_FORMULA_UNSOURCED",
    (d) => (d.power.retention.formula = "Capacity * speed"),
  ],
  [
    "lifetime deposit as eligible principal",
    "POWER_FORMULA_UNSOURCED",
    (d) =>
      (d.power.global_capacity.principal_source =
        "LIFETIME_DEPOSIT_PLUS_REWARD"),
  ],
  [
    "product capacity multiplication",
    "UNAPPROVED_CAPACITY_OVERRIDE",
    (d) => (d.power.global_capacity.product_multiplier_changes_capacity = true),
  ],
  [
    "retention counted as settlement-ready",
    "UNAPPROVED_CAPACITY_OVERRIDE",
    (d) => (d.power.retention.included_in_settlement_ready = true),
  ],
  [
    "downgrade locks selected product",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.locks_product = true),
  ],
  [
    "product access PAUSE",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.pause_for_product_access = true),
  ],
  [
    "downgrade clears history",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.preserves = []),
  ],
  [
    "automatic slot winner invented",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.slot_resolution = "KEEP_HIGHEST_SPEED"),
  ],
  [
    "principal HOLD reset",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.principal_withdrawal_hold = "RESET"),
  ],
  [
    "catch-up invented",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.catch_up = true),
  ],
  [
    "automatic product substitution",
    "UNSAFE_OPEN_ACCESS_DOWNGRADE",
    (d) => (d.power.downgrade.automatic_substitution = true),
  ],
  [
    "superseded gate used again",
    "SUPERSEDED_GATE_STILL_ACTIVE",
    (d) => (d.eligibility.active = true),
  ],
  [
    "historical file hash altered",
    "HISTORICAL_EVIDENCE_CHANGED",
    (d) => (d.archiveHashes[d.archive.files[0].archive_path] = "0".repeat(64)),
  ],
  [
    "archive manifest points at wrong HEAD",
    "HISTORICAL_EVIDENCE_CHANGED",
    (d) => (d.archive.source_head = "8f68be2005e16f1ac257626b3418cd3b8a96f1e3"),
  ],
  [
    "source engine hash altered",
    "POWER_SOURCE_EVIDENCE_MISMATCH",
    (d) => (d.power.source_evidence[0].sha256 = "0".repeat(64)),
  ],
  [
    "Owner correction hash altered",
    "OWNER_EVIDENCE_MISMATCH",
    (d) => (d.access.owner_evidence_sha256 = "0".repeat(64)),
  ],
  [
    "draft product marked actually public",
    "UNPROVEN_ACCESS_ACTIVATION",
    (d) => (d.access.products[0].effective_selection_available = true),
  ],
  [
    "offline access marked runtime activated",
    "UNPROVEN_ACCESS_ACTIVATION",
    (d) => (d.access.enforced_in_runtime = true),
  ],
  [
    "open access coverage missing",
    "OPEN_ACCESS_COVERAGE_MISSING",
    (d) => d.access.products.pop(),
  ],
  [
    "duplicate open access product",
    "OPEN_ACCESS_COVERAGE_MISSING",
    (d) => (d.access.products[1] = structuredClone(d.access.products[0])),
  ],
  [
    "final cap changed",
    "INVALID_FINAL_CAP",
    (d) => (d.economy.combined_speed_cap_bps = 16000),
  ],
  [
    "absolute Tier rate capped instead",
    "INVALID_FINAL_CAP",
    (d) => (d.power.final_cap_scope = "ABSOLUTE_TIER_RATE"),
  ],
  [
    "false actual concentration",
    "FABRICATED_ACTUAL_CONCENTRATION",
    (d) => (d.simulation.concentration.observed_fastest_share = "0.20"),
  ],
  [
    "false actual reward",
    "FABRICATED_SIMULATION_DATA",
    (d) => (d.simulation.tiers[0].actual_effective_daily_reward = "500"),
  ],
  [
    "stale Tier unlock content metadata",
    "STALE_TIER_GATE_CONTENT",
    (d) =>
      (d.delta["faq-additions"].at(
        -1,
      ).metadata.requires_authoritative_eligibility_event = true),
  ],
  [
    "simulation daily rate tampering",
    "SIMULATION_READBACK_MISMATCH",
    (d) =>
      (d.simulation.tiers[0].per_product_reference[0].conditional_daily_base_micro_krw.numerator =
        "1"),
  ],
];
for (const [name, code, change] of mutations)
  test(`reject ${name}`, () => {
    const data = structuredClone(base);
    change(data);
    const result = validatePackage(data);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.code === code),
      JSON.stringify(result.errors),
    );
  });
test("all previous evidence files remain byte-identical to the historical HEAD", () => {
  const files = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      base.archive.source_head,
      "--",
      "catalog-ops/evidence",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const path of files) {
    const original = execFileSync("git", [
      "show",
      `${base.archive.source_head}:${path}`,
    ]);
    assert.deepEqual(readFileSync(path), original, path);
  }
});
test("old mutating generators fail before overwriting the current Owner proposal", () => {
  const before = readFileSync("catalog-ops/product-economy-proposal.json");
  for (const name of [
    "finalize-catalog.py",
    "report-finalize.py",
    "tier-content-delta.py",
    "build-catalog.py",
    "build-content.py",
    "build-registration.py",
  ]) {
    assert.throws(
      () =>
        execFileSync("python", [`catalog-ops/${name}`], {
          stdio: ["ignore", "pipe", "pipe"],
        }),
      (error) =>
        error.status !== 0 &&
        String(error.stderr).includes("SUPERSEDED_BY_OWNER_CORRECTION"),
    );
  }
  assert.deepEqual(
    readFileSync("catalog-ops/product-economy-proposal.json"),
    before,
  );
});
