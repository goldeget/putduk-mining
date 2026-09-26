# AI-Assisted Mining Product Catalog

Status: **P0 CATALOG FOUNDATION / OPERATOR APPROVAL REQUIRED**

Mining products are PUTDUK virtual themes. They are not securities, investment
products or live-market replicas, and no external market price drives rewards.

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
