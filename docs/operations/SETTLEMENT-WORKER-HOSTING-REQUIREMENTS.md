# Settlement Worker Hosting Requirements

Status: requirements only (2026-10-19). Nothing is provisioned. Read from `workers/runner.mjs`,
`workers/funding-scheduler.mjs`, `workers/README.md` and `supabase/migrations`. Hosting is an
owner decision; the Cloudflare adapter spike may use this as its input. This file does not
choose a host and does not authorize any deployment.

## What the process is

- One Node process. Entry point `workers/runner.mjs`, started as
  `node --env-file-if-exists=.env.local workers/runner.mjs`.
- It is a long-running loop: `runDurableLoop` runs `runWorkerCycle`, then sleeps `POLL_MS = 3000`.
- Bounded mode: `node workers/runner.mjs --once` or `PUTDUK_WORKER_ONCE=1` runs one cycle and
  exits 0, or throws `WORKER_ONCE_FAILED` (exit 1) when a claim, handler or failure-recording step
  failed or work was unsupported. An empty successful poll exits 0.
- It is not a Cloudflare Workers fetch handler. It uses a timer loop, `process.exit`, signal
  handlers and `node:path`. It cannot run unchanged on the Workers runtime. V1 documents reject
  Cloudflare Queues and Durable Objects for this job.

## Runtime

- Node `>=24.19.0 <25` (`package.json` engines; `.node-version` pins 24.21.0).
- Installed dependencies from the frozen lockfile (`pnpm@12.6.0`). The runner imports
  `@supabase/supabase-js` and Node built-ins. It also imports `./funding-scheduler.mjs`.
- No build step. No browser. No inbound port.

## Environment

Required (runner exits with an error when missing, see `requireEnv`):

| Variable | Meaning | Handling |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL for the project | not secret |
| `SUPABASE_SECRET_KEY` | Service-role key | highest-value secret; secret store only; never in Git or logs |

Optional:

| Variable | Meaning |
| --- | --- |
| `PUTDUK_WORKER_ID` | Stable worker id. Default is `putduk-worker-<pid>`. Use a fixed, unique id per instance so lease ownership is readable. |
| `PUTDUK_WORKER_ONCE` | `1`, `true` runs one bounded cycle. |

Not needed by the runner: `WITHDRAWAL_DATA_KEY`, `VAPID_*`, `AI_*`, `CHANNEL_TALK_*`.

## Database access

- The runner uses PostgREST RPC over HTTPS with the service role. It does not open a direct
  Postgres connection, so no pooler, port or database password is needed.
- RPCs and commands it calls: `claim_outbox_events`, `complete_outbox_event`, `fail_outbox_event`,
  `claim_system_jobs`, `complete_system_job`, `fail_system_job`, lease extension commands,
  `run_financial_reconciliation`, `schedule_due_funding_jobs`.
- Money is never computed in JavaScript. Handlers validate envelopes and the database commands
  verify originals, write balanced ledger entries and outbox events in one transaction.
- The runner requires the full 201 migration set on the target database.

## Schedule and capacity

- Continuous loop, one cycle about every 3 seconds plus handler time.
- Per cycle: funding scheduler batch 25, outbox batch up to 25 events, job batch up to 10 jobs.
  Each item is claimed immediately before it is processed.
- Stdout heartbeat every 15 seconds (`worker.heartbeat`). Other log lines: `worker.start`,
  `worker.cycle`, `worker.once.summary`. These are operational logs, not lease evidence.
- Retry delay: exponential, jittered, 5 to 3600 seconds. Permanent failures go to dead letter.
- Safe mode: the database stops the matching component (for example `SETTLEMENT`, `NEW_MINING`);
  the funding scheduler returns `paused`. A paused system is not a worker failure.
- Shutdown: `SIGINT` exits 130, `SIGTERM` exits 143 after stopping lease renewals. Unfinished
  leases expire and are reclaimed with the fenced commands.

## Instances

- Claims are leased and fenced in the database, so a restart or a second instance does not
  double-apply a command. V1 recommendation: exactly one instance with automatic restart, and a
  unique `PUTDUK_WORKER_ID`. Concurrent multi-instance behaviour is covered only by the local
  concurrency tests; it has no production evidence.

## What the owner still has to provide

1. A host that keeps a Node process alive, restarts it, and injects the two secrets.
2. Outbound HTTPS to the Supabase project only.
3. Log shipping for stdout JSON and an alert on: process exit, no `worker.heartbeat` for more than
   60 seconds, `worker.cycle` with `failed` or `unsupported` above 0, and dead-letter growth.
4. A daily owner check of `/exceptions` in admin. Reconciliation records mismatches and never
   repairs money.
5. A producer for recurring `FINANCIAL_RECONCILIATION` jobs. `workers/README.md` lists an approved
   recurring schedule as still missing. This audit found no producer in `workers/`.
6. Owner acceptance of the settlement path in staging. `workers/README.md` still lists the
   approved mining settlement runner as missing while `runner.mjs` registers
   `FUNDING_MINING_TICK_V1`. These documents disagree; staging evidence decides.

## Push worker (separate)

`workers/push-runtime.mjs` is a different process for device push delivery. It refuses to run
unless `APP_ENV` is `test` or `development`, `PUTDUK_PUSH_SEND_APPROVED=true` and the local
Supabase allowlist matches. It cannot send in production as written. It checks safe mode
(`GLOBAL`, `NOTIFICATION`) before claiming any delivery.

## Fit against hosting options (facts only)

- Cloudflare Workers or Containers: the loop must be ported or wrapped. A Workers port would be a
  new design (cron-triggered `--once` equivalent) and needs its own evidence.
- A small Node host or container: runs as is.
- A scheduler that only calls `--once`: works for correctness, but latency becomes the schedule
  interval instead of 3 seconds.
