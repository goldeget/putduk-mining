import test from "node:test";
import assert from "node:assert/strict";
import { loadPackage, validatePackage, validDate } from "./validate.mjs";
import {
  decimalBps,
  combineSpeed,
  accrue,
  allocationRate,
  rational,
  displayFraction,
  normalizedProduct,
} from "./economy-simulate.mjs";

// Preserve all 108 historical cases against their exact input contract.
// Current researched/Tier-gated inputs have independent tests in finalize.test.
const base = loadPackage({ ref: "8f68be2005e16f1ac257626b3418cd3b8a96f1e3" });
const now = Date.parse("2026-10-07T23:59:59Z");
const fresh = () => structuredClone(base);

function rejection(name, code, change) {
  test(name, () => {
    const data = fresh();
    change(data);
    const result = validatePackage(data, { now });
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.code === code),
      JSON.stringify(result.errors),
    );
  });
}

test("a complete gated draft passes while research and registration remain blocked", () => {
  const result = validatePackage(base, { now });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(base.research.completed, false);
  assert.equal(base.launch.effective_launch_count, 0);
  assert.equal(base.catalogPlan.production_ready, false);
});

test("planned P0 can be researched later but UNKNOWN never becomes effective launch", () => {
  const data = fresh();
  assert.equal(data.candidates.candidates[0].proposed_wave, "P0_LAUNCH_CORE");
  assert.equal(data.candidates.candidates[0].effective_wave, "HOLD");
  assert.equal(validatePackage(data, { now }).ok, true);
});

test("verified source bookkeeping requires a real response and fresh factual evidence", () => {
  // In-memory test evidence; never saved or used as market research.
  const data = fresh();
  const s = data.research.sources[0];
  s.observation = "RESPONSE_REVIEWED";
  s.http_status = 200;
  s.accessed_at = "2026-10-07T10:00:00Z";
  s.verified = true;
  s.response_sha256 = "a".repeat(64);
  s.verified_facts = ["SYNTHETIC TEST FACT NOT PUBLIC RESEARCH"];
  data.sourceResponseHashes[s.id] = s.response_sha256;
  assert.equal(validatePackage(data, { now }).ok, true);
});

