# Workers

The `workers/` directory holds approved background adapters. It is not a signal
that Cloudflare Queues or additional Cloudflare Workers should be created.

## V1 runner

- Entrypoint: `workers/runner.mjs`
- Uses existing SQL commands: `claim_outbox_events`, `complete_outbox_event`,
  `fail_outbox_event`, `claim_system_jobs`, `complete_system_job`,
  `fail_system_job`, `run_financial_reconciliation`
- Testable cycle exports: `runWorkerCycle`, `processOutboxBatch`,
  `processJobBatch`
- Bounded run: `node workers/runner.mjs --once` or `PUTDUK_WORKER_ONCE=1`
- Unsupported outbox/job types call `fail_*` and are never silently completed
- Reconciliation records mismatches and does **not** auto-repair
- The browser is never the runner
- `SAFE_MODE_CHANGED.v1` has an internal audit acknowledgement handler. Existing
  `complete_outbox_event` verifies the immutable original command and commits one
  `event_consumer_deliveries` receipt in its completion transaction. Replay keeps
  that receipt and never reapplies past control state. This is a candidate pending
  DB and full CI evidence; it does not deliver member notifications or Web Push.

Stdout heartbeats are operational logs only. Durable lease ownership is
`claim_*`, `extend_*_lease`, `complete_*`, and `fail_*`. Operator replay is
`replay_outbox_event` and `replay_system_job` (audited, no direct table update).

Unsupported outbox types and an incompatible `SAFE_MODE_CHANGED.v1` envelope
are permanent. `fail_outbox_event` stores `DEAD_LETTER` on that attempt.
`fail_system_job` does the same when `p_error_class` is `PERMANENT`.
Other failures keep capped exponential backoff. The delay adds jitter, stays
at least the base delay, and never exceeds 3600 seconds.

`FINANCIAL_RECONCILIATION` sends the job id as `p_request_id`. The same
request returns the existing succeeded run and does not record a second run.
The checker still does not repair money.

Still missing:

- member notification fanout commands and other domain consumers

Periodic lease renewal exists in the runner and has its own runtime evidence
tests. No new infrastructure is provisioned by these adapters.

```bash
node --env-file-if-exists=.env.local workers/runner.mjs
node --env-file-if-exists=.env.local workers/runner.mjs --once
```

Required env:

- `NEXT_PUBLIC_SUPABASE_URL` (local `http://127.0.0.1:…` for tests)
- `SUPABASE_SECRET_KEY`
- optional `PUTDUK_WORKER_ID`
- optional `PUTDUK_WORKER_ONCE`
