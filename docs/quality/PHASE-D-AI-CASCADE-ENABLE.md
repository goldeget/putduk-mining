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
| Non-prod dispatch | Documented: set `AI_PROVIDER_DISPATCH_ENABLED=true` + NVIDIA key/model; optional `OPENROUTER_FREE_API_KEY` (`.env.example`, `docs/ai/PUTDUK-AI.md`) |
| Production `APP_ENV` | Remains **code-blocked** in `isAiProviderDispatchAdmitted` |
| Paid Haiku | Route hardcodes `paidCallAuthorized: false` — keys alone never authorize |
| Member nav | AI stays demoted from primary IA; `/ai` deep route kept |
| Admin | No AI money mutation; nav label “회원 AI 기록” only |

## Human gates still required

1. **AI-PROD** — reviewed code + owner approval to admit `APP_ENV=production`
2. **AI-PAID** — owner approval to set `paidCallAuthorized: true` + provision paid key
3. Live provider smoke in staging with real keys (not performed in this agent session — mocks only)

## Explicit non-claims

- Not live for production users
- No paid API calls made by this track
- Not PRODUCT COMPLETE for AI partner
