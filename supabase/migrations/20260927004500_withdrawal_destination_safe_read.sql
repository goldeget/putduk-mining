-- Authenticated users may read only the non-sensitive status projection for
-- their own withdrawal destinations. Encrypted values, fingerprints and the
-- owner key remain service-only.

revoke all on table public.withdrawal_destinations from anon, authenticated;

grant select (
  id,
  destination_type,
  display_hint,
  verification_status,
  verified_at,
  protection_until,
  replaced_at,
  created_at,
  updated_at
) on table public.withdrawal_destinations to authenticated;

drop policy if exists withdrawal_destinations_select_own_safe_projection
  on public.withdrawal_destinations;

create policy withdrawal_destinations_select_own_safe_projection
on public.withdrawal_destinations
for select
to authenticated
using ((select auth.uid()) = user_id);

comment on policy withdrawal_destinations_select_own_safe_projection
on public.withdrawal_destinations is
  'Allows an authenticated member to read only granted status/display columns for their own destination. Sensitive ciphertext, fingerprint and owner columns are not granted.';
