# PUTDUK PRODUCT-SPECIFIC CINEMATIC SCENE PRODUCTION LANE

Use /workspace/putduk-mining, the existing isolated checkout. Do not create a worktree unless the user explicitly requests one. Another $200 Primary owns Member UI/runtime/shared backend.

Freeze these branches exactly; no edit, commit, rebase, amend or merge:
- parallel/admin-release: f9b454a7c1b86dde1099b6e5a264092118258ead
- parallel/launch-ops-content: ba9ed931f756488ce4f67f945cffad9552842c09

Verify exact origin https://github.com/goldeget/putduk-mining.git before each GitHub operation. git fetch origin; explicitly fetch develop when the remote refspec is main-only. Record exact current origin/develop SHA. Never use main as implementation baseline. Before creating parallel/product-scene-production, inspect whether it exists locally/remotely, its exact HEAD and work ownership. Preserve all existing user changes, commits and stashes. Do not reset an existing feature branch to a newer develop. Re-audit source drift and coordinate with Primary.

WRITE ONLY scene-production/**. Read actual catalog/schema/read models/fixtures/routes, SceneRegistry, MiningLiveStage, SceneDecoration, approved visual assets and relevant tests. No modifications to app, components, apps/admin, domain, lib, supabase, worker, existing runtime assets, package/lockfiles or workflows. No parallel API/backend/financial rule or invented product.

Read AGENTS.md, README.md, architecture SSOT, PUTDUK START, Design System/visual/motion/asset/theme contracts, CONVENTIONS and .cursor/rules. Read scene-production/README.md, PRODUCT-CATALOG-INVENTORY.md, SCENE-RUNTIME-MAPPING.md, PRODUCTION-STATUS.md and acceptance checklist. Approved mockups/Visual Lab set visual quality; existing UI does not lower it. They never provide money or catalog truth. Use Korean-first plain language.

For every shell:
source /workspace/.putduk-cloud-tools/activate.sh
cd /workspace/putduk-mining
git status --short --branch
node --version
pnpm --version

Pinned Node 24.21.0, pnpm 12.6.0. This package uses only Node built-ins; no DB or app services are required for its validation. Existing frozen installation script, network and non-secret variables remain unchanged. Refresh repository dependencies only when actually needed, using pnpm install --frozen-lockfile; no upgrades. Current activation and Git fetch/push are verified. Browser/Supabase readiness is outside this lane and must not be inherited as PASS.

Required targeted checks:
node scene-production/validate.mjs
node --test scene-production/validate.test.mjs
pnpm exec eslint scene-production/*.mjs --max-warnings=0
pnpm exec prettier --check 'scene-production/**/*.{mjs,json}'
git diff --check
git diff --name-only origin/develop...HEAD

All changed paths must be scene-production/**. Before commit/push verify authorized origin, git fsck --full and no missing reachable objects. Make meaningful checkpoint commits and push only parallel/product-scene-production. No PR, full repository CI, production branch push/merge, deploy, remote DB write/read, publication or asset activation.

At audited base 0a7e95ba8bf55539fe32fd6f4654ee49a0be226d: 11 DRAFT catalog rows, repository-default member-visible 0, live member-visible UNKNOWN. US 3/KR 2/crypto 4/precious 2/ETF 0. Tesla is quality direction only, absent from catalog. No extra products. One approved memory family/default art pack, product-complete acceptance 0; only 000660 has current family binding; current /mining uses neutral default art without selected product identity.

The manifest and 22 desktop/mobile prompts are PREPRODUCTION SPEC_ONLY, not approved launch catalog or images. All 11 have separate product worlds, dedicated portrait strategy, brand review and runtime mapping pending. UNKNOWN != PASS. Native image generation follows as a separate phase; no placeholder assets in this lane.

SCENE IS NOT MONEY AUTHORITY. Keep mining engine/ledger/settlement/withdrawal/RLS and existing shared contracts. Server truth → live snapshot → UI state → product profile → local motion. Fixed camera; no viewport sway/zoom/parallax. Preserve static approved quality/reduced motion/low power/hidden and offscreen pausing. Images contain no copy, logos, money, yields/APR, multipliers, fake charts/UI or endorsement. Real HTML displays true integer KRW and server-confirmed session/receipt data only. No money from browser timers or AI. No invented member pause command. Require operator/brand/visual approvals separately.

Integration-ready here means the reviewable specification package, not runtime/product/production readiness. After final checks report exact branch/HEAD/base, commits, changed paths, counts, validator/rejection evidence, real image backlog, Primary requirements and unresolved approvals in the user's requested format.
