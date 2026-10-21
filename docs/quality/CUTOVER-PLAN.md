# Cutover plan — staging-named Workers on public hosts

Date: `2026-10-21`
Track: SIMPLIFIED_TRACK
Account: Cloudflare `putduk-landing` `9dc502d4ef06b3b5374591de6e6933ca`
Hosts: `mining.putduk.com`, `admin.mining.putduk.com`

## Current topology (as of 2026-10-21 owner-authorized deploy)

Public hosts already point at **staging-named** Workers:

| Host | Worker |
| --- | --- |
| `mining.putduk.com` | `putduk-mining-web-staging` |
| `admin.mining.putduk.com` | `putduk-mining-admin-staging` |

Owner authorized publishing an accepted develop SHA onto those Workers. That is the current meaning of “올리다” — not a separate `*-prod` Worker rename.

Evidence pack: `docs/quality/CUTOVER-EVIDENCE-20261021.md`  
SHA served: `34650eeeb51897e09c57401ede1c014f9d3a8d07`

## Still separate (not done by that deploy)

1. Full authenticated E2E green on the exact SHA (`ci-full-e2e.yml`)
2. Counsel wet-ink / attorney signature package (operational checklist only so far)
3. Remote Supabase production apply
4. Real payouts
5. Renaming Workers to non-staging names (optional; not required for hosts to serve traffic)

## Rollback

Re-bind previous known-good Worker version IDs recorded in the evidence pack. Do not delete retained email/security DNS.
