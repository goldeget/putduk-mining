# Backup and Restore Drill

Status: **P0 RUNBOOK / REMOTE EXECUTION NOT AUTHORIZED**

## Scope lock

The only production database target is Supabase project `putduk-mining`, ref `osrmyjgmpdspdcwqjwuv`, region `ap-northeast-2`. Never discover, inspect or reuse another project as a recovery target. A restore rehearsal needs a separately and explicitly authorized isolated target; this document does not grant that authority.

## Preflight evidence

Before any remote action, record:

1. exact source project ref and authenticated identity;
2. current release commit, migration head and schema digest;
3. Supabase Pro backup/PITR entitlement, retention and restore options;
4. approved recovery target identity and deletion owner;
5. secret/storage objects not covered by the database backup;
6. target RPO/RTO, maintenance window and abort criteria.

An account-wide project listing is forbidden. Verify the exact known ref directly or stop with `BLOCKED_TARGET_SCOPE`.

## Rehearsal

1. freeze writes or establish the approved recovery point;
2. create the provider-supported restore into the authorized isolated target;
3. keep application traffic and outbound notifications disabled;
4. verify migration history and extensions;
5. run pgTAP, RLS, schema lint and security advisors;
6. compare critical row counts and deterministic aggregates;
7. verify every ledger transaction balances and wallet projections reconcile;
8. verify outbox/job leases are cleared or deliberately quarantined before workers start;
9. exercise synthetic identity, trial, welcome conversion, withdrawal and admin-denial journeys;
10. record actual RPO/RTO and destroy the recovery target only under its approved removal plan.

## Required reconciliation queries

- debit total equals credit total for every `ledger_transactions.id`;
- every `wallet_ledger` monetary projection links to its domain source;
- one conversion exists per trial account and no conversion exceeds KRW 5,000;
- one welcome withdrawal exists per conversion;
- outbox idempotency keys and consumer keys are unique;
- no `RUNNING` job or `PROCESSING` event retains an expired lease when workers resume;
- no anonymous/authenticated role gained direct write privilege to server-owned tables;
- published catalog versions have approval and publication evidence.

## Exit decision

The drill passes only with raw provider identifiers, timestamps, row/reconciliation results, test output and named operator approval. A successful restore button or a booting application alone is insufficient. Until a separately authorized drill runs, backup and restore remain `SPEC_ONLY / BLOCKED_REMOTE_AUTHORIZATION`.
