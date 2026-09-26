# Notification Orchestration and PWA Delivery

Status: **P0 TRANSACTION CORRECTNESS / P1 CHANNEL EXPERIENCE**

## Canonical record

The persisted in-app notification is the user-visible record. Toast and Web
Push are delivery channels, not the source of truth. Every notification links
to a versioned domain event and a same-origin allowlisted deep link.

## Flow

```text
domain transaction + outbox event
→ audience resolution
→ notification intent (deduplicated)
→ preference/quiet-hours/cooldown/cap policy
→ persisted notification
→ in-app/toast and Web Push delivery jobs
→ delivery attempts and terminal state
→ click/open deep link and analytics
```

Normal event/notice publication automatically fans out. Invalid/expired push
subscriptions are disabled safely after classified provider responses.

## Required event families

Mining/trial milestones, deposit/withdrawal transitions, funding/referral/event
rewards, event start/end, rank-up and maintenance start/completion must be able
to create notifications, analytics and Member 360 timeline facts.

## Fatigue and priority

- category opt-in/out;
- member quiet hours in their timezone;
- per-category cooldown;
- daily caps;
- digest grouping;
- transactional, service, security and marketing priority separation;
- narrowly documented critical-service override.

Marketing and events never crowd out transactional/security delivery.

## PWA rules

- permission is requested only after education and user action;
- denial is respected and the product remains complete in-app;
- clicks open only allowlisted internal routes;
- offline UI never claims a financial mutation succeeded;
- service-worker updates are versioned and recoverable;
- iOS, Android and desktop installed-mode proof is required for launch claims.

Delivery is idempotent, localized, retryable, auditable and KST-presented for
Korean members while UTC remains canonical in storage.
