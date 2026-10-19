# PUTDUK AI V1

## Current source truth and evidence boundary

The authenticated member route, deterministic guard/router, owned read-only tools, durable conversation/audit paths and provider streaming/cancellation code exist. Their existence and local mock/native tests do not establish real-provider quality, production activation or PRODUCT COMPLETE. Static public facts and RLS-owned account answers do not require an external model.

The current member route selects the NVIDIA → verified OpenRouter chain in `lib/ai/provider-chain.ts`; it does not dispatch the legacy OpenAI Responses envelope. External routing requires the exact NVIDIA configuration and `APP_ENV !== "production"`. The current production guard therefore keeps provider dispatch off. Configuration presence in a non-production runtime is not permission to call a provider, and staging is not automatically approved.

Real-provider dispatch needs an explicit owner switch, `AI_PROVIDER_DISPATCH_ENABLED=true` (`lib/ai/dispatch-admission.ts`). It is OFF by default in every environment, including staging. A complete key/model tuple without the exact value `true` answers through the deterministic static and owned-tool paths with zero provider calls, and the display gate (`hasConfiguredAiProvider`) reports not configured. Production stays blocked in code even when the switch is on; enabling production needs a separate reviewed code and approval phase. Unit evidence: `tests/unit/ai-chat-dispatch-switch.test.ts`, `tests/unit/ai-display-availability.test.ts`.

The route passes `paidCallAuthorized: false`. Keys, an environment flag, a free-tier label or a budget row cannot authorize a paid fallback. This task's provider opt-in tests remain disabled unless separately admitted; no real-provider completion or cost claim is inferred from member-page HTTP 200.

Owner-account conversation bodies, source/tool receipts and feedback can be stored/reopened. Stored answers are historical, not fresh account lookups. Free-form member turns stay out of the shared response cache. Bounded owner history can be supplied to provider turns under the source boundary described below; safe summary generation and production transmission/retention acceptance remain separate gates.

## V1 scope

This document describes the member-facing AI. The required V1 operator assistant is a separate admin surface with its own live operator authorization and draft-only boundary, documented in `docs/architecture/ADMIN-OPERATIONS-ASSISTANT.md`. Member RLS tools and public response caches never become an operator data channel. Operator facts are not sent to the member provider.

PUTDUK AI has four bounded routes:

1. deterministic denial or clarification;
2. PUTDUK public knowledge;
3. current-user account state through PUTDUK-owned read-only tools;
4. general-safe or allowlisted current-screen help through an approved provider.

Provider models never receive raw wallet rows, ledger entries, KYC evidence,
risk weights, operator data, credentials, private profile records or hidden
application state. Account tools compose their own Korean answer from minimal
RLS-filtered fields and do not delegate financial facts to a model.

It can:

- explain published product identity and boundaries;
- explain PUTDUK START, mining, settlement and funding principles;
- read the authenticated user's minimum necessary wallet, mining, deposit,
  withdrawal, referral, event, notification and KYC status fields;
- answer safe general questions without account context when an approved
  provider is available;
- use only an allowlisted route/world/product/transaction/event screen context;
- state when the canonical public facts do not support an answer;
- stream the provider's actual output text and expose honest completion,
  interruption and cancellation states.

It cannot:

- mutate a wallet, ledger, settlement or reward;
- approve deposits or withdrawals;
- change economic rules, roles or administrative state;
- claim a private or operational fact that is absent from approved context;
- query or disclose another user's records;
- expose KYC evidence, risk weights, protected destinations or private formulas;
- assist prompt injection, reward farming, referral abuse, identity-control
  evasion, device/IP/block evasion or admin escalation;
- expose provider reasoning events or hidden instructions.

## Request path

```text
authenticated browser
→ same-origin and payload validation
→ atomic per-user idempotency and rate admission
→ deterministic safety/policy guard
→ intent and context router
  ├─ denial / clarification / canonical static rule
  ├─ authenticated RLS-owned read-only domain tool
  ├─ canonical public knowledge (free-form shared cache disabled)
  ├─ allowlisted UI help
  └─ general-safe provider fallback without structured account-tool context
→ current fixed NVIDIA/OpenRouter chain only when configured and admitted
→ provider Chat Completions SSE with exact model/endpoint proof where required
→ guarded text deltas only; no reasoning/tool/multimodal output
→ atomic terminal status + usage record
→ browser completion state
```

The browser never calls the provider directly. Keys remain server-only. The current parser admits text from the single Chat Completions choice, verifies model/request/usage and completion evidence, and emits bounded PUTDUK stream events. Reasoning is ignored; tool calls, multimodal content, mismatched identity and incomplete/billing-unverified output are rejected. Raw provider events are not exposed. Legacy Responses helpers remain offline contract-test support, not the current route or a production approval.

## Data handling

- Member questions and completed answers are stored in owner-scoped
  `ai_conversations` / `ai_messages` after best-effort secret redaction. Tool
  failure explanations are also stored. Redaction is not a guarantee that every
  sensitive value is recognized. Never describe this as hash-only storage.
