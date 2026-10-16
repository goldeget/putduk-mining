# Local source-bound mission gaps

Only missing event/source integration is extended. Existing domain command names,
calculation, configured money values, ledger writer and idempotency remain canonical.
These are reviewed new Local implementations, not byte-identical recovered Cloud SQL.

The preceding function consistency migration retains calculations and signatures;
constant/composite initialization and variable qualification resolve PL/pgSQL lint.
Focused financial 16 and atomic transcript 21 assertions passed after that change.

| Existing exact source | Observed gap | Extension |
| --- | --- | --- |
| `process_neutral_funding_condition_job` in `20261008204927_funding_atomic_cycle_rollover.sql` | Positive earnings already create accepted receipt, balanced journal, wallet source and settlement. No `MINING_STARTED.v1` / `MINING_SETTLEMENT_COMPLETED.v1` source exists. | After the same writer succeeds, append sealed source originals and canonical outbox in the same transaction. No additional money write. |
| `settle_trial(uuid,text)` in `20260926104500_trial_settlement_command.sql` | Terminal trial already writes completion, ended session and trial ledger; no `TRIAL_COMPLETED.v1`. Existing service INSERT permits an unsealed trial delta or completion. | Preserve its body and public signature inside a closed private executor; close only raw service INSERT on the two trial tables and append terminal original/outbox before return in the same transaction. |
| Referral tables and frozen product specification | No actual payout writer or complete versioned stage qualification found. | `REFERRAL_REWARD_PAID.v1` stays unsupported. No approved payout or qualifying activity is invented. |

`MINING_STARTED` is not a first-payment timestamp. Its business clock is the actual
funded activation start; its later observation requires positive accepted earnings,
actual completion fence and balanced ledger. Activation alone, zero ticks and
pre-extension historical receipts cannot publish this source. This covers only
the existing funded engine. Settlement uses the actual accepted settlement end.
Observation and business time remain separate. Qualification rejects business
clocks before the member's join or policy approval.

Mining native 38/38 and seven-day cancellation native 28/28 passed on the isolated
iterative DB. Mission creation fault rolls back the existing monetary transaction;
retry duplicates zero originals; zero next tick produces no positive source. Actual
worker claim/closed consumer and ID-only owner validation pass. No policy means
zero awards. Cancellation preserves exact ten-day portion age, excludes seven
held days and pays only 23 eligible days at fixed cycle end, then no catch-up.

Seven-day partial recovery native 29/29 passed. Actual HOLD after ten eligible days,
seven days held and canonical FINALIZE preserve the recovered portion's ten-day
age. A synthetic local bank-send receipt supports this test; no bank API is called.
Only the remaining 170,000 KRW participates in the terminal benefit (25,500 KRW).
The next early tick pays zero; original seals, retry and atomic rollover pass.
Fixture preparation time-positions the receipt, wallet debit and source envelope
together, then restores every installed guard before the real writer executes.

Terminal trial native 30/30 passed with the real service role. The existing START
and settlement curve create their original ledger deltas; completion plus retry
create one sealed original/outbox. Source failure rolls back the terminal delta,
completion and account state. Crossed or absent JWT roles, raw service INSERT and
client invocation are rejected. The real lease/closed consumer validates the
original; without an approved rule and join it produces no award or real money.
The original 20261002103000 revokes UPDATE, not INSERT, on trial tables. An earlier
interpretation was corrected before this candidate was committed.

Current fixed-path Definer tests explicitly list all 63 reviewed signatures and
retain exact count and exclusion checks. RLS 65/65, WS-04 43/43 and reconciliation
33/33 passed. Reconciliation uses only this PostgreSQL TCP address or the exact
isolated project host supplied by the verified test runner. Socket dblink cannot
meet its non-superuser password requirement; no elevated grant was added.
Worker source preflight tests 14/14 passed. Non-trigger PL/pgSQL checks and new
mission triggers reported no errors/warnings. Whole trigger lint still reports
pre-existing table-branch inference errors; it is not a whole-schema clean result.

All controlled history is rollback-local synthetic evidence, not production
30-day observation or actual bank sending. Final exact candidate fresh reset/full
native/Worker suite is pending. Iterative applies and historical baseline results
are not final PASS.

Safe worktree logs: `test-results/local-recovery/mining-mission-native.log`,
`mining-mission-worker-unit.log`, `financial-seven-day-cancel.log`,
`financial-seven-day-partial-recovery-bounded-v5.log`,
`trial-completion-native-v4.log`, `current-rls-native.log`,
`current-ws04-native.log`, `current-reconciliation-native-v3.log`,
`current-mission-native-lint.log`. Failed attempts, including Docker API 500 and
synthetic-clock preparation failures, are preserved separately. Credentials remain
excluded.
