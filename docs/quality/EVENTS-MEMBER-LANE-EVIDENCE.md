# Events member product lane evidence

Status: **FUNCTIONAL EVIDENCE / NOT PRODUCT COMPLETE / NOT LAUNCH READY**

Lane: `parallel/events-product`

Ownership: `app/(product)/events/**`, events-specific tests/components

## Publication lifecycle audit (no silent redesign)

| Surface | Status vocabulary | Publication gate |
| --- | --- | --- |
| Product catalog | `DRAFT → APPROVED → PUBLISHED → RETIRED` | `published_at` + status |
| Promotions | `DRAFT/APPROVED/SCHEDULED/ACTIVE/PAUSED/ENDED/CANCELLED` | approval + schedule |
| `public.events` | `DRAFT/SCHEDULED/LIVE/ENDED/CANCELLED` | `published_at` required when not `DRAFT` |
| `public.notices` | `content_status`: `DRAFT/PUBLISHED/ARCHIVED` | `published_at` + optional `expires_at` |

**HUMAN_DECISION_REQUIRED:** align event status enum with catalog/promotion/content publication vocabulary, or formally accept the divergence. This lane does not migrate enums.

**HUMAN_DECISION_REQUIRED:** approved production event/notice copy, schedules, and rewards are absent from seeds/migrations. Member UI must keep empty states until an operator-approved content pack exists. Do not invent rewards, dates, or Korean marketing copy.

## Security / money audit for this lane

| Check | Result |
| --- | --- |
| Migration | NONE |
| GRANT/REVOKE | unchanged |
| service_role | unused by member Events UI |
| SECURITY DEFINER/INVOKER | unchanged |
| RLS | existing `events_read_published`, `notices_read_published`, `event_participants_select_own` consumed as-is |
| auth.uid() | participant reads filter `user_id = auth.uid()` (RLS) and app `.eq("user_id", identity.userId)` |
| user-supplied user_id | not accepted from client for Events reads |
| Direct wallet/ledger mutation | none |
| Test-only privilege / debug RPC | none; fixtures use local admin SQL only |
| Outbox / audit mutation | none in this lane |
| Money impact | none |
| Outbox impact | none |

## Proven in this lane

- Unauthenticated return for `/events` and `/events/[slug]`
- Empty events + empty notices
- LIVE / SCHEDULED / ENDED presentation from local fixtures
- Own participant state; cross-user participant isolation
- Pinned notices; expired + unpublished exclusion
- Loading route UI (`loading.tsx`); recoverable query error panels + route `error.tsx`
- 390 / 834 / 1440; Light / Dark / System; keyboard focus; reduced motion; overflow
- Korean copy gate checks; hydration count captured
- Visual Lab: route `/events` (+ detail) compared structurally to benchmark anatomy — full pixel acceptance still OPEN
- Performance: bounded local interaction window only — production percentiles OPEN

## OPEN

- Local Docker / `supabase_db_putduk-mining` was unavailable during this lane run; browser E2E against a live local DB was not executed (left OPEN rather than touching remote Supabase)
- Safe fault-injection for network/offline recovery beyond query-error panels
- Operator-approved production event content pack
- Full Visual Lab pixel/regression suite and production Web Vitals percentiles
- Event mission progress / payout receipt UX (no reward invention)
- Publication fanout / LiveOps admin (explicitly out of lane scope)

## Focused unit evidence (this run)

- `tests/unit/events-member-read-model.test.ts`
- `tests/unit/return-path.test.ts` (includes `/events` and `/events/[slug]`)
- `tests/unit/event-reward.test.ts` (unchanged reward safety)
- Result: **3 files / 28 tests passed**
- `tsc --noEmit`: pass
