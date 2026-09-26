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

## Brand asset pipeline

`build-brand-assets.py` reads only the versioned, text-free PNG masters under
`docs/design/generated-masters/` and writes responsive runtime derivatives plus
`public/brand/assets.manifest.json`. Its Python dependency is pinned in
`scripts/brand-assets.requirements.txt` and must include AVIF support.

The normal release gate does not rebuild image encodings. It verifies the
committed outputs, canonical-reference hashes and generated-master hashes:

```powershell
pnpm assets:verify
```

Run a full rebuild only when a reviewed source master or encoding policy
changes:

```powershell
python scripts/build-brand-assets.py
pnpm assets:verify
```

Never add production copy to raster masters. Korean copy, especially the exact
brand spelling `퍼뜩`, remains HTML/CSS or reviewed SVG.
