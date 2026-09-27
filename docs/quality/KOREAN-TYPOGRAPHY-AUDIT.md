# PUTDUK MINING Korean typography audit

Baseline: `ws05/integration` at `869809f8132011ff7ad3aaaa0b3f6adf213021a4`.

Branch: `ws05/korean-line-break-audit`.

This branch is intentionally isolated from the active WS-05 CI/auth/worker repair. It adds tests and evidence only. It does not edit product CSS, pages, migrations, money commands, CI workflows, `package.json`, `develop`, `main`, remote Supabase, Cloudflare, or DNS.

## Current finding

Korean-friendly wrapping is partially and thoughtfully implemented, but it is not yet proven across every screen.

Positive evidence in the current source:

- Root documents declare `lang="ko"`.
- The public font stack prioritizes Pretendard, SUIT, Apple SD Gothic Neo, and Noto Sans KR.
- The landing headline keeps `엽니다.` in one explicit line and applies `word-break: keep-all`.
- Major public, authenticated-user, and admin headings apply combinations of `word-break: keep-all`, `text-wrap: balance`, readable line-height, and constrained reading width.
- Machine values such as addresses and hashes use `overflow-wrap: anywhere` in some dedicated components.

Remaining uncertainty:

- The wrapping policy is applied selector by selector rather than through one complete shared typography contract.
- Some cards, status text, queue copy, form feedback, and admin evidence panels do not visibly share the same Korean wrapping rules.
- Several Korean heading widths use `ch`, which measures the `0` glyph rather than a CJK ideograph. A future targeted review may prefer an `ic` fallback pattern where the intent is a Korean character count.
- Long UUID, address, transaction-hash, bank-reference, and idempotency values need a separate machine-token overflow policy and must not inherit Korean prose wrapping.
- Authenticated protected screens still require successful local-auth evidence and are not declared `PRODUCT COMPLETE`.

## Isolation repair after the first CI run

The first PR run exposed that placing this suite under `tests/e2e/` caused the default Browser foundation job to collect it. That job starts only the public application, while this audit intentionally visits the separate admin application on port 3100.

The audit now lives under `tests/typography/`, and `playwright.typography.config.ts` owns that directory exclusively. Therefore:

- `pnpm test:e2e` does not collect typography tests;
- the typography config starts both the public and admin applications;
- the audit uses one Chromium worker, no retries, and a bounded CI global timeout;
- no active WS-05 workflow or package script is changed.

This isolates the audit from PR #7 without weakening assertions or skipping failing routes.

## Added audit coverage

Run:

```bash
pnpm exec playwright test --config playwright.typography.config.ts
```

The suite starts only the local public and admin applications. It does not start a worker and does not contact the remote Supabase project.

Current routes:

Public:

- `/`
- `/login`
- `/signup`
- `/verification`
- `/trial`
- `/withdrawal`
- `/status`

Admin public states:

- `/login`
- `/session-expired`
- `/unauthorized?code=STEP_UP_REQUIRED`
- `/reauth?reason=step-up`

Matrix:

- widths: 390, 834, 1440
- themes: light and dark
- reduced motion enabled
- an additional 390 light pass at 200% root text size for landing, login, signup, and admin login

Each audited route attaches a full-page screenshot before assertions. The test fails when:

1. document width exceeds viewport width; or
2. a visible contiguous Hangul token is rendered on more than one line.

The token check uses rendered character rectangles rather than source-text guessing. Korean words separated by spaces may wrap between words; a single Hangul token may not split between syllables.

## Preliminary evidence from the mixed-suite run

The first CI run is not acceptance evidence because it used the default Playwright config and did not start the admin application. It still produced repeatable public-render findings that the isolated run must confirm:

- 390 light/dark landing: split tokens included `경험합니다`, `정보만`, and `완료를`.
- 834 light/dark landing: split tokens included `확인이`, `가능한`, and `대신하지`.
- 1440 light/dark landing: split tokens included `경험합니다`, `가능한`, and `완료를`.
- 390 light at 200% root text size: document width reached 408 px for a 390 px viewport. Reported offenders included the header theme control and hero mascot.
- Admin public-state checks were blocked by `ERR_CONNECTION_REFUSED` on port 3100 because the wrong Playwright config owned that run.

These are `PARTIAL` findings only. They must be reproduced by the isolated typography config before a product CSS patch is reviewed.

## Integration protocol

1. Let the active Cursor repair finish on `ws05/integration`.
2. Update this branch from the new integration head without force pushing.
3. Run formatter, typecheck, and the isolated typography suite.
4. Record actual failing selectors and screenshot evidence.
5. Only then make a separate, reviewed CSS patch for confirmed failures.
6. Do not apply `overflow-wrap: anywhere` globally. Reserve it for machine values.
7. Do not apply `word-break: keep-all` blindly to hashes, UUIDs, addresses, codes, or other unspaced machine values.
8. Protected user/admin screens are added to this suite only after the authenticated fixture is green.

## Completion language

Passing this audit does not by itself make any screen `PRODUCT COMPLETE`. It proves only the tested wrapping and horizontal-overflow conditions for the captured routes and matrix.

Current launch verdict: **NOT LAUNCH READY**.
