# Workers

The `workers/` directory is reserved for approved background adapters. It is not a signal that Cloudflare Queues or additional Workers should be created.

V1 rules:

- authoritative mining, settlement, wallet, and ledger logic remains server-side and PostgreSQL-backed;
- no per-second mining writes;
- no worker may maintain a shadow balance or economic rule set;
- every asset mutation is idempotent, ledger-first, and auditable;
- a worker is added only after its retry, deduplication, observability, and recovery contract is documented;
- Cloudflare resources remain unprovisioned until the gate in `docs/operations/CLOUDFLARE-INFRASTRUCTURE.md` is satisfied.
