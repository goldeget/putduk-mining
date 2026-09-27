# WS-04 QA evidence (DRAFT — Agent D)

Status: **DRAFT / NOT LAUNCH-READY / NOT PRODUCT COMPLETE**

Branch: `ws04/qa-evidence`  
Base SHA: `71e591cafc6d73be78e2b68bfe0afba5edf9a384`  
Agent role: independent QA only — no product implementation edits  
Origin verified: `https://github.com/goldeget/putduk-mining.git`  
Worktree: `C:\Users\PC\.cursor\worktrees\ws04-qa-9e72d1ab`  
`WORKTREE_ID`: `ws04-qa-9e72d1ab`  
`WORKTREE_START_REF`: `71e591cafc6d73be78e2b68bfe0afba5edf9a384`

This note records contract-lock tests and observable smoke only. It must not be
cited as release readiness, `PRODUCT COMPLETE`, or pgTAP/CI green without the
exact command results below.

## Scope lock

| Action | Status |
| --- | --- |
| Edit `supabase/migrations`, `domain/`, app pages, `apps/admin` UI, `workers/` | **FORBIDDEN** (not done) |
| Push / remote Supabase / Cloudflare | **FORBIDDEN** (not done) |
| Unscoped `docker ps` / prune | **FORBIDDEN** (not done) |
| Contract unit + Playwright additions + this draft | **OWNED** |

## Tests added

| Path | Purpose |
| --- | --- |
| `tests/unit/ws04-domain-command-contract.test.ts` | Executable WS-04 invariants: phone enum leak resistance, USDT deposit snapshot/uniqueness/once-credit, hold/release once, EXTERNAL_SENT then ledger retry without second send, KRW/USDT evidence shapes, START welcome no-funding withdrawals (KRW + USDT), user isolation, reconciliation no auto-repair, frozen public command presence gate |
| `tests/e2e/ws04-transfer-contract.spec.ts` | Signup phone copy (no `휴대폰 인증` / SMS ownership), wallet login isolation, public admin denial |

Baseline floors that must not be weakened: web unit 163, admin unit 12, Playwright 28, pgTAP 222, asset checks 84. New tests are additive.

## Expected failures (strict — do not weaken)

Until Agent A lands WS-04 public functions in a **new** migration, the unit case
`WS-04 frozen public command presence (Agent A gate) > requires every frozen
WS-04 public command in migrations` is expected to **FAIL**. Observed missing
`create function public.<name>(...)` names on this SHA:

- `normalize_signup_phone`
- `signup_phone_availability`
- `set_usdt_deposit_instructions`
- `submit_usdt_manual_deposit`
- `confirm_usdt_manual_deposit`
- `register_krw_bank_destination`
- `register_usdt_withdrawal_destination`
- `request_krw_withdrawal`
- `request_usdt_withdrawal`
- `record_krw_external_send`
- `record_usdt_external_send`
- `finalize_withdrawal_ledger`
- `release_withdrawal_hold`

In-memory harness cases encode the same semantics so the expected behavior stays
locked even while SQL is absent.

## Commands and results

Evidence date: `2026-09-27` (KST), Agent D worktree.

### Asset / unit / admin / e2e

```text
pnpm assets:verify
→ exit 0
→ Verified 84 PUTDUK brand assets (2026.09.27-v1).

pnpm test:web
→ exit 1 (expected Agent A gate failure)
→ Test Files  1 failed | 25 passed (26)
→ Tests       1 failed | 180 passed (181)
→ FAIL only: WS-04 frozen public command presence (Agent A gate)
             > requires every frozen WS-04 public command in migrations
→ Prior baseline floor 163 web unit tests remains covered (180 = 163 + 17 new
  passing contract cases; 1 new failing gate).

pnpm test:admin
→ exit 0
→ Tests  12 passed (12)

pnpm test:e2e
→ exit 0
→ 34 passed (chromium + mobile-chrome)
→ Prior baseline floor 28 Playwright tests remains covered
  (34 = 28 + 6 new: 3 specs × 2 projects).
```

### pgTAP / local DB

```text
pnpm db:start
→ exit 1
→ LegacyLocalDbRunningError / dockerDesktopLinuxEngine pipe missing
→ BLOCKED_LOCAL_DB_RUNTIME
→ pnpm db:test / pgTAP 222 NOT RUN — do not claim passed.
```

### Visual Lab smoke (browser)

Target Visual Lab (reference only, not runtime truth):
`https://putduk-mining-visual-lab-2026.ai-ptk.chatgpt.site/?theme=dark&utm_source=chatgpt.com#worlds`

```text
Visual Lab #worlds (dark):
- Title: 퍼뜩 채굴 — PUTDUK MINING Visual Lab
- Heading: 당신의 여정이 머무는 여섯 개의 월드
- Neutral rank-01 … rank-06 cards; active world CTA 현재 월드 입장
- Badge/context: VISUAL LAB · 예시 데이터; bottom nav 홈/채굴/월드/지갑/이벤트
- Not treated as production money or PRODUCT COMPLETE

localhost http://127.0.0.1:3000/ (worktree pnpm dev, after e2e):
- Title: 퍼뜩 채굴 | PUTDUK MINING
- Public landing hero: 작은 시작이, 나만의 채굴 세계; PUTDUK START CTA
- Trust/copy mentions 최대 5,000원 welcome path; not Visual Lab app shell

localhost http://127.0.0.1:3000/signup:
- Label 휴대전화 present; no 휴대폰 인증 / SMS ownership verified copy
- Copy notes 해당 첫 출금은 사전 입금 불필요 and 최대 5,000원 자격 확인
```

Comparison note: Visual Lab is a dark product-shell benchmark with six neutral
worlds; localhost at this SHA is the public marketing/auth surface, not a
parity claim for authenticated wallet/transfer PRODUCT COMPLETE UX.

## Explicit non-claims

- Not `FOUNDATION COMPLETE` / `FUNCTIONALLY COMPLETE` / `PRODUCT COMPLETE` for WS-04 transfer flows.
- Not a launch gate pass.
- Not evidence that Agent A/B/C implementation is merged.
- Not a pgTAP pass.
