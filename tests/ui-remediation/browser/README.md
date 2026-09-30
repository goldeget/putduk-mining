# Local client component fixtures

Run from the PUTDUK repository root:

```text
node tests/ui-remediation/browser/server.mjs
```

The server binds only to `http://127.0.0.1:4175`. It uses installed Vite; no package install, Next build, Supabase service, environment file, DB or remote command is required.

| Query | Actual components | Synthetic inputs |
| --- | --- | --- |
| `?fixture=motion` | MiningCore, GuidedQuest | running/lowPower host controls, four real quest targets, tail spacer for offscreen behavior |
| `?fixture=home-motion`, `start-motion` | Production Home/START CSS wrappers, Surface, MiningCore | Protected route replica with explicit synthetic running state and unavailable money/progress; no authentication bypass |
| `?fixture=login` | AuthForm | return path `/wallet`; authentication action blocked |
| `?fixture=signup` | SignupForm | original validation/visibility controls; all availability requests and signup action blocked |
| `?fixture=update-password` | UpdatePasswordForm | component only; no recovery proof or production route guard bypass |
| `?fixture=withdrawal` | WithdrawalForm | clearly synthetic balance/holds, KRW_BANK and USDT_ADDRESS policy rows; command traffic blocked |
| `?fixture=admin-mfa` | MfaGate | synthetic verified factor; no enrollment or real TOTP validation |
| `?fixture=admin-step-up` | StepUpTokenField | KYC_REVIEW family; synthetic invalid-outside-harness token only when selected |
| `?fixture=admin-kyc` | KycReviewForm + StepUpTokenField | synthetic case id, evidence availability checkbox; review action returns a blocked result |
| `?fixture=admin-today` | TodayView | actual snapshot builder consumes fixed synthetic counts/audits; populated/partial/empty host select |

Web fixtures import current `app/globals.css` and `app/productization.css`. Admin fixtures import current admin global CSS, independently of web styles. Actual CSS modules are compiled by Vite. Shared ThemeControl/ThemeRuntime run without stubs, and the same exported theme bootstrap is injected before module rendering. `/fixture-font.woff2` supplies the exact repository `assets/fonts/PretendardVariable.woff2` through a fixture font-face; this verifies the glyph/font file, but does not verify Next's generated font-loader URLs or production CSP.

## Boundaries and controls

All server actions, admin browser SDK methods, analytics, Next navigation and component `window.fetch` calls are intercepted. Underlying browser HTML/CSS/font/module requests are local. Server middleware also rejects `/api/*` and non-GET/HEAD requests. No env file is loaded, no real user or production secret is included, and no enrollment, money or review request reaches any service.

`window.__PUTDUK_FIXTURE__.calls` contains only operation names and relative timing; it deliberately excludes form bodies, passwords, TOTP codes and identifiers. `ready` means the fixture React root mounted, not that a real domain flow or async screen finished. Browser tests must additionally wait for actual component state and font loading.

Use `&sdk=throw` or `&sdk=stall` to select initial SDK failures. Default SDK mode is `ready` with a syntactically valid synthetic verified-factor UUID. Use `&network=throw` (default), `malformed`, `stall`, `json-stall`, `wrong-family` or `success` for local fetch responses. `stall` respects request abort; `json-stall` tests a stalled body after a resolved mock response. SDK/fetch selectors are visible on admin fixtures; switching SDK mode remounts MFA preparation. `success` means a synthetic fixture response only, never genuine authorization. Its MFA session UUID follows the response syntax contract and its step-up token is invalid outside this harness. Use `&phone=throw` or `&phone=stall` for local availability-action failure; the server action remains blocked. `window.__PUTDUK_FIXTURE__.emitAuth("SIGNED_OUT")` drives the stubbed SDK auth listener for client invalidation tests.

Motion selectors are the production `data-motion`, `data-motion-quality`, `data-mining-running`, `data-guided-quest` and `data-guided-quest-coach`. Host controls use `data-fixture-running` and `data-fixture-low-power`. Existing pause, quest dismiss/replay and Escape controls are the actual components.

## Fidelity limits

This is a **client-mounted component fixture**, not Next SSR hydration, a live authenticated E2E test, real MFA proof, server/RLS acceptance or a launch-readiness claim. Wrappers are clearly test-only; visual scene sizing uses a bounded fixture frame and does not prove the production route composition. Balances, counts, policy values, progress and factor data are fixtures, not approved economic data. The password-update component is mounted without asserting that its guarded production route accepts an arbitrary visitor. Root integration separately checks actual Next public routes.

The harness exists exclusively under `tests/`; no production route, auth exception, application dependency on Vite, command contract or data schema is introduced. Use it for accessibility, responsive geometry, actual local component interactions, reduced motion, font glyphs and truthful client failure cleanup evidence, with screenshots labelled as fixtures.

## Regression evidence

After starting the server, run `node tests/ui-remediation/browser/component-evidence.mjs`. It uses one headless Chrome and closes each case context serially. Artifacts are saved under `test-results/ui-motion-remediation/component-browser/`; the JSON records exact tracked-source SHA256 hashes before and after, per-case outcomes, sampled resolved colors, operations and evidence limits. Any source change during a run fails the manifest assertion. `PUTDUK_COMPONENT_CASE_FILTER` permits a targeted repeat; retained cases keep their own manifest digest so a later run cannot silently relabel earlier source evidence.

The base matrix mounts eight actual auth/member/admin components at 390/834/1440 and explicit Light/Dark plus System with both OS preferences. Additional cases cover blocked auth-action error UI, signup availability failures, SDK and fetch/body stalls, MFA response syntax, step-up stale-token invalidation, KYC evidence failure, truthful Today populated/partial/empty presentation, local-font failure, live System changes and 200% text-only enlargement. Only timeout/expiry cases fast-forward actual browser timers after observing the in-flight operation. The 200% stress doubles resolved element font sizes; it is explicitly not a native browser-zoom claim. Admin danger/warning/gold probes use actual CSS classes in clearly labelled synthetic markup, separate from actual domain-state components.

The full component runner has 148 cases: 96 base matrix, 25 failure/recovery cases, 12 enlarged-text cases, 12 paired Light/Dark contrast cases, two blocked-font cases and one live System transition. Source hashes before and after cover 33 consumed files; every case stores the manifest digest. A full repeat is required for final evidence after shared source changes.

Contrast checks alpha-compose resolved sRGB text/background samples only where no background image, gradient or opacity makes the sampling unsupported. Field borders use the actual CSS `background-clip`: `border-box` composites an alpha border over the field interior, while padding/content-box uses the exterior background. The runner samples normal/hover/focus after transitions settle, records actual outline and colored-shadow indicators, and asserts supported editable inner boundaries at 3:1. Border/focus samples retain separate support limits. Disabled colors are recorded without an AA requirement. Decorative button boundaries are recorded without inheriting the editable-field threshold. These results do not prove whole-page WCAG conformance or production financial/authentication correctness.

Final screenshots follow the names in `results.json`; retained earlier failure screenshots belong in `discovery/`. Discovery artifacts should not be presented as final source acceptance.