rejection("duplicate proposal identity", "DUPLICATE_PROPOSAL_ID", (d) => {
  d.candidates.candidates[1].proposal_id =
    d.candidates.candidates[0].proposal_id;
});
rejection("duplicate product slug", "DUPLICATE_PRODUCT_SLUG", (d) => {
  d.candidates.candidates[1].slug = d.candidates.candidates[0].slug;
});
rejection("duplicate market and ticker", "DUPLICATE_MARKET_TICKER", (d) => {
  d.candidates.candidates[1].ticker_hint =
    d.candidates.candidates[0].ticker_hint;
});
rejection("uncontracted asset class", "INVALID_ASSET_CLASS", (d) => {
  d.candidates.candidates[0].asset_class = "FUTURES";
});
rejection("empty product identity hint", "EMPTY_PRODUCT_NAME", (d) => {
  d.candidates.candidates[0].name_hint_ko = " ";
});
rejection("invalid planned launch wave", "INVALID_LAUNCH_WAVE", (d) => {
  d.candidates.candidates[0].proposed_wave = "NOW";
});
rejection("market linked product", "MARKET_LINKED_PRODUCT", (d) => {
  d.candidates.candidates[0].market_linked = true;
});
rejection("fake operator approval", "FAKE_PRODUCT_APPROVAL", (d) => {
  d.candidates.candidates[0].operator_approval = "AI_APPROVED";
});
rejection(
  "unreviewed brand clearance",
  "UNPROVEN_LEGAL_OR_PARTNERSHIP",
  (d) => {
    d.candidates.candidates[0].legal_brand_review = "APPROVED";
  },
);
rejection(
  "invented partnership claim",
  "UNPROVEN_LEGAL_OR_PARTNERSHIP",
  (d) => {
    d.candidates.candidates[0].partnership_claim_allowed = true;
  },
);
rejection("unproven live catalog", "UNPROVEN_LIVE_DATABASE", (d) => {
  d.candidates.candidates[0].live_status = "LIVE_PUBLISHED";
});
rejection("fabricated new database UUID", "FABRICATED_DATABASE_ID", (d) => {
  d.candidates.candidates[2].repository_draft_id =
    "30000000-0000-4000-8000-000000000099";
});
rejection("candidate without a source", "MISSING_SOURCE_REFERENCE", (d) => {
  d.candidates.candidates[0].source_ids = [];
});
rejection(
  "verified identity without factual evidence",
  "UNPROVEN_PUBLIC_IDENTITY",
  (d) => {
    d.candidates.candidates[0].identity_status = "PUBLIC_MARKET_VERIFIED";
  },
);
rejection(
  "UNKNOWN P0 effective candidate",
  "UNKNOWN_EFFECTIVE_LAUNCH_PRODUCT",
  (d) => {
    d.candidates.candidates[0].effective_wave = "P0_LAUNCH_CORE";
  },
);
rejection(
  "UNKNOWN P1 effective candidate",
  "UNKNOWN_EFFECTIVE_LAUNCH_PRODUCT",
  (d) => {
    d.candidates.candidates[0].effective_wave = "P1_LAUNCH_EXPANSION";
  },
);
rejection(
  "SpaceX hint promoted to canonical ticker without checking",
  "UNKNOWN_CANONICAL_IDENTITY",
  (d) => {
    d.candidates.candidates.find((p) => p.slug === "spacex").canonical_ticker =
      "SPCX";
  },
);
rejection(
  "unmeasured scoring sold as measurement",
  "INVALID_EDITORIAL_SCORES",
  (d) => {
    d.candidates.candidates[0].score_status = "MEASURED";
  },
);
rejection("ETF category contract omitted", "MISSING_ETF_CONTRACT_GATE", (d) => {
  d.candidates.candidates.find((p) => p.slug === "spy").blocking_requirements =
    [];
});
rejection("official source URL with credentials", "INVALID_SOURCE_URL", (d) => {
  d.research.sources[0].requested_url = "https://user:password@www.sec.gov/a";
});
rejection(
  "blocked source falsely verified",
  "BLOCKED_SOURCE_CLAIMED_VERIFIED",
  (d) => {
    d.research.sources[0].verified = true;
  },
);
rejection(
  "stale fetched source cannot verify current listing",
  "UNPROVEN_OR_STALE_SOURCE",
  (d) => {
    const s = d.research.sources[0];
    Object.assign(s, {
      observation: "RESPONSE_REVIEWED",
      verified: true,
      http_status: 200,
      response_sha256: "a".repeat(64),
      accessed_at: "2026-08-01T10:00:00Z",
      verified_facts: ["test"],
    });
  },
);
rejection(
  "future accessed date cannot verify source",
  "UNPROVEN_OR_STALE_SOURCE",
  (d) => {
    const s = d.research.sources[0];
    Object.assign(s, {
      observation: "RESPONSE_REVIEWED",
      verified: true,
      http_status: 200,
      response_sha256: "a".repeat(64),
      accessed_at: "2026-10-09T10:00:00Z",
      verified_facts: ["test"],
    });
  },
);
rejection(
  "research completed without a verified response",
  "FALSE_RESEARCH_COMPLETION",
  (d) => {
    d.research.completed = true;
  },
);
rejection(
  "response hash invented without an obtained file",
  "UNPROVEN_OR_STALE_SOURCE",
  (d) => {
    const s = d.research.sources[0];
    Object.assign(s, {
      observation: "RESPONSE_REVIEWED",
      verified: true,
      http_status: 200,
      response_sha256: "b".repeat(64),
      accessed_at: "2026-10-07T10:00:00Z",
      verified_facts: ["test"],
    });
  },
);
rejection("launch missing a product entry", "INVALID_LAUNCH_COUNT", (d) => {
  d.launch.products.pop();
});
rejection("duplicate display order", "DUPLICATE_DISPLAY_ORDER", (d) => {
  d.launch.products[1].display_order = d.launch.products[0].display_order;
});
rejection("unproven launch approval", "UNPROVEN_LAUNCH_APPROVAL", (d) => {
  d.launch.approved = true;
});
rejection(
  "new product without Scene spec gate",
  "NEW_PRODUCT_SCENE_SPEC_MISSING",
  (d) => {
    const p = d.launch.products.find((p) => p.slug === "tesla");
    p.scene_requirements = p.scene_requirements.filter(
      (s) => s !== "SCENE_SPEC_REQUIRED",
    );
  },
);
rejection("missing mobile master gate", "UNPROVEN_SCENE_READINESS", (d) => {
  d.launch.products[0].scene_requirements =
    d.launch.products[0].scene_requirements.filter(
      (s) => s !== "MOBILE_MASTER_REQUIRED",
    );
});
rejection("fabricated ready Scene asset", "UNPROVEN_SCENE_READINESS", (d) => {
  d.launch.products[0].desktop_master = "/fake.png";
});
rejection("invalid calendar date", "INVALID_DATE", (d) => {
  d.launch.products[0].effective_from = "2026-02-30T10:00:00Z";
});
rejection("reversed availability dates", "INVALID_DATE_ORDER", (d) => {
  d.launch.products[0].effective_from = "2026-10-10T10:00:00Z";
  d.launch.products[0].available_to = "2026-10-09T10:00:00Z";
});
rejection(
  "numeric floating speed instead of decimal string",
  "INVALID_SPEED_DECIMAL",
  (d) => {
    d.economy.products[0].proposed_product_speed_multiplier = 1.12;
  },
);
rejection(
  "three-decimal speed violates 0.01 step",
  "INVALID_SPEED_DECIMAL",
  (d) => {
    d.economy.products[0].proposed_product_speed_multiplier = "1.125";
  },
);
rejection(
  "proposed speed exceeds allowed 1.20",
  "INVALID_PROPOSED_SPEED_BAND",
  (d) => {
    d.economy.products[0].proposed_product_speed_multiplier = "1.25";
  },
);
rejection(
  "proposal band silently changed",
  "INVALID_ECONOMY_PROPOSAL_BAND",
  (d) => {
    d.economy.allowed_proposal_band.maximum_bps = 12500;
  },
);
rejection(
  "suggested yield invented",
  "UNAUTHORIZED_YIELD_OR_PRICE_FIELD",
  (d) => {
    d.economy.products[0].proposed_yield_percent = "15";
  },
);
rejection("proposed speed below 1.00", "INVALID_PROPOSED_SPEED_BAND", (d) => {
  d.economy.products[0].proposed_product_speed_multiplier = "0.99";
});
rejection("bps and decimal disagree", "SPEED_BPS_MISMATCH", (d) => {
  d.economy.products[0].proposed_product_speed_bps = 11300;
});
rejection("grade contradicts speed band", "GRADE_SPEED_MISMATCH", (d) => {
  d.economy.products[0].grade = "C";
});
rejection(
  "mining personality omitted",
  "MISSING_MINING_PERSONALITY_OR_RATIONALE",
  (d) => {
    d.economy.products[0].mining_personality = "";
  },
);
rejection("approved value invented", "UNAPPROVED_PRODUCT_ECONOMY", (d) => {
  d.economy.products[0].approved_product_speed_multiplier = "1.12";
});
rejection("human policy gate disabled", "UNPROVEN_POLICY_APPROVAL", (d) => {
  d.economy.policy_approval_required = false;
});
rejection(
  "market price controls proposed economy",
  "MARKET_LINKED_ECONOMY",
  (d) => {
    d.economy.market_linked = true;
  },
);
rejection(
  "product capacity override added",
  "UNAPPROVED_CAPACITY_OVERRIDE",
  (d) => {
    d.economy.products[0].product_capacity_override = "11000";
  },
);
rejection(
  "per-slot global capacity replicated",
  "UNAPPROVED_CAPACITY_OVERRIDE",
  (d) => {
    d.economy.products[0].capacity_scope = "PER_SLOT";
  },
);
rejection("fractional won main display", "SUB_WON_PRIMARY_DISPLAY", (d) => {
  d.economy.products[0].main_money_display = "SUB_WON";
});
rejection(
  "new speed above existing policy passed silently",
  "POLICY_BAND_CHANGE_UNACKNOWLEDGED",
  (d) => {
    d.economy.products[0].existing_policy_compatibility = "ACTIVE";
  },
);
rejection("final cap increased", "INVALID_FINAL_CAP", (d) => {
  d.economy.combined_speed_cap_bps = 16000;
});
rejection("intermediate cap applied", "INVALID_FINAL_CAP", (d) => {
  d.economy.clamp_stage = "EACH_MODIFIER";
});
rejection("micro unit altered", "INVALID_MONEY_UNIT", (d) => {
  d.economy.micro_krw_per_krw = "1000";
});
rejection(
  "missing one launch economy value",
  "ECONOMY_COVERAGE_MISSING",
  (d) => {
    d.economy.products.pop();
  },
);
rejection("money guarantee in member copy", "UNSUPPORTED_MEMBER_CLAIM", (d) => {
  d.copy[0].body_ko += " 원금 100% 보장합니다.";
});
rejection(
  "numeric payout invented in member copy",
  "UNAPPROVED_ECONOMIC_COPY",
  (d) => {
    d.copy[0].body_ko += " 5000원 지급합니다.";
  },
);
rejection("market linked payout copy", "MARKET_LINKED_COPY", (d) => {
  d.copy[0].body_ko += " 시세 상승에 따라 보상이 증가합니다.";
});
rejection("technical enum exposed to member", "TECHNICAL_MEMBER_COPY", (d) => {
  d.copy[0].body_ko += " EFFECT_SCOPE_UNRESOLVED";
});
rejection(
  "positioning disclaimer removed",
  "POSITIONING_PHRASE_MISSING",
  (d) => {
    d.copy[0].body_ko = "멋진 상품입니다.";
  },
);
rejection("linked FAQ not present", "BROKEN_CONTENT_LINK", (d) => {
  d.copy[0].linked_faq_slugs = ["missing-faq"];
});
rejection(
  "delta collides with frozen internal slug",
  "CONTENT_DELTA_SLUG_COLLISION",
  (d) => {
    d.delta["events-additions"][0].slug = d.frozen.packages.events.slugs[0];
  },
);
rejection(
  "delta collides with frozen storage slug",
  "CONTENT_DELTA_STORAGE_SLUG_COLLISION",
  (d) => {
    d.delta["events-additions"][0].storage.slug =
      d.frozen.packages.events.storage_slugs[0];
  },
);
rejection("empty content title", "EMPTY_MEMBER_TEXT", (d) => {
  d.delta["notices-additions"][0].storage.title_ko = "";
});
rejection("empty content full body", "EMPTY_MEMBER_TEXT", (d) => {
  d.delta["notices-additions"][0].storage.body_markdown = " ";
});
rejection("missing CTA", "MISSING_OR_INVALID_CTA", (d) => {
  d.delta["events-additions"][0].metadata.cta = null;
});
rejection("fabricated product detail route", "MISSING_OR_INVALID_CTA", (d) => {
  d.delta["events-additions"][0].metadata.cta.route = "/products/nvidia";
});
rejection("invalid audience", "INVALID_AUDIENCE", (d) => {
  d.delta["events-additions"][0].metadata.audience = "EVERYONE";
});
rejection("invalid mining segment", "INVALID_SEGMENT", (d) => {
  d.delta["events-additions"][0].metadata.segment = "RICH_MEMBERS";
});
rejection("required copy missing", "REQUIRED_PHRASE_MISSING", (d) => {
  d.delta["events-additions"][0].metadata.required_phrases = [
    "입금은 필요하지 않습니다",
  ];
});
rejection(
  "template variable not declared",
  "UNDECLARED_OR_UNUSED_VARIABLE",
  (d) => {
    d.delta["notices-additions"][0].metadata.variables = [];
  },
);
rejection(
  "unapproved content financial value",
  "UNAPPROVED_CONTENT_ECONOMY",
  (d) => {
    d.delta["events-additions"][0].metadata.economy.values = {
      bonus_krw: "5000",
    };
  },
);
rejection(
  "content published without receipt",
  "UNAPPROVED_CONTENT_PUBLICATION",
  (d) => {
    d.delta["notices-additions"][0].storage.status = "PUBLISHED";
  },
);
rejection("event ends before it starts", "INVALID_EVENT_SCHEDULE", (d) => {
  const x = d.delta["events-additions"][0];
  x.storage.starts_at = "2026-10-10T10:00:00Z";
  x.storage.ends_at = "2026-10-09T10:00:00Z";
});
rejection(
  "in-app notification links outside protected allowlist",
  "UNSAFE_NOTIFICATION_ROUTE",
  (d) => {
    d.delta["notifications-additions"][0].storage.route = "/support";
  },
);
rejection(
  "uppercase notification category is not mapped",
  "INVALID_NOTIFICATION_CATEGORY",
  (d) => {
    d.delta["notifications-additions"][0].storage.category = "NOTICE";
  },
);
rejection("push opt-in bypass", "UNSAFE_NOTIFICATION_AUTOMATION", (d) => {
  d.delta["notifications-additions"][0].metadata.push_opt_in_required = false;
});
rejection(
  "invented member notification target",
  "FABRICATED_NOTIFICATION_TARGET",
  (d) => {
    d.delta["notifications-additions"][0].metadata.user_id = "fake-user";
  },
);
rejection(
  "support macro sends automatically",
  "UNREVIEWED_SUPPORT_SEND",
  (d) => {
    d.delta["support-additions"][0].review_before_send = false;
  },
);
rejection("missing a frozen event review", "INCOMPLETE_FROZEN_REVIEW", (d) => {
  d.review.event_review.pop();
});
rejection("drop deletes historical records", "INVALID_REVIEW_DECISION", (d) => {
  d.review.event_review[0].retains_historical_records = false;
});
rejection(
  "unobserved external benchmark claimed complete",
  "FALSE_BENCHMARK_COMPLETION",
  (d) => {
    d.review.public_benchmark_completed = true;
  },
);
rejection(
  "registration ready without readback evidence",
  "UNPROVEN_REGISTRATION_READINESS",
  (d) => {
    d.catalogPlan.registration_ready = true;
  },
);
rejection(
  "production ready without approval",
  "UNPROVEN_REGISTRATION_READINESS",
  (d) => {
    d.catalogPlan.production_ready = true;
  },
);
rejection("catalog command invented", "INVENTED_APPROVED_COMMAND", (d) => {
  d.catalogPlan.approved_commands.publish = "publish_catalog_magic";
});
rejection(
  "direct SQL used to bypass command absence",
  "REGISTRATION_BOUNDARY_BYPASS",
  (d) => {
    d.catalogPlan.direct_sql_allowed = true;
  },
);
rejection(
  "shared staging not owned by this lane",
  "REGISTRATION_BOUNDARY_BYPASS",
  (d) => {
    d.contentPlan.shared_staging = "WRITTEN";
  },
);
rejection(
  "fabricated readback PASS",
  "FABRICATED_REGISTRATION_EVIDENCE",
  (d) => {
    d.readback.status = "PASS";
  },
);
rejection(
  "fake screenshot used as real registration proof",
  "FABRICATED_REGISTRATION_EVIDENCE",
  (d) => {
    d.render.screenshots = ["fake.png"];
  },
);
rejection("fake rollback receipt", "FABRICATED_REGISTRATION_EVIDENCE", (d) => {
  d.rollback.rollback_receipt = "fake-receipt";
});
rejection(
  "simulated outputs edited after computation",
  "SIMULATION_READBACK_MISMATCH",
  (d) => {
    d.simulation.products[0].A.days_to_cap_display = "1.000000";
  },
);
rejection(
  "invented live selection distribution",
  "FABRICATED_SIMULATION_DATA",
  (d) => {
    d.simulation.concentration.observed_member_distribution = "90% NVDA";
  },
);

