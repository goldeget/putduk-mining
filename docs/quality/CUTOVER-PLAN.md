# Cutover plan — prep only (DO NOT EXECUTE)

Date: `2026-10-21`  
Track: SIMPLIFIED_TRACK  
Account: Cloudflare `putduk-landing` `9dc502d4ef06b3b5374591de6e6933ca`  
Hosts: `mining.putduk.com`, `admin.mining.putduk.com`

## Purpose

Document the **future** staging → accepted production SHA switch.  
**This document does not authorize DNS changes, Worker activate-as-prod, or remote Supabase apply.**

## Preconditions (all required before any cutover command)

1. Exact release candidate SHA reviewed and accepted by owner
2. PR smoke (`ci.yml`) green ≤20m wall clock
3. `.github/workflows/ci-full-e2e.yml` green on that exact SHA
4. Kept-surface PRODUCT COMPLETE evidence for SIMPLIFIED_TRACK journeys
5. Production coupling classified (not UNKNOWN) for the exact deploy target
6. Rollback artifact/version IDs recorded
7. Separate owner written approval naming: SHA, hosts, Worker IDs, rollback

## Planned steps (execution blocked until approval)

1. Inventory current staging Worker/version bindings for both hosts
2. Preserve DNS/email/security configuration (no zone transfer)
3. Deploy accepted artifact to isolated staging verification if needed
4. Switch host bindings only for the two platform hostnames
5. Verify TLS, auth, critical smoke
6. Hold remote Supabase apply as its own approval packet

## Rollback (prep)

- Re-bind previous known-good Worker version IDs
- Do not delete retained email/security DNS
- Record exact timestamps and actors in the cutover evidence pack under authorized QA storage when approved

## Explicit stop

Until the owner names the exact SHA and says to execute cutover, agents **stop here**.
