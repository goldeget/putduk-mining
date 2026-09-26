# Security Policy

PUTDUK MINING is a private proprietary repository.

## Never commit
- production secrets
- Supabase secret keys or legacy service-role keys
- private keys
- VAPID private keys
- withdrawal destination encryption keys
- AI provider secrets
- wallet/private signing keys
- user private data exports

## Required principles
- RLS on exposed user-data tables
- server-side authorization for privileged operations
- ledger-first asset changes
- idempotency for settlements and asset-related commands
- audit logs for privileged admin actions
- no raw technical errors exposed to users

Security findings should be handled privately by repository owners rather than opened as public issues.
