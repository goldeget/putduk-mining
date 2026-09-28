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

Stdout heartbeats are operational logs only. Durable lease ownership is
`claim_*`, `extend_*_lease`, `complete_*`, and `fail_*`. Operator replay is
`replay_outbox_event` and `replay_system_job` (audited, no direct table update).

Still missing:

- a timer that extends a lease again while one handler runs longer than the lease
- permanent unsupported reject (today exhausts attempts into `DEAD_LETTER`)
- outbox delivery / notification fanout commands

```bash
node --env-file-if-exists=.env.local workers/runner.mjs
node --env-file-if-exists=.env.local workers/runner.mjs --once
```

Required env:

- `NEXT_PUBLIC_SUPABASE_URL` (local `http://127.0.0.1:…` for tests)
- `SUPABASE_SECRET_KEY`
- optional `PUTDUK_WORKER_ID`
- optional `PUTDUK_WORKER_ONCE`
