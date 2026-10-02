-- ADMIN_MEMBER_MINING_COUNT_READ
-- Exact caller: apps/admin/app/(control)/members/page.tsx
--   createAdminServiceClient().from("mining_sessions")
--   .select("id", { count: "exact", head: true })
--   .eq("user_id", userId)
-- Purpose: Member 360 module card "채굴 · 정산" count only.
-- Least privilege: SELECT only. No INSERT / UPDATE / DELETE.
-- RLS stays FORCE; service_role bypasses RLS by design but still needs GRANT.

grant select on table public.mining_sessions to service_role;

comment on table public.mining_sessions is
  'Mining session headers. Member 360 may COUNT via service_role SELECT only; writes stay in SECURITY DEFINER commands.';
