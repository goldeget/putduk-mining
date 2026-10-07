# PUTDUK parallel build coordination

Primary continues member presentation, backend/API, mining, wallet/ledger, deposits/withdrawals, Supabase/RLS/security, shared configuration/CI, Member AI backend, Admin AI backend/authorization and final integration. Secondary owns Admin presentation and its dedicated UI tests. Keep both accounts' current work; do not restart, reset unrelated files or create unnecessary worktrees.

The [ownership manifest](parallel-build-ownership-2026-10-07.json) records the 66 existing Secondary files and SHA256 values verified at checkpoint `7b34cd3ef30c4b746733e2c439a537247f009344`, plus its allowed new paths. Read the actual branch, HEAD and working tree for every new wave. Those fingerprints are conflict checks; they do not authorize restoring older files. The implementation baseline is latest verified `origin/develop`, never the old main document scaffold.

Primary must not edit the listed Secondary presentation files. Secondary must not edit Admin `lib/**`, `app/api/**`, `actions.ts`, root/control layouts, `proxy.ts`, `review-confirmation.ts`, package/Next/TS configuration, shared backend/finance/security, Supabase or CI. Classify unknown files before editing. Request a contract change from Primary while continuing independent presentation work.

Preserve these shared interfaces:

- Member search: `POST /api/v1/admin/members/search`, `{query}`; normalized name/login ID/full phone/UUID input, masked `members`/`hasMore`, AAL2/roles, audited access before reads, no-store/Vary Cookie and literal SQL pattern escaping.
- Admin AI context: `POST /api/v1/admin/assistant/context` to `{data: AssistantContextReport}`; `canExecute:false`, allowed fact/navigation classes, role/step-up/audit checks. Approved deterministic commands own financial execution.
- AdminShell keeps server principal handling, children, logout-all and theme contracts. Whole server principals/private Supabase clients do not enter Client components.
- Financial step-up, idempotency, source/draft/recovery callbacks stay intact. Member principal recovery v3 stays separate from reward withdrawal v2. Secrets/service-role keys remain server-side.

Secondary reconstructs presentation, including JSX/DOM/component hierarchy when needed, against approved references while retaining those contracts. Validate actual browser behavior, responsive Korean typography, themes, loading/empty/error/recovery, overflow, accessibility, console/network and buttons. Preserve financial assertions and original test deadlines.

Before integration, require explicit wave closure, exact base/head, changed paths/hashes, actual checks and scoped browser evidence. A returned patch alone does not close a wave. Compare fingerprints before applying it; do not build or test inputs another account is editing in a shared workspace.

Every checkpoint includes `PRIMARY OWNED PATHS`, `SECONDARY SAFE PATHS`, `NO-TOUCH PATHS`, `SHARED CONTRACTS`, `CURRENT BRANCH` and `EXACT HEAD`, plus changed/current/next-wave files and a reviewable local commit/bundle/PR. Exact HEAD is the observed checkout, not a saved historical manifest value.

Before any push/merge/tag/dispatch/database application/deployment, determine the exact action's automatic production coupling. Unknown coupling is blocked. Live-impacting actions require explicit human approval for the exact candidate, target and effects. No remote Supabase, Cloudflare or DNS writes are authorized. Transport local work with a verified bundle when remote action remains blocked.
