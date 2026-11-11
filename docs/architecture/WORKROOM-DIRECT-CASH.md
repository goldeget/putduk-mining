# WORKROOM direct deposit cash

The WORKROOM practice balance is noncash. This successor permits only actual,
operator-approved KRW deposits and canonically verified TRC20 manual USDT
deposits credited to KRW to fund a separate manual withdrawal. It does not
produce mining rewards, convert practice results, or activate a funding engine.

The three new public functions are SECURITY INVOKER and executable only by
service_role. The application must obtain the authenticated identity server-side
and supply that identity's UUID; no member-supplied subject is authoritative.
The sole new SECURITY DEFINER function is private
`app_private.workroom_cash_owner_ready(uuid)`, executable only by service_role.
It returns a boolean for confirmed active Auth identity, WORKROOM membership and
absence of legacy engine state. It exposes no account data and avoids granting
service_role direct SELECT on provider Auth or practice-account tables.

- `read_workroom_cash(p_user_id uuid)` returns JSON with `schemaVersion:1`,
  `currency:"KRW"`, `source:"DIRECT_DEPOSIT"`, `ready:boolean`, and decimal strings
  `availableKrw`, `heldKrw`, `depositedKrw`, `withdrawnKrw`. An unavailable owner or
  unresolved source returns `ready:false` and zero strings.
- `prepare_workroom_cash_withdrawal(p_user_id uuid,p_method text,p_amount_krw
  bigint,p_policy_id uuid,p_policy_version integer,p_destination_fingerprint
  text,p_destination_id uuid default null)` returns the existing version2
  withdrawal logical record. Existing destination IDs may provide their canonical
  fingerprint. New destination registration retains the existing reauthentication,
  encrypted destination, protection period and binding commands.
- `hold_workroom_cash_withdrawal(p_user_id uuid,p_idempotency_key text,p_method
  text,p_destination_id uuid,p_amount_krw bigint)` returns the withdrawal UUID.

Preparation creates a private immutable DIRECT_DEPOSIT original tied to the
logical key. It never adopts a preexisting legacy pending request. The existing
one-pending-request rule and full-input conflict checks remain in force. A repeat
HOLD returns its original UUID, including after terminal completion, and never
posts another hold or reserves another credit.

Only confirmed active WORKROOM accounts without legacy funding-engine activations
or principal-recovery allocations may enter the new flow. Credits must be
PRINCIPAL/CREDIT with KRW_DEPOSIT or USDT_KRW_DEPOSIT provenance and pass the
unchanged canonical deposit receipt verifier. Existing mining and native
principal paths retain their frozen checks. No source mixing or fallback occurs.

Per-credit reservations and terminal dispositions are immutable. Member advisory
serialization precedes logical/request/wallet row locks. Partial reservations use
newest verified deposit credits first. Active and finalized reservations consume
credits; a proved RELEASE makes its original reserved amount available again.
Finalization requires the existing full manual external-send evidence and posts
exactly one existing wallet debit. Release after external send is rejected.

The existing withdrawal requests, balanced HOLD/RELEASE/FINALIZE journals,
transaction receipts, owner logical recovery and administrator queues are reused.
Dedicated read-only cash coverage validates their exact source bindings and
terminal receipts; deferred completeness checks fail the transaction if any link
is missing. The source summary adds direct cash reservations/dispositions to its
fold and classification without rewriting historical rows or relaxing legacy
coverage. Practice ledgers never appear in any cash query.
After a direct-cash original exists, new legacy engine activations and native
principal allocations for that owner are rejected under the same member lock.
This prevents a later mode change from spending the same original deposit again.

No deposit refund/reversal command is introduced. Existing schema contains a
REVERSE movement kind, but no operational deposit reversal contract was found.
Unknown or damaged original deposit proof fails closed rather than being
reinterpreted as a refund or valid withdrawal source.

Operational prerequisites remain real merchant bank details/USDT address,
approved zero-fee general cash routing policies, configured encryption key,
verified protected member destination, and administrator role/MFA/step-up.
