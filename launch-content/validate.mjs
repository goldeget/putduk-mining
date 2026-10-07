import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ownRoot = path.dirname(fileURLToPath(import.meta.url));
const fields = {
  events: [
    "slug",
    "title_ko",
    "summary_ko",
    "status",
    "starts_at",
    "ends_at",
    "published_at",
  ],
  notices: [
    "slug",
    "title_ko",
    "summary_ko",
    "body_markdown",
    "status",
    "is_pinned",
    "published_at",
    "expires_at",
  ],
  notifications: ["category", "title_ko", "body_ko", "route", "expires_at"],
  faq: [],
  "support-macros": [],
  "incident-templates": [],
  runbook: [],
};
const placeholderPattern = /\{\{([a-z0-9_]+)\}\}/g;
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function loadPackage(root = ownRoot) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const collections = Object.fromEntries(
    manifest.files.map((kind) => [
      kind,
      JSON.parse(fs.readFileSync(path.join(root, `${kind}.json`), "utf8")),
    ]),
  );
  const runbookSource = fs.readFileSync(
    path.join(root, "LAUNCH-DAY-RUNBOOK.md"),
    "utf8",
  );
  return { manifest, collections, runbookSource };
}

// Date.parse alone accepts impossible dates such as February 30; verify the
// calendar independently and require an explicit storage offset.
export function validDate(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const lastDay = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > lastDay ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    return false;
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4, 6)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4, 6)) !== 0))
  )
    return false;
  return Number.isFinite(Date.parse(value));
}

