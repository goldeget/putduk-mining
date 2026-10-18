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
