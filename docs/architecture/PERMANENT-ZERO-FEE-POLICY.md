# Permanent zero platform fees

## Direct human instruction

On 2026-10-11 the user stated:

> 수수료는 영구적으로 없앨것이다. 나의 퍼뜩 플랫폼은 수수료자체를 없앤다.

This supersedes earlier permission to introduce platform fees in future economy
versions. Existing original specifications, sealed policy manifests, command
receipts and financial ledger rows remain historical evidence.

## Prospective boundaries

All five `platformFeesKrw` settings must be exactly zero in new administrator
policy input. This includes deposits, USDT deposit conversion, mining, mining
reward withdrawal and principal recovery. Every fee key in a newly inserted
economy policy must be zero. New receipts cannot advance a fee-bearing economy
policy. Historical parsing and reading remain available.

SQL is authoritative for completed same-key command replay: a historical
successful command can return its immutable original receipt before a new-write
fee guard runs. HTTP still verifies authorization, the returned receipt and the
subsequent state; a database fee rejection is a clear failure, never success.

New KRW/USDT withdrawal policies and new withdrawal requests must have zero
`fee_atomic`. An existing request's fee snapshot cannot be rewritten. A private,
fixed-search-path, SECURITY INVOKER trigger enforces these rules at the database
boundary. No new money writer or raw member privileges are introduced.

## Upgrade and historical transactions

Migration `20261011001444` does not update or delete historical rows. Affected
withdrawal routes receive zero-fee successor policies in original version order,
including scheduled zero-fee policies. Limits, destination settings, enablement,
expiration and recorded approval provenance are copied. Expired policies are
not reactivated. A copied effective timestamp advances only to the next available
microsecond to satisfy the existing unique constraint. Copying is a schema
upgrade, not a fresh administrator approval of other economic settings.

A pending fee-bearing historical withdrawal cannot record a new send or advance
to payout completion. Use the existing authorized cancellation/release command
and create a new zero-fee request. The old receipt, fee snapshot and amount-plus-fee
reconciliation rules are retained; they must not be globally rewritten.

A pre-existing immutable external-send receipt is treated separately. Recording
another fee-bearing transfer remains prohibited, but its historical status and
ledger reconciliation are not frozen by the new fee trigger. The migration does
not send money, manufacture transfer evidence or automatically finalize requests.
Historical exception behavior requires the original lifecycle's authorization,
source provenance, transaction and reconciliation checks.

## Confirmed manual KRW payout contract

The user's subsequent direct instruction is:

> 요청한 금액을 운영자가 직접 수동 송금후 어드민에서 완료처리 누르면 유저에게도 반영

The operator manually transfers the full requested KRW amount, then records the
transfer evidence and completes the existing authorized admin ledger command.
There is no partial/split payout workflow. The platform does not initiate a bank
transfer. Migration `20261011003244` rejects new KRW send receipts unless their
actual amount equals the request, and rejects completion of an existing mismatched
receipt. The canonical finalizer atomically reconciles the held reward, records one
debit and updates the member projection. An unsuccessful completion rolls back
all financial writes; retrying a confirmed command returns its original receipt.

Historical immutable sends remain evidence. A previously recorded mismatch needs
reconciliation rather than rewriting the send or falsely marking it complete.
Administrator responses verify the requested withdrawal and its terminal journal;
an unreadable or unconfirmed result is not reported as success.

External bank or blockchain provider costs are distinct from platform fees. This
decision does not authorize charging those costs to a member, changing conversion
rates or inventing a network fee subsidy policy.

UI/UX is currently unapproved and unchanged. Local isolated validation is not an
operating deployment. Production migrations and financial operations require their
separate authorized release procedure.
