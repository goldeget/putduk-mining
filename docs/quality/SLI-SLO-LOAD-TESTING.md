# SLI, SLO and Load Testing

Status: **P0 ACCEPTANCE CONTRACT / BASELINE HARNESS ADDED**

## Launch indicators and objectives

Objectives apply to a rolling 28-day production window after launch and do not replace per-request correctness gates.

| Capability | SLI | Initial objective | Correctness guard |
| --- | --- | --- | --- |
| Core read APIs | successful non-5xx responses / eligible requests | 99.9%; p95 under 500 ms | stale/private data never substituted for success |
| Trial commands | committed valid commands / eligible commands | 99.9%; p95 under 1 s | server time, quota and exactly-once settlement |
| Money commands | terminal valid outcomes / accepted commands | 99.95%; p95 admission under 1 s | balanced journal and idempotent business effect |
| Outbox delivery | events processed inside target delay / committed events | 99.9% inside 60 s | duplicate delivery cannot duplicate money |
| Durable jobs | jobs reaching success or owned exception / due jobs | 99.9% inside domain SLA | bounded retry, lease and dead-letter evidence |
| Notification fanout | eligible deduplicated deliveries / planned deliveries | 99% inside 5 min | preference, cap and deep-link compliance |
| Admin queues | queue reads with current cursor / eligible reads | 99.9%; p95 under 1 s | no cross-role or sensitive-field leakage |

An SLO miss consumes error budget and triggers review; it never authorizes weakening ledger, RLS, KYC, anti-abuse or idempotency checks.

## Required load scenarios

1. steady and spike public/API reads;
2. simultaneous trial progress/settlement and replay;
3. concurrent welcome conversion for one trial and multi-account abuse batches;
4. deposit confirmation burst with percentage, fixed, tiered and exclusive campaigns;
5. large referral qualification graph including self/ring/shared-IP signals;
6. event qualification and budget contention;
7. outbox backlog, consumer crash, lease expiry and recovery;
8. notification fanout with preference/deduplication/fatigue filters;
9. admin queue pagination during background load;
10. reconciliation after each money-path scenario.

## Evidence

Record commit SHA, environment, dataset shape, k6 version, scenario parameters, raw output, database reconciliation, outbox/job terminal counts, resource graphs and abort reason. A green latency chart with a ledger mismatch is a failure.

The current `tests/load/core-api.k6.js` file is only the non-destructive local/preview reference baseline. Authenticated and contention scenarios remain blocked until the local database gate runs and synthetic fixture commands are available.
