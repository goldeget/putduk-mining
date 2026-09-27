# PUTDUK MINING Korean typography audit

Baseline: `ws05/integration` at `4f55c4a1d6ef28181cc05b3de5403e471b2ac578`, merged as `89e56d66dd901d132363e0203d89871827230d09`.

Branch: `ws05/korean-line-break-audit`.

The branch started from the older integration head `869809f8132011ff7ad3aaaa0b3f6adf213021a4` and was updated with a normal merge. It does not edit migrations, money commands, `package.json`, `develop`, `main`, remote Supabase, Cloudflare, or DNS. The workflow change is only the two Korean typography jobs.

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
- public and protected suites are separate workflow jobs, not part of Browser foundation or Authenticated.

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

These older notes are not the acceptance record. The isolated suite on the merged head is.

## Confirmed on the merged head

Public matrix: 70 independent route × viewport × theme cases, including reduced motion on every case and a 390 light 200% pass for landing, login, signup, and admin login.

First isolated run: 29 failed, 41 passed, 9.5m. After the prose patch: 70 passed, 5.5m. Formatter and typecheck passed. Assertions were not relaxed. The public CI job expects this 70 passed result.

Reproduced Hangul splits:

- landing 390 light/dark: `.landing-welcome-proof p` `필요하지`; journey card `경험합니다`; `#trust-title` `가능한`; trust copy `표시합니다`, `않습니다`
- landing 834 light/dark: journey card `필요해요`
- landing 1440 light/dark: journey card `경험합니다`
- signup 390 light/dark: `#signup-title` `시작하는`; consent copy `금액만`
- signup 1440 light/dark: `#signup-title` `에서`, `시작하는`
- trust guides 390 light/dark: aside `적용일을`
- trust guides 1440 light/dark: aside `변경은`
- 390 light 200%: additional splits on the same landing, login, and signup prose, including `확인이`

Not reproduced, so not patched:

- `정보만`, `완료를`, `대신하지`
- 390 light 200% horizontal overflow of the header theme control
- hero mascot horizontal overflow

The patch adds `.ko-heading` and `.ko-copy` (`word-break: keep-all`) only on the confirmed prose, and `.machine-token` (`overflow-wrap: anywhere`) for later machine values. `keep-all` is not applied to `body`.

## Protected screens

`playwright.typography.protected.config.ts` runs the same matrix for the signed-in user and admin routes. Public `playwright.typography.config.ts` ignores those files, so the fake-key public suite stays unchanged.

The earlier failure was the harness, not a broken product login. Two cold `next dev` processes compiled while GoTrue looked up the user, and the local Auth database call returned `request_timeout` (`AuthRetryableFetchError` on the member server action). Direct invalid-credential grants stayed fast. The protected harness now builds both apps and serves them with `next start`, and it opens `127.0.0.1:3199` only after both login pages and a local password-grant probe are ready. Setup projects use the same Desktop Chrome device as the matrix so the admin session fingerprint matches. No remote Supabase project is used.

Local result after that harness and the confirmed wrapping patch: **128 passed** (2 session setups + 70 member cases + 56 admin cases), 9.4m. The 126 rendered cases each attached a full-page screenshot. Exported copies are under `test-results/typography-protected/screenshots/`. Console hydration annotations: 0. The protected CI job expects this matrix. A green run is not `PRODUCT COMPLETE`, and the launch verdict stays **NOT LAUNCH READY**.

The first CI gate did not pass. Public failures were verification list items at 390, plus 200% overflow on the landing header and mascot and 200% splits on login and signup. Protected failures were the desktop sidebar phrase `반영됩니다` at 1440 and a 5px menu overflow at 390 with 200% text. The follow-up patch keeps `word-break: keep-all` on those elements only.

The protected rerun then passed: 128 passed, 126 screenshots, hydration 0, 3.2m. Public `next start` never reached `networkidle` against the fake local API, so those CI servers stay on `next dev`. The landing 200% labels keep whole words. The public step cap remains 15 minutes.

Confirmed wrapping that was patched:

- member home heading `있어요` on `.product-home__welcome h1`
- member wallet, deposit, withdraw, events, and AI prose that split at 390–1440
- 390 light 200% splits across signed-in member `main.product-main` and admin `main.control-main`
- 390 light 200% header identity overflow, contained with `min-width: 0` on `.product-header__tools`
- admin restrictions 200% queue cards, contained with wrapping on `.queue-card__head`

`word-break: keep-all` is on those content roots, not on `body`. `.machine-token` remains `overflow-wrap: anywhere`.

The admin document now applies the saved theme before paint and suppresses the html hydration warning, matching the member document. The matrix recorded no hydration console error.

## Integration protocol

1. Let the active Cursor repair finish on `ws05/integration`.
2. Update this branch from the new integration head without force pushing.
3. Run formatter, typecheck, and the isolated typography suite.
4. Record actual failing selectors and screenshot evidence.
5. Only then make a separate, reviewed CSS patch for confirmed failures.
6. Do not apply `overflow-wrap: anywhere` globally. Reserve it for machine values.
7. Do not apply `word-break: keep-all` blindly to hashes, UUIDs, addresses, codes, or other unspaced machine values.
8. Protected user/admin screens passed the local matrix recorded above. The CI gate checks that same matrix. It does not merge PR #8.

## Completion language

Passing this audit does not by itself make any screen `PRODUCT COMPLETE`. It proves only the tested wrapping and horizontal-overflow conditions for the captured routes and matrix.

Current launch verdict: **NOT LAUNCH READY**.
