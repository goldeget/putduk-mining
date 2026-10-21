# LAUNCH SIMPLIFIED — Phase B evidence (SIMPLIFIED_TRACK)

Date: `2026-10-21`
Workspace: `c:\Dev\putduk-mining`
Baseline / HEAD at start: `2d7e903c712726f4540cdbe860d9410935023f4e`
Remote verified: `https://github.com/goldeget/putduk-mining.git` (`TARGETS_OK`)
Owner D5: **ACCEPTED** · Label: **SIMPLIFIED_TRACK**
Commit: **not created** (implement + leave working tree; await owner 「커밋해」)

---

## Phase A done

- Wrote `docs/quality/LAUNCH-SIMPLIFIED-SURFACE.md`
- ASSUMED: D1 keep staging until cutover; D6 defer events/AI/products from primary IA; D4 PUT-9 leave as-is

---

## Phase B — files touched (summary)

### Docs
- `docs/quality/LAUNCH-SIMPLIFIED-SURFACE.md` (new)
- `docs/quality/LAUNCH-SIMPLIFIED-PHASE-B-EVIDENCE.md` (this file)

### Navigation / shell
- `components/navigation/product-navigation.tsx` — bottom + mining sidebar: 홈·채굴·지갑·더보기 (상품 removed)
- `components/navigation/mobile-navigation.tsx` — design example aligned
- `components/layout/product-shell.tsx` — floating AI dock removed (deep-link only)

### Home / mining / START / wallet / menu
- `app/(product)/home/page.tsx` + `home.module.css` — first viewport: 퍼뜩 + one line + one CTA + one balance
- `lib/product/home-world-state.ts` — simplified CTA/labels (no products allocation peer)
- `lib/product/mining-presentation.ts` — 채굴 중 / 채굴 시작 messaging; allocation not primary when active
- `app/(product)/mining/page.tsx` — large primary actions; tier link → wallet
- `lib/product/start-page-state.ts` · `components/product/start-trial-button.tsx` · `app/(product)/start/page.tsx`
- `components/product/wallet-overview-view.tsx` (+ css) — one primary balance; ledger only on 내역 tab; USDT manual-deposit hint
- `app/(product)/menu/menu-items.ts` · `components/product/member-menu-view.tsx` — thin menu; events/AI demoted

### Tests aligned to new IA (not assertion weakening)
- unit: `home-world-state`, `mining-presentation`, `start-error-presentation-recovery`
- e2e helpers/specs: `member-session`, `products-catalog`, `catalog-allocation`, `catalog-allocated-home-*`, `home-start-product`, `home-catalog-materials-run`, `mining-product`

---

## First-viewport checklist (SIMPLIFIED_TRACK)

| Rule | Status |
| --- | --- |
| Brand signal (퍼뜩) hero-level | PASS (code) |
| One short Korean line | PASS |
| One primary mining CTA or 채굴 중 | PASS |
| One balance number | PASS |
| No product / event / AI peer CTAs on home | PASS |
| Bottom nav without 상품 | PASS |
| Korean gate (no 휴대폰 인증 / no USDT 잔액) | PASS (wallet hint + existing deposit copy) |
| No emoji core icons | PASS (PutdukIcon / HomeIcon) |

---

## Verify

| Check | Result |
| --- | --- |
| Focused unit (home-world / mining-presentation / start*) | **PASS** — 4 files, 163 tests |
| `pnpm typecheck:web` | **PASS** after e2e helper TS fix |
| Focused E2E | **BLOCKED_E2E** — `http://127.0.0.1:3000` unavailable; no local web stack. Prefer `pnpm test:e2e:auth:file -- tests/e2e/authenticated/home-start-product.spec.ts` when stack ready |
| Full authenticated suite | **Not run** (forbidden by brief) |
| Commit / push / PR | **Skipped** |

---

## Remains

| Phase | Work |
| --- | --- |
| **C** | Mining settlement runner / producer connection (Eligible Funding Principal accrual) |
| **D** | AI cascade enable (owner gates for paid/prod) |
| **E** | Release cutover + go/no-go (human gates) |

---

## Ready for owner

- Working tree holds Phase A+B UX. Ready for owner 「커밋해」 then next phase C (or focused E2E after stack).
