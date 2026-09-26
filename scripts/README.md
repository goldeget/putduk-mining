# scripts

Operational and development scripts.

Any script that can affect production assets, economic configuration, settlements or user data must:
- default to non-production
- require explicit environment selection
- support dry-run where practical
- emit clear logs
- avoid embedding secrets

## First administrator bootstrap

`bootstrap-first-admin.mjs` is the only supported first-role bootstrap path. It
is locked to Supabase project ref `osrmyjgmpdspdcwqjwuv`, requires an exact
existing `auth.users` UUID, a human audit reason, and the literal confirmation
`BOOTSTRAP_FIRST_SUPER_ADMIN`. The database command is atomic and permanently
refuses a second bootstrap after any role row exists.

This is a remote mutation. Do not run it during local verification and do not
run it without explicit approval for the exact user UUID and target project.

```powershell
pnpm admin:bootstrap -- `
  --user-id=<exact-auth-user-uuid> `
  --reason="Initial production operator bootstrap" `
  --confirm=BOOTSTRAP_FIRST_SUPER_ADMIN
```