test("leap and invalid-calendar dates are distinguished", () => {
  assert.equal(validDate("2028-02-29T00:00:00Z"), true);
  assert.equal(validDate("2026-02-29T00:00:00Z"), false);
  assert.equal(validDate("2026-10-07T24:00:00Z"), false);
  assert.equal(validDate("2026-10-07"), false);
});

test("decimal bps use exact 0.01 increments", () => {
  assert.equal(decimalBps("1.18"), 11800n);
  assert.throws(() => decimalBps(1.18));
  assert.throws(() => decimalBps("1.180"));
});

test("combined cap matches requested product user event example", () => {
  const x = combineSpeed([12000n, 11500n, 11000n, 10000n]);
  assert.equal(x.raw_display, "1.518000");
  assert.equal(x.final_display, "1.500000");
  assert.equal(x.capped, true);
});

test("exact cap boundary and one bps below stay distinguishable", () => {
  assert.equal(combineSpeed([10000n, 12000n, 12500n, 10000n]).capped, false);
  assert.equal(
    combineSpeed([10000n, 12000n, 12499n, 10000n]).final_display,
    "1.499880",
  );
});

test("final-only clamp preserves a later reduction modifier", () => {
  const x = combineSpeed([11800n, 12000n, 12500n, 8000n]);
  assert.equal(x.final_display, "1.416000");
  assert.equal(x.capped, false);
  assert.notEqual(x.final_display, "1.200000");
});

