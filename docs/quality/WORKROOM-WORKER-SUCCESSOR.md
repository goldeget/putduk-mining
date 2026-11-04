# WORKROOM worker scheduler test successor

The WORKROOM runner intentionally does not call `schedule_due_funding_jobs`. It reports a paused replacement scheduler and always supplies `p_allow_funding: false` to job claims, including when an older caller supplies `allowFundingJobs: true`. Operational outbox and job processing remain active.

The hosted201 worker run at41823879621 failed15 assertions in `funding-scheduler.test.ts` because they still expected the retired scheduler to be called before those two operational claims, or treated an uncalled scheduler's mock error as an operational failure. This successor changes those expectations without re-enabling funding or changing worker product code.

All24 original test cases remain covered. Bounded per-client pagination, cursor redaction, malformed receipt rejection and invalid batch rejection continue to exercise the exported scheduler helper directly. Reconciliation, CMS fanout, canonical safe-mode audit completion and their original request/job identities remain checked through the replacement cycle. Two additional cases verify that real outbox/job claim errors still mark the cycle failed while the other operational claim remains available. No tests are skipped or blanket-retired.

These are unit/protocol assertions with explicit RPC fixtures. They are not real Auth, database execution, monetary processing, production deployment or whole-CI acceptance evidence. Native and authenticated runtime lanes remain separately required.
