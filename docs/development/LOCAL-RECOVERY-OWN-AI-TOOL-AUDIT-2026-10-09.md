# Own-state AI tool audit extension

The owner-approved internal read-only names `ai.usage` and `ai.cancelled_history` are added exactly to the existing `ai_requests_tool_name` CHECK and `begin_ai_request_v2` inline allowlist. All ten existing names and the canonical RPC name/arguments remain unchanged. This grants no client write or financial authority, and accepts no wildcard tools.

Migration `20261008210734_ai_own_state_tool_audit_names.sql` was registered through the Supabase CLI and applied only to the fresh scoped local DB. Native `ai_own_state_tool_audit_names.sql` passes five assertions: both names are admitted/audited, existing wallet admission is preserved, an unapproved money name is rejected, and anon/authenticated admission execution is denied. Actual provider lane own-state smoke separately passed with external AI calls and paid calls zero. Final full-chain fresh reset remains pending other schema work.
