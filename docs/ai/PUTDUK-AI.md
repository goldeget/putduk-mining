# PUTDUK AI V1

## Current truth

The authenticated application path, deterministic safety and intent router,
owned read-only account tools, public-knowledge cache boundary, database audit,
real streaming transport and cancellation handling are implemented. Static
public facts and account-state answers backed by the current user's RLS session
work without an external model. No provider is active until `AI_PROVIDER`,
`AI_API_KEY` and an operator-approved `AI_MODEL_LOW_COST` are configured in the
target runtime. A configured code path is not a production launch approval.

## V1 scope

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
  ├─ versioned public-knowledge cache
  ├─ allowlisted UI help
  └─ general-safe provider fallback without account context
→ approved low-cost or high-capability model only where required
→ OpenAI Responses API when required (`stream: true`, `store: false`)
→ allowlisted text delta events only
→ atomic terminal status + usage record
→ browser completion state
```

The browser never calls the provider directly. The provider key remains
server-only. The application forwards only `response.output_text.delta` and a
bounded PUTDUK completion or error event; raw provider events are not exposed.

## Data handling

- Raw user questions are not stored in the PUTDUK database in the current
  implementation.
- `ai_requests` stores a SHA-256 prompt hash, question character count, model
  key, knowledge version, status and bounded error metadata.
- `ai_usage` stores non-negative token counts only after a verified completion.
- The provider request sets `store: false`; this disables normal Responses API
  application-state storage. Provider abuse-monitoring and legal retention
  controls must still be reviewed before production activation.
- Account-tool results are rendered deterministically and are never written to
  the shared response cache or sent to the provider.
- The current cache is an exact prompt/model/knowledge-version cache for public
  PUTDUK knowledge, not a semantic-similarity cache. Semantic caching remains
  gated on an approved embedding model, public-only corpus, similarity threshold
  evaluation and cache-poisoning tests; it must never include account context.
- General-safe prompts contain no account or screen context. UI-help prompts
  contain only schema-validated route/world/product fields and selected-item
  presence flags. Transaction/event UUIDs stay server-side for RLS tool reads
  and are not sent to the provider.
- User IDs are never sent to the provider.

### Conversation continuity gate

Durable conversation/message/summary storage is **not implemented yet**. The
current browser retains only its in-memory messages, so a refresh does not
restore a conversation. This is an explicit functional gap, not simulated
persistence. Before adding it, approve and implement together:

- user-owned conversation, message and versioned safe-summary tables;
- RLS plus `FORCE ROW LEVEL SECURITY` and server-only mutation commands;
- retention, export and deletion policy;
- secret/credential redaction and content protection;
- atomic turn start/completion/failure and per-user idempotency;
- cross-user, refresh restoration and cancellation recovery tests.

Official implementation references:

- [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Text generation and the Responses API](https://developers.openai.com/api/docs/guides/text)
- [Data controls and retention](https://developers.openai.com/api/docs/guides/your-data)

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
- `AiCache` — public-knowledge-only, version and expiry-bound response cache.
- `AiUsage` — server-only admission, terminal state and usage commands.
- `AiReport` — read-only usage projections.

## Runtime configuration

```dotenv
AI_PROVIDER=openai
AI_API_KEY=<server-only-secret>
AI_MODEL_LOW_COST=<operator-approved-low-cost-model-id>
AI_MODEL_HIGH_CAPABILITY=<optional-approved-analysis-model-id>
AI_MAX_OUTPUT_TOKENS=900
AI_MAX_REQUESTS_PER_MINUTE=5
AI_MAX_REQUESTS_PER_DAY=100
AI_CACHE_TTL_SECONDS=3600
```

The repository intentionally does not hardcode a model. Static facts and owned
domain tools are checked first. Only public PUTDUK knowledge is eligible for the
shared cache. General-safe and UI-help answers are never placed in that cache.
Simple provider questions select the approved low-cost model; only explicit
comparative/analytical questions may select the optional high-capability model.
Availability, quality, latency, pricing, data controls and account access must
be approved together. The database enforces the per-user minute and rolling
24-hour admission limits atomically, so concurrent requests cannot bypass them.

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

Before enabling the provider in production, verify the exact model and account,
data-retention controls, monthly budget and alerts, abuse response, Korean answer
quality, prompt-injection tests, streaming cancellation, usage reconciliation,
and authenticated ownership isolation. Durable conversation continuity requires
its separate gate above. Remote Supabase application, provider activation and
production browser evidence remain separate authorization/evidence boundaries;
do not infer readiness from an HTTP 200 response.
