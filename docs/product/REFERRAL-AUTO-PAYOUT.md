# Referral Qualification and Automatic Payout

Status: **CANONICAL P0 PRODUCT CONTRACT**

## Launch rule

- Invitations are unlimited.
- The standard maximum reward to a referrer for one normally qualified active
  referral is `KRW 10,000`.
- Default stage 1 maximum: `KRW 5,000`.
- Default stage 2 maximum: `KRW 5,000`.
- Exact activity windows and criteria are versioned operator configuration.
- Normal qualified referrals pay automatically; the operator handles only
  ambiguous exceptions.

## State machine

```text
PENDING → QUALIFIED → APPROVED → PAID
             │           │
             └→ AUTO_HOLD ┘
PENDING|QUALIFIED|AUTO_HOLD → REJECTED
PAID → REVERSED (compensating journal only)
```

Each referral has immutable attribution evidence and per-stage decision
snapshots containing rule version, risk-model version, evidence, decision,
decision time and payout IDs. Unique `(referral_id, stage)` prevents duplicate
payout.

## Qualification pipeline

```text
valid attribution + new member + approved identity/KYC
→ verified funding + real mining started + first real settlement
→ risk evaluation
→ stage 1 automatic journal payout
→ later configured legitimate activity + health/risk recheck
→ stage 2 automatic journal payout
→ notifications and reconciliation
```

The exact required facts may change only through a new effective rule version.
Past decisions remain explainable.

## Risk

Signals may include identity, IP, device, session, account age, trial/funding/
mining behavior, referral graph, velocity, self-referral, multi-account farms,
same-device farms, circular rings and repeated welcome-reward abuse.

No single shared IP causes automatic rejection. It may contribute to an
`AUTO_HOLD` when combined with stronger evidence. AI may summarize evidence but
cannot decide or post money.

## Acceptance

Attribution, both stages exactly once, automatic hold/recheck, reversal,
self/ring risk, shared-IP-only non-rejection, event replay and balanced journal
payout are mandatory tests.
