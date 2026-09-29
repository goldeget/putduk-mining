# ADMIN_MEMBER_MINING_COUNT_READ — lane E audit

Status: **LOCAL BRANCH EVIDENCE ONLY** (not PRODUCT COMPLETE / not launch ready)

## Verdict

`mining_sessions` SELECT for Member 360 count is **genuinely required**.

Exact caller:

- `apps/admin/app/(control)/members/page.tsx`
- via `countMemberMiningSessions()` in
  `apps/admin/app/(control)/members/_lib/member-evidence.ts`
- Query shape: `select("id", { count: "exact", head: true }).eq("user_id", userId)`

Without `GRANT SELECT ... TO service_role`, the admin service client count fails
and the UI must show `확인 필요` (never a false zero).

## Migration (local branch only — not applied remotely)

- `supabase/migrations/20260929151000_admin_member_mining_sessions_select.sql`
- `GRANT SELECT` only on `public.mining_sessions` to `service_role`
- No INSERT / UPDATE / DELETE
- No RLS policy weaken / drop / FORCE RLS change
- No SECURITY DEFINER function added
- No auth.uid() policy change

## Security tests

- `supabase/tests/database/admin_member_mining_count_read.sql`
- Proves service_role SELECT yes; INSERT/UPDATE/DELETE no
- Proves authenticated write denied; anon SELECT denied

## Still OPEN (intentional)

- Unsafe fault injection for partial module failure UI
- Visual Lab authenticated Member 360 capture / performance acceptance
- `event_participants` / `notifications` service_role SELECT (not in this OPEN item;
  counts stay `확인 필요`, recovery banner excludes those known gaps)
- SHARED matrices / CI workflow / admin globals.css / admin-shell were not edited
- Local Docker Supabase apply/pgTAP may be unavailable on the lane machine;
  CI database job must prove the migration + pgTAP file

## Money / outbox

- No balance mutation
- No money command changes
- No outbox writes from this read path
