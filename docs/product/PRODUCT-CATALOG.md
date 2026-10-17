# AI-Assisted Mining Product Catalog

Status: **P0 CATALOG FOUNDATION / OPERATOR APPROVAL REQUIRED**

Mining products are PUTDUK virtual themes. They are not securities, investment
products or live-market replicas, and no external market price drives rewards.

## Owner product-access correction — 2026-10-07

Apply [the Owner correction](OWNER-PRODUCT-TIER-POLICY-2026-10-07.md) before
catalog, Product or Mining UI changes. Funding Tier does not unlock products:
every eligible member, including L1, can select any actually published/available
product within their approved concurrent slot count. Availability and account
eligibility are separate from Tier economics. Never add product minimum-Tier
requirements or funding-based product-lock copy.

Tier scales principal-based mining, GLOBAL_CYCLE capacity/entitlement and slots;
Product supplies identity/experience and explicitly approved speed modifiers.
The current catalog proposal's 1.00x–1.10x range is PROPOSED_NOT_APPROVED, not
published economic data. Keep neutral runtime rules until an actual rule version
is approved. Current principal-proportional base accrual already represents
mining scale; do not add a second Tier speed multiplier. Tier downgrade preserves
product access and history. Deterministic excess-slot retention/pause remains a
server implementation gate, not permission to call a product ineligible.

## Launch categories

- Korean top-tier stock themes;
- U.S. top-tier stock themes;
- Gold;
- Silver;
- top-tier crypto themes.

The registry is versioned through `product_catalog_versions`,
`mining_products`, `product_rule_versions`, `product_visuals` and
`product_availability`. React components consume published catalog data and do
not hardcode an instrument list.

## Snapshot workflow

```text
AI researches current public identifiers and category relevance
→ records source snapshot date and source references
→ produces deterministic DRAFT catalog version
→ validates unique code/slug/localized names/order/visual/rule references
→ operator reviews legal/product/brand suitability
→ operator approves and schedules
→ deterministic publish
```

The seed in this workstream establishes neutral draft structure, not an active
recommendation or an economic rule. `DRAFT` records cannot appear as published
products. A future `N+1` proposal never mutates the previously published
snapshot.

## Product fields

Code, slug, category, world, `ko-KR`/`en`/future `ja-JP` names and descriptions,
display order, featured state, lifecycle status, trial availability, visual
manifest references, economy rule reference, non-financial difficulty/reward/
risk display profile, activation/deactivation times and source snapshot.

## Runtime boundary

- No live financial-market API dependency.
- No browser-side economic formula.
- Public identifiers are descriptive only.
- All reward/difficulty/bonus behavior comes from approved PUTDUK rule versions.
- AI proposes; operators approve; deterministic code publishes.

## Selection methodology record

Each proposed catalog version stores an explanation of category coverage,
liquidity/recognition criteria, exclusions, source URLs, snapshot date and
validation digest. It must avoid language that implies an investment ranking or
expected return.