- `ai_requests` stores a SHA-256 prompt hash, question character count, model
  key, knowledge version, status and bounded error metadata.
- `ai_usage` stores non-negative token counts only after a verified completion.
- Do not generalize the legacy OpenAI `store: false` envelope to NVIDIA or OpenRouter. Current OpenRouter requests set a specific verified endpoint, disable provider fallback and request `data_collection: deny` / `zdr: true`. Request fields are not proof of provider retention behavior. Exact account/model/endpoint terms, abuse monitoring and legal retention still need production review; no zero-retention or permanent-free promise is made.
- Account-tool results are rendered deterministically and are never written to
  the shared response cache or sent to the provider.
- Exact prompt/model/knowledge-version cache infrastructure exists, but member
  free-form turns do not read or write it. Enabling a shared cache requires an
  approved public-only corpus and deterministic input selector plus privacy and
  poisoning tests. Semantic caching additionally requires approved embedding
  and similarity evaluation. Topic regexes cannot establish public-only input.
- General-safe request metadata contains no structured account or screen context; question/history text remains subject to the best-effort boundary below. UI-help prompts
  contain only schema-validated route/world/product fields and selected-item
  presence flags. Transaction/event UUIDs stay server-side for RLS tool reads
  and are not serialized as structured provider context. Free text remains subject to best-effort redaction, not a guarantee of identifier removal.
- Structured owner-ID metadata is not serialized into the provider request. Free-text redaction is best effort and does not guarantee that every identifier supplied in a question or history body is removed.

### Conversation continuity gate

Durable conversation and message rows exist in
`supabase/migrations/20261005040000_ai_conversation_storage.sql`.
Answer tool calls, sources, and feedback rows exist in
`supabase/migrations/20261005054518_ai_tool_evidence_storage.sql`.
Summary schema exists in `20261005064600_ai_conversation_summary_storage.sql`,
but no summary generation or summary transmission is enabled. The current route can transmit bounded owner provider history: `provider-history.ts` selects at most 20 recent safe pairs within 48,000 UTF-8 bytes, redacts text, and excludes tool/account-result turns and inconsistent fragments. Structured owner IDs, tool receipts and transaction/event UUID metadata are not serialized into provider history. Free-text question/history redaction remains best effort and does not guarantee removal of every identifier or UUID. Historical assistant text is conversation context, never current account authority.
`domain/ai/continuity.ts` uses `OWNER_ACCOUNT`. The initial page contains up to 40 conversations and the latest 120 message rows. `member-conversation-read.ts` supports stable conversation and message cursors; `putduk-ai-session.tsx` and `putduk-ai-chat.tsx` expose earlier-page loading with owner invalidation, retry and loading states. Restoration joins stored body chunks across message pages. These source paths do not establish complete current browser pagination, ownership, scroll restoration or recovery acceptance.

Restoration reads existing source and tool-outcome receipts under owner RLS.
Failed tools stay retryable; missing/inconsistent receipts are unverified.
Stored `created_at` is labeled as the save time. Original tool lookup `asOf` is
not stored and is never reconstructed from save time. Historical answers tell
the member to ask again for current state. Owner invalidation cancels or ignores
pending history, stream and list results before they can replace cleared state.

The source includes the `append_ai_member_turn` atomic-turn RPC path. Source support is not complete current HTTP/browser recovery proof. Remaining gates include retention/export/deletion policy, actual provider transmission/retention acceptance, multichunk/turn and retry recovery, full owner/restoration/cancellation browser evidence, and safe summary generation.
`docs/ai/CONVERSATION-CONTINUITY-AUDIT.md` is a historical audit and has not been reconciled with the current history transmission, cursor pagination and atomic-turn paths above. Its older absence statements are not current implementation evidence. Schema and unit tests do not establish product completion.

Current implementation references:

- `app/api/v1/ai/chat/route.ts`: actual member dispatch, production guard and paid-call prohibition.
- `lib/ai/provider-models.ts`, `provider-chain.ts`, `provider-registry.ts`: exact models, fallback, current endpoint/pricing proof and bounded registry reads.
- `lib/ai/provider-turn.ts`, `provider-stream.ts`, `provider-history.ts`: provider request, verified streaming and owner-history boundary.
- `lib/ai/member-policy.ts`, `provider-attempts.ts`: policy ceilings and canonical DB admission/attempt receipts.
- `lib/ai/openai-stream.ts`: preserved legacy parser; not evidence that the current member route calls OpenAI.

## Module boundaries

- `AiGuard` — deterministic secret, privacy, privilege, mutation, injection and
  abuse/evasion denial before tools or providers.
- `AiRouter` — account tool, knowledge, UI-help, general-safe, clarification and
  denial selection.
- `AiOrchestrator` — route/context/cache plan and deterministic tool-failure copy.
- `AiContext` — explicit `PUBLIC_FACTS_ONLY`, `UI_HELP` or `GENERAL_SAFE` context.
- `AiKnowledge` — canonical versioned public fact retrieval.
- `AiPrompt` — provider instruction construction and complete prompt hashing.
- `AiTools` — typed PUTDUK-owned, read-only tool registry. Tools are not exposed
  as provider-callable functions and accept no user ID.