test("maximum proposed speed keeps exact calculable modifier headroom", () => {
  const result = base.simulation.products.find((p) => p.slug === "nvidia");
  assert.deepEqual(result.headroom_factor_to_final_cap, {
    numerator: "75",
    denominator: "59",
  });
  assert.equal(combineSpeed([11800n, 11500n, 11000n, 10000n]).capped, false);
  assert.equal(combineSpeed([11800n, 11500n, 11000n, 10500n]).capped, true);
});

test("sub-micro carry survives until the third tick", () => {
  let state = { accrued: 0n, carry: 0n };
  const expected = [
    { accrued: 0n, carry: 1n },
    { accrued: 0n, carry: 2n },
    { accrued: 1n, carry: 0n },
  ];
  for (const x of expected) {
    state = accrue({
      rateNumerator: 1n,
      rateDenominator: 3n,
      elapsed: 1n,
      capacity: 100n,
      ...state,
    });
    assert.deepEqual(state, x);
  }
});

test("chunked accrual equals one interval without losing residue", () => {
  let chunked = { accrued: 0n, carry: 0n };
  for (const elapsed of [2n, 7n, 11n])
    chunked = accrue({
      rateNumerator: 17n,
      rateDenominator: 13n,
      elapsed,
      capacity: 1000n,
      ...chunked,
    });
  const once = accrue({
    rateNumerator: 17n,
    rateDenominator: 13n,
    elapsed: 20n,
    capacity: 1000n,
  });
  assert.deepEqual(chunked, once);
});

