# WS-03 production visual evidence review

Reviewed on 2026-09-27 against the matching Landing, Login and Signup captures in `../benchmark-v2026-09-27/`.

## Evidence boundary

- These 14 WebP files are full-page renders of the current public Next.js production build, not prototype captures.
- Every route returned HTTP 200 on a loopback-only server. External requests were blocked. Synthetic, non-production environment values were used and no credentials, user records or financial records appear.
- Desktop uses a 1440 × 1000 viewport and mobile uses 390 × 844. Dark and Light were explicitly selected. Reduced motion was requested; CSS animations and transitions were disabled after load; fonts and images were ready before capture.
- The two validation captures use synthetic text only and demonstrate login-ID format and password-match feedback. They are not evidence of a completed signup or remote backend behavior.
- `capture-index.json` records exact path, route, HTTP status, viewport, theme, state, byte size and SHA-256 for every image.

## Reviewed strengths

- The exact `퍼뜩` brand spelling, restrained Black/Gold palette, premium typography and real HTML copy are consistent across both themes.
- Landing communicates virtual mining, server-continuing status, KOREA entry, five worlds, the conditional KRW 5,000 ceiling and the no-prior-funding first-withdrawal rule without exposing formulas.
- Login keeps account-enumeration-safe copy and presents recovery paths, password visibility and primary/secondary actions clearly.
- Signup contains the required identity, recovery, credential and consent fields. Its reviewed validation state has visible error color, focus treatment and natural Korean recovery copy.
- Mobile layouts are intentionally recomposed rather than a clipped desktop canvas. All reviewed controls remain readable and touch-sized.
- Light mode is a designed warm-paper surface rather than an inverted dark theme, while Dark retains the canonical cinematic contrast.

## Meaningful benchmark gaps

These gaps mean the three screens are reviewed production evidence, not a claim that the complete product is `PRODUCT COMPLETE`.

1. **Landing immersion:** production uses an editorial inset world/mascot panel and more vertical whitespace. The canonical benchmark has a more immersive full-bleed hero, stronger planetary depth and a larger character presence. Production clarity is stronger, but the cinematic intensity remains lower.
2. **Login composition:** production's split editorial layout is clear and polished, but it does not reproduce the benchmark's full-bleed mascot backdrop and centered high-focus login object. The current treatment needs a future intentional acceptance decision or a closer cinematic pass.
3. **Signup interaction:** production exposes the complete form in one continuous view. The benchmark communicates staged progress with a three-step journey. The current form is honest and functional, but the long mobile scroll and absence of progressive staging remain a material interaction gap.
4. **State breadth:** signup validation is captured, but login failure/recovery success, submit-pending, offline/reconnect and final signup success were not exercised in this non-connected evidence session.
5. **Motion and performance:** captures intentionally freeze motion. They do not prove motion quality, Web Vitals, long-task behavior, GPU cost or memory lifecycle.

## Gate conclusion

The rendered Landing, Login and Signup default states pass the WS-03 evidence requirement for Desktop Dark, Desktop Light, Mobile Dark and Mobile Light. Signup validation has additional reviewed evidence. Because the benchmark gaps and uncaptured connected states above remain, this review must not be used as a launch-readiness or full `PRODUCT COMPLETE` claim.