export function validatePackage(bundle, { publication = false } = {}) {
  const errors = [];
  const blockers = [];
  const counts = {};
  const seen = new Set();
  const { manifest, collections } = bundle;
  const issue = (code, slug, detail = "") =>
    errors.push({ code, slug, detail });
  const block = (code, slug) => blockers.push({ code, slug });
  if (manifest.schema_version !== "putduk-launch-content-v1")
    issue("MANIFEST_VERSION", "manifest");
  if (
    manifest.registration?.production_allowed !== false ||
    manifest.registration?.status !== "BLOCKED"
  )
    issue("REGISTRATION_BOUNDARY", "manifest");
  if (Object.keys(manifest.approved_economic_values ?? {}).length)
    issue("UNVERIFIED_POLICY_REGISTRY", "manifest");
  for (const kind of Object.keys(fields)) {
    const items = collections[kind];
    if (!Array.isArray(items)) {
      issue("COLLECTION_REQUIRED", kind);
      continue;
    }
    counts[kind] = items.length;
    if (items.length < manifest.minimum_counts[kind])
      issue("INSUFFICIENT_CONTENT", kind);
    const storageSlugs = new Set();
    for (const item of items) {
      if (!object(item)) {
        issue("INVALID_RECORD", kind);
        continue;
      }
      const { slug, storage: row, metadata: m } = item;
      if (!nonempty(slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        issue("INVALID_SLUG", slug);
      if (seen.has(slug)) issue("DUPLICATE_SLUG", slug);
      seen.add(slug);
      if (!object(row) || !object(m)) {
        issue("MISSING_STORAGE_OR_METADATA", slug);
        continue;
      }
      for (const key of Object.keys(row))
        if (!fields[kind].includes(key))
          issue("UNKNOWN_STORAGE_FIELD", slug, key);
      for (const key of fields[kind])
        if (!Object.hasOwn(row, key)) issue("MISSING_STORAGE_FIELD", slug, key);
      if (row.slug) {
        if (storageSlugs.has(row.slug)) issue("DUPLICATE_STORAGE_SLUG", slug);
        storageSlugs.add(row.slug);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug))
          issue("INVALID_STORAGE_SLUG", slug);
      }
      const title = row.title_ko ?? item.title_ko;
      const body =
        row.body_markdown ??
        row.body_ko ??
        (kind === "events" ? m.body_markdown : item.body_ko);
      if (!nonempty(title)) issue("EMPTY_TITLE", slug);
      if (!nonempty(body)) issue("EMPTY_BODY", slug);
      if (
        typeof title === "string" &&
        title.length > (kind === "notices" ? 120 : 100)
      )
        issue("TITLE_TOO_LONG", slug);
      if (
        Object.hasOwn(row, "summary_ko") &&
        (!nonempty(row.summary_ko) || row.summary_ko.length > 500)
      )
        issue("INVALID_SUMMARY", slug);
      if (
        kind === "notifications" &&
        typeof body === "string" &&
        body.length > 500
      )
        issue("NOTIFICATION_TOO_LONG", slug);
      if (!manifest.audiences.includes(m.audience))
        issue("INVALID_AUDIENCE", slug);
      if (
        !nonempty(m.cta?.label) ||
        !manifest.cta_routes.includes(m.cta?.route)
      )
        issue("MISSING_OR_UNSAFE_CTA", slug);
      if (
        m.approval?.required !== true ||
        m.approval?.status !== "PENDING" ||
        m.approval?.approved_by !== null
      )
        issue("APPROVAL_NOT_VERIFIED", slug);
      block("OPERATOR_APPROVAL_REQUIRED", slug);
      if (m.source_baseline !== manifest.baseline_sha)
        issue("BASELINE_MISMATCH", slug);
      if (
        !object(m.economy) ||
        !["NONE", "POLICY_DEPENDENT"].includes(m.economy.impact) ||
        !object(m.economy.values)
      )
        issue("ECONOMY_METADATA_REQUIRED", slug);
      else {
        // This package has no authenticated approval registry. Do not accept
        // a self-declared approval or a financial fixture as approved policy.
        if (Object.keys(m.economy.values).length)
          issue("UNAPPROVED_ECONOMIC_VALUE", slug);
        if (
          m.economy.impact === "NONE" &&
          m.economy.policy_status !== "NOT_APPLICABLE"
        )
          issue("ECONOMY_STATE_MISMATCH", slug);
        if (m.economy.impact === "POLICY_DEPENDENT") {
          if (m.economy.policy_status !== "POLICY_VALUE_REQUIRED")
            issue("UNVERIFIED_ECONOMIC_APPROVAL", slug);
          block("POLICY_VALUE_REQUIRED", slug);
        }
      }
      const visibleCopy = `${title ?? ""}\n${body ?? ""}\n${row.summary_ko ?? ""}\n${m.card_title_ko ?? ""}\n${m.notification_copy ?? ""}`;
      function inspectEconomicFields(value) {
        if (Array.isArray(value)) {
          value.forEach(inspectEconomicFields);
          return;
        }
        if (!object(value)) return;
        for (const [key, entry] of Object.entries(value)) {
          const economicKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
          if (
            /^(?:speed|capacity|amount_atomic|bonus_amount|reward_amount|yield|reward_rate|multiplier)(?:_value|_atomic|_multiplier|_rate)?$/i.test(
              economicKey,
            ) &&
            entry !== null
          )
            issue("UNAPPROVED_METADATA_ECONOMICS", slug, key);
          if (object(entry) || Array.isArray(entry))
            inspectEconomicFields(entry);
        }
      }
      inspectEconomicFields(m);
      const economicCopy = `${visibleCopy}\n${m.scene_brief ?? ""}`.replace(
        /0원(?:으로 (?:판단|생각)하지 마세요|인가요\?)/g,
        "금액 미확인 안내",
      );
      if (/\d[\d,.]*\s*(?:%|퍼센트|원|KRW|USDT|배)/i.test(economicCopy))
        issue("UNAPPROVED_NUMERIC_ECONOMICS", slug);
      if (
        /POLICY_VALUE_REQUIRED|authoritative|\bDB\b|snapshot|raw enum/i.test(
          visibleCopy,
        )
      )
        issue("INTERNAL_LANGUAGE_IN_MEMBER_COPY", slug);
      const requiredPhrases = new Set([
        ...(manifest.required_phrases[slug] ?? []),
        ...(Array.isArray(m.required_phrases) ? m.required_phrases : []),
      ]);
      for (const phrase of requiredPhrases)
        if (!visibleCopy.includes(phrase))
          issue("REQUIRED_PHRASE_MISSING", slug, phrase);
      const usedVariables = [
        ...new Set(
          [...visibleCopy.matchAll(placeholderPattern)].map(
            (match) => match[1],
          ),
        ),
      ].sort();
      const declared = Array.isArray(m.variables)
        ? [...m.variables].sort()
        : [];
      if (JSON.stringify(usedVariables) !== JSON.stringify(declared))
        issue("VARIABLE_DECLARATION_MISMATCH", slug);
      if (/\{\{/.test(visibleCopy.replace(placeholderPattern, "")))
        issue("MALFORMED_VARIABLE", slug);
      if (usedVariables.length)
        block("VERIFIED_TEMPLATE_VALUES_REQUIRED", slug);
      for (const [key, value] of Object.entries(row))
        if (key.endsWith("_at") && value !== null && !validDate(value))
          issue("INVALID_DATE", slug, key);
      if (row.published_at !== undefined && row.published_at !== null)
        issue("UNPUBLISHED_PACKAGE_REQUIRED", slug);
      if (row.status !== undefined && row.status !== "DRAFT")
        issue("DRAFT_STATUS_REQUIRED", slug);
      if (
        row.expires_at &&
        row.published_at &&
        Date.parse(row.expires_at) <= Date.parse(row.published_at)
      )
        issue("INVALID_EXPIRATION_ORDER", slug);
      if (kind === "events") {
        if (!manifest.event_segments.includes(m.segment))
          issue("INVALID_EVENT_SEGMENT", slug);
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
          "registration_kind",
        ])
          if (!nonempty(m[key])) issue("MISSING_EVENT_FIELD", slug, key);
        if (
          !nonempty(m.kpi?.definition) ||
          !nonempty(m.kpi?.measurement) ||
          m.kpi?.target !== null
        )
          issue("KPI_NOT_VERIFIED", slug);
        if (
          !object(m.schedule) ||
          m.schedule.timezone !== "Asia/Seoul" ||
          m.schedule.starts_at !== row.starts_at ||
          m.schedule.ends_at !== row.ends_at
        )
          issue("SCHEDULE_METADATA_MISMATCH", slug);
        if ((row.starts_at === null) !== (row.ends_at === null))
          issue("PARTIAL_SCHEDULE", slug);
        if (row.starts_at === null && row.ends_at === null)
          block("SCHEDULE_REQUIRED", slug);
        else if (Date.parse(row.ends_at) <= Date.parse(row.starts_at))
          issue("INVALID_DATE_ORDER", slug);
      }
      if (kind === "runbook") {
        if (m.audience !== "OPERATORS" || m.route_origin !== "ADMIN_APP_URL")
          issue("RUNBOOK_OPERATOR_SCOPE_REQUIRED", slug);
        if (
          !Array.isArray(item.sections) ||
          item.sections.length < 9 ||
          item.sections.some(
            (section) =>
              !nonempty(section.title_ko) ||
              !nonempty(section.body_markdown) ||
              section.operator_confirmation_required !== true,
          )
        )
          issue("RUNBOOK_STEPS_REQUIRED", slug);
        if (body !== bundle.runbookSource)
          issue("RUNBOOK_DOCUMENT_MISMATCH", slug);
      }
      if (kind === "notifications") {
        if (
          !["wallet", "mining", "events", "service", "marketing"].includes(
            row.category,
          )
        )
          issue("INVALID_NOTIFICATION_CATEGORY", slug);
        if (!manifest.notification_routes.includes(row.route))
          issue("NOTIFICATION_ROUTE_REJECTED", slug);
        if (
          !nonempty(m.trigger_evidence) ||
          !nonempty(m.delivery_policy) ||
          !nonempty(m.deduplication)
        )
          issue("MISSING_NOTIFICATION_EVIDENCE_GATE", slug);
        if (
          JSON.stringify(m.channels) !== JSON.stringify(["IN_APP", "WEB_PUSH"])
        )
          issue("INVALID_CHANNELS", slug);
        if (
          m.push?.title_ko !== title ||
          m.push?.body_ko !== body ||
          m.push?.route !== row.route
        )
          issue("PUSH_INAPP_MISMATCH", slug);
        block("PRIMARY_DOMAIN_EVENT_MAPPING_REQUIRED", slug);
      }
    }
  }
  for (const requiredSlug of Object.keys(manifest.required_phrases))
    if (!seen.has(requiredSlug))
      issue("MANDATORY_CONTENT_MISSING", requiredSlug);
  const faqCategories = new Set(
    (collections.faq ?? []).map((item) => item.metadata?.category),
  );
  for (const category of manifest.faq_categories)
    if (!faqCategories.has(category)) issue("FAQ_CATEGORY_MISSING", category);
  block("APPROVED_CONTENT_COMMAND_REQUIRED", "package");
  const status = errors.length
    ? "FAIL"
    : publication && blockers.length
      ? "BLOCKED"
      : "PASS_DRAFT_ONLY";
  return {
    status,
    counts,
    errors,
    publication_blockers: blockers,
    production_allowed: false,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const publication = process.argv.includes("--publication-ready");
    const result = validatePackage(loadPackage(), { publication });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode =
      result.status === "FAIL" ? 1 : result.status === "BLOCKED" ? 2 : 0;
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", error: String(error) }));
    process.exitCode = 1;
  }
}
