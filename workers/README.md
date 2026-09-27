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

Stdout heartbeats are operational logs only. Durable lease ownership is proven
only through claim/complete/fail RPCs. The following commands are **missing**
and must not be invented in this worker branch (report to Agent A):

- `extend_outbox_event_lease` / `heartbeat_outbox_event_lease`
- `extend_system_job_lease` / `heartbeat_system_job_lease`
- `replay_outbox_event` / `replay_system_job`
- permanent unsupported reject (today exhausts attempts into `DEAD_LETTER`)
- outbox delivery / notification fanout commands
- **service_role DML grants** on `outbox_events`, `system_jobs`,
  `system_job_attempts`, reconciliation tables, and related worker fixtures
  (claim/complete/fail are `SECURITY INVOKER` and currently cannot touch rows)

```bash
node --env-file-if-exists=.env.local workers/runner.mjs
node --env-file-if-exists=.env.local workers/runner.mjs --once
```

Required env:

- `NEXT_PUBLIC_SUPABASE_URL` (local `http://127.0.0.1:…` for tests)
- `SUPABASE_SECRET_KEY`
- optional `PUTDUK_WORKER_ID`
- optional `PUTDUK_WORKER_ONCE`