test("capacity cannot be exceeded by large elapsed time", () => {
  assert.equal(
    accrue({
      rateNumerator: 100000000000000000001n,
      rateDenominator: 1n,
      elapsed: 1000000000000000000n,
      capacity: 99n,
    }).accrued,
    99n,
  );
});

test("whole won display stays below the next verified 1-won boundary", () => {
  assert.equal(displayFraction(1999999n, 1000000n, 0), "1");
  assert.equal(displayFraction(2000000n, 1000000n, 0), "2");
});

test("two slots share global capacity and cannot allocate more than 100%", () => {
  assert.deepEqual(
    allocationRate([
      { allocationBps: 5000n, speedBps: 11800n },
      { allocationBps: 5000n, speedBps: 10000n },
    ]),
    { numerator: "109", denominator: "100" },
  );
  assert.throws(() =>
    allocationRate([
      { allocationBps: 10000n, speedBps: 11800n },
      { allocationBps: 10000n, speedBps: 10000n },
    ]),
  );
});

test("Policy A and B differ in capacity rather than silently changing reward rate", () => {
  const a = normalizedProduct(11800n, 10000n);
  const b = normalizedProduct(11800n, 11500n);
  assert.deepEqual(a.daily_index_rate, b.daily_index_rate);
  assert.deepEqual(a.capacity_index, { numerator: "100", denominator: "1" });
  assert.deepEqual(b.capacity_index, { numerator: "115", denominator: "1" });
  assert.notDeepEqual(a.days_to_cap, b.days_to_cap);
});

test("rational arithmetic is exact beyond Number safe integer range", () => {
  const n = 900719925474099312345n;
  assert.deepEqual(rational(n * 3n, 3n), {
    numerator: n.toString(),
    denominator: "1",
  });
});

test("invalid negative or zero inputs fail instead of producing money", () => {
  assert.throws(() => rational(-1n, 1n));
  assert.throws(() => rational(1n, 0n));
  assert.throws(() => combineSpeed([10000n, 10000n, 10000n, 0n]));
  assert.throws(() =>
    accrue({
      rateNumerator: 1n,
      rateDenominator: 3n,
      elapsed: 1n,
      capacity: 10n,
      carry: 3n,
    }),
  );
});

test("restored default draft remains valid after all isolated mutations", () => {
  assert.equal(validatePackage(base, { now }).ok, true);
});
