# /login PUT-9 시각 GAP — 디자인 결정 대기 (2026-10-18)

Status: **BLOCKED** (Product 디자인 결정 전 구현 변경 금지)

Worktree: `C:\Users\PC\Desktop\putduk-mining\.worktrees\cloud-ui-20261012`
Linear: [PUT-9](https://linear.app/putduk-mining/issue/PUT-9/full-visual-acceptance-mockup-truth-vs-browser) · [PUT-22](https://linear.app/putduk-mining/issue/PUT-22/cloud-codex-제품-uiux를-최종-기준으로-복구통합전체-수용)
관련 증거: `VISUAL-ACCEPTANCE-ROUTE-MATRIX-20261018.md` (`/login` 행), `CURSOR_HANDOFF_20261017.md`, 목업 `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261017-run-03\source-desktop\ChatGPT 이미지 2026년 10월 4일 오전 11_08_08-6.png`

---

## 1. GAP 요약

| 항목 | 목업 (10/4 desktop) | 현재 브라우저 (2026-10-18 dev) |
| --- | --- | --- |
| **히어로 장면** | 금빛 도시·지구(urban/globe) 연출 | 반도체·공장(semiconductor fab) 3D 장면 |
| **레이아웃** | 목업 기준 2열·카드 배치 | 좌 장면 + 우 로그인 카드 (Cloud 복구 UI) |
| **영문 태그라인** | 목업 픽셀 기준 (별도 대조 필요) | `TECHNOLOGY CREATES…` / 카드 하단 `SEMICONDUCTOR DRIVES…` |
| **소셜 로그인** | 목업에 애플 등 (미구현) | **미지원** — 아키텍처·계약상 유지 |
| **폼 계약** | — | **유지:** 로그인 ID 또는 복구 이메일, 비밀번호, `find-id` / `recover` 링크 |

**기능(Fn):** 로그인 API·RLS·폼 필드는 FOUNDATION/FUNCTIONAL PASS로 분류 (`LAUNCH-READINESS-CHECKLIST-20261018.md`).
**제품(P):** PUT-9 전체 매트릭스(320/390/834, 상태 화면, a11y) 미충족 → **PRODUCT OPEN**.

---

## 2. 변경 불가 (결정과 무관)

- 승인 없이 목업 픽셀을 그대로 복사하는 **전면 시각 리라이트** 금지 (본 문서 §3 옵션 채택 전).
- 애플/서드파티 OAuth를 목업만 보고 추가하지 않음.
- 계정 ID·복구 이메일·비밀번호 서버 계약 변경 금지.
- 한글 카피를 raster에 굽지 않음 (HTML/CSS/SVG만).

---

## 3. Product 선택지 (하나만 승인)

### 옵션 A — **반도체 장면 유지** (현행)

- **내용:** 현재 `login` 히어로·카피·BrandMark 유지. 목업 urban 장면은 **10/4 ZIP 참고용**으로만 보관.
- **장점:** Cloud Codex 복구선(반도체/tech)과 Visual Lab tech 톤 정합; 이미 104행 캡처·브라우저 검증됨.
- **단점:** PUT-9에서 목업 직접 대응 **PASS 불가**; Product/운영이 “10/4 목업 = 법적 기준”이면 출시 서명 충돌.
- **Eng 영향:** PUT-9 diff는 “목업 예외 등록” 또는 matrix `mockup 출처` 재분류 문서화만. 코드 최소.
- **출시:** Product owner가 목업 대신 Visual Lab + 반도체 마스터를 **승인 기준**으로 서명해야 PRODUCT 가능.

### 옵션 B — **목업 장면 채택** (urban/globe)

- **내용:** 히어로·배경·타이포·카드 비율을 `11_08_08-6.png`에 맞춰 **새 아트 + 레이아웃** (폼 계약은 §2 유지).
- **장점:** 10/4 ZIP 직접 대응 경로 중 P0 `/login` GAP 해소에 가장 직접적.
- **단점:** 대규모 UI diff; 320/390/834·테마·motion 재검증; canonical brand/rank/manifest와 충돌 검토 필요.
- **Eng 영향:** `app/login/**`, scene assets, `public/brand` 또는 versioned hero manifest, visual regression·E2E 스크린샷 갱신.
- **출시:** PUT-9 부분 PASS 가능하나 **전체 63경로** 및 Visual Lab gap review는 별도.

### 옵션 C — **하이브리드**

- **내용:** 예) 목업형 **색·구도·카드 크기**만 근접, 장면은 **승인된** neutral world/brand master 또는 `docs/design/generated-masters/` 검토본 중 하나로 통일. 영문 `SEMICONDUCTOR…` 카피는 Product가 한국어 우선 톤으로 정리.
- **장점:** 목업 “느낌”과 PUTDUK 자산·금융 UI 단순성 절충.
- **단점:** “하이브리드” 정의가 모호하면 PUT-9 PASS 논쟁; 디자인 스펙(픽셀 tolerances) 문서 필수.
- **Eng 영향:** A보다 크고 B보다 작음 — 스펙 확정 후 scoped PR.

---

## 4. 권장 Product 액션

1. **48h 내** 옵션 A / B / C 중 하나를 Linear PUT-9 코멘트 + 본 파일 §5에 **서명(이름·날짜)**.
2. B 또는 C 선택 시: `PUTDUK-VISUAL-DIRECTION.md`·`PUTDUK-BRAND-ASSET-SYSTEM.md` 대비 **예외 목록** 작성.
3. 결정 후에만 Eng가 `/login` 시각 PR 착수; 그 전까지 matrix `/login` **PARTIAL / PRODUCT OPEN** 유지.

---

## 5. 결정 기록 (비어 있음 — BLOCKED)

| 필드 | 값 |
| --- | --- |
| 선택 옵션 | _미정_ |
| Product 승인자 | _미정_ |
| 승인일 | _미정_ |
| Visual Lab / 목업 기준 | _미정_ |
| Eng 착수 조건 | §3 해당 옵션 + asset manifest 버전 |

---

## 6. Eng 준비 상태 (2026-10-18, 결정 무관)

| Gate | 결과 |
| --- | --- |
| `pnpm lint` | PASS (`.sites/**` eslint ignore 반영) |
| `pnpm build:web` / `build:admin` | PASS |
| 브라우저 `/login` | HTTP 200, h1 「로그인」, 폼 필드·링크 정상 (Cursor MCP) |
| Hydration 콘솔 | 제품 결함 아님 — Playwright caret 계측 (`LAUNCH-VERIFICATION-LOG-20261018.md` §8) |

**구현 착수:** §5 채워질 때까지 **STOP**.
