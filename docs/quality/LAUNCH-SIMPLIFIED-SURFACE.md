# LAUNCH SIMPLIFIED SURFACE — SIMPLIFIED_TRACK

Status: **ACCEPTED working launch bar** (owner D5 YES · 「실행해」 2026-10-21)  
Label: **SIMPLIFIED_TRACK** (not full V1 PRODUCT COMPLETE)  
Baseline tip SHA: `2d7e903c712726f4540cdbe860d9410935023f4e`  
Workspace: `c:\Dev\putduk-mining` · Remote: `https://github.com/goldeget/putduk-mining.git`  
SSOT: `docs/architecture/FINAL-OWNER-DESIRED-LAUNCH-ARCHITECTURE.md` · runbook `LAUNCH-SIMPLIFICATION-PATCH-ARCHITECTURE.md` §12

---

## Targets verified

| Check | Result |
| --- | --- |
| `git remote get-url origin` | `https://github.com/goldeget/putduk-mining.git` |
| HEAD | `2d7e903c712726f4540cdbe860d9410935023f4e` |
| Branch | `develop` |
| Verdict | `TARGETS_OK` |

---

## Kept member routes (primary IA)

| Route | Role |
| --- | --- |
| `/home` | First viewport: brand + one Korean line + one mining CTA (or 채굴 중) + one balance |
| `/mining` | Live mining status; large primary action |
| `/start` | PUTDUK START trial; unified “채굴 시작” messaging |
| `/wallet` | One KRW balance; deposit / withdraw secondary |
| `/wallet/deposit` | Manual deposit (incl. USDT → KRW principal; never “USDT 잔액”) |
| `/wallet/withdraw` | Withdraw against KRW balance |
| `/login` · `/signup` | Auth (D4 PUT-9 left as-is unless trivial) |
| `/menu` | Thin hub: account, support, legal/trust, optional referral |

Bottom nav (4): **홈 · 채굴 · 지갑 · 더보기**

---

## Admin min (kept)

Deposit queue · withdraw queue · exception / review queue · member lookup — exact admin paths unchanged; no IA expansion in this track.

---

## Hidden / deferred from primary IA (D6)

| Surface | Treatment |
| --- | --- |
| 상품 (`/products`, allocation) | **Removed from bottom nav / sidebar peer CTAs.** Deep links remain for operators/tests; not a launch peer hub. |
| 이벤트 (`/events`) | Deferred from bottom nav and home peer CTAs; optional under thin menu later. |
| AI as peer CTA | Not bottom-nav; not home inline dock. `/ai` may remain deep-link only. |
| Promotion / catalog trees | Not first-viewport |

---

## ASSUMED decisions (Phase A)

| ID | Assumption | Note |
| --- | --- | --- |
| **D1** | Keep public **staging** on mining/admin hosts until cutover day | No deploy/DNS in this phase |
| **D5** | **ACCEPTED** — narrowed PRODUCT COMPLETE / simplified launch bar | Evidence labeled **SIMPLIFIED_TRACK** |
| **D6** | Defer events / AI / products from primary IA | Deep links OK; not peer CTAs |
| **D4** | PUT-9 `/login` mockup — **leave as-is** unless a trivial copy fix | No visual redesign in Phase B |

---

## Mental model (member)

> **「퍼뜩에서 채굴 버튼만 누르면 수익이 쌓여요.」**

Korean content gate: one screen / one idea; no `휴대폰 인증`; no USDT-as-balance; no jargon.

---

## Out of this surface file

- Phase C mining settlement runner connection  
- Phase D AI cascade owner gates  
- Phase E push / PR / merge / CF cutover / remote Supabase  