- `AiToolExecutor` — current-session RLS reads and deterministic Korean answers.
- `AiCache` — version and expiry-bound cache infrastructure; member free-form
  caching remains disabled pending a proven public-only input boundary.
- `AiUsage` — server-only admission, terminal state and usage commands.
- `AiReport` — read-only usage projections.

## Current provider models and configuration

The current server allowlist is intentionally pinned in source and DB. An environment model name or a key cannot select an arbitrary provider/model:

| Order | Exact source model | Source tier and boundary |
| --- | --- | --- |
| 1 | `openai/gpt-oss-20b` | NVIDIA `trial`; configured chain entry |
| 2 | `google/diffusiongemma-26b-a4b-it` | NVIDIA `trial`; bounded pre-answer fallback |
| 3 | `apodex/apodex-1.1-mini:free` | OpenRouter `free`; current exact Novita/bf16 endpoint and zero-price proof required |
| 4 | `anthropic/claude-haiku-5.5` | OpenRouter paid boundary exists in code but current route never authorizes it |

These are source/policy identifiers, not a claim that a provider currently offers the model, grants a free trial or charges zero. The OpenRouter registry/endpoint proof must match current identity, text-only capability, availability and all applicable pricing fields; unverified/expired metadata fails closed. The request locks that endpoint rather than enabling automatic provider fallback. Missing free-tier key stops the chain; it does not jump to a paid key.

Fallback is permitted only before accepted answer text for network, first-token timeout, 5xx or provider rate-limit failure. Cancellation, Auth rejection, policy/audit failure or begun answer text do not trigger another provider. Each attempt has a durable lease and at most one dispatch; unknown/dispatched paid costs remain reserved rather than being released by a timer.

Example configuration names for a separately admitted non-production runtime; never commit actual values:

```dotenv
AI_PROVIDER=nvidia
AI_API_KEY=<server-only-approved-NVIDIA-key>
AI_MODEL_LOW_COST=openai/gpt-oss-20b
OPENROUTER_FREE_API_KEY=<separate-server-only-key-if-admitted>
OPENROUTER_API_KEY=
AI_FIRST_TOKEN_TIMEOUT_MS=2000
AI_MAX_OUTPUT_TOKENS=900
AI_MAX_REQUESTS_PER_MINUTE=5
AI_MAX_REQUESTS_PER_DAY=100
AI_CACHE_TTL_SECONDS=3600
```

`NVIDIA_API_KEY` is an alias for `AI_API_KEY`; if both are set they must match. `AI_MODEL_HIGH_CAPABILITY` remains a legacy schema field and does not override the fixed current chain. Output tokens and first-token bounds are validated in `lib/env/server.ts`; member requests are atomically capped at five per minute and 100 per rolling 24 hours across providers. The OpenRouter free admission has separate durable per-user counting within the same ceilings. These are application ceilings, not external-provider quota or cost guarantees.

The DB paid budget is a global cumulative cap of 10,000,000 micro-USD (USD10), with atomic spent/reserved accounting and bounded member limits; it is not a monthly reset or spend authorization. Current `paidCallAuthorized: false`, exact model proof and provider/budget guards are independent. Future paid activation requires explicit current human approval and a reviewed code/runtime phase; adding a key or increasing configuration is not that approval.

Static facts and owned tools are checked first. Shared free-form caching remains disabled. Live availability, Korean quality, latency, costs, data controls and account access require actual evidence; they are not established by source constants or the four skipped local provider opt-in suites.

## Failure semantics

- Missing provider configuration: deterministic fact answers remain available;
  account tools remain available; provider-only questions return an honest
  no-provider answer without an external call.
- Account tool failure: terminal `FAILED` audit state and deterministic Korean
  error copy with no unverified number or status.
- A selected transaction/event outside the current user's RLS scope returns no
  record; caller-supplied user IDs are not accepted.
- Duplicate client message ID: `409 AI_REQUEST_ALREADY_EXISTS`; no second call.
- PUTDUK rate limit: `429 AI_RATE_LIMITED`; no provider call.
- Provider rejection or outage: terminal `FAILED` audit state.
- Browser cancellation: upstream abort plus terminal `CANCELLED` audit state.
- Stream without a verified completion event: terminal `FAILED`; never shown as
  complete.
- Usage persistence failure: response is not marked successful.

## Production activation gate

External-provider dispatch is disabled in production by the current guard, and paid calls are unauthorized. Before proposing a separately approved production provider phase, verify the exact model and account,
data-retention and input-transmission controls, cumulative and period budgets with alerts, abuse response, Korean answer
quality, prompt-injection tests, streaming cancellation, usage reconciliation,
and authenticated ownership isolation. Durable conversation continuity requires
its separate gate above. Remote Supabase application, provider activation and
production browser evidence remain separate authorization/evidence boundaries;
do not infer readiness from an HTTP 200 response.
