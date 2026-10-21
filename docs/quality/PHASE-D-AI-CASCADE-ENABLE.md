# Phase D — AI cascade enable notes (SIMPLIFIED_TRACK)

Date: `2026-10-21`

## Cascade (unchanged order)

1. NVIDIA `openai/gpt-oss-20b` (trial)
2. NVIDIA `google/diffusiongemma-26b-a4b-it` (pre-answer fallback)
3. OpenRouter free `apodex/apodex-1.1-mini:free`
4. OpenRouter paid `anthropic/claude-haiku-5.5` — **only** when `paidCallAuthorized: true`

## This track

| Gate | Action |
| --- | --- |
| Dispatch (any `APP_ENV`) | Set Worker/Pages secret `AI_PROVIDER_DISPATCH_ENABLED=true` + NVIDIA key/model; optional `OPENROUTER_FREE_API_KEY` |
| Production `APP_ENV` | Allowed when the same dispatch switch is `true` (no separate code block) |
| Paid Haiku | `AI_PAID_CALL_AUTHORIZED=true` **and** `OPENROUTER_API_KEY` — default both off; keys alone never authorize |
| Member nav | AI stays demoted from primary IA; `/ai` deep route kept |
| Admin | No AI money mutation; nav label “회원 AI 기록” only |

## Where to set secrets (names only)

- Cloudflare Worker `putduk-mining-web-staging` (bound to `mining.putduk.com`): `AI_PROVIDER_DISPATCH_ENABLED`, `NVIDIA_API_KEY` / `AI_API_KEY`, `AI_PROVIDER`, `AI_MODEL_LOW_COST`, optional `OPENROUTER_FREE_API_KEY`, optional `OPENROUTER_API_KEY` + `AI_PAID_CALL_AUTHORIZED`
- Local: `.env` from `.env.example` (never commit values)

## Human gates still required

1. **AI-KEYS** — owner pastes missing provider keys into Worker secrets (see owner key list)
2. **AI-PAID** — owner sets `AI_PAID_CALL_AUTHORIZED=true` only when Haiku spend is accepted
3. Live provider smoke on staging/prod hosts after secrets land

## Explicit non-claims

- Secrets are not in git
- No paid API calls made by this agent session
- Not PRODUCT COMPLETE for AI partner
