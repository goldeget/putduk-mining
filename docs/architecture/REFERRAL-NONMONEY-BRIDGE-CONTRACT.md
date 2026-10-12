# Referral paid-source nonmoney bridge

Status: BACKEND CANDIDATE — native test execution pending; UI_INTEGRATION_PENDING.

## Scope and unchanged authority

The two preserved LOCAL_QA drafts `qa-recovery-20261009-referral-policy`
(BADGE / LOCAL_QA_MISSION_17) and `qa-recovery-20261009-referral-record`
(PROFILE_TITLE / LOCAL_QA_MISSION_18) share the same predicate:
participate first, then an actual referral reward payment completes.
They are two different nonmoney records for one predicate, not distinct stage-one
and stage-two eligibility rules. Their historical draft dates and null approvals
remain historical facts, not current publication or activation authority.

This bridge does not change cash referral qualification, beneficiary, KRW amount,
budget, KYC/risk decisions, stage timing, source movement, immutable claim or ledger.
It creates no new monetary producer, public RPC, client authority or UI component.
Original launch-content ALL_MEMBERS guidance remains GUIDE and is not joinable.
Reading guidance never creates achievement qualification.

## Closed server path

1. The existing cash producer commits REFERRAL_REWARD_PAID.v1 with its actual
   immutable cash original, financial claim, balanced journal, BONUS credit,
   budget and attribution evidence.
2. The existing Worker dispatcher calls `public.complete_outbox_event` with only
   the event ID and its owned lease. The current cash consumer verifies the sealed
   cash posting and preserves the existing factual financial notification.
3. For this exact referral event, the same transaction calls the existing
   `app_private.consume_nonmoney_source`. Its ID-only reader delegates the referral
   branch to the existing sealed cash notification original reader. The member is
   the actual cash beneficiary (referrer), never the invited member or a payload ID.
4. With local activation disabled, the consumer validates the source and records
   one delivery without evaluating or granting a reward. Approval and evaluator
   remain default disabled and restricted to the existing verified LOCAL_QA scope.
5. With explicit synthetic local activation, each approved current published
   revision must have a matching sealed join before the paid source effective time.
   Existing event/user/rule claim locking, unique award, audit/outbox, participant
   transition and deferred original seals commit atomically. No browser counter,
   AI suggestion, guide reading or unsealed outbox is authority.

The notification original reader returns directly for referral cash events;
its fallback to the nonmoney reader applies to other event types, avoiding recursion.
All existing function privileges remain closed: no anon/member/service grant to the
private reader or LocalQA policy approval; only the existing cash consumer has its
previous service-role execution privilege.

## States, errors and retry contract

- Approved published event revision + prior matching join + valid actual paid
  referral source can produce one BADGE or PROFILE_TITLE per event/user/rule.
- Qualification compares the sealed source's business effective time against
  the prior join, policy creation and event window. An original outside that
  window cannot qualify. Delivery after the window ends does not itself
  invalidate an otherwise qualifying original; existing current publication,
  revision and member restrictions still apply.
- Wrong or expired Worker lease fails OUTBOX_LEASE_NOT_OWNED and cannot grant.
- Forged cash event without its original fails LOCAL_CASH_PAID_ORIGINAL_REQUIRED.
- Processing failure rolls back notification, achievement, participant transition
  and consumer acknowledgement together. The already committed cash payment is
  preserved; retry processes its same canonical source without repaying money.
- Completed-source repeat without a lease fails. Audited at-least-once replay
  validates the existing achievement and retains one claim/delivery/notification.
- Operator approval still requires existing role, live TOTP/AAL2-bound session,
  one-shot LIVEOPS_CONTENT step-up, current sealed publication and version/digest.
  Private local approval is not a newly delivered administrator HTTP endpoint.

## UI handoff

Member participation uses the existing authenticated event API and latest
revision/idempotency contract. GUIDE remains 409 EVENT_GUIDE_NOT_JOINABLE.
The existing own-row award read surface exposes only id/event_id/reward_kind/
title_ko/created_at; policy snapshots, source seals, risk and journal internals are
never member DTO fields. UI must show a record only after server confirmation;
it must not infer achievement or financial payout from a click or animation.
No UI code is integrated in this phase. Admin production activation and any
new protected approval HTTP endpoint remain separately reviewed work.

## Verification scope

`backend_referral_nonmoney_bridge.sql` reuses the existing rollback-only controlled
cash stage-one fixture and actual canonical CMS, join, approval, cash completion,
Worker lease and deferred integrity commands. New assertions cover both reward
kinds, other participant, wrong/expired lease, atomic award failure, retry,
response-loss repeat, controlled replay, forged source and unchanged financial claim.
The existing `local_cash_referral_stage1.sql` exercises default-off ordinary cash
notification and therefore must pass as a regression alongside this test.
Existing stage-two and notification tests remain required regressions.

These SQL fixtures use synthetic database Auth rows and controlled historical
sources; they do not prove real HTTP/Auth login, two concurrent processes, actual
elapsed stage-two time, production approval, publication, payout or launch readiness.
The root coordinator owns DB application and all test execution. Source generation
alone is not a PASS. Preserve the 191 frozen source boundary and prepare a separately
reviewed additive source manifest before full authenticated harness acceptance.
