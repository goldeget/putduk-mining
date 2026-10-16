# PUTDUK AI — Conversation Continuity Audit

Status: **OWNER-ACCOUNT IMPLEMENTATION / PRODUCT GATES OPEN**

Mode: `OWNER_ACCOUNT` (`domain/ai/continuity.ts`).

| Capability | Current evidence |
| --- | --- |
| Owner conversation/body persistence | Existing `ai_conversations` / `ai_messages`, forced owner RLS and server writes; best-effort secret redaction |
| Source/tool/feedback persistence | Existing `ai_answer_sources`, `ai_tool_calls`, `ai_feedback` |
| Refresh/reopen | Browser reads owner conversations and messages, including available source/tool receipts |
| History window | Latest 40 conversations and 120 message rows; omitted earlier rows disclosed; full-history pagination absent |
| Historical financial truth | Save time is displayed separately; current state requires a new question; original lookup `asOf` is not stored |
| Failure restoration | Failed tool receipts restore an error/retry state; missing or inconsistent evidence remains unverified |
| Owner changes | Active answers are cancelled; delayed history/list results are ignored after owner invalidation or observer replacement |
| Summary schema | Present in `20261005064600_ai_conversation_summary_storage.sql`; no generation/summary transmission enabled |
| Provider memory | Only the current redacted question is sent; stored conversations are not appended to provider input |
| Shared provider cache | Disabled for all free-form member turns until a public-only corpus/input selector is approved and verified |

Conversation writes remain sequential. The existing recovery patch verifies
stored bodies and repairs identical missing evidence; it does not supply atomic
multichunk/turn persistence or recover every partial write through actual HTTP
retries. Cancellation/provider failures do not have a durable full-turn state.

Retention, export/deletion, provider input/history/summary scope, learning
publication scores/canary and learning-candidate storage remain policy or
implementation gates. Do not invent those decisions or simulate provider memory.

Deterministic component tests cover late reads after account switch, sign-out,
fresh same-owner verification and new-conversation selection. Reader/presentation
tests cover historical receipts, failure recovery and bounded recent history.
These checks do not replace real PostgREST/RLS ownership tests, browser interaction,
screenshots, visual acceptance or approved provider evaluation.

Do not claim PRODUCT COMPLETE or production activation from these foundations.
