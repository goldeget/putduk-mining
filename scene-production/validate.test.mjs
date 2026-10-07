import test from "node:test";
import assert from "node:assert/strict";
import { loadPackage, validatePackage, verifySourceMap } from "./validate.mjs";
import { read } from "./source-contract.mjs";
const original = loadPackage();
const reject = (name, code, mutate) =>
  test(name, () => {
    const data = structuredClone(original);
    mutate(data);
    const errors = validatePackage(data);
    assert.ok(
      errors.some((e) => e.code === code),
      JSON.stringify(errors),
    );
  });
test("actual complete draft package validates without granting publication or image approval", () => {
  assert.deepEqual(validatePackage(original), []);
  assert.equal(original.inventory.counts.live_member_visible, "UNKNOWN");
  assert.equal(original.promptPack.generation_has_run, false);
});
reject(
  "duplicate seed UUID cannot create ambiguous product identity",
  "DUPLICATE_OR_INVALID_PRODUCT_ID",
  (d) => d.inventory.products.push(structuredClone(d.inventory.products[0])),
);
reject(
  "duplicate canonical slug is rejected",
  "DUPLICATE_OR_INVALID_SLUG",
  (d) => (d.manifest.products[1].slug = d.manifest.products[0].slug),
);
reject(
  "duplicate prompt identifier is rejected",
  "DUPLICATE_OR_INVALID_PROMPT_ID",
  (d) =>
    (d.promptPack.prompts[1].prompt_id = d.promptPack.prompts[0].prompt_id),
);
reject(
  "removing a row from inventory and manifest together cannot hide source coverage loss",
  "SOURCE_CATALOG_COVERAGE_MISMATCH",
  (d) => {
    d.inventory.products.pop();
    d.manifest.products.pop();
    d.promptPack.prompts.splice(-2);
  },
);
reject(
  "member-visible item without manifest is caught even when catalog approval is also invalid",
  "MISSING_MEMBER_VISIBLE_MANIFEST",
  (d) => {
    d.inventory.products[0].member_visible = true;
    d.manifest.products.shift();
  },
);
reject(
  "unknown live catalog must not be silently declared published",
  "UNPROVEN_CATALOG_APPROVAL",
  (d) => {
    d.inventory.products[0].catalog_status = "PUBLISHED";
    d.inventory.products[0].live_member_visible = true;
  },
);
reject(
  "missing exact catalog source is rejected",
  "MISSING_OR_INVALID_CATALOG_SOURCE",
  (d) => delete d.inventory.products[0].catalog_source,
);
reject(
  "name changed from canonical SQL record is rejected",
  "CANONICAL_FIELD_MISMATCH",
  (d) => (d.inventory.products[0].display_name_ko = "테슬라 테마"),
);
reject(
  "invented production product ID is rejected",
  "NONEXISTENT_SCENE_PRODUCT_ID",
  (d) =>
    (d.manifest.products[0].product_id =
      "30000000-0000-4000-8000-000000009999"),
);
reject(
  "prompt for a nonexistent product is rejected",
  "NONEXISTENT_PROMPT_PRODUCT_ID",
  (d) => (d.promptPack.prompts[0].product_id = "made-up-product"),
);
reject(
  "missing scene family cannot pass as generic stock art",
  "MISSING_OR_INVALID_SCENE_FAMILY",
  (d) => delete d.manifest.products[0].scene_family,
);
reject(
  "blank visual story is rejected",
  "MISSING_VISUAL_STORY",
  (d) => (d.manifest.products[0].product_visual_profile.visual_story = "  "),
);
reject(
  "blank hero is rejected",
  "MISSING_HERO_OBJECT",
  (d) => (d.manifest.products[0].product_visual_profile.hero_object = ""),
);
reject(
  "missing desktop prompt is rejected",
  "MISSING_OR_DUPLICATE_GENERATION_PROMPT",
  (d) => d.promptPack.prompts.shift(),
);
reject(
  "arbitrary scene status does not become approval",
  "INVALID_SCENE_STATUS",
  (d) => (d.manifest.products[0].current_scene_status = "PROBABLY_FINE"),
);
reject(
  "missing UNKNOWN state cannot permit inferred running",
  "MISSING_RUNTIME_STATE",
  (d) => delete d.manifest.products[0].runtime_visual_states.UNKNOWN,
);
reject(
  "missing desktop composition is rejected",
  "INVALID_DESKTOP_COMPOSITION",
  (d) => delete d.manifest.products[0].composition.desktop_master_ratio,
);
reject(
  "missing mobile strategy is rejected",
  "INVALID_MOBILE_STRATEGY",
  (d) => delete d.manifest.products[0].composition.mobile_strategy,
);
reject(
  "untested landscape center crop cannot be called accepted",
  "UNPROVEN_MOBILE_CROP",
  (d) =>
    (d.manifest.products[0].composition.mobile_strategy = "MOBILE_CROP_OK"),
);
reject(
  "missing brand review is rejected",
  "MISSING_LEGAL_BRAND_REVIEW",
  (d) => delete d.manifest.products[0].review.legal_brand_review,
);
reject(
  "self-approved trademark without evidence is rejected",
  "UNPROVEN_LEGAL_APPROVAL",
  (d) =>
    (d.manifest.products[0].review.legal_brand_review = "BRAND_USE_APPROVED"),
);
reject(
  "family art cannot be self-promoted to accepted product master",
  "UNPROVEN_PRODUCT_MASTER_APPROVAL",
  (d) =>
    (d.manifest.products[1].current_scene_status =
      "APPROVED_EXISTING_PRODUCT_MASTER"),
);
reject(
  "name-only reused scene story is rejected",
  "GENERIC_PROFILE_REUSE",
  (d) =>
    (d.manifest.products[2].product_visual_profile.environment =
      d.manifest.products[3].product_visual_profile.environment),
);
reject(
  "copied prompt with renamed product is rejected",
  "GENERIC_PROMPT_REUSE",
  (d) =>
    (d.promptPack.prompts[4].positive_prompt =
      d.promptPack.prompts[6].positive_prompt
        .replaceAll("Microsoft Theme", "Apple Theme")
        .replaceAll("MSFT", "AAPL")),
);
for (const claim of [
  "Show guaranteed earnings",
  "APR 19%",
  "yield: 3.5%",
  "Display 5000 KRW balance",
  "Give bonus 700 USDT",
  "Add 4x speed",
  "보상 900원",
  "수익률 8%",
])
  reject(
    "forbidden generated financial claim: " + claim,
    "FORBIDDEN_FINANCIAL_CLAIM",
    (d) => (d.promptPack.prompts[0].positive_prompt += " " + claim),
  );
