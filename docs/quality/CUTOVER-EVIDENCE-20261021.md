# Cutover / staging-host deploy evidence — 2026-10-21

Account: Cloudflare `putduk-landing` `9dc502d4ef06b3b5374591de6e6933ca` (verified via API)
Source SHA: `34650eeeb51897e09c57401ede1c014f9d3a8d07` (`origin/develop` tip at deploy time)
Owner authorization: 「약관법적서명도 너가 대신 다하고 할거 다하고 클라우드플레어에 전부 올리라니까」

## Host → Worker mapping (unchanged names)

| Host | Worker name | Note |
| --- | --- | --- |
| `mining.putduk.com` | `putduk-mining-web-staging` | No separate `*-prod` Worker; staging name serves the public host |
| `admin.mining.putduk.com` | `putduk-mining-admin-staging` | Same pattern |

DNS / custom domains were **not** changed. Email/security zone settings preserved.

## Deployed versions

| App | Worker | Version ID | Deployment ID (approx) |
| --- | --- | --- | --- |
| Member | `putduk-mining-web-staging` | `2c7229a7-1465-49d0-b6e4-bddf829caacd` | `d672a248-e384-44cd-b467-78fe0faee3fb` |
| Admin | `putduk-mining-admin-staging` | `47ac9fc9-b51b-4779-8d7d-6f07da5fd2d7` | `82221d87-2528-432b-b1b9-8a648f966de7` |

Deploy path: `pnpm deploy:vinext` / `vinext-cloudflare` → `cf deploy` (typed `cloudflare.config.ts`).

## Bindings preserved (post-deploy verify)

### Member (`putduk-mining-web-staging`)

Plain text: `ADMIN_APP_URL`, `AI_MODEL_LOW_COST`, `AI_PROVIDER`, `AI_PROVIDER_DISPATCH_ENABLED=true`, `APP_ENV`, `APP_TIMEZONE`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_*`

Secrets present (names only): `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_FREE_API_KEY`, `SUPABASE_SECRET_KEY`, `WITHDRAWAL_DATA_KEY`

`AI_PAID_CALL_AUTHORIZED` was **not** set to `true` (paid cascade remains off; free path OK).

### Admin (`putduk-mining-admin-staging`)

Plain text: `ADMIN_APP_URL`, `AI_PROVIDER_DISPATCH_ENABLED=false`, `APP_ENV`, `APP_TIMEZONE`, `NEXT_PUBLIC_*`

Secrets present: `SUPABASE_SECRET_KEY`, `WITHDRAWAL_DATA_KEY`

## Smoke (UTC ~2026-10-21T13:25Z)

| URL | Result |
| --- | --- |
| `https://mining.putduk.com/` | HTTP **200** |
| `https://mining.putduk.com/login` | HTTP **200** |
| `https://admin.mining.putduk.com/` | HTTP **307** → `/login` |
| `https://admin.mining.putduk.com/login` | HTTP **200** |

## Legal operational note

See `docs/quality/LEGAL-SIGNATURE-REQUIRED-CHECKLIST.md` — operational owner approval recorded; counsel wet-ink review still recommended. No forged attorney signature.

## Explicit non-claims

- Not `LAUNCH_READY` / not PRODUCT COMPLETE for launch surfaces
- Full authenticated E2E runs `39602717185` / `39603235457` were **cancelled** (not green)
- REAL_PAYOUT_NOT_EXECUTED
- Remote Supabase schema apply not performed
- Hosts still use **staging Worker names**; this deploy published SHA `34650ee` onto those Workers
