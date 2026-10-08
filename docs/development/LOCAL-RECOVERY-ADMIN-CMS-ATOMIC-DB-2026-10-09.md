# Local recovery: audited reads, content receipts and atomic AI turns

This change extends the exact PUTDUK repository at `0630b5a92817fac6e8d05cb2ddc3198317d76e5f`. It is newly reviewed implementation of recovered contracts, not a claim that incomplete Cloud SQL was recovered byte for byte.

`admin_read_ai_conversations` retains the five-argument Cloud contract. Database authorization checks the current administrator role, bound unexpired session, verified TOTP factor, AAL2 and session AMR before producing masked search results or complete conversation text. Read results and audit writes share a transaction. Unknown provider costs remain null; nano-USD evidence is distinct from conservative micro-USD reservations.

The content command and review RPCs preserve the recovered canonical signatures. Immutable revision snapshots, exact digests, one-shot step-up proofs, idempotency receipts, audits, outbox events and public projections are committed together. Current accepted content has `rewardMode=NONE`; this does not implement the owner's twenty rewarding events or monetary reward execution.

The newly approved internal `append_ai_member_turn` helper serializes an owned conversation and its request identity, and writes all question/answer fragments, source/tool evidence and conversation timestamps in one transaction. Conflicting replay and legacy partial storage fail closed.

Native PostgreSQL evidence in the isolated project `putduk-mining-local-recovery-20261009-fi`: atomic storage 21 assertions passed; administrator reads and content receipts 35 assertions passed. Logs are `test-results/local-recovery/atomic-retention-native.log` and `test-results/local-recovery/admin-cms-native.log`. Tests cover full text, ownership, current authorization, replay, and injected intermediate failures rolling back writes. The separate sixteen retention arithmetic assertions in the first log are outside this change.

These are targeted local results. Final migration-file digests, a clean reset of the complete chain, full native regression, two-connection concurrency, actual administrator UI and device delivery evidence remain independent acceptance gates. Earlier empty drafts were recorded by the development database; they are not final migration-chain evidence. No remote database, production configuration, deployment, paid provider request or real money was changed.
