# Visual Lab Reference Captures

This directory stores reviewed, non-sensitive captures derived from `visual-lab-2026.09.27-v1` and production comparison renders.

File naming:

```text
<source>--<screen>--<viewport>--<theme>--<state>.<webp|avif|png>
```

`source` is `benchmark` or `production`. Viewport is `mobile-390`, `tablet-834` or `desktop-1440`. Captures must not contain real user, operator, KYC, financial or credential data. Every capture is visual evidence only and never backend or economic truth.

Capture review status is recorded in `capture-index.json` when images are added.

## Current canonical capture set

- Source: exact local render of Sites commit `a8206957b1cb540291ad4e840e7f8835487e0380`.
- Renderer: loopback-only Chromium; no hosted Site credentials were used.
- Encoding: near-lossless WebP, quality 88, with a SHA-256 digest for every file.
- Stability: fonts and document images were ready before capture; CSS animation and transition were disabled.
- Coverage: all 15 screens in desktop Dark, plus Landing, Login, Signup, START active, START complete, Wallet, PUTDUK AI, Admin Today and Member 360 in desktop Light, mobile Dark and mobile Light.
- Count: 42 captures, 8,062,580 bytes total.

These are benchmark default-state references. Loading, empty, error, success, disabled, unauthorized, offline and reconnect captures are added only when their rendered state is reviewed. Their absence from the current capture index is not evidence that those states passed.

## Current WS-03 production comparison evidence

- Public Landing, Login and Signup: `production-ws03-2026-09-27/` — 14 reviewed WebP captures, 1,220,552 bytes. It includes Desktop/Mobile × Dark/Light default states plus two synthetic Signup validation states. See its `capture-index.json` and `REVIEW.md` for hashes, provenance and remaining benchmark gaps.
- Separate admin Login: `production-admin-ws03-2026-09-27/` — 4 reviewed WebP captures, 83,666 bytes covering Desktop/Mobile × Dark/Light. Authenticated 오늘의 퍼뜩 and Member 360 evidence is explicitly blocked until approved operator, MFA, role and synthetic domain fixtures exist.

Production comparison evidence is not promoted into the canonical benchmark count and does not by itself establish `PRODUCT COMPLETE` or launch readiness.
