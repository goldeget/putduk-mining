# PUTDUK AI V1

## Current truth

The application path, deterministic fact router, version cache, database audit
boundary, real streaming transport and cancel handling are implemented. Static
public-fact answers work without an external model. No provider is considered
active until `AI_PROVIDER`, `AI_API_KEY` and an operator-approved
`AI_MODEL_LOW_COST` are configured in the target runtime. A configured code path
is not a production launch approval.

## V1 scope

PUTDUK AI answers one question at a time from the canonical public fact registry
in `lib/trust/public-content.ts`. It does not receive wallet rows, ledger entries,
operator data, credentials, private profile data or hidden application state.

It can:

- explain published product identity and boundaries;
- explain PUTDUK START, mining, settlement and funding principles;
- state when the canonical public facts do not support an answer;
- stream the provider's actual output text and expose honest completion,
  interruption and cancellation states.

It cannot:

- mutate a wallet, ledger, settlement or reward;
- approve deposits or withdrawals;
- change economic rules, roles or administrative state;
- claim a private or operational fact that is absent from approved context;
- expose provider reasoning events or hidden instructions.

## Request path

```text
authenticated browser
→ same-origin and payload validation
→ atomic per-user idempotency and rate admission
→ AiGuard
→ canonical static rule
→ versioned response cache
→ approved low-cost or high-capability model route
→ OpenAI Responses API when required (`stream: true`, `store: false`)
→ allowlisted text delta events only
→ atomic terminal status + usage record
→ browser completion state
```

The browser never calls the provider directly. The provider key remains
server-only. The application forwards only `response.output_text.delta` and a
bounded PUTDUK completion or error event; raw provider events are not exposed.

## Data handling

- Raw user questions are not stored in the PUTDUK database.
- `ai_requests` stores a SHA-256 prompt hash, question character count, model
  key, knowledge version, status and bounded error metadata.
- `ai_usage` stores non-negative token counts only after a verified completion.
- The provider request sets `store: false`; this disables normal Responses API
  application-state storage. Provider abuse-monitoring and legal retention
  controls must still be reviewed before production activation.
- The static prompt contains only public facts. User IDs are never sent to the
  provider.

Official implementation references:

- [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Text generation and the Responses API](https://developers.openai.com/api/docs/guides/text)
- [Data controls and retention](https://developers.openai.com/api/docs/guides/your-data)

## Module boundaries

- `AiRouter` — static, cache, low-cost and high-capability route selection.
- `AiContext` — explicit locale and `PUBLIC_FACTS_ONLY` context contract.
- `AiKnowledge` — canonical versioned public fact retrieval.
- `AiPrompt` — provider instruction construction and complete prompt hashing.
- `AiTools` — an intentionally empty V1 provider tool registry.
- `AiCache` — knowledge-version and expiry-bound response cache.
- `AiUsage` — server-only admission, terminal state and usage commands.
- `AiReport` — read-only usage projections.
- `AiGuard` — mutation and internal-data request rejection before provider use.

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

The repository intentionally does not hardcode a model. Static facts and cached
answers are checked first. Unmatched simple questions select the approved
low-cost model; only explicit comparative/analytical questions select the
optional high-capability model. Availability, quality, latency, pricing, data
controls and account access must be approved together. The database enforces the
per-user minute and rolling 24-hour admission limits atomically, so concurrent
requests cannot bypass them.

## Failure semantics

- Missing provider configuration: deterministic fact answers remain available;
  unmatched questions return an honest no-provider answer without an external
  call.
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
and authenticated ownership isolation. Record the evidence and approval; do not
infer readiness from an HTTP 200 response.
