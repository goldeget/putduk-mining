import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { decimalBps, simulate } from "./economy-simulate.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const classes = new Set(["KR_STOCK", "US_STOCK", "ETF", "CRYPTO", "PRECIOUS"]);
const waves = new Set([
  "P0_LAUNCH_CORE",
  "P1_LAUNCH_EXPANSION",
  "P2_LATER",
  "HOLD",
  "REJECT",
]);
const audiences = new Set(["MEMBERS", "PUBLIC", "OPERATORS"]);
const segments = new Set([
  "ALL_MEMBERS",
  "MINING_MEMBERS",
  "NEW_MEMBERS",
  "START_MEMBERS",
]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const gradeBands = {
  C: [10000n, 10400n],
  B: [10500n, 10900n],
  A: [11000n, 11400n],
  S: [11500n, 12000n],
};
const blank = (x) => typeof x !== "string" || !x.trim();
const clone = (x) => JSON.parse(JSON.stringify(x));

export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    return false;
  const calendar = value.slice(0, 10);
  const day = Date.parse(calendar + "T00:00:00Z");
  return (
    Number.isFinite(day) &&
    new Date(day).toISOString().slice(0, 10) === calendar &&
    Number.isFinite(Date.parse(value))
  );
}

export function loadPackage() {
  const read = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
  const sourceResponseHashes = {};
  const responseDir = resolve(root, "evidence/source-responses");
  if (existsSync(responseDir)) {
    for (const name of readdirSync(responseDir).filter((p) =>
      /^[a-z0-9-]+\.txt$/.test(p),
    )) {
      sourceResponseHashes[name.slice(0, -4)] = createHash("sha256")
        .update(readFileSync(resolve(responseDir, name)))
        .digest("hex");
    }
  }
  return {
    sourceResponseHashes,
    candidates: read("product-candidates.json"),
    launch: read("launch-catalog-proposal.json"),
    economy: read("product-economy-proposal.json"),
    simulation: read("economy-simulation-results.json"),
    copy: read("product-copy.json"),
    waves: read("launch-wave-plan.json"),
    research: read("evidence/research-sources.json"),
    sources: read("evidence/product-source-evidence.json"),
    current: read("current-catalog-audit.json"),
    currentEvidence: read("evidence/current-catalog-evidence.json"),
    frozen: read("evidence/frozen-content-sources.json"),
    scenes: read("evidence/frozen-scene-sources.json"),
    routes: read("evidence/route-inventory.json"),
    review: read("event-notice-benchmark.json"),
    catalogPlan: read("catalog-registration-plan.json"),
    contentPlan: read("content-registration-plan.json"),
    readback: read("evidence/registration-readback.json"),
    render: read("evidence/render-evidence.json"),
    rollback: read("evidence/rollback-evidence.json"),
    delta: Object.fromEntries(
      [
        "events-additions",
        "events-rewrites",
        "notices-additions",
        "notices-rewrites",
        "faq-additions",
        "notifications-additions",
        "support-additions",
      ].map((k) => [k, read("content-delta/" + k + ".json")]),
    ),
    actions: read("content-delta/review-actions.json"),
  };
}

