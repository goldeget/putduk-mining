const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const forbidden =
  /minimum_funding_tier|minimum_eligible_principal|intended_minimum_funding_tier|unlock_policy|available_in_tiers/;

export function validateOwnerCorrection(data) {
  const errors = [];
  const require = (ok, code, path) => {
    if (!ok) errors.push({ code, path });
  };
  const {
    power,
    access,
    economy,
    launch,
    policySource: policy,
    archive,
  } = data;
  if (!power || !access || !archive)
    return [{ code: "OWNER_MODEL_MISSING", path: "power/access/archive" }];
  require(access.status === "OWNER_DIRECTION_CONFIRMED_NOT_RUNTIME_ACTIVE" &&
    access.enforced_in_runtime === false &&
    access.effective_published_proposal_count === 0 &&
    access.current_live_catalog ===
      "LIVE_DB_UNKNOWN", "UNPROVEN_ACCESS_ACTIVATION", "access");
  require(access.owner_original_sha256 === data.ownerOriginalHash &&
    access.owner_evidence_sha256 ===
      data.ownerEvidenceHash, "OWNER_EVIDENCE_MISMATCH", "access");
  require(access.product_access_policy === "ALL_ELIGIBLE_MEMBERS" &&
    access.tier_product_access === "ALL_PUBLISHED_PRODUCTS" &&
    economy.product_access_policy === "ALL_ELIGIBLE_MEMBERS" &&
    power.product_access ===
      "ALL_PUBLISHED_PRODUCTS", "PRODUCT_TIER_GATE_REINTRODUCED", "access");
  const expected = new Map(
    economy.products.map((p) => [p.proposal_id, p.slug]),
  );
  for (const [name, rows] of [
    ["economy", economy.products],
    ["launch", launch.products],
    ["access", access.products],
  ]) {
    require(rows.length === expected.size &&
      new Set(rows.map((p) => p.proposal_id)).size === expected.size &&
      new Set(rows.map((p) => p.slug)).size ===
        expected.size, "OPEN_ACCESS_COVERAGE_MISSING", name);
    for (const p of rows) {
      const path = `${name}.${p.slug}`;
      require(expected.get(p.proposal_id) ===
        p.slug, "OPEN_ACCESS_COVERAGE_MISSING", path);
      require(!Object.keys(p).some((k) =>
        forbidden.test(k),
      ), "PRODUCT_TIER_GATE_REINTRODUCED", path);
      require(p.product_access_policy === "ALL_ELIGIBLE_MEMBERS" &&
        p.tier_capacity ===
          "INHERITED", "PRODUCT_TIER_GATE_REINTRODUCED", path);
    }
  }
  for (const p of access.products)
    require(p.product_tier_lock === false &&
      p.tier_downgrade_locks_product === false &&
      p.current_effective_wave === "HOLD" &&
      p.effective_selection_available === false &&
      p.market_linked ===
        false, "UNPROVEN_ACCESS_ACTIVATION", `access.${p.slug}`);
  const source = power.source_policy;
  require(source.sha256 === data.policySourceHash &&
    source.policy_version === policy.policyVersion &&
    same(source.tiers, policy.tiers) &&
    source.base_capacity_rate_bps === policy.baseCycleRateBps &&
    source.cycle_days === policy.cycleDays &&
    source.micro_krw_per_krw === policy.microKrwPerKrw &&
    source.document_approval ===
      policy.approvalState, "TIER_SSOT_MISMATCH", "power.source_policy");
  require(source.live_publication_status === "UNKNOWN_NO_SERVER_RECEIPT" &&
    source.effective_from ===
      null, "UNPROVEN_LIVE_POLICY_PUBLICATION", "power.source_policy");
  require(power.tier_base_speed_status === "TIER_SPEED_CONTRACT_REQUIRED" &&
    power.tier_base_speed_multiplier === null &&
    power.approved_distinct_tier_speed_rule === null &&
    economy.tier_base_speed_status ===
      "TIER_SPEED_CONTRACT_REQUIRED", "INVENTED_TIER_SPEED", "power");
  require(power.tiers.length === 14, "TIER_SSOT_MISMATCH", "power.tiers");
  for (const [i, t] of power.tiers.entries()) {
    const actual = policy.tiers[i];
    require(actual &&
      t.tier === actual.code &&
      t.name === actual.name &&
      t.minimum_eligible_principal_krw === actual.minimumPrincipalKrw &&
      t.maximum_eligible_principal_krw === actual.maximumPrincipalKrw &&
      t.slots === actual.slots &&
      t.retention_bonus_bps ===
        actual.retentionBonusBps, "TIER_SSOT_MISMATCH", `power.${t.tier}`);
    require(t.base_speed_multiplier === null &&
      t.base_speed_status ===
        "TIER_SPEED_CONTRACT_REQUIRED", "INVENTED_TIER_SPEED", `power.${t.tier}`);
    require(t.product_access === "ALL_PUBLISHED_PRODUCTS" &&
      t.capacity ===
        "INHERITED_GLOBAL_PRINCIPAL_PROPORTIONAL", "PRODUCT_TIER_GATE_REINTRODUCED", `power.${t.tier}`);
  }
  require(power.global_capacity.scope === "GLOBAL_CYCLE" &&
    power.global_capacity.product_multiplier_changes_capacity === false &&
    power.global_capacity.slots_multiply_capacity === false &&
    power.global_capacity.allocation_maximum_total_bps ===
      policy.allocation.maximumTotalBps &&
    power.retention.included_in_base_capacity === false &&
    power.retention.included_in_settlement_ready === false &&
    power.retention.product_modifier_scope ===
      "PRIMARY_CONTRACT_REQUIRED", "UNAPPROVED_CAPACITY_OVERRIDE", "power");
  const d = power.downgrade;
  require(power.global_capacity.formula ===
    "EligiblePrincipal * microKrwPerKrw * baseCycleRateBps / 10000" &&
    power.retention.formula ===
      "EligiblePrincipal * microKrwPerKrw * tier.retentionBonusBps / 10000" &&
    power.global_capacity.principal_source ===
      "REMAINING_ELIGIBLE_PRINCIPAL_EXCLUDING_REWARD_BONUS_TRIAL_AND_ACTIVE_PRINCIPAL_HOLD", "POWER_FORMULA_UNSOURCED", "power");
  require(d.action ===
    "KEEP_PRODUCT_SELECTION_REEVALUATE_FUTURE_TIER_ECONOMICS" &&
    d.locks_product === false &&
    d.pause_for_product_access === false &&
    d.reset === false &&
    d.automatic_substitution === false &&
    d.principal_withdrawal_hold === "PAUSE_NOT_RESET" &&
    d.slot_reduction_policy === "PRIMARY_CONTRACT_REQUIRED" &&
    d.slot_resolution === null &&
    d.catch_up === false &&
    d.when_capacity_below_used === "STOP_NEW_ACCRUAL_NO_CLAWBACK_NO_RESET" &&
    [
      "VERIFIED_LEDGER",
      "MEMBER_HISTORY",
      "MINING_AGE",
      "CURRENT_CYCLE",
      "USED_GLOBAL_CAPACITY",
      "EXACT_FRACTIONAL_CARRY",
    ].every((p) =>
      d.preserves.includes(p),
    ), "UNSAFE_OPEN_ACCESS_DOWNGRADE", "power.downgrade");
  require(data.eligibility.status === "SUPERSEDED_BY_OWNER_CORRECTION" &&
    data.eligibility.active === false &&
    data.eligibility.use_in_final_proposal ===
      false, "SUPERSEDED_GATE_STILL_ACTIVE", "eligibility");
  require(archive.status === "SUPERSEDED_BY_OWNER_CORRECTION" &&
    archive.source_head === "783732492e70c312b33640e07ee0d8ffad68c3e5" &&
    archive.active === false &&
    archive.files.length === 28 &&
    archive.files.every(
      (f) => data.archiveHashes[f.archive_path] === f.sha256,
    ), "HISTORICAL_EVIDENCE_CHANGED", "archive");
  require(power.source_evidence.length === 4 &&
    power.source_evidence.every(
      (f) => data.powerSourceHashes[f.path] === f.sha256,
    ), "POWER_SOURCE_EVIDENCE_MISMATCH", "power.source_evidence");
  require(economy.combined_speed_cap_bps === 15000 &&
    economy.clamp_stage === "FINAL_COMBINED_ONCE" &&
    power.final_cap_scope ===
      "RELATIVE_COMBINED_PRODUCT_USER_EVENT_TEMPORARY_MODIFIERS_NOT_ABSOLUTE_KRW_RATE_OR_TIER_CAPACITY", "INVALID_FINAL_CAP", "economy");
  for (const rows of Object.values(data.delta))
    for (const p of rows) {
      if (!p.slug.startsWith("catalog-tier-")) continue;
      require(p.metadata.owner_access_policy === "ALL_ELIGIBLE_MEMBERS" &&
        p.metadata.historical_draft_status ===
          "SUPERSEDED_BY_OWNER_CORRECTION" &&
        !p.metadata
          .requires_authoritative_eligibility_event, "STALE_TIER_GATE_CONTENT", p.slug);
    }
  require(data.simulation.schema_version === 3 &&
    data.simulation.tiers.length === 14 &&
    data.simulation.tiers.every(
      (t) =>
        t.product_access === "ALL_PUBLISHED_PRODUCTS" &&
        t.tier_base_speed_multiplier === null &&
        t.actual_effective_daily_reward === null &&
        t.current_effective_proposal_choice_count === 0 &&
        t.per_product_reference.length === 25,
    ), "FABRICATED_SIMULATION_DATA", "simulation");
  require(data.simulation.concentration.tier_gated_model_status ===
    "SUPERSEDED_BY_OWNER_CORRECTION" &&
    data.simulation.concentration.observed_member_distribution === "UNKNOWN" &&
    data.simulation.concentration.observed_fastest_share ===
      null, "FABRICATED_ACTUAL_CONCENTRATION", "simulation");
  return errors;
}
