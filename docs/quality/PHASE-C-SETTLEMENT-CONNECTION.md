# Phase C — Settlement connection inventory (SIMPLIFIED_TRACK)

Date: `2026-10-21`
Branch track: `codex/simplified-launch-track-20261021`
Authority: `docs/architecture/FINAL-OWNER-DESIRED-LAUNCH-ARCHITECTURE.md` §4
Money lock: Eligible Funding Principal × Tier × eligible server time; capacity/used ≠ app/AI usage.

## Honest verdict

| Layer | State | Notes |
| --- | --- | --- |
| Private producer | **CONNECTED (local SQL)** | `process_default_funding_job` posts earned/used/carry + balanced `MINING_REWARD` + outbox inside `complete_system_job` |
| Job seal | **CONNECTED** | `prepare_default_funding_job` seals `FUNDING_MINING_TICK_V1` at `available_at=infinity` with marker `FUNDING_ENGINE_RUNTIME_NOT_CONNECTED` (dormant original, not a missing writer) |
| Due scheduling | **CONNECTED** | `public.schedule_due_funding_jobs` releases exact dormant originals; `workers/funding-scheduler.mjs` + `runWorkerCycle` call it before claims |
| Worker claim/complete | **CONNECTED** | `prepareFundingMiningTick` validates envelope only; money stays DB-fenced; pause/scheduler failure sets `p_allow_funding: false` |
| Legacy settlement | **CLOSED** | `record_mining_settlement` service EXECUTE revoked; do not reopen |
| Product activation path | **PARTIAL** | Fresh principal + member `confirm_funding_allocation` → `apply_funding_allocation_boundary` / `activate_zero_funding_allocation`; auto-activate-on-deposit alone is not a second money path |
| App-closed continuous accrual proof | **NOT PRODUCT-PROVEN** | Unit/worker orchestration + SQL pgTAP exist; kept-surface PRODUCT COMPLETE + release `ci-full-e2e` still required |
| Remote Supabase | **HUMAN GATE** | Local migrations only in this track |

`FUNDING_ENGINE_RUNTIME_NOT_CONNECTED` on a sealed PENDING job means **not yet released by the scheduler**, not “producer missing.”

## Desired tick (unchanged)

```text
schedule_due_funding_jobs
  → claim_system_jobs (funding admitted)
  → FUNDING_MINING_TICK_V1 envelope check (JS)
  → complete_system_job → process_default_funding_job
  → earned receipt + used + carry + MINING_REWARD journal + outbox
```

## Exit criteria status (C1–C7)

| # | Criterion | This track |
| --- | --- | --- |
| C1 | Principal × Tier × time only | Formula/SQL authority present; no usage meters in formula |
| C2 | Capacity/used enforced | SQL/unit coverage; product matrix still open |
| C3 | App-closed accrual | Worker loop wired; browser-absent product proof open |
| C4 | Ledger-first + outbox same tx | Private producer contract |
| C5 | Legacy closed | Migration + permission tests |
| C6 | No WS-04 alias invention | Consume existing commands only |
| C7 | Kept mining/wallet PRODUCT | SIMPLIFIED_TRACK — not claimed here |

## Remaining human / product gates for live accrual

1. Published catalog + member allocation on qualifying principal (when funded mining is the path).
2. Local worker process kept running against project-scoped stack.
3. Remote Supabase apply (separate owner approval).
4. Focused then release-SHA E2E green for kept journeys.
5. Do not interpret 사용량 as app opens / AI tokens / Scene frames.

## Explicit non-claims

- Not PRODUCT COMPLETE.
- Not launch-ready.
- No second ledger, float rewards, or client-determined amounts.
- No remote DB mutation from this document.
