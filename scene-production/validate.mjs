import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  root,
  read,
  sourceProducts,
  sourceFamilies,
  sha256,
  seedFile,
} from "./source-contract.mjs";
export const statuses = [
  "APPROVED_EXISTING_PRODUCT_MASTER",
  "FAMILY_MASTER_ONLY",
  "PRODUCT_MASTER_REQUIRED",
  "REGENERATION_REQUIRED",
  "MOBILE_VARIANT_REQUIRED",
  "DESKTOP_VARIANT_REQUIRED",
  "RUNTIME_MAPPING_REQUIRED",
  "BRAND_LEGAL_REVIEW_REQUIRED",
  "CATALOG_TRUTH_UNRESOLVED",
  "NOT_MEMBER_VISIBLE",
  "DEPRECATED",
  "BLOCKED",
];
export const states = [
  "IDLE",
  "STARTING",
  "RUNNING",
  "REDUCED",
  "PAUSED",
  "STOPPED",
  "MAINTENANCE",
  "PARTIAL_STOP",
  "SETTLEMENT",
  "VERIFIED",
  "UNKNOWN",
];
const legal = [
  "LEGAL_BRAND_REVIEW_REQUIRED",
  "BRAND_USE_REVIEW_REQUIRED",
  "BRAND_USE_APPROVED",
  "BRAND_USE_RESTRICTED",
];
const mobile = [
  "MOBILE_CROP_OK",
  "MOBILE_VARIANT_REQUIRED",
  "MOBILE_MASTER_REQUIRED",
];
const nonblank = (v) => typeof v === "string" && v.trim().length > 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const strings = (v) => Array.isArray(v) && v.length > 0 && v.every(nonblank);
const point = (v) =>
  object(v) &&
  Number.isFinite(v.x) &&
  Number.isFinite(v.y) &&
  v.x >= 0 &&
  v.x <= 1 &&
  v.y >= 0 &&
  v.y <= 1;
