# Catalog server contract and existing UI boundary

The authenticated read-only `GET /api/v1/products/catalog` exposes the canonical
six categories: `KR_STOCK`, `US_STOCK`, `ETF`, `GOLD`, `SILVER`, `CRYPTO`.
The administrator review parser uses the same closed set. This contract adds no
products, economic values, approval commands or publication authorization.

The server helper reuses the existing single authenticated RLS query, bounded
latest published snapshot, publication cutoff, approval evidence validation,
source validation and availability projection. It exposes no operator UUID,
rule payload, private methodology or display profile. Malformed latest data is
an error; it never falls back to an older catalog or drops individual products.
Approval digest validation here checks the stored digest's format; PostgreSQL
publication guards remain responsible for its authoritative snapshot seal.

## Original backend-first UI boundary (historical)

A loaded response retains every product and its native category. Its `legacyUi`
field is `READY` for the current five categories, or `UI_PENDING` with the
unsupported product IDs for ETF. This is an API capability diagnostic, not a
new visible screen state and not a mining eligibility or publication decision.
The existing `getPublishedCatalog`, `ProductCategory`, SSR pages and components
keep their five-category behavior. ETF is never relabeled as US stocks or crypto.

The existing `/api/v1/products/allocation` remains the only allocation writer.
It accepts product IDs and integer basis points, and independently enforces
published catalog seal, approved rules, effective windows, principal eligibility,
slots, idempotency and member identity. It does not validate a category DTO.
Consequently its current UI could list a future published ETF by name while the
legacy catalog screen rejects that mixed snapshot. ETF publication must wait for
separate UI compatibility validation and explicit operator approval; `UI_PENDING`
alone does not enforce such a gate.

The original eleven neutral DRAFT products remain unchanged. ETF identifiers,
world mapping, source snapshots and economic decisions require separately
reviewed data. Tests use synthetic objects and make no production calls.

## Member browse compatibility — 2026-10-21 local candidate

The member `ProductCategory`, published snapshot parser, catalog filters, card
labels and home labels now accept the same closed six-category set as the server.
A valid mixed ETF snapshot is retained in full, with its native category,
publication evidence, order and availability. Unknown categories, invalid
publication evidence and malformed latest snapshots remain errors. The prior
five-category behavior above records the original integration boundary.

`legacyUi.READY` now means this catalog browse decoder/display supports the native
category. It does not approve a product, publish a snapshot, authorize an
allocation or certify a mining scene. ETF catalog decoration uses the existing
neutral PUTDUK brand mark and does not borrow a stock or crypto illustration.

The ETF mining-scene boundary remains separate: `ETF_BASKET` is
`DECISION_REQUIRED`, and selected ETF identities without a reviewed scene remain
truthfully unavailable in that presentation. Other class scenes and allocation
rules are unchanged. No ETF code, world, asset, seed, economics or publication was
added by this compatibility change. Runtime/browser acceptance and operator
publication approval remain separate evidence gates.
