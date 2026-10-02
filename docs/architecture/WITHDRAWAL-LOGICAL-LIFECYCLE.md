# PR #38 — member withdrawal logical lifecycle

Scope: general member KRW_BANK / USDT_ADDRESS withdrawal only. This is a P1
money-integrity repair, not product completion, deployment or merge approval.
Baseline: `d6a2e0797acbf61aa827d752e734f3f7f6f028c3`.

## Read-only flow map and confirmed defects

`WithdrawalForm` selects a registered destination or collects new material.
`POST /withdrawals/destinations` encrypts the material and calls the frozen
`register_krw_bank_destination` / `register_usdt_withdrawal_destination` command.
`POST /withdrawals/hold` calls the frozen `request_krw_withdrawal` /
`request_usdt_withdrawal` command. `request_withdrawal_with_hold` looks up
owner + key before checking destination eligibility, then locks the destination
and KRW wallet. It creates one request, balanced hold, `WITHDRAWAL_REQUESTED.v1`
outbox event and receipt. The withdrawal page reads the owner's requests and
balance projection. Welcome withdrawal remains a separate conversion-bound flow.

The baseline client hashed new material as `material:*` but registered material
as `registered:*`. It also reconstructed `FormData` after registration awaited
and disabled the inputs. The storage wrapper could report success after a failed
write, while a subsequent successful `getItem` returned null. A new key could
therefore create another fully valid money command. Registration itself had no
logical replay boundary and could replace a destination / restart protection.

The existing safe identity is `withdrawal_destinations.value_fingerprint`: a
server SHA-256 of canonical destination fields. Encryption uses the existing
owner-and-method-bound envelope. No second client hash is introduced.

## Final design

- Capture all input once, synchronously, before pending, disabling or awaiting.
- Prepare one server-owned unresolved logical record per authenticated owner.
  It contains version, random key, method, integer KRW amount, policy id/version,
  existing destination fingerprint, optional destination/withdrawal ids, state,
  created/updated/expiry timestamps. No raw destination or cipher payload.
- An owner advisory transaction lock and a partial unique index serialize tabs.
  A conflicting unresolved intent blocks; it is never silently replaced.
- Use owner-scoped localStorage v2. Write **and read back the exact validated
  record** before registration and before hold. No in-memory send fallback.
- Registration and binding commit in one transaction. A replay returns the bound
  destination without invoking registration again or changing protection/history.
- Hold and binding commit in one transaction, delegating money to the frozen
  commands. An existing withdrawal is returned before TTL/policy/eligibility
  changes; new holds must satisfy all original guards and the selected policy.
- Keep a committed record unresolved until the browser explicitly acknowledges
  the exact withdrawal id. Response loss, reload, another tab and missing storage
  recover the same server record. Confirmation permits a later identical intent
  with a new random key. Late retries of the old key still return the old result.
- An already-open tab retains its known key only as a reconciliation pointer.
  Even if another tab clears shared storage or prepares a later intent, an old
  retry first resolves that exact owner key. Memory never permits registration
  or hold without a fresh validated server record and durable read-back proof.
- Cancellation / definitive rejection is serialized against hold and checks for
  a committed withdrawal first. A committed result cannot be discarded as an
  uncommitted request. Browser reset alone never cancels server state.
- TTL is 24 hours. Expired uncommitted records require explicit safe cancellation;
  expired committed records remain recoverable. Corrupt/unknown/foreign-owner
  browser records require server reconciliation or fail closed, never a new key.
- APIs derive owner from verified auth. Browser owner/amount/policy cannot bypass
  server validation. Table access and lifecycle RPC execution are service-only;
  RLS is enabled and forced. Responses are no-store and contain safe fields only.

Minimum states: PREPARED → DESTINATION_REGISTERED → OUTCOME_UNCERTAIN (hold
committed, acknowledgement pending) → CONFIRMED. Uncommitted requests can become
CANCELLED / DEFINITIVELY_REJECTED after reconciliation. Transport uncertainty is
not a terminal state.

## Deliberate contract extension, not money-command aliases

New orchestration commands: `prepare_withdrawal_logical_request`,
`bind_withdrawal_logical_destination`, `hold_withdrawal_logical_request`, and
`resolve_withdrawal_logical_request`. They own durable lifecycle/race protection,
not a parallel ledger or destination model. All WS-04 frozen commands, existing
hold/release/finalize semantics and welcome flow remain authoritative.

The member hold API requires a prepared logical key. Direct canonical service
RPC consumers and welcome withdrawal retain their existing contracts. Fixture
setup follows the new HTTP lifecycle without removing existing assertions.

## Adversarial acceptance

Real local DB + Chromium must demonstrate KRW and USDT registration-response
loss separately from hold-response loss, exact one-effect counts before cleanup,
unchanged destination/protection, storage write/read failures with zero money or
destination effects, owner switching, multi-tab recovery, expiry/corruption and
a legitimate subsequent identical withdrawal. Unit and pgTAP tests cover strict
record validation, no sensitive persistence, privileges, races and balanced money.
The final evidence report records tested cases and limitations; this document is
design, not evidence of completion.
