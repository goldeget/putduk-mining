import { tierOrdinal } from "./tier-analysis.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const decode = (s) =>
  s
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, h, d) =>
      String.fromCodePoint(parseInt(h ?? d, h ? 16 : 10)),
    )
    .replace(
      /&(?:amp|quot|apos|nbsp|lt|gt|reg|trade|copy);/g,
      (m) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
          "&lt;": "<",
          "&gt;": ">",
          "&reg;": "®",
          "&trade;": "™",
          "&copy;": "©",
        })[m],
    );
const visible = (s) =>
  decode(
    s
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

export function validateFinalization(data) {
  const errors = [];
  const require = (ok, code, path) => {
    if (!ok) errors.push({ code, path });
  };
  const candidates = data.candidates.candidates;
  const sources = new Map(data.research.sources.map((s) => [s.id, s]));
  const evidence = new Map(data.sources.map((s) => [s.proposal_id, s]));
  const sec = data.sourceResponseTexts.sec
    ? JSON.parse(data.sourceResponseTexts.sec)
    : null;
  const directory = new Map((sec?.data ?? []).map((row) => [row[2], row]));
  const texts = new Map();
  for (const p of candidates) {
    const path = `research.${p.slug}`;
    if (p.proposed_wave === "P0_LAUNCH_CORE")
      require(p.identity_status ===
        "PUBLIC_MARKET_VERIFIED", "P0_IDENTITY_UNRESOLVED", path);
    if (p.identity_status === "PUBLIC_MARKET_PARTIAL")
      require(p.verified_facts.length > 0 &&
        p.unresolved_identity_fields.length >
          0, "UNPROVEN_PARTIAL_IDENTITY", path);
    require(p.identity_status !==
      "UNKNOWN", "LEGACY_UNKNOWN_IN_CURRENT_RESEARCH", path);
    const e = evidence.get(p.proposal_id);
    require(e &&
      e.verification_status === p.identity_status &&
      e.verified_name === p.canonical_name &&
      e.verified_code === p.canonical_ticker &&
      e.verified_exchange === p.canonical_exchange &&
      e.share_class ===
        p.canonical_share_class, "IDENTITY_EVIDENCE_READBACK_MISMATCH", path);
    if (
      p.asset_class === "US_STOCK" &&
      p.verified_facts.some((f) => f.source_id === "sec")
    ) {
      const row = directory.get(p.canonical_ticker);
      require(row &&
        row[1] === p.canonical_name &&
        row[3] ===
          p.canonical_exchange, "SEC_DIRECTORY_IDENTITY_MISMATCH", path);
    }
    for (const f of p.verified_facts) {
      const s = sources.get(f.source_id),
        raw = data.sourceResponseTexts[f.source_id];
      require(s?.verified &&
        raw &&
        data.sourceResponseHashes[f.source_id] ===
          s.response_sha256, "OFFICIAL_RESPONSE_REQUIRED", path);
      let found = false;
      if (raw) {
        if (f.source_id === "sec")
          found =
            directory.has(p.canonical_ticker) &&
            same(directory.get(p.canonical_ticker), JSON.parse(f.quote));
        else {
          if (!texts.has(f.source_id))
            texts.set(
              f.source_id,
              data.sourceResponseVisible[f.source_id] ?? visible(raw),
            );
          found =
            decode(raw)
              .replace(/\s+/g, " ")
              .includes(decode(f.quote).replace(/\s+/g, " ")) ||
            texts.get(f.source_id).includes(f.quote) ||
            texts
              .get(f.source_id)
              .replace(/\s+/g, " ")
              .includes(f.quote.replace(/\s+/g, " "));
        }
      }
      require(found, "OFFICIAL_QUOTE_NOT_IN_RESPONSE", path);
    }
  }
  if (data.economy.schema_version !== 2) return errors;
  const e = data.eligibility;
  if (!e)
    return [
      ...errors,
      { code: "MISSING_TIER_ELIGIBILITY", path: "eligibility" },
    ];
  const source = e.source_policy;
  require(source.sha256 === data.policySourceHash &&
    source.policy_version === data.policySource.policyVersion &&
    same(source.tiers, data.policySource.tiers) &&
    source.base_capacity_rate_bps ===
      data.policySource
        .baseCycleRateBps, "TIER_SSOT_MISMATCH", "eligibility.source_policy");
  require(source.live_publication_status === "UNKNOWN_NO_SERVER_RECEIPT" &&
    source.effective_from ===
      null, "UNPROVEN_LIVE_POLICY_PUBLICATION", "eligibility.source_policy");
  require(e.status === "PROPOSED_NOT_APPROVED" &&
    e.approved === false &&
    e.eligibility_policy_version ===
      null, "UNPROVEN_ELIGIBILITY_APPROVAL", "eligibility");
  const launch = new Map(data.launch.products.map((p) => [p.proposal_id, p]));
  const economy = new Map(data.economy.products.map((p) => [p.proposal_id, p]));
  const seen = new Set(),
    slugs = new Set();
  require(e.products.length ===
    launch.size, "ELIGIBILITY_COVERAGE_MISSING", "eligibility");
  for (const p of e.products) {
    const path = `eligibility.${p.slug}`,
      l = launch.get(p.proposal_id),
      money = economy.get(p.proposal_id);
    require(!seen.has(p.proposal_id) &&
      !slugs.has(p.slug), "DUPLICATE_ELIGIBILITY", path);
    seen.add(p.proposal_id);
    slugs.add(p.slug);
    let min, intended;
    try {
      min = tierOrdinal(p.minimum_funding_tier);
      intended = tierOrdinal(p.intended_minimum_funding_tier);
    } catch {
      require(false, "UNKNOWN_FUNDING_TIER", path);
    }
    require(l &&
      money &&
      l.slug === p.slug &&
      money.slug === p.slug &&
      l.minimum_funding_tier === p.minimum_funding_tier &&
      money.minimum_funding_tier ===
        p.minimum_funding_tier, "PRODUCT_TIER_COVERAGE_MISMATCH", path);
    require(p.minimum_eligible_principal === "DERIVED_FROM_TIER" &&
      l?.minimum_eligible_principal === "DERIVED_FROM_TIER" &&
      money?.minimum_eligible_principal ===
        "DERIVED_FROM_TIER", "RAW_PRODUCT_PRINCIPAL_THRESHOLD", path);
    for (const row of [p, l, money])
      if (row)
        require(!Object.keys(row).some(
          (k) =>
            k !== "minimum_main_step_krw" &&
            /((minimum|unlock|eligible|funding).*krw|principal.*threshold|minimum.*principal.*krw)/i.test(
              k,
            ),
        ), "RAW_PRODUCT_PRINCIPAL_THRESHOLD", path);
    require(p.unlock_policy === "FUNDING_TIER" &&
      p.eligibility_status === "PROPOSED_NOT_APPROVED" &&
      p.approved_minimum_funding_tier === null &&
      p.eligibility_policy_version_required === true &&
      p.approved_eligibility_policy_version === null &&
      p.effective_from === null &&
      p.policy_receipt_required === true, "UNPROVEN_ELIGIBILITY_POLICY", path);
    const rationale = p.lower_tier_exception;
    require((min !== undefined &&
      intended !== undefined &&
      min >= intended &&
      !(money?.proposed_product_speed_bps >= 11000 && min < 11n)) ||
      (rationale?.status === "PROPOSED_NOT_APPROVED" &&
        rationale?.review_required === true &&
        typeof rationale?.reason_ko === "string" &&
        rationale.reason_ko.trim().length >=
          20), "HIGH_SPEED_LOW_TIER_WITHOUT_RATIONALE", path);
    require(typeof p.why_this_tier_ko === "string" &&
      p.why_this_tier_ko.trim().length > 20, "MISSING_TIER_RATIONALE", path);
    require(p.downgrade_behavior ===
      "PAUSE_INELIGIBLE_SELECTION_FORWARD_ONLY", "MISSING_DOWNGRADE_BEHAVIOR", path);
    require(p.effective_selection_available === false &&
      l?.selection_available === false &&
      l?.effective_wave === "HOLD", "AVAILABLE_DESPITE_EFFECTIVE_HOLD", path);
    require(min !== undefined &&
      same(
        p.available_in_tiers,
        Array.from(
          { length: 15 - Number(min) },
          (_, i) => `L${i + Number(min)}`,
        ),
      ), "INVALID_TIER_UNLOCK_SET", path);
    for (const key of ["unlock_copy_ko", "next_unlock_copy_ko"])
      require(typeof p[key] === "string" &&
        !/(?:\bL\d+\b|DERIVED_FROM_TIER|추가로?\s*입금|입금하면|수익\s*보장|더\s*벌)/.test(
          p[key],
        ), "UNSAFE_TIER_MEMBER_COPY", path);
  }
  require([...launch.keys()].every((id) =>
    seen.has(id),
  ), "ELIGIBILITY_COVERAGE_MISSING", "eligibility");
  const d = e.downgrade;
  require(d?.recommended === "B" &&
    d.status === "PROPOSED_NOT_APPROVED" &&
    d.reset === false &&
    d.principal_withdrawal_hold === "PAUSE_NOT_RESET" &&
    d.automatic_substitution === false &&
    d.confirmation_required === true &&
    d.when_capacity_below_used === "STOP_NEW_ACCRUAL_NO_CLAWBACK_NO_RESET" &&
    [
      "VERIFIED_LEDGER",
      "MEMBER_HISTORY",
      "MINING_AGE",
      "CURRENT_CYCLE",
      "USED_GLOBAL_CAPACITY",
      "EXACT_FRACTIONAL_CARRY",
    ].every((x) =>
      d.preserves.includes(x),
    ), "UNSAFE_TIER_DOWNGRADE", "eligibility.downgrade");
  require(data.economy.policy_version_change_required ===
    true, "NEW_TIER_POLICY_VERSION_REQUIRED", "economy");
  const bands = data.simulation.comparison_bands;
  require(bands.length === 3 &&
    bands.every(
      (b) =>
        b.tiers?.length === 14 &&
        b.fastest_headroom?.denominator &&
        b.tiers.every(
          (t) =>
            t.fastest_modifier_headroom?.denominator &&
            t.global_base_capacity_index === "100",
        ),
    ), "FINAL_CAP_HEADROOM_ANALYSIS_MISSING", "simulation");
  require(data.simulation.concentration.after.observed_member_distribution ===
    "UNKNOWN" &&
    data.simulation.concentration.after.observed_fastest_share ===
      null, "FABRICATED_ACTUAL_CONCENTRATION", "simulation");
  require(data.economy.combined_speed_cap_bps === 15000 &&
    data.economy.clamp_stage ===
      "FINAL_COMBINED_ONCE", "INVALID_FINAL_CAP", "economy");
  return errors;
}
