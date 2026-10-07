import { writeFileSync, readFileSync } from 'node:fs';
import { sourceProducts, sourceFamilies, seedFile, read, root, sha256 } from './source-contract.mjs';
const write=(name,data)=>writeFileSync(root+'scene-production/'+name,JSON.stringify(data,null,2)+'\n');
const base='0a7e95ba8bf55539fe32fd6f4654ee49a0be226d';
const master='docs/design/generated-masters/semiconductor-memory-v3-clean-2026-10-03/semiconductor-memory-v3-clean-master-v1.png';
const products=sourceProducts().map(p=>({...p,
  id_scope:'REPOSITORY_DRAFT_SEED_UUID_NOT_LIVE_DB_ID_PROOF',
  market:p.world==='KOREA'?'KR':p.world==='USA'?'US':'UNKNOWN',
  ticker:p.product_code,ticker_scope:'CATALOG_CODE_ONLY_NOT_INDEPENDENT_EXCHANGE_VERIFICATION',sector:'UNKNOWN',
  catalog_version_id:'20000000-0000-4000-8000-000000000001',catalog_status:'DRAFT',
  member_visible:false,visibility_scope:'REPOSITORY_DEFAULT_SEED',live_member_visible:'UNKNOWN',enabled:'UNKNOWN',public_status:'NOT_PUBLISHED_IN_SEED',availability:'NO_SEEDED_AVAILABILITY',
  route:'/products',product_detail_route:null,mining_route:'/mining',
  current_scene_family:p.product_code==='000660'?'SEMICONDUCTOR_MEMORY':null,
  current_scene_master:p.product_code==='000660'?master:null,
  current_asset_path:p.product_code==='000660'?'/brand/scenes/semiconductor-memory/semiconductor-memory-1539-v1.webp':null,
  visual_approval:p.product_code==='000660'?'APPROVED_FAMILY_MASTER_PRODUCT_QA_PENDING':'NO_PRODUCT_MASTER',
  current_scene_status:p.product_code==='000660'?'FAMILY_MASTER_ONLY':'PRODUCT_MASTER_REQUIRED',
  catalog_source:{file:seedFile,symbol_or_record:'proposal code '+p.product_code,line:p.source_line,verified:true,verification_scope:'REPOSITORY_RECORD_NOT_OPERATOR_APPROVAL'},
  sources:[seedFile,'lib/mining-scene/product-presentation.ts','lib/product/published-catalog.ts','domain/products/published-catalog.ts','app/(product)/products/page.tsx'],
  unresolved_fields:['live DB UUID/version/publication/availability/member eligibility','market exchange and sector metadata absent from catalog schema','brand/legal clearance','launch priority approval','member product selection and snapshot product binding','product-specific visual acceptance']
}));
write('product-catalog-inventory.json',{
 schema_version:1,base_sha:base,observed_at:new Date().toISOString(),source_scope:'REPOSITORY_DEFAULT_NOT_REMOTE_DATABASE',
 counts:{audited:products.length,repository_member_visible:0,live_member_visible:'UNKNOWN',US_STOCK:3,KR_STOCK:2,ETF:0,CRYPTO:4,PRECIOUS_OTHER:2},
 excluded:[{identity:'TEST_THEME / OTHER',source:'tests/unit/published-catalog.test.ts',reason:'Synthetic validation fixtures; not catalog products'},{identity:'TSLA / Tesla',source:'user quality direction only',reason:'Absent from actual catalog; no production record or prompt'},{identity:'ETF',source:'lib/mining-scene/types.ts',reason:'Family exists but category and catalog product do not'}],products
});
const manifest=JSON.parse(read('public/brand/assets.manifest.json'));
const assets=manifest.assets.filter(a=>a.path.includes('/scenes/semiconductor-memory/'));
write('evidence/scene-registry-audit.json',{
 base_sha:base,scope:'READ_ONLY_SOURCE_AUDIT',family_count:sourceFamilies().length,approved_family_count:1,pending_family_count:13,
 approved_product_specific_master_count:0,approval_scope:'Family/default backdrop only; no product-complete acceptance',
 families:sourceFamilies().map(f=>({key:f,source:'lib/mining-scene/scene-registry.ts',current_status:f==='SEMICONDUCTOR_MEMORY'?'APPROVED':'VISUAL_MASTER_REQUIRED',master:f==='SEMICONDUCTOR_MEMORY'?{path:master,sha256:sha256(master),width:1539,height:1022}:null,asset_allowlist:f==='SEMICONDUCTOR_MEMORY'?assets:[],actual_product_mappings:f==='SEMICONDUCTOR_MEMORY'?[products[1].product_id]:[],missing_products:[],missing_products_scope:'Proposed assignments belong to manifest; registry alone does not define catalog',runtime_consumers:['lib/mining-scene/resolve-scene.ts','lib/mining-scene/stage-input.ts','lib/mining-scene/default-stage.ts','components/mining-live/mining-live-stage.tsx'],economic_policy:f==='ETF_BASKET'?'DECISION_REQUIRED':'NONE'})),
 runtime_audit:{route:'/mining',source:'app/(product)/mining/page.tsx',input:'resolveDefaultStageInput() has no selected-product parameter',server_gate:'isConfirmedMiningRunning permits NORMAL or REDUCED only',renderer:'canvas-2d over approved static art',fps:30,dpr:1.5,max_particles:12,max_dimension:2048,max_pixels:1572864,degraded_fps:15,degraded_particles:4,degraded_dpr:1,low_power:'saveData or hardwareConcurrency <= 2; expensive/delayed frames degrade',visibility:'IntersectionObserver + document.hidden; scroll fallback',reduced_motion:'matchMedia stops RAF; static master retained',anchor:{x:0.5,y:0.235},extraction_target:{x:0.5,y:0.695},extraction_target_consumed:false,timerAdvancesValue:false,particle_behavior:'bounded light motes around cover-projected anchor; no extraction path or money events',actual_product_binding:'ABSENT_ON_MEMBER_MINING_ROUTE',scope:'Source behavior inspected; no browser/device/runtime QA executed'}
});
const files=[seedFile,'supabase/migrations/20260926192203_ws02_foundation_schema.sql','supabase/seed/000_no_production_rules.sql','lib/product/published-catalog.ts','domain/products/published-catalog.ts','lib/mining-scene/types.ts','lib/mining-scene/scene-registry.ts','lib/mining-scene/product-presentation.ts','lib/mining-scene/resolve-scene.ts','lib/mining-scene/stage-input.ts','lib/mining-scene/default-stage.ts','lib/mining-scene/sk-hynix-v3-reference.ts','components/mining-live/mining-live-stage.tsx','components/mining-live/scene-decoration.tsx','components/mining-live/mining-live-stage.module.css','app/(product)/mining/page.tsx','app/(product)/products/page.tsx','components/product/published-catalog-view.tsx','lib/product/mining-display.ts','lib/product/mining-server-display.ts','lib/product/read-mining-server-display.ts','domain/mining/funding-entitlement.ts','domain/mining/economy-policy.ts','tests/unit/published-catalog.test.ts','tests/e2e/authenticated/products-catalog.spec.ts','tests/unit/mining-scene/scene-platform.test.ts','tests/unit/mining-scene/default-stage.test.ts','tests/unit/mining-scene/mining-live-stage.test.ts','tests/unit/mining-scene/scene-decoration-runtime.test.ts','public/brand/assets.manifest.json',master,master.replace(/[^/]+$/,'REVIEW.md'),'AGENTS.md','README.md','docs/architecture/PUTDUK-MINING-MASTER-ARCHITECTURE.md','docs/architecture/ARCHITECTURE-CLOSURE-AUDIT.md','docs/product/PUTDUK-START.md','docs/product/PRODUCT-CATALOG.md','docs/product/V1-SCOPE-PRIORITIES.md','docs/design/PUTDUK-DESIGN-SYSTEM.md','docs/design/PUTDUK-VISUAL-DIRECTION.md','docs/design/PUTDUK-BRAND-ASSET-SYSTEM.md','docs/design/PUTDUK-THEME-SYSTEM.md','docs/design/PUTDUK-MOTION-EXPERIENCE.md','docs/design/visual-lab/CANONICAL-VISUAL-BENCHMARK.md','docs/development/CONVENTIONS.md','.cursor/rules/putduk-master.mdc','.cursor/rules/putduk-e2e-agent-verification.mdc','.cursor/rules/putduk-ci-wall-clock.mdc','package.json','.node-version','pnpm-lock.yaml','.github/workflows/ci.yml'];
write('evidence/catalog-source-map.json',{
 base_sha:base,files:files.map(file=>({file,sha256:sha256(file)})),
 authoritative_candidate:'Immutable latest operator-approved published catalog + mining_products child rows; not React presentation table',
 discovery:{search:'rg mining_products/product_catalog_versions/product_code/code/slug across migrations, seeds, fixtures, read models, routes and tests',finding:'One production seed VALUES set: 11 DRAFT rows; other identifiers found only in tests. No Tesla or ETF product row.',excluded_test_examples:['TEST_THEME','OTHER'],remote_database:'NOT_READ_OR_WRITTEN'},
 visual_inspection:{file:master,sha256:sha256(master),method:'view_image direct master inspection',finding:'Floating HBM stack, left wafer, right processing towers, lower extraction ring; reflective black metal and amber/blue depth. 1539x1022 is not 16:9; no mobile crop acceptance inferred.',tesla_reference:'UNAVAILABLE_IN_REPOSITORY; user supplied direction only',sk_hynix_prototype:'REFERENCE_APPROVED / NOT_PRODUCTION_APPROVED, see sk-hynix-v3-reference.ts; not reused as runtime master'},
 freeze:{'parallel/admin-release':'f9b454a7c1b86dde1099b6e5a264092118258ead','parallel/launch-ops-content':'ba9ed931f756488ce4f67f945cffad9552842c09'}
});
console.log(JSON.stringify({products:products.length,families:sourceFamilies().length,scene_assets:assets.length,source_files:files.length}));