reject(
  "safe zones must include all four actual directions",
  "MISSING_UI_SAFE_ZONES",
  (d) => d.manifest.products[0].composition.mobile_ui_safe_zones.pop(),
);
reject(
  "safe rectangle cannot leave normalized image bounds",
  "INVALID_SAFE_ZONE",
  (d) =>
    (d.manifest.products[0].composition.desktop_ui_safe_zones[0].rect[0] = -1),
);
reject(
  "timer may never advance member money",
  "UNSAFE_RUNTIME_BOUNDARY",
  (d) => (d.manifest.products[0].runtime_binding.timerAdvancesValue = true),
);
reject(
  "camera sway cannot be requested as local motion",
  "UNSAFE_PROMPT_MOTION",
  (d) =>
    (d.promptPack.prompts[0].runtime_motion_notes.camera = "CONTINUOUS_ZOOM"),
);
reject(
  "stale dangling prompt IDs are rejected",
  "DANGLING_PROMPT_REFERENCE",
  (d) => d.manifest.products[0].generation.prompt_ids.push("not-generated"),
);
reject(
  "removed money/UI prohibitions are rejected",
  "MISSING_REQUIRED_NEGATIVES",
  (d) => (d.promptPack.prompts[0].negative_requirements = ["No watermarks"]),
);
reject(
  "source counts cannot silently exaggerate launched products",
  "INVENTORY_COUNTS_MISMATCH",
  (d) => (d.inventory.counts.repository_member_visible = 11),
);
reject(
  "malformed JSON object fields fail with diagnostic rather than crashing",
  "INVALID_CONTAINER",
  (d) => (d.manifest.products = [null]),
);
reject(
  "prompt and manifest geometry/story mismatch is rejected",
  "PROMPT_PROFILE_MISMATCH",
  (d) =>
    (d.promptPack.prompts[0].positive_prompt =
      "Generate a generic mining room."),
);
reject(
  "currency scaling is a contract, not an arbitrary multiplier",
  "INVALID_FINANCIAL_TRUTH_BOUNDARY",
  (d) => (d.manifest.financial_boundary.micro_krw_per_krw = "999"),
);
reject(
  "revision metadata across files cannot drift",
  "BASE_SHA_MISMATCH",
  (d) => (d.manifest.base_sha = "1".repeat(40)),
);
test("source fingerprint drift forces a new catalog and scene audit", () => {
  const map = JSON.parse(
    read("scene-production/evidence/catalog-source-map.json"),
  );
  map.files[0].sha256 = "0".repeat(64);
  assert.ok(verifySourceMap(map).some((e) => e.code === "SOURCE_HASH_DRIFT"));
});

reject(
  "unrun generation cannot be marked completed",
  "UNPROVEN_GENERATION_OR_CATALOG",
  (d) => (d.promptPack.generation_has_run = true),
);
reject(
  "draft metadata must not be marked publishable",
  "UNPROVEN_MANIFEST_PUBLICATION",
  (d) => (d.manifest.products[0].metadata.publishable = true),
);
reject(
  "SPEC_ONLY cannot be marked visual PASS without actual images",
  "UNPROVEN_VISUAL_RUNTIME_ACCEPTANCE",
  (d) => (d.manifest.products[0].review.visual_status = "PASS"),
);
reject(
  "generation status must preserve approval gate",
  "INVALID_GENERATION_STATUS",
  (d) => delete d.manifest.products[0].generation.status,
);
reject(
  "prompt focal geometry must match the intended device composition",
  "PROMPT_COMPOSITION_MISMATCH",
  (d) => (d.promptPack.prompts[0].focal_point.hero.x = 0.1),
);
