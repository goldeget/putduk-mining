# Workers

The `workers/` directory holds approved background adapters. It is not a signal
that Cloudflare Queues or additional Cloudflare Workers should be created.

## V1 runner

- Entrypoint: `workers/runner.mjs`
- Uses existing SQL commands: `claim_outbox_events`, `complete_outbox_event`,
  `fail_outbox_event`, `claim_system_jobs`, `complete_system_job`,
  `fail_system_job`, `run_financial_reconciliation`
- Heartbeat, exponential backoff, lease-based idempotency, and dead-letter
  transitions are enforced in Postgres
- Reconciliation records mismatches and does **not** auto-repair
- The browser is never the runner

```bash
node --env-file-if-exists=.env.local workers/runner.mjs
```

Required env:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- optional `PUTDUK_WORKER_ID`
