# UI·UX·애니메이션 갭 — PROPOSED R4/FINAL 대비 (2026-10-10)

**상태:** 검토 전용 감사 산출물. **PROPOSED·RESTORED·Work mockup은 사용자 승인 전 production truth가 아니다.**

**증거 위치 (Git 외부):** `F:\PUTDUK-MINING-QA\design-review-2026-10-10\`  
**매니페스트:** `manifest/sha256-manifest.csv` (579행), `manifest/dedupe-canonical-table.csv` (52 논리 키)

**정본 잠금 (repo):**

| 잠금 | 경로·식별 |
| --- | --- |
| 브랜드·랭크 마스터 | `docs/design/visual-references/` (`putduk-brand-master-reference.png`, `putduk-rank-master-reference.png`) |
| 제품 UX 벤치마크 | `docs/design/visual-lab/` — **visual-lab-2026.09.27-v1** |
| 시각 방향 | `docs/design/PUTDUK-VISUAL-DIRECTION.md` |
| 모션 | `docs/design/PUTDUK-MOTION-EXPERIENCE.md` |
| 테마 | `docs/design/PUTDUK-THEME-SYSTEM.md` |

**연계:** [07_SAFE_INTEGRATION_CANDIDATE.md](./07_SAFE_INTEGRATION_CANDIDATE.md) — 보존·CI 통합 wave 이후 UX wave 착수 권장.

---

## 1. 첨부물 목록·용도

| 입력 | 역할 | bundle 분류 | 비고 |
| --- | --- | --- | --- |
| `PUTDUK_R4_FOLLOWUP_24_PROPOSED.zip` | R4 follow-up **24화면** 상태·액션 PROPOSED PNG + `SCREEN_STATE_ACTION_MANIFEST.json` | **PROPOSED (R4F)** | PWA·출금 처리·구독 취소·AI·운영자 step-up 등 **신규 상태 기계** |
| `PUTDUK_FINAL_DESIGN_PROPOSED.zip` | FINAL 패키지: scene/animation spec, 갤러리 HTML, `CURRENT_VALID_CAPTURE_INDEX.json`(34), 대량 원본·인덱스 | **PROPOSED (FINAL)** | **2026-10-10** 타임스탬프; umbrella + scene L0–L4 계약 |
| `PUTDUK_R4_RESTORED_REVIEW.zip` | R3/R4 **복원 검토** 40화면 + `MINIMAL_CHANGES.html` + 5건 라벨 diff | **RESTORED (review bundle)** | `selection: RESTORED_BASELINE_REVIEW_NOT_OWNER_APPROVAL` |
| `PUTDUK_R4_FOLLOWUP_REVIEW.html` | 24화면 갤러리(standalone) | **PROPOSED review HTML** | zip 내 동일 파일과 **SHA-256 일치** |
| `PUTDUK_MINIMAL_CHANGES.html` | 5건 before/after 갤러리(Downloads) | **PROPOSED review HTML** | REST zip `MINIMAL_CHANGES.html`과 **해시 불일치** — 별도 export 취급 |

**SHA-256 (소스 아카이브·HTML):**

| 파일 | SHA-256 |
| --- | --- |
| `source-zips/PUTDUK_R4_FOLLOWUP_24_PROPOSED.zip` | *(manifest CSV bundle=SOURCE_ZIP)* |
| `source-zips/PUTDUK_FINAL_DESIGN_PROPOSED.zip` | *(manifest CSV)* |
| `source-zips/PUTDUK_R4_RESTORED_REVIEW.zip` | *(manifest CSV)* |
| `PUTDUK_R4_FOLLOWUP_REVIEW.html` | `991c4fae756d8276443097d068329b21398f6db36a6f2cd706bd251da0bde452` |
| `PUTDUK_MINIMAL_CHANGES.html` (Downloads) | `894e78860a863be69f463723650a745387ae7c0a82c1875a1cf84fd5164a73d5` |
| `MINIMAL_CHANGES.html` (REST zip) | `9b64af5da556118a72644e4397dc3dba4bbe71b8d25778f4477892928a798ff7` |

전체 추출 파일 해시는 `F:\PUTDUK-MINING-QA\design-review-2026-10-10\manifest\sha256-manifest.csv` 참조.

---

## 중복·정본 구분

### dedupe 통계 (2026-10-10 추출 기준)

| 지표 | 값 |
| --- | --- |
| 매니페스트 파일 수 | **579** |
| 고유 SHA-256 | **334** |
| IDENTICAL 그룹 (동일 해시 ≥2) | **168** 그룹 |
| 중복 인스턴스 (이중 집계분) | **245** |
| 이미지·HTML 파일 | **386** |
| 이미지 IDENTICAL 그룹 | **106** |
| R4F 24화면 ↔ RESTORED PNG 해시 겹침 | **19** / 24 |

### 분류 규칙 적용 요약

| 분류 | 의미 | 대표 사례 |
| --- | --- | --- |
| **IDENTICAL** | 바이트 동일 | R4 zip ↔ Downloads `PUTDUK_R4_FOLLOWUP_REVIEW.html`; 세 zip 공통 `contracts/*`, `brand_references/*`, 일부 PNG |
| **NEAR_DUPLICATE** | 동일 화면·상태, export/메타만 상이 | Downloads `PUTDUK_MINIMAL_CHANGES.html` vs REST `MINIMAL_CHANGES.html`; 동일 route·theme·다른 viewport JPG |
| **SUPERSEDED** | 구버전 R4F → 신규 after | `MINIMAL_CHANGE_INDEX.json` 5건: `after` PNG가 `comparison_previous/*R4F*` before supersede; FINAL 패키지가 R4-only 산출물보다 **날짜·spec 범위**에서 umbrella 우선 |
| **UNIQUE** | 단일 bundle 전용 | R4F 전용 상태 ID 5건(REST hash 미일치); FINAL `SCENE_ASSET_AND_ANIMATION_SPEC.md`; REST scene master 2건 |

### PROPOSED vs RESTORED — 화면군별 authoritative 후보

| 화면군 | PROPOSED (구현 참조용) | RESTORED (review bundle) | repo 정본 |
| --- | --- | --- | --- |
| 회원 홈·채굴 composition | FINAL scene spec + visual-lab | `screens/member/*`, scene masters | **visual-lab-2026.09.27-v1**, `PUTDUK-VISUAL-DIRECTION.md` |
| PWA·알림 저장 상태 4종 | **R4F manifest** + MINIMAL `after` 라벨 | `screens/pwa/*` (9) | 알림 도메인 contract + 구현 `/menu/notifications` |
| 구독/취소 5종 | **R4F manifest** | member REST (일부 overlap) | *(승인 전)* |
| 운영 출금·지급 결과 3종 | **R4F manifest** | admin REST overlap | `apps/admin/.../withdrawals/*` |
| AI 7상태 | **R4F manifest** + MINIMAL AI-ERROR/LIMIT after | `screens/ai/*` (11) | `PutdukAiChat` + session states |
| EV/HBM scene master | FINAL `NEW_MOCKUP_INDEX` / scene layers | **REST** `P06`/`P07` | **SEMICONDUCTOR_MEMORY**만 approved pack; EV/HBM은 PROPOSED |
| 로그인·가입 viewport | FINAL `current-valid/*` (34) | admin/member REST | 구현 `app/login`, `app/signup`, admin login |

### logical_screen_id 정본 표 (갭 행과 1:1 — 이중 집계 없음)

| logical_screen_id | best_reference_file | duplicates_ignored | notes |
| --- | --- | --- | --- |
| `canonical/visual-lab-benchmark` | `docs/design/visual-lab/` visual-lab-2026.09.27-v1 | 모든 PROPOSED PNG/HTML | Art direction·composition **최종 정본** |
| `canonical/scene-semiconductor-approved` | `docs/design/generated-masters/semiconductor-memory-v3-clean-2026-10-03/` + `public/` manifest | REST P06/P07 PROPOSED | owner-approved **SEMICONDUCTOR_MEMORY** only |
| `scene/p06-ev-mobility-scene-master` | `PUTDUK_R4_RESTORED_REVIEW/screens/scenes/P06-*.png` | FINAL originals overlap (hash dup) | RESTORED review; **승인 전** runtime 연결 금지 |
| `scene/p07-hbm-fab-scene-master` | `PUTDUK_R4_RESTORED_REVIEW/screens/scenes/P07-*.png` | 동일 | 동일 |
| `member/home-dominant-scene` | visual-lab + `PUTDUK-VISUAL-DIRECTION.md` § owner layout | REST member PNG, FINAL partial | `app/(product)/home` — MiningCore; **dominant scene·AI launcher** 밀도 갭 |
| `member/mining-live-stage` | FINAL `SCENE_ASSET_AND_ANIMATION_SPEC.md` | REST/FINAL raster duplicates | `MiningLiveStage` + `SceneDecoration`; L2–L3 **미검증** |
| `member/auth-login-signup` | FINAL `current-valid/member-login|signup-*` | 30 viewport matrix duplicates | 다크/라이트·폭별 **캡처만**; 전 route UX 아님 |
| `admin/auth-login` | FINAL `current-valid/admin-login-*` | 4 captures | `apps/admin/app/login` |
| `flow/pwa-notification-preferences` | R4F `images/PWA-*-R4F-PROPOSED.png` | REST pwa 9 + hash overlap; MINIMAL `after` 3건 | `/menu/notifications` — **저장 중/완료/실패** 전용 UI 갭 |
| `flow/member-subscription-cancel` | R4F `CANCEL-*`, `RECALL-*` | REST member overlap | **취소 상태 기계** 구현 증거 부족 |
| `flow/admin-payout-resolution` | R4F `PAYOUT-*` | REST admin overlap | KRW/USDT 출금 운영 화면 — **결과 unknown/failed** UX |
| `flow/admin-step-up-final` | R4F `OPERATOR-AUTH`, `FINAL-CONFIRM` | MINIMAL FINAL-CONFIRM after | `reauth`, withdrawals step-up — preview 카드 밀도 |
| `flow/admin-retry-snapshot` | R4F `ADMIN-PC/M/LIGHT` | REST admin | 운영자 **동일 snapshot 재시도** 연출 |
| `flow/ai-conversation-states` | R4F `AI-*-R4F` + MINIMAL AI after | REST ai 11 | `PutdukAiChat` — keyboard/stream/stop/limit **전용 layout** |
| `admin/money-deposits-withdrawals` | REST admin + visual-lab admin refs | R4F payout subset | `deposits/usdt`, `krw`, `withdrawals/*` — money table polish |
| `admin/kyc-members-restrictions` | REST `KYC-R3-*` 등 | hash dup with REST | list/detail **PRODUCT COMPLETE** 미달 가능 |
| `bundle/review-gallery-html` | `source-html/PUTDUK_R4_FOLLOWUP_REVIEW.html` | zip 내 동일 | 검수용; runtime 아님 |
| `bundle/minimal-diff-html` | REST `MINIMAL_CHANGES.html` | Downloads HTML (NEAR_DUPLICATE) | 5건 라벨 diff |

*(전체 52행: `F:\...\manifest\dedupe-canonical-table.csv`)*

---

## 2. 화면별 대조표 (논리 flow 1행)

| logical_screen_id | 목업/제안 (best reference) | 현재 구현 (repo) | 갭 | 우선순위 |
| --- | --- | --- | --- | --- |
| `member/home-dominant-scene` | visual-lab: 지배 scene + `상세 보기` + AI face + 5-tab | `app/(product)/home/page.tsx`, `MiningCore` | scene 비율·금속/유리 재질·정보 계층이 벤치마크 대비 **flat**; AI launcher visual weight | **P0** |
| `member/mining-live-stage` | FINAL scene spec 8-state; rank master cinematic | `MiningLiveStage`, `scene-decoration.tsx`, `mining/page.tsx` | L2 effect·L3 기구 motion **스토리보드만**; EV/HBM 미승인; IDLE→VERIFIED 전환 **정적 위주** | **P0** |
| `member/wallet-deposit-withdraw` | visual-lab wallet; PROPOSED finance specimen | `wallet/page.tsx`, deposit/withdraw routes | 카드·영수증·한국어 gate(한 화면 한 메시지) ** polish** | **P1** |
| `member/products-catalog` | visual-lab catalog | `products/page.tsx`, `published-catalog-view` | operator catalog 연동 UI는 있으나 **premium catalog scene** 부족 | **P1** |
| `flow/pwa-notification-preferences` | R4F PWA 4 states; MINIMAL 라벨 | `menu/notifications/page.tsx`, `NotificationPreferencesForm`, `PushControl` | **저장 중·서버 확인·실패·재시도** 상태 카드·revision 예시·토글 lock **미구현** | **P0** |
| `flow/member-subscription-cancel` | R4F 5 states | *(전용 cancel flow route 미확인)* | 취소 진행·홀드 해제·거절·revision conflict **상태 UI 없음** | **P0** |
| `flow/admin-payout-resolution` | R4F PAYOUT complete/failed/unknown | `withdrawals/krw-bank`, `withdrawals/usdt` | 지급 **결과 불명·실패 확정** 운영자 UX·evidence card | **P0** |
| `flow/admin-step-up-final` | R4F OPERATOR-AUTH, FINAL-CONFIRM | `reauth/page.tsx`, MFA, withdrawal step-up E2E | final approval preview·step-up **visual parity** | **P1** |
| `flow/ai-conversation-states` | R4F AI 7 + MINIMAL error/limit | `PutdukAiChat`, `app/(product)/ai/page.tsx` | long transcript, keyboard overlay, stream, stop, limit **전용 화면** | **P1** |
| `admin/money-deposits-withdrawals` | REST admin money; R4F payout | admin deposits/members pages (local dirty) | USDT/KRW **browser money** E2E 있으나 PROPOSED table density·상태 pill | **P1** |
| `admin/kyc-members-restrictions` | REST KYC/member PNG | `kyc/page.tsx`, `members/page.tsx`, `restrictions/page.tsx` | review queue **empty/error/recovery** premium | **P2** |
| `member/auth-login-signup` | FINAL 30 captures | `app/login`, `app/signup` | responsive typography·theme flash — 부분 충족, **visual-lab 대조** 필요 | **P2** |
| `scene/p06-ev`, `scene/p07-hbm` | REST scene PROPOSED | `scene-registry.ts` — **SEMICONDUCTOR only** active | EV/HBM family **연결 승인 전** | **P2** (승인 게이트) |
| `rank/world-cards` | `putduk-rank-master-reference.png` | `public/ranks/rank-01…06` neutral | rank card **cinematic elevation** motion | **P1** |

---

## 3. 애니메이션·모션 연출 갭

| 영역 | PROPOSED/FINAL 기대 | 현재 repo | 갭 |
| --- | --- | --- | --- |
| **모션 토큰** | `PUTDUK-MOTION-EXPERIENCE.md` Micro 120–180ms … Cinematic 600–1400ms | `--motion-fast/standard/slow`, `lib/motion/motion-preference` | 토큰 **foundation**; route별 cinematic **미적용** |
| **채굴 scene** | FINAL spec: RUNNING 300–600ms, SETTLING pulse, VERIFIED ≤900ms/receipt | `SceneDecoration`, server `running` hint | **타이머 기반 progress 없음**(good); L2 RAF·receipt dedupe **미검증** |
| **랭크·월드** | rank master cinematic; neutral rank-01…06 | static assets + CSS | elevation·shared-object transition **없음** |
| **카드·패널** | metal/glass, component tier 180–280ms | `Surface`, product CSS + reduced-motion media queries | shadcn-default 잔여·**press/focus** 일관성 |
| **페이지 전환** | spatial 240–420ms | Next App Router default | **의도적 spatial continuity** 미구현 |
| **reduced-motion** | parallax/3D off; opacity ≤100ms; evidence 유지 | `@media (prefers-reduced-motion)` 다수; `MiningLiveStage` paused | `data-motion-quality` 테스트 있음; **scene RAF complete stop** FINAL spec “미검증”과 일치 |
| **mining visuals** | L0–L4 분리; HTML HUD only for money | `MiningLiveStage` children slots | **L3 robot/wafer** — raster stretch 금지; geometry **blocked** |

---

## 4. 승인 전 자동 적용 금지 항목

1. PROPOSED PNG/SVG의 **픽셀 내 한글** → HTML/CSS copy source로 사용.
2. R4F·REST **`runtimePassed: false`** 화면을 PRODUCT COMPLETE 근거로 기록.
3. EV/HBM scene master를 **catalog/runtime default**로 연결 (`scene-registry` 승인 없이).
4. FINAL `SCENE_ASSET_AND_ANIMATION_SPEC`의 L1 effect-zone SVG를 **정밀 mask**로 treat.
5. PROPOSED **경제 숫자·rank 이름·혜택**을 seed/ledger/config에 반영.
6. Downloads zips/HTML을 **git commit** 또는 `public/` drop-in.
7. visual-lab·visual-references를 PROPOSED bundle로 **대체**.

---

## 5. 권장 작업 순서 (UX wave)

1. **보존·CI** — [07_SAFE_INTEGRATION_CANDIDATE.md](./07_SAFE_INTEGRATION_CANDIDATE.md) PR #72 merge·develop sync·E2E green.
2. **정본 고정** — visual-lab vs R4/FINAL diff sign-off (owner); MINIMAL 5건 라벨 승인.
3. **P0 flows** — PWA notification save state machine; admin payout outcomes; cancel flow UI (domain 연동).
4. **P0 scene** — `MiningLiveStage` L2 against approved SEMICONDUCTOR only; performance baselines.
5. **P1** — AI 7-state layout; home/mining composition; rank card motion; admin step-up preview.
6. **P2** — auth viewport polish; KYC/members; EV/HBM **승인 후** catalog hookup.
7. **증거** — Visual Lab screenshot compare, typography-protected, browser E2E, reduced-motion capture.

---

## 6. PRESERVE_OUTSIDE_GIT

| 권장 | 경로 |
| --- | --- |
| **원본 zip 보관** | `F:\PUTDUK-MINING-QA\design-review-2026-10-10\source-zips\` |
| **추출물·매니페스트** | `F:\PUTDUK-MINING-QA\design-review-2026-10-10\` (`manifest/`, bundle dirs) |
| **Git에 넣지 않을 것** | Downloads zip, 대용량 PNG/HTML, `sha256-manifest.csv` 전체 |

repo에는 **본 감사 markdown**만 커밋 후보. 디자인 실물은 QA 볼륨 **F:** (또는 ESD-USB 정책 시 `D:\PUTDUK-MINING-QA\`)에 유지.

---

## 부록: 소스 zip SHA-256 (SOURCE_ZIP)

| 파일 | SHA-256 |
| --- | --- |
| `PUTDUK_R4_FOLLOWUP_24_PROPOSED.zip` | `3f095842e42560b6af281ad7cbe8d2cba00456cdd799bcfc24f2569c4e94f0e6` |
| `PUTDUK_FINAL_DESIGN_PROPOSED.zip` | `96cb71a2b5d2732c7c689e28cfd7e9d83c5d6fe2a2e6adf0844bd54c94bbf5be` |
| `PUTDUK_R4_RESTORED_REVIEW.zip` | `6443eeee3190ea2152189f4085dcc810a7e80db8f7a759e3202756dda61e8b96` |

전체 추출 파일: `manifest/sha256-manifest.csv`. 추출 완료: 2026-10-10 (3 zip + HTML copy).

---

*생성: design-review extraction + repo read-only contrast. 제품 UI 코드 변경 없음.*
