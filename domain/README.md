# domain

Pure business rules shared by command handlers and tests. Current foundations cover trial, welcome conversion, mining/settlement, balanced wallet journals, referral qualification, funding promotions, versioned events/outbox delivery, notification fatigue/deep links, AI/trust and analytics.

These modules do not authorize a mutation by themselves. Server handlers still verify identity/role and database commands preserve transaction, RLS, idempotency and audit boundaries.
