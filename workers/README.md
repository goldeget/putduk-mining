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
- A bounded run exits nonzero on claim, lease, handler or failure-recording
  errors, including unsupported work. An empty successful poll exits zero.
- Each cycle processes at most 25 outbox events and 10 jobs by default. It
  claims one item immediately before starting that item, so later items never
  consume waiting leases or attempts. A transient item failure returns to the
  next poll rather than draining zero-delay retries in the same cycle.
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
Each replay request binds its original target, actor and reason. Retrying that
request returns its original receipt across later states and never applies a
second replay. A subsequent failure needs a fresh reviewed request. Job replay
retains attempt history and refuses recovery once the absolute 100-attempt
budget is exhausted; it records no false recovery receipt.

Unsupported outbox types and an incompatible `SAFE_MODE_CHANGED.v1` envelope
are permanent. `fail_outbox_event` stores `DEAD_LETTER` on that attempt.
`fail_system_job` does the same when `p_error_class` is `PERMANENT`.
Other failures keep capped exponential backoff. The delay adds jitter, stays
at least the base delay, and never exceeds 3600 seconds.

`FINANCIAL_RECONCILIATION` sends the job id as `p_request_id`. The same
request returns the existing succeeded run and does not record a second run.
The checker still does not repair money.

Still missing:

- member notification/Web Push fanout and financial domain consumers, including
  referral, promotion and event reward processing;
- production job enqueueing and an approved recurring reconciliation schedule;
- the approved mining settlement command and unattended settlement runner.

These remain launch blockers. The worker does not invent handlers, payout rules
or schedules. Unsupported financial events retain their original payloads in
dead letter until an approved consumer and reviewed replay exist. See
`docs/architecture/DOMAIN-EVENTS-OUTBOX.md` and the current mining runtime gap in
`docs/architecture/PUTDUK-MINING-MASTER-ARCHITECTURE.md`.

Periodic lease renewal exists in the runner and has its own runtime evidence
tests. No new infrastructure is provisioned by these adapters.
Integration fixtures validate the exact API port and project from
`supabase/config.toml` before creating a client or SQL session; production,
staging, unrelated loopback ports and other HTTP hosts are rejected.

```bash
node --env-file-if-exists=.env.local workers/runner.mjs
node --env-file-if-exists=.env.local workers/runner.mjs --once
```

Required env:

- `NEXT_PUBLIC_SUPABASE_URL` (local `http://127.0.0.1:…` for tests)
- `SUPABASE_SECRET_KEY`
- optional `PUTDUK_WORKER_ID`
- optional `PUTDUK_WORKER_ONCE`
