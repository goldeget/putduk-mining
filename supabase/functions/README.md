# Edge Functions

No Edge Function is deployed in the foundation phase.

Privileged functions must:

- validate an authenticated user and server-side authorization;
- never trust `user_metadata` for roles;
- keep service credentials server-only;
- use idempotency keys for asset-affecting commands;
- emit an audit record for high-risk operations;
- return user-safe errors without database internals.
