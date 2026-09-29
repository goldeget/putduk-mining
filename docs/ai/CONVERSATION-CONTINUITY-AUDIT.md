# PUTDUK AI — Conversation Continuity Audit

Status: **OPEN (honest gap)**  
Lane: C — AI product  
Mode constant: `SESSION_MEMORY_ONLY` (`domain/ai/continuity.ts`)

## Current truth

| Capability | Evidence |
| --- | --- |
| Browser in-memory messages | `components/product/putduk-ai-chat.tsx` keeps React state only |
| Refresh / remount | Messages are cleared; UI copy states this openly |
| Durable conversation tables | **Absent** — no `ai_conversations` / `ai_messages` / safe-summary schema |
| Restore / resume API | **Absent** — only `POST /api/v1/ai/chat` turn admission |
| Cross-device continuity | **Absent** |
| Simulated persistence (localStorage of raw turns) | **Forbidden** — would fake durability |

`docs/ai/PUTDUK-AI.md` and WS-04 already freeze this: durable conversation is a separate gate. Agent ownership of future tables is not this lane’s schema authority without an approved migration plan. Missing continuity must not be papered over.

## What this lane proves instead

1. Authenticated ownership of the AI surface and chat API.
2. Money-mutation denial before tools or providers.
3. Unavailable account-tool data fails closed without fabricated amounts.
4. Provider-unconfigured and provider-failure paths stay honest (no invented financial facts).
5. Session-only continuity is disclosed in Korean UI and covered by browser/unit checks.
6. Themes, viewports, keyboard/focus, reduced motion, and hydration on `/ai`.

## Gate before implementing durable continuity

Approve and ship together (do not half-implement):

- user-owned conversation, message, and versioned safe-summary tables;
- RLS + `FORCE ROW LEVEL SECURITY` and server-only mutation commands;
- retention, export, and deletion policy;
- secret/credential redaction;
- atomic turn start/completion/failure + per-user idempotency;
- cross-user isolation, refresh restore, and cancellation recovery tests.

Until then: **OPEN**. Do not claim PRODUCT COMPLETE for PUTDUK AI conversation continuity.