export function validatePackage(data, { now = Date.now() } = {}) {
  const errors = [];
  const add = (code, path) => errors.push({ code, path });
  const require = (condition, code, path) => {
    if (!condition) add(code, path);
  };
  function unique(rows, key, code, path) {
    const seen = new Set();
    for (const [i, row] of rows.entries()) {
      const value = key(row);
      if (value === null || value === undefined) continue;
      require(!seen.has(value), code, `${path}[${i}]`);
      seen.add(value);
    }
  }
  const date = (value, path) => {
    if (value !== null && value !== undefined)
      require(validDate(value), "INVALID_DATE", path);
  };
  function memberText(text, path) {
    require(!blank(text), "EMPTY_MEMBER_TEXT", path);
    if (typeof text !== "string") return;
    require(!/(?:보장합니다|보장됩니다|확정\s*수익률|공식\s*제휴사|주주가\s*됩니다|실제\s*(?:주식|ETF|코인)을\s*(?:매수|지급)합니다)/.test(
      text,
    ), "UNSUPPORTED_MEMBER_CLAIM", path);
    require(!/(?:시세|시장가격|배당)\s*(?:상승|수익률)?에?\s*따라\s*(?:채굴)?보상이/.test(
      text,
    ), "MARKET_LINKED_COPY", path);
    require(!/(?:[0-9]+(?:\.[0-9]+)?\s*(?:%|배|원)\s*(?:지급|보상|수익|보장)|수익률\s*[0-9])/.test(
      text,
    ), "UNAPPROVED_ECONOMIC_COPY", path);
    require(!/(?:POLICY_[A-Z_]+|PROPOSED_NOT_APPROVED|EFFECT_SCOPE_UNRESOLVED|raw enum|authoritative|API payload|snapshot|UUID)/i.test(
      text,
    ), "TECHNICAL_MEMBER_COPY", path);
  }
  const routeSet = new Set(Object.keys(data.routes?.static_routes ?? {}));
  const safeNotifications = new Set(data.routes?.notification_safe_paths ?? []);
  function cta(metadata, path) {
    require(metadata?.cta &&
      !blank(metadata.cta.label) &&
      routeSet.has(metadata.cta.route), "MISSING_OR_INVALID_CTA", path);
  }
  function metadata(meta, body, path) {
    require(audiences.has(meta?.audience), "INVALID_AUDIENCE", path);
    require(meta?.approval?.required === true &&
      meta.approval.status === "PENDING" &&
      meta.approval.approved_by === null, "UNPROVEN_CONTENT_APPROVAL", path);
    require(meta?.registration_ready !==
      true, "UNPROVEN_CONTENT_REGISTRATION_READY", path);
    cta(meta, path);
    const required = meta?.required_phrases ?? [];
    for (const phrase of required)
      require(typeof body === "string" &&
        body.includes(phrase), "REQUIRED_PHRASE_MISSING", path);
    const tokens =
      typeof body === "string"
        ? [...body.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((x) => x[1])
        : [];
    require(tokens.every((x) => (meta?.variables ?? []).includes(x)) &&
      (meta?.variables ?? []).every((x) =>
        tokens.includes(x),
      ), "UNDECLARED_OR_UNUSED_VARIABLE", path);
    require(meta?.economy &&
      (meta.economy.impact === "NONE"
        ? meta.economy.policy_status === "NOT_APPLICABLE" &&
          Object.keys(meta.economy.values ?? {}).length === 0
        : meta.economy.policy_status === "POLICY_VALUE_REQUIRED" &&
          Object.keys(meta.economy.values ?? {}).length ===
            0), "UNAPPROVED_CONTENT_ECONOMY", path);
  }
  try {
    require(data.candidates?.schema_version === 1 &&
      Array.isArray(
        data.candidates.candidates,
      ), "INVALID_PACKAGE_SHAPE", "candidates");
    if (!Array.isArray(data.candidates?.candidates))
      return { ok: false, errors };
    const candidates = data.candidates.candidates;
    unique(
      candidates,
      (p) => p.proposal_id,
      "DUPLICATE_PROPOSAL_ID",
      "candidates",
    );
    unique(candidates, (p) => p.slug, "DUPLICATE_PRODUCT_SLUG", "candidates");
    unique(
      candidates,
      (p) =>
        p.canonical_ticker || p.ticker_hint
          ? `${p.market}:${p.canonical_ticker ?? p.ticker_hint}`
          : null,
      "DUPLICATE_MARKET_TICKER",
      "candidates",
    );
    const sourceMap = new Map(data.research.sources.map((s) => [s.id, s]));
    const idMap = new Map(candidates.map((p) => [p.proposal_id, p]));
    const currentIds = new Map(
      data.current.products.map((p) => [p.slug, p.product_id]),
    );
    for (const [i, p] of candidates.entries()) {
      const path = `candidates[${i}]`;
      require(!blank(p.proposal_id) &&
        slugPattern.test(p.slug), "INVALID_ID_OR_SLUG", path);
      require(classes.has(p.asset_class), "INVALID_ASSET_CLASS", path);
      require(!blank(p.name_hint_ko), "EMPTY_PRODUCT_NAME", path);
      require(waves.has(p.proposed_wave) &&
        waves.has(p.effective_wave), "INVALID_LAUNCH_WAVE", path);
      require(p.market_linked === false, "MARKET_LINKED_PRODUCT", path);
      require(p.operator_approval === null &&
        p.status === "PUTDUK_PROPOSED", "FAKE_PRODUCT_APPROVAL", path);
      require(p.legal_brand_review === "LEGAL_BRAND_REVIEW_REQUIRED" &&
        p.partnership_claim_allowed ===
          false, "UNPROVEN_LEGAL_OR_PARTNERSHIP", path);
      require(p.registration_ready ===
        false, "UNPROVEN_REGISTRATION_READY", path);
      require(p.live_status ===
        "LIVE_DB_UNKNOWN", "UNPROVEN_LIVE_DATABASE", path);
      require(p.repo_status === "REPOSITORY_DRAFT"
        ? currentIds.get(p.slug) === p.repository_draft_id
        : p.repo_status === "NOT_IN_REPOSITORY" &&
            p.repository_draft_id === null, "FABRICATED_DATABASE_ID", path);
      require(Array.isArray(p.source_ids) &&
        p.source_ids.length > 0 &&
        p.source_ids.every((s) =>
          sourceMap.has(s),
        ), "MISSING_SOURCE_REFERENCE", path);
      require(p.identity_status === "UNKNOWN" ||
        p.identity_status ===
          "PUBLIC_MARKET_VERIFIED", "INVALID_IDENTITY_STATE", path);
      if (p.identity_status === "PUBLIC_MARKET_VERIFIED") {
        require(p.source_ids.some((s) => sourceMap.get(s)?.verified === true) &&
          p.verified_facts.length > 0 &&
          !blank(p.canonical_name) &&
          !blank(p.canonical_ticker) &&
          (p.asset_class === "CRYPTO" ||
            p.asset_class === "PRECIOUS" ||
            !blank(p.canonical_exchange)), "UNPROVEN_PUBLIC_IDENTITY", path);
      }
      if (
        ["P0_LAUNCH_CORE", "P1_LAUNCH_EXPANSION"].includes(p.effective_wave)
      ) {
        require(p.identity_status ===
          "PUBLIC_MARKET_VERIFIED", "UNKNOWN_EFFECTIVE_LAUNCH_PRODUCT", path);
      }
      if (p.identity_status === "UNKNOWN")
        require(p.canonical_name === null &&
          p.canonical_ticker === null &&
          p.canonical_exchange === null, "UNKNOWN_CANONICAL_IDENTITY", path);
      require(p.score_status === "EDITORIAL_HYPOTHESIS_NOT_MEASURED" &&
        Object.keys(p.scores).length === 16 &&
        Object.values(p.scores).every(
          (v) => Number.isInteger(v) && v >= 1 && v <= 5,
        ), "INVALID_EDITORIAL_SCORES", path);
      if (p.asset_class === "ETF")
        require(p.blocking_requirements.includes(
          "ETF_CATEGORY_CONTRACT_REQUIRED",
        ), "MISSING_ETF_CONTRACT_GATE", path);
    }
    unique(
      data.research.sources,
      (s) => s.id,
      "DUPLICATE_SOURCE_ID",
      "research",
    );
    for (const [i, s] of data.research.sources.entries()) {
      const path = `research.sources[${i}]`;
      let url;
      try {
        url = new URL(s.requested_url);
      } catch {
        /* reject below */
      }
      require(url?.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.hostname === s.hostname, "INVALID_SOURCE_URL", path);
      date(s.attempted_at, path);
      date(s.accessed_at, path);
      if (s.verified)
        require(s.http_status === 200 &&
          validDate(s.accessed_at) &&
          Date.parse(s.accessed_at) <= now &&
          now - Date.parse(s.accessed_at) <= 30 * 86400000 &&
          /^[a-f0-9]{64}$/.test(s.response_sha256) &&
          data.sourceResponseHashes[s.id] === s.response_sha256 &&
          Array.isArray(s.verified_facts) &&
          s.verified_facts.length > 0, "UNPROVEN_OR_STALE_SOURCE", path);
      if (s.observation === "ACCESS_BLOCKED")
        require(s.verified === false &&
          s.accessed_at === null &&
          s.verified_facts.length ===
            0, "BLOCKED_SOURCE_CLAIMED_VERIFIED", path);
    }
    require(!data.research.completed ||
      (data.research.sources.some((s) => s.verified) &&
        candidates
          .filter((p) =>
            ["P0_LAUNCH_CORE", "P1_LAUNCH_EXPANSION"].includes(p.proposed_wave),
          )
          .every(
            (p) => p.identity_status === "PUBLIC_MARKET_VERIFIED",
          )), "FALSE_RESEARCH_COMPLETION", "research");
    require(data.candidates.research_completed ===
      data.research.completed, "RESEARCH_STATE_MISMATCH", "candidates");
    const launch = data.launch.products;
    unique(launch, (p) => p.proposal_id, "DUPLICATE_LAUNCH_ID", "launch");
    unique(launch, (p) => p.display_order, "DUPLICATE_DISPLAY_ORDER", "launch");
    require(launch.length >= 20 &&
      launch.length <= 30 &&
      data.launch.planned_product_count ===
        launch.length, "INVALID_LAUNCH_COUNT", "launch");
    require(data.launch.status === "PROPOSED_NOT_APPROVED" &&
      data.launch.approved === false &&
      data.launch.effective_launch_count ===
        0, "UNPROVEN_LAUNCH_APPROVAL", "launch");
    for (const [i, p] of launch.entries()) {
      const path = `launch.products[${i}]`;
      const candidate = idMap.get(p.proposal_id);
      require(candidate &&
        candidate.slug === p.slug &&
        candidate.proposed_wave ===
          p.planned_wave, "LAUNCH_CANDIDATE_MISMATCH", path);
      require(["P0_LAUNCH_CORE", "P1_LAUNCH_EXPANSION"].includes(
        p.planned_wave,
      ), "INVALID_LAUNCH_WAVE", path);
      require(p.effective_wave === "HOLD" &&
        p.approved === false &&
        p.registration_ready === false, "UNPROVEN_EFFECTIVE_LAUNCH", path);
      date(p.effective_from, path);
      date(p.available_to, path);
      require(p.available_to === null ||
        (validDate(p.effective_from) &&
          Date.parse(p.available_to) >
            Date.parse(p.effective_from)), "INVALID_DATE_ORDER", path);
      require(Number.isSafeInteger(p.display_order) &&
        p.display_order > 0, "INVALID_DISPLAY_ORDER", path);
      require(p.scene_requirements.includes("DESKTOP_MASTER_REQUIRED") &&
        p.scene_requirements.includes("MOBILE_MASTER_REQUIRED") &&
        p.scene_requirements.includes("REAL_BROWSER_ACCEPTANCE_REQUIRED") &&
        p.desktop_master === null &&
        p.mobile_master === null, "UNPROVEN_SCENE_READINESS", path);
      if (candidate?.repo_status === "NOT_IN_REPOSITORY")
        require(p.scene_requirements.includes(
          "SCENE_SPEC_REQUIRED",
        ), "NEW_PRODUCT_SCENE_SPEC_MISSING", path);
    }
    const economy = data.economy;
    require(economy.allowed_proposal_band.minimum_bps === 10000 &&
      economy.allowed_proposal_band.maximum_bps === 12000 &&
      economy.recommended_band.minimum === "1.00" &&
      economy.recommended_band.maximum === "1.18" &&
      economy.recommended_band.step ===
        "0.01", "INVALID_ECONOMY_PROPOSAL_BAND", "economy");
    require(economy.status === "PROPOSED_NOT_APPROVED" &&
      economy.approved_policy_version === null &&
      economy.policy_approval_required ===
        true, "UNPROVEN_POLICY_APPROVAL", "economy");
    require(economy.market_linked ===
      false, "MARKET_LINKED_ECONOMY", "economy");
    require(economy.recommended_policy === "A" &&
      economy.capacity_policy ===
        "INHERIT_TIER_CAPACITY", "UNAPPROVED_CAPACITY_POLICY", "economy");
    require(economy.combined_speed_cap_bps === 15000 &&
      economy.clamp_stage ===
        "FINAL_COMBINED_ONCE", "INVALID_FINAL_CAP", "economy");
    require(economy.micro_krw_per_krw ===
      "1000000", "INVALID_MONEY_UNIT", "economy");
    unique(
      economy.products,
      (p) => p.proposal_id,
      "DUPLICATE_ECONOMY_ID",
      "economy",
    );
    const launchIds = new Set(launch.map((p) => p.proposal_id));
    const economyIds = new Set(economy.products.map((p) => p.proposal_id));
    require(launchIds.size === economyIds.size &&
      [...launchIds].every((id) =>
        economyIds.has(id),
      ), "ECONOMY_COVERAGE_MISSING", "economy");
    for (const [i, p] of economy.products.entries()) {
      const path = `economy.products[${i}]`;
      let speed;
      try {
        speed = decimalBps(p.proposed_product_speed_multiplier);
      } catch {
        add("INVALID_SPEED_DECIMAL", path);
      }
      require(speed !== undefined &&
        speed >= 10000n &&
        speed <= 12000n, "INVALID_PROPOSED_SPEED_BAND", path);
      require(speed !== undefined &&
        speed ===
          BigInt(p.proposed_product_speed_bps), "SPEED_BPS_MISMATCH", path);
      const band = gradeBands[p.grade];
      require(band &&
        speed >= band[0] &&
        speed <= band[1], "GRADE_SPEED_MISMATCH", path);
      require(!blank(p.mining_personality) &&
        !blank(p.personality_ko) &&
        !blank(
          p.speed_rationale_ko,
        ), "MISSING_MINING_PERSONALITY_OR_RATIONALE", path);
      require(p.policy_status === "PROPOSED_NOT_APPROVED" &&
        p.policy_approval_required === true &&
        p.approved_product_speed_multiplier ===
          null, "UNAPPROVED_PRODUCT_ECONOMY", path);
      require(p.market_linked === false, "MARKET_LINKED_ECONOMY", path);
      require(!Object.keys(p).some((key) =>
        /(?:yield|apr|apy|roi|guaranteed_return|market_price|price_feed)/i.test(
          key,
        ),
      ), "UNAUTHORIZED_YIELD_OR_PRICE_FIELD", path);
      require(p.capacity_policy === "INHERIT_TIER_CAPACITY" &&
        p.product_capacity_override === null &&
        p.capacity_scope ===
          "GLOBAL_CYCLE", "UNAPPROVED_CAPACITY_OVERRIDE", path);
      require(p.main_money_display === "WHOLE_KRW_ONLY" &&
        p.minimum_main_step_krw === "1", "SUB_WON_PRIMARY_DISPLAY", path);
      if (speed > 11000n)
        require(p.existing_policy_compatibility ===
          "POLICY_VERSION_CHANGE_REQUIRED", "POLICY_BAND_CHANGE_UNACKNOWLEDGED", path);
    }
    const copiedIds = new Set(data.copy.map((p) => p.proposal_id));
    require(copiedIds.size === launchIds.size &&
      [...launchIds].every((id) =>
        copiedIds.has(id),
      ), "COPY_COVERAGE_MISSING", "copy");
    unique(data.copy, (p) => p.slug, "DUPLICATE_COPY_SLUG", "copy");
    const linked = new Set([
      ...Object.values(data.frozen.packages).flatMap((p) => p.slugs),
      ...Object.values(data.delta).flatMap((rows) => rows.map((r) => r.slug)),
    ]);
    for (const [i, p] of data.copy.entries()) {
      const path = `copy[${i}]`;
      memberText(p.title_ko, path);
      memberText(p.body_ko, path);
      memberText(p.short_description_ko, path);
      require(p.body_ko.includes(
        "시세나 배당이 채굴보상을 결정하지 않습니다",
      ) &&
        p.body_ko.includes("기업·운용사와의 제휴를 뜻하지 않습니다") &&
        p.body_ko.includes(
          "실제 주식·ETF·금속·코인의 매수나 소유를 뜻하지 않습니다",
        ), "POSITIONING_PHRASE_MISSING", path);
      require(p.status === "DRAFT" &&
        p.legal_copy_status === "LEGAL_COPY_REQUIRED" &&
        p.registration_ready === false, "UNAPPROVED_PRODUCT_COPY", path);
      cta(p, path);
      require([
        ...p.linked_faq_slugs,
        ...p.linked_notice_slugs,
        ...p.linked_event_slugs,
      ].every((s) => linked.has(s)), "BROKEN_CONTENT_LINK", path);
    }
    const additionSlugs = [];
    for (const [kind, rows] of Object.entries(data.delta)) {
      unique(rows, (r) => r.slug, "DUPLICATE_CONTENT_SLUG", kind);
      const oldKind = kind.startsWith("events")
        ? "events"
        : kind.startsWith("notices")
          ? "notices"
          : kind.startsWith("faq")
            ? "faq"
            : kind.startsWith("support")
              ? "support-macros"
              : "notifications";
      const originals = new Set(data.frozen.packages[oldKind].slugs);
      const existingStorageSlugs = new Set(
        data.frozen.packages[oldKind].storage_slugs ?? [],
      );
      for (const [i, r] of rows.entries()) {
        const path = `${kind}[${i}]`;
        const isRewrite = kind.endsWith("rewrites");
        const s = r.storage;
        require(slugPattern.test(r.slug), "INVALID_CONTENT_SLUG", path);
        require(isRewrite
          ? originals.has(r.slug)
          : !originals.has(r.slug), "CONTENT_DELTA_SLUG_COLLISION", path);
        if (!isRewrite) {
          additionSlugs.push(r.slug);
          if (s?.slug)
            require(!existingStorageSlugs.has(
              s.slug,
            ), "CONTENT_DELTA_STORAGE_SLUG_COLLISION", path);
        }
        const title = s?.title_ko ?? r.title_ko;
        const body =
          s?.body_markdown ??
          r.body_ko ??
          s?.body_ko ??
          r.metadata?.body_markdown;
        memberText(title, path);
        memberText(body, path);
        metadata(r.metadata, body, path);
        if (s?.summary_ko !== undefined) memberText(s.summary_ko, path);
        require(title.length <=
          (kind.startsWith("notices") ? 120 : 100), "TITLE_TOO_LONG", path);
        if (s?.summary_ko !== undefined)
          require(s.summary_ko.length <= 500, "SUMMARY_TOO_LONG", path);
        if (s?.status !== undefined)
          require(s.status === "DRAFT" &&
            s.published_at === null, "UNAPPROVED_CONTENT_PUBLICATION", path);
        for (const field of [
          "starts_at",
          "ends_at",
          "published_at",
          "expires_at",
        ])
          date(s?.[field], `${path}.${field}`);
        if (kind.startsWith("events")) {
          require(segments.has(r.metadata.segment), "INVALID_SEGMENT", path);
          require(s.starts_at === null && s.ends_at === null
            ? r.metadata.schedule.status === "SCHEDULE_REQUIRED"
            : validDate(s.starts_at) &&
                validDate(s.ends_at) &&
                Date.parse(s.ends_at) >
                  Date.parse(s.starts_at), "INVALID_EVENT_SCHEDULE", path);
          require(r.metadata.schedule.starts_at === s.starts_at &&
            r.metadata.schedule.ends_at ===
              s.ends_at, "SCHEDULE_METADATA_MISMATCH", path);
          for (const key of [
            "card_title_ko",
            "start_condition",
            "end_condition",
            "participation",
            "exclusion",
            "scene_brief",
            "notification_copy",
            "operator_note",
            "rollback",
            "abuse_risk",
          ])
            require(!blank(
              r.metadata[key],
            ), "MISSING_EVENT_METADATA", `${path}.${key}`);
          require(r.metadata.kpi?.target === null, "INVENTED_KPI_TARGET", path);
        }
        if (kind.startsWith("notices") && s.expires_at !== null)
          require(s.published_at !== null &&
            Date.parse(s.expires_at) >
              Date.parse(s.published_at), "INVALID_DATE_ORDER", path);
        if (kind.startsWith("notifications")) {
          require(safeNotifications.has(s.route) &&
            routeSet.has(s.route), "UNSAFE_NOTIFICATION_ROUTE", path);
          require([
            "events",
            "marketing",
            "mining",
            "service",
            "wallet",
          ].includes(s.category), "INVALID_NOTIFICATION_CATEGORY", path);
          require(body.length <= 500, "NOTIFICATION_TOO_LONG", path);
          require(r.metadata.push_opt_in_required === true &&
            r.metadata.critical_override === false &&
            r.metadata.publication_is_delivery ===
              false, "UNSAFE_NOTIFICATION_AUTOMATION", path);
          require(r.metadata.user_id === null &&
            r.metadata.source_event_id === null &&
            r.metadata.deduplication_key ===
              null, "FABRICATED_NOTIFICATION_TARGET", path);
        }
        if (kind.startsWith("support"))
          require(r.review_before_send ===
            true, "UNREVIEWED_SUPPORT_SEND", path);
      }
    }
    unique(
      additionSlugs.map((slug) => ({ slug })),
      (r) => r.slug,
      "DUPLICATE_CROSS_CONTENT_SLUG",
      "delta",
    );
    for (const kind of ["event", "notice"]) {
      const entries = data.review[kind + "_review"];
      const expected = new Set(data.frozen.packages[kind + "s"].slugs);
      require(entries.length === expected.size &&
        entries.every((r) =>
          expected.has(r.slug),
        ), "INCOMPLETE_FROZEN_REVIEW", kind);
      unique(entries, (r) => r.slug, "DUPLICATE_REVIEW_ROW", kind);
      for (const r of entries)
        require(["KEEP", "REWRITE", "MERGE", "DROP"].includes(r.decision) &&
          !blank(r.reason_ko) &&
          r.operation_status === "PROPOSED_NOT_EXECUTED" &&
          r.retains_historical_records === true &&
          (r.decision !== "MERGE" ||
            linked.has(r.merge_into)), "INVALID_REVIEW_DECISION", kind);
    }
    require(data.review.public_benchmark_completed === false &&
      data.review.benchmarks.length === 7 &&
      data.review.benchmarks.every(
        (b) =>
          b.observed_pattern === null &&
          b.verification_status === "ACCESS_BLOCKED",
      ), "FALSE_BENCHMARK_COMPLETION", "review");
    for (const [kind, plan] of [
      ["catalog", data.catalogPlan],
      ["content", data.contentPlan],
    ]) {
      require(plan.registration_ready === false &&
        plan.production_ready === false &&
        plan.local_registration === "NOT_RUN" &&
        plan.generated_ids.length === 0 &&
        plan.readback === "BLOCKED" &&
        plan.render === "BLOCKED" &&
        plan.rollback === "BLOCKED", "UNPROVEN_REGISTRATION_READINESS", kind);
      require(plan.command_status === "NOT_FOUND" &&
        Object.values(plan.approved_commands).every(
          (c) => c === null,
        ), "INVENTED_APPROVED_COMMAND", kind);
      require(plan.direct_sql_allowed === false &&
        plan.fixtures_allowed === false &&
        plan.migration_allowed === false &&
        plan.shared_staging === "DEFERRED_PRIMARY_OWNED_ENVIRONMENT" &&
        plan.production ===
          "FORBIDDEN_IN_THIS_LANE", "REGISTRATION_BOUNDARY_BYPASS", kind);
    }
    for (const [name, evidence] of [
      ["readback", data.readback],
      ["render", data.render],
      ["rollback", data.rollback],
    ]) {
      require(evidence.status === "BLOCKED" &&
        evidence.execution === "UNRUN" &&
        evidence.created_id === null &&
        evidence.screenshots.length === 0 &&
        evidence.rollback_receipt === null &&
        evidence.readback_result === null &&
        evidence.production_touched === false &&
        evidence.shared_staging_written === false &&
        evidence.direct_sql_executed ===
          false, "FABRICATED_REGISTRATION_EVIDENCE", name);
    }
    require(data.actions.status === "PROPOSED_NOT_EXECUTED" &&
      data.actions.never_delete_historical_records ===
        true, "UNSAFE_CONTENT_REVIEW_ACTION", "actions");
    if (
      !errors.some((e) => /SPEED|GRADE|COVERAGE|PACKAGE_SHAPE/.test(e.code))
    ) {
      const expected = simulate(
        clone(economy),
        clone(data.candidates),
        clone(data.currentEvidence.current_policy),
      );
      require(JSON.stringify(expected) ===
        JSON.stringify(
          data.simulation,
        ), "SIMULATION_READBACK_MISMATCH", "simulation");
      require(data.simulation.market_price_inputs.length === 0 &&
        data.simulation.live_policy_confirmed === false &&
        data.simulation.concentration.observed_member_distribution ===
          "UNKNOWN", "FABRICATED_SIMULATION_DATA", "simulation");
    }
  } catch (error) {
    add("INVALID_PACKAGE_SHAPE", String(error.message));
  }
  return { ok: errors.length === 0, errors };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let result;
  try {
    result = validatePackage(loadPackage());
  } catch (error) {
    result = {
      ok: false,
      errors: [{ code: "LOAD_FAILED", path: error.message }],
    };
  }
  const evidence = {
    schema_version: 1,
    validated_at: new Date().toISOString(),
    status: result.ok ? "PASS_DRAFT_VALIDATION" : "FAIL",
    ...result,
    research_completed: false,
    registration_ready: false,
    production_ready: false,
    note: "Passing validates safe proposal structure, not public identities, financial approval or product readiness.",
  };
  writeFileSync(
    resolve(root, "evidence/validation.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
  process.exitCode = result.ok ? 0 : 1;
}