const unique = (rows, key, err) => {
  const seen = new Set();
  for (const row of rows) {
    const value = row?.[key];
    if (!nonblank(value) || seen.has(value))
      err("DUPLICATE_OR_INVALID_" + key.toUpperCase());
    seen.add(value);
  }
};
function normalized(text, products) {
  let value = String(text ?? "").toLowerCase();
  for (const p of products) {
    for (const id of [
      p.product_code,
      p.slug,
      p.display_name_ko,
      p.display_name_en,
    ])
      if (nonblank(id)) value = value.split(id.toLowerCase()).join("");
  }
  return value.replace(/\s+/g, " ").trim();
}
function tokens(text) {
  return new Set(text.toLowerCase().match(/[a-z]{3,}/g) || []);
}
function similarity(a, b) {
  const x = tokens(a),
    y = tokens(b);
  return [...x].filter((t) => y.has(t)).length / new Set([...x, ...y]).size;
}
export function loadPackage() {
  return {
    inventory: JSON.parse(
      read("scene-production/product-catalog-inventory.json"),
    ),
    manifest: JSON.parse(read("scene-production/product-scene-manifest.json")),
    promptPack: JSON.parse(
      read("scene-production/scene-generation-prompts.json"),
    ),
  };
}
export function validatePackage(
  data,
  { sourceRows = sourceProducts(), families = sourceFamilies() } = {},
) {
  const errors = [];
  const err = (code, detail = "") => errors.push({ code, detail });
  if (
    !object(data) ||
    !object(data.inventory) ||
    !object(data.manifest) ||
    !object(data.promptPack)
  )
    return [{ code: "INVALID_PACKAGE_SHAPE" }];
  const inv = data.inventory,
    manifest = data.manifest,
    pack = data.promptPack;
  for (const [name, container, key] of [
    ["inventory", inv, "products"],
    ["manifest", manifest, "products"],
    ["prompts", pack, "prompts"],
  ]) {
    if (
      container.schema_version !== 1 ||
      !Array.isArray(container[key]) ||
      !container[key].every(object)
    )
      err("INVALID_CONTAINER", name);
    if (!/^[0-9a-f]{40}$/.test(container.base_sha ?? ""))
      err("INVALID_BASE_SHA", name);
  }
  if (errors.length) return errors;
  if (inv.base_sha !== manifest.base_sha || inv.base_sha !== pack.base_sha)
    err("BASE_SHA_MISMATCH");
  if (
    pack.generation_has_run !== false ||
    pack.production_catalog_verified !== false
  )
    err("UNPROVEN_GENERATION_OR_CATALOG");
  const rows = inv.products,
    scenes = manifest.products,
    prompts = pack.prompts;
  if (!rows.length || !scenes.length || !prompts.length) err("EMPTY_PACKAGE");
  for (const collection of [rows, scenes])
    for (const key of ["product_id", "product_code", "slug"])
      unique(collection, key, err);
  unique(prompts, "prompt_id", err);
  const source = new Map(sourceRows.map((p) => [p.product_id, p]));
  const catalog = new Map(rows.map((p) => [p.product_id, p]));
  const scene = new Map(scenes.map((p) => [p.product_id, p]));
  if (
    rows.length !== source.size ||
    sourceRows.some((p) => !catalog.has(p.product_id))
  )
    err("SOURCE_CATALOG_COVERAGE_MISMATCH");
  for (const p of rows) {
    const canonical = source.get(p.product_id);
    if (!canonical) {
      err("NONEXISTENT_PRODUCT_ID", p.product_id);
      continue;
    }
    for (const key of [
      "product_code",
      "slug",
      "asset_class",
      "display_name_ko",
      "display_name_en",
    ])
      if (p[key] !== canonical[key])
        err("CANONICAL_FIELD_MISMATCH", p.product_code + ":" + key);
    if (
      p.catalog_source?.file !== seedFile ||
      p.catalog_source?.verified !== true ||
      !nonblank(p.catalog_source?.symbol_or_record) ||
      p.catalog_source?.line !== canonical.source_line
    )
      err("MISSING_OR_INVALID_CATALOG_SOURCE", p.product_code);
    if (
      p.catalog_status !== "DRAFT" ||
      p.member_visible !== false ||
      p.live_member_visible !== "UNKNOWN"
    )
      err("UNPROVEN_CATALOG_APPROVAL", p.product_code);
    if (!scene.has(p.product_id))
      err(
        p.member_visible === true
          ? "MISSING_MEMBER_VISIBLE_MANIFEST"
          : "MISSING_CANDIDATE_MANIFEST",
        p.product_id,
      );
  }
  for (const s of scenes) {
    const p = catalog.get(s.product_id);
    if (!p) {
      err("NONEXISTENT_SCENE_PRODUCT_ID", s.product_id);
      continue;
    }
    for (const key of [
      "product_code",
      "slug",
      "asset_class",
      "display_name_ko",
      "display_name_en",
    ])
      if (s[key] !== p[key])
        err("MANIFEST_IDENTITY_MISMATCH", s.product_code + ":" + key);
    if (
      !object(s.catalog_source) ||
      JSON.stringify(s.catalog_source) !== JSON.stringify(p.catalog_source)
    )
      err("MISSING_OR_INVALID_CATALOG_SOURCE", s.product_code);
    if (
      s.catalog_status !== p.catalog_status ||
      s.metadata?.publishable !== false
    )
      err("UNPROVEN_MANIFEST_PUBLICATION", s.product_code);
    if (
      s.member_visible !== p.member_visible ||
      s.live_member_visible !== p.live_member_visible
    )
      err("VISIBILITY_MISMATCH", s.product_code);
    if (!families.includes(s.scene_family))
      err("MISSING_OR_INVALID_SCENE_FAMILY", s.product_code);
    if (
      !statuses.includes(s.current_scene_status) ||
      !strings(s.status_tags) ||
      s.status_tags.some((t) => !statuses.includes(t))
    )
      err("INVALID_SCENE_STATUS", s.product_code);
    const v = s.product_visual_profile;
    if (!object(v)) err("INVALID_VISUAL_PROFILE", s.product_code);
    for (const field of [
      "visual_story",
      "environment",
      "hero_object",
      "lighting",
      "energy_flow",
      "extraction_target",
      "depth_plan",
      "foreground_plan",
      "midground_plan",
      "background_plan",
    ])
      if (!nonblank(v?.[field]))
        err("MISSING_" + field.toUpperCase(), s.product_code);
    for (const field of [
      "secondary_objects",
      "materials",
      "palette",
      "machinery",
    ])
      if (!strings(v?.[field]))
        err("MISSING_" + field.toUpperCase(), s.product_code);
    for (const state of states)
      if (!nonblank(s.runtime_visual_states?.[state]))
        err("MISSING_RUNTIME_STATE", s.product_code + ":" + state);
    const c = s.composition;
    if (
      c?.desktop_master_ratio !== "16:9" ||
      !nonblank(c?.desktop_notes) ||
      !point(c?.focal_point?.desktop) ||
      !point(c?.extraction_target?.desktop)
    )
      err("INVALID_DESKTOP_COMPOSITION", s.product_code);
    if (
      !mobile.includes(c?.mobile_strategy) ||
      !nonblank(c?.mobile_notes) ||
      !nonblank(c?.crop_constraints) ||
      !point(c?.focal_point?.mobile) ||
      !point(c?.extraction_target?.mobile)
    )
      err("INVALID_MOBILE_STRATEGY", s.product_code);
    for (const field of ["desktop_ui_safe_zones", "mobile_ui_safe_zones"]) {
      const zones = list(c?.[field]);
      if (
        zones.length !== 4 ||
        ["left", "right", "top", "bottom"].some(
          (side) => !zones.some((z) => z?.side === side),
        )
      )
        err("MISSING_UI_SAFE_ZONES", s.product_code + ":" + field);
      for (const z of zones) {
        if (
          !object(z) ||
          !nonblank(z.purpose) ||
          !Array.isArray(z.rect) ||
          z.rect.length !== 4 ||
          z.rect.some((n) => !Number.isFinite(n) || n < 0 || n > 1) ||
          z.rect[2] <= z.rect[0] ||
          z.rect[3] <= z.rect[1]
        )
          err("INVALID_SAFE_ZONE", s.product_code);
      }
    }
    if (
      c?.mobile_strategy === "MOBILE_CROP_OK" &&
      s.review?.mobile_crop_evidence?.status !== "PASS"
    )
      err("UNPROVEN_MOBILE_CROP", s.product_code);
    if (!legal.includes(s.review?.legal_brand_review))
      err("MISSING_LEGAL_BRAND_REVIEW", s.product_code);
    if (
      s.review?.legal_brand_review === "BRAND_USE_APPROVED" &&
      !nonblank(s.review?.legal_approval_evidence)
    )
      err("UNPROVEN_LEGAL_APPROVAL", s.product_code);
    if (
      s.review?.visual_status !== "SPEC_ONLY" ||
      s.review?.runtime_mapping_status !== "RUNTIME_MAPPING_REQUIRED"
    )
      err("UNPROVEN_VISUAL_RUNTIME_ACCEPTANCE", s.product_code);
    if (
      !nonblank(s.review?.visual_status) ||
      !nonblank(s.review?.runtime_mapping_status) ||
      !strings(s.review?.notes)
    )
      err("MISSING_REVIEW_STATUS", s.product_code);
    if (
      s.current_scene_status === "APPROVED_EXISTING_PRODUCT_MASTER" &&
      (!nonblank(s.review?.product_approval_evidence) ||
        s.review?.visual_status !== "PASS")
    )
      err("UNPROVEN_PRODUCT_MASTER_APPROVAL", s.product_code);
    const r = s.runtime_binding;
    if (
      r?.timerAdvancesValue !== false ||
      r?.camera !== "FIXED_CAMERA" ||
      r?.motion !== "LOCAL_MOTION_ONLY" ||
      !nonblank(r?.reduced_motion) ||
      !nonblank(r?.offscreen) ||
      !nonblank(r?.low_power)
    )
      err("UNSAFE_RUNTIME_BOUNDARY", s.product_code);
    if (
      s.generation?.status !== "PREPRODUCTION_CATALOG_GATE_REQUIRED" ||
      !nonblank(s.generation?.reason)
    )
      err("INVALID_GENERATION_STATUS", s.product_code);
    if (
      !object(s.generation) ||
      !Array.isArray(s.generation.prompt_ids) ||
      !s.generation.prompt_ids.includes(s.generation.prompt_id) ||
      typeof s.generation.desktop_master_required !== "boolean" ||
      typeof s.generation.mobile_master_required !== "boolean" ||
      typeof s.generation.regen_required !== "boolean"
    )
      err("INVALID_GENERATION_PLAN", s.product_code);
    for (const target of ["DESKTOP_MASTER", "MOBILE_MASTER"]) {
      const found = prompts.filter(
        (q) => q.product_id === s.product_id && q.target === target,
      );
      if (found.length !== 1)
        err(
          "MISSING_OR_DUPLICATE_GENERATION_PROMPT",
          s.product_code + ":" + target,
        );
      if (
        found.some((q) => !list(s.generation?.prompt_ids).includes(q.prompt_id))
      )
        err("PROMPT_REFERENCE_MISMATCH", s.product_code);
    }
    for (const id of list(s.generation?.prompt_ids))
      if (
        !prompts.some(
          (q) => q.prompt_id === id && q.product_id === s.product_id,
        )
      )
        err("DANGLING_PROMPT_REFERENCE", id);
  }
  for (const q of prompts) {
    if (!catalog.has(q.product_id) || !scene.has(q.product_id))
      err("NONEXISTENT_PROMPT_PRODUCT_ID", q.prompt_id);
    const s = scene.get(q.product_id);
    if (
      q.product_name !== s?.display_name_ko ||
      q.product_code !== s?.product_code
    )
      err("PROMPT_PRODUCT_MISMATCH", q.prompt_id);
    if (
      !["DESKTOP_MASTER", "MOBILE_MASTER"].includes(q.target) ||
      q.aspect_ratio !== (q.target === "DESKTOP_MASTER" ? "16:9" : "9:16")
    )
      err("INVALID_PROMPT_TARGET", q.prompt_id);
    for (const field of [
      "positive_prompt",
      "composition_notes",
      "lighting_notes",
      "approval_status",
    ])
      if (!nonblank(q[field]))
        err("MISSING_PROMPT_FIELD", q.prompt_id + ":" + field);
    for (const field of [
      "negative_requirements",
      "material_notes",
      "regeneration_reasons",
    ])
      if (!strings(q[field]))
        err("MISSING_PROMPT_FIELD", q.prompt_id + ":" + field);
    if (s) {
      const device = q.target === "DESKTOP_MASTER" ? "desktop" : "mobile";
      if (
        JSON.stringify(q.focal_point?.hero) !==
          JSON.stringify(s.composition?.focal_point?.[device]) ||
        JSON.stringify(q.focal_point?.extraction) !==
          JSON.stringify(s.composition?.extraction_target?.[device]) ||
        JSON.stringify(q.ui_safe_zone_notes) !==
          JSON.stringify(s.composition?.[device + "_ui_safe_zones"])
      )
        err("PROMPT_COMPOSITION_MISMATCH", q.prompt_id);
    }
    if (!point(q.focal_point?.hero) || !point(q.focal_point?.extraction))
      err("INVALID_PROMPT_FOCAL_POINT", q.prompt_id);
    if (
      !Array.isArray(q.ui_safe_zone_notes) ||
      q.ui_safe_zone_notes.length !== 4
    )
      err("MISSING_PROMPT_SAFE_ZONES", q.prompt_id);
    if (
      q.runtime_motion_notes?.camera !== "FIXED_CAMERA" ||
      q.runtime_motion_notes?.motion !== "LOCAL_MOTION_ONLY"
    )
      err("UNSAFE_PROMPT_MOTION", q.prompt_id);
    if (
      q.approval_status !==
      "DRAFT_CREATIVE_BRIEF_NOT_VISUAL_OR_CATALOG_APPROVAL"
    )
      err("UNPROVEN_PROMPT_APPROVAL", q.prompt_id);
    const text =
      String(q.positive_prompt ?? "") +
      " " +
      String(q.composition_notes ?? "") +
      " " +
      String(q.lighting_notes ?? "") +
      " " +
      list(q.material_notes).join(" ");
    if (
      /\d+(?:[,.]\d+)*\s*(?:KRW|USDT|원|달러|%|배|x\b|×)|(?:yield|APR|APY|reward|bonus|return|수익률|보너스|보상)\s*(?:of|is|=|:)?\s*\d|(?:guaranteed|guarantees|보장|확정)\s+(?:earnings?|returns?|rewards?|수익|보상)/i.test(
        text,
      )
    )
      err("FORBIDDEN_FINANCIAL_CLAIM", q.prompt_id);
    const negative = list(q.negative_requirements).join(" ").toLowerCase();
    if (
      ![
        "text",
        "logos",
        "ui",
        "balances",
        "earnings",
        "yield",
        "apr",
        "guaranteed rewards",
        "2d",
        "cartoon",
        "camera",
      ].every((t) => negative.includes(t))
    )
      err("MISSING_REQUIRED_NEGATIVES", q.prompt_id);
    if (s?.product_visual_profile)
      for (const field of [
        "environment",
        "hero_object",
        "lighting",
        "extraction_target",
      ])
        if (
          !String(q.positive_prompt).includes(s.product_visual_profile[field])
        )
          err("PROMPT_PROFILE_MISMATCH", q.prompt_id + ":" + field);
  }
  for (let i = 0; i < scenes.length; i++)
    for (let j = i + 1; j < scenes.length; j++) {
      const a = scenes[i].product_visual_profile,
        b = scenes[j].product_visual_profile;
      for (const field of [
        "visual_story",
        "environment",
        "hero_object",
        "lighting",
        "energy_flow",
        "extraction_target",
      ])
        if (
          nonblank(a?.[field]) &&
          normalized(a[field], rows) === normalized(b?.[field], rows)
        )
          err(
            "GENERIC_PROFILE_REUSE",
            scenes[i].product_code + "/" + scenes[j].product_code + ":" + field,
          );
    }
  for (let i = 0; i < prompts.length; i++)
    for (let j = i + 1; j < prompts.length; j++)
      if (
        prompts[i].product_id !== prompts[j].product_id &&
        prompts[i].target === prompts[j].target
      ) {
        const a = normalized(prompts[i].positive_prompt, rows),
          b = normalized(prompts[j].positive_prompt, rows);
        if (a === b || similarity(a, b) > 0.92)
          err(
            "GENERIC_PROMPT_REUSE",
            prompts[i].prompt_id + "/" + prompts[j].prompt_id,
          );
      }
  if (
    manifest.financial_boundary?.micro_krw_per_krw !== "1000000" ||
    manifest.financial_boundary?.authority !== "SERVER_LEDGER_SETTLEMENT" ||
    manifest.financial_boundary?.session_label !== "이번 세션 채굴액" ||
    manifest.financial_boundary?.session_hint !== "실시간 계산 중 · 정산 전"
  )
    err("INVALID_FINANCIAL_TRUTH_BOUNDARY");
  const counts = {
    audited: rows.length,
    repository_member_visible: rows.filter((p) => p.member_visible).length,
    live_member_visible: "UNKNOWN",
    US_STOCK: rows.filter((p) => p.asset_class === "US_STOCK").length,
    KR_STOCK: rows.filter((p) => p.asset_class === "KR_STOCK").length,
    ETF: rows.filter((p) => p.asset_class === "ETF").length,
    CRYPTO: rows.filter((p) => p.asset_class === "CRYPTO").length,
    PRECIOUS_OTHER: rows.filter(
      (p) => !["US_STOCK", "KR_STOCK", "ETF", "CRYPTO"].includes(p.asset_class),
    ).length,
  };
  if (JSON.stringify(inv.counts) !== JSON.stringify(counts))
    err("INVENTORY_COUNTS_MISMATCH");
  return errors;
}
export function verifySourceMap(map) {
  const errors = [];
  for (const item of list(map?.files)) {
    try {
      if (sha256(item.file) !== item.sha256)
        errors.push({ code: "SOURCE_HASH_DRIFT", detail: item.file });
    } catch {
      errors.push({ code: "SOURCE_FILE_MISSING", detail: item.file });
    }
  }
  if (!list(map?.files).length) errors.push({ code: "SOURCE_MAP_EMPTY" });
  return errors;
}
export function statistics(data) {
  const m = data.manifest.products,
    p = data.promptPack.prompts;
  return {
    audited: data.inventory.products.length,
    repository_member_visible: data.inventory.counts.repository_member_visible,
    live_member_visible: "UNKNOWN",
    ...Object.fromEntries(
      ["US_STOCK", "KR_STOCK", "ETF", "CRYPTO", "PRECIOUS_OTHER"].map((k) => [
        k,
        data.inventory.counts[k],
      ]),
    ),
    approved_product_specific_masters: m.filter(
      (s) => s.current_scene_status === "APPROVED_EXISTING_PRODUCT_MASTER",
    ).length,
    family_only: m.filter(
      (s) => s.current_scene_status === "FAMILY_MASTER_ONLY",
    ).length,
    new_product_master_required: m.filter(
      (s) => s.generation.desktop_master_required,
    ).length,
    regeneration_required: m.filter((s) => s.generation.regen_required).length,
    mobile_master_required: m.filter((s) => s.generation.mobile_master_required)
      .length,
    legal_review_required: m.filter(
      (s) => s.review.legal_brand_review !== "BRAND_USE_APPROVED",
    ).length,
    catalog_unknown: m.filter((s) =>
      s.status_tags.includes("CATALOG_TRUTH_UNRESOLVED"),
    ).length,
    current_family_unassigned: m.filter((s) => s.current_scene_family === null)
      .length,
    runtime_mapping_required: m.filter(
      (s) => s.review.runtime_mapping_status === "RUNTIME_MAPPING_REQUIRED",
    ).length,
    desktop_prompts: p.filter((q) => q.target === "DESKTOP_MASTER").length,
    mobile_prompts: p.filter((q) => q.target === "MOBILE_MASTER").length,
    prompt_count: p.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const data = loadPackage();
    const sourceMap = JSON.parse(
      read("scene-production/evidence/catalog-source-map.json"),
    );
    const errors = [...validatePackage(data), ...verifySourceMap(sourceMap)];
    const files = [
      "product-catalog-inventory.json",
      "product-scene-manifest.json",
      "scene-generation-prompts.json",
      "visual-profiles.json",
    ];
    const report = {
      status: errors.length ? "FAIL" : "PASS_SPEC_ONLY",
      checked_at: new Date().toISOString(),
      node: process.version,
      base_sha: data.inventory.base_sha,
      checks:
        "JSON shape, source identity/hash, coverage, statuses, prompts, generic reuse heuristic, financial claims, composition, runtime and approval boundaries",
      counts: statistics(data),
      artifact_hashes: files.map((file) => ({
        file,
        sha256: createHash("sha256")
          .update(readFileSync(root + "scene-production/" + file))
          .digest("hex"),
      })),
      errors,
      not_validated: [
        "Live published catalog",
        "Actual generation/visual/legal acceptance",
        "Browser/runtime/backend/production readiness",
      ],
    };
    if (process.argv.includes("--write-evidence"))
      writeFileSync(
        root + "scene-production/evidence/validation.json",
        JSON.stringify(report, null, 2) + "\n",
      );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error("FAIL", error.message);
    process.exitCode = 1;
  }
}
