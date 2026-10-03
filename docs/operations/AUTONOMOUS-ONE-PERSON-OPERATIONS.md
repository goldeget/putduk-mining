# Autonomous One-Person Operations

Status: **CANONICAL OPERATING MODEL / IMPLEMENTATION INCOMPLETE**

“Autonomous” means the system reduces repetitive work and presents safe decisions. It does not mean AI or jobs receive unrestricted mutation authority.

## 1. Operator cockpit

The operator needs one prioritized inbox and simple value, target, time, preview and confirmation controls. Admin work must remain usable without an AI provider. Do not add a separate advanced mode, JSON/SQL editor or internal key/version inputs. The integrated V1 operator assistant prepares the same typed forms and uses the same human-confirmed server command boundary. Its contract is `docs/architecture/ADMIN-OPERATIONS-ASSISTANT.md`.

| Queue | SLA signal | Required evidence | Allowed action |
| --- | --- | --- | --- |
| Deposit review | age, amount, duplicate risk | request, user, proof metadata, prior decisions | approve/reject with reason and idempotency |
| Withdrawal review | age, risk/hold state | ownership, balance hold, destination, history | approve/reject/release per policy |
| Settlement exception | severity, retry count | request/trace/job IDs, rule version, ledger state | retry safely, quarantine, escalate |
| Failed job/dead letter | attempts, next retry | payload digest, error class, owner | replay idempotently or close with reason |
| Support/user lookup | user-visible impact | timeline of auth, wallet, mining, notifications | explain, tag, perform approved bounded action |
| Content/live operations | schedule and state | version, targeting, preview, approver | publish/pause/expire/rollback |
| Security/audit | severity | actor, target, IP/session context, immutable diff | contain, revoke, investigate |

## 2. Daily operating loop

```text
readiness and overnight exceptions
→ deposits/withdrawals by SLA and risk
→ settlement/job exceptions
→ support-impacting incidents
→ scheduled content/event review
→ product and growth facts
→ close with reconciliation and audit completeness
```

The cockpit shows counts, oldest age, severity and stale-owner warnings. Empty queues are explicit success states, not blank screens.

## 3. Safe automation

Jobs may:

- detect due work;
- validate current state;
- claim work with a lease;
- execute an idempotent domain command;
- append attempt/result evidence;
- back off and move terminal failures to an exception queue.

Jobs may not bypass RLS/domain checks, overwrite balances, change rule history, self-approve withdrawals or conceal repeated failures.

Every job carries `job_id`, `request_id`/`trace_id` where applicable, idempotency key, attempt, rule/config version, timestamps and terminal state. Replay consumes the same business idempotency key.

## 4. Emergency controls

P0 controls:

- global safe mode;
- new mining-session pause;
- settlement pause without deleting due work;
- deposit approval pause;
- withdrawal processing pause;
- AI/provider kill switch;
- push/marketing send pause;
- per-feature flag defaults and expiry.

Activation requires operator identity, reason, scope, expiry/review time and immutable audit. Safe mode prioritizes preservation and clear communication; it never silently reports a stopped system as active.

## 5. AI boundaries

The V1 operator assistant may summarize authorized queues, explain outcomes and prepare editable drafts for the existing forms. A human confirms the current target and proposed result through the ordinary server command, live permissions and required step-up. The assistant never submits a mutation or consumes the final approval. Growth AI remains a P2 advisory capability. Neither may:

- mutate balances or ledgers;
- approve deposits/withdrawals;
- change economic rules or flags;
- publish content or send a campaign;
- grant roles;
- mark an incident resolved.

Recommendations cite source facts and remain reviewable. Unknown data is labeled unknown.

## 6. Reconciliation

Daily automated checks should compare:

- ledger entries to wallet projections;
- settlement commands to produced ledger entries;
- approved deposits/withdrawals to ledger state;
- claimed jobs to terminal or retry state;
- notification sends to preferences and delivery outcomes;
- admin mutations to audit events.

Any mismatch becomes an exception; automated “repair” is forbidden unless a specific reversible repair command is approved and idempotent.

## 7. Incident loop

```text
detect → classify → contain → preserve evidence → communicate
→ recover using runbook → reconcile → review → prevent recurrence
```

Severity, owner, started/contained/recovered times, impacted domains, public-message decision, trace IDs and follow-ups are mandatory. Product failure, verifier-contract failure and environment failure are classified before rerunning the same operation.

## 8. Backup and restore

- Verify Supabase Pro backup/PITR entitlement and retention on the exact authorized project before launch.
- Document which storage objects and external secrets are not covered by database backups.
- Rehearse restore into an explicitly authorized isolated recovery target; never use another historical project.
- Validate row counts, critical constraints, RLS, representative ledger chains and app compatibility after restore.
- Record RPO/RTO evidence; a dashboard toggle alone is not a restore test.

## 9. Current implementation truth

The repository now contains a physically separate admin application with server-owned role checks, mandatory AAL2/TOTP gates, a 오늘의 퍼뜩 request-time snapshot, an exact-UUID Member 360 reference and a guarded deposit-approval command. It also contains balanced-ledger, outbox, durable job/attempt, reconciliation, safe-mode, feature-flag, KYC/security and member-timeline data foundations. Service-only lease claim/complete/fail commands provide bounded retry and dead-letter transitions, but no continuously deployed worker or complete action queue has been proven.

It still does not provide app-owned admin sessions with bounded lifetime/revocation, single-use step-up, authentication rate limits, complete Member 360 actions, withdrawal/settlement exception resolution, dead-letter replay UI, a reconciliation runner, backup verification or a restore drill. Authenticated role/MFA/revocation browser evidence is also absent. Local database execution is pending because the project-scoped Docker engine was unavailable during WS-03. These remain P0 implementation and evidence blockers.
