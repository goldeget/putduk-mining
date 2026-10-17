# Cursor 인계 — 2026-10-17 목업 대조·출시 UI 후속 작업

이 문서는 2026-10-17 현재 검증한 기준점이다. 과거 handoff의 경로·SHA·런타임 결과를 현재 사실로 재사용하지 않는다. 기존 Linear 문서 「2026-10-16 Cursor 인계 — UI·AI·상품 연출·행동별 QA [1913334]」는 해당 날짜의 기록으로 보존한다.

## 작업 폴더와 경계

- Cursor에서 열 폴더: C:\Users\PC\Desktop\putduk-mining\.worktrees\cloud-ui-20261012
- 브랜치 codex/cloud-ui-recovery-20261012, HEAD **74e4d5d** (`docs(quality): sync launch tracking to 411be7eb`; trust **`411be7eb`**)
- origin https://github.com/goldeget/putduk-mining.git. **2026-10-18:** origin `codex/cloud-ui-recovery-20261012` 대비 **ahead 16** · PR #76 remote head `0a29487`과 불일치. Push/merge/배포는 **production coupling** 승인 전 금지 (`GIT-CI-CD-POLICY.md`, checklist §2.2 B7).
- 현재 로컬 변경 3개: app/page.tsx, lib/trust/public-content.ts, tests/unit/trust-content.test.ts. 미추적 .sites/ 및 docs/design/generated-masters/*proposed-20261017.png 5개도 보존한다.
- 루트 AGENTS.md, apps/admin/AGENTS.md, CI/DoD, 제품·금융 계약을 먼저 다시 읽는다. **출시까지 추적:** `docs/quality/LAUNCH-READINESS-CHECKLIST-20261018.md` (기존 `RELEASE-READINESS-MATRIX.md`·`PRODUCT-COMPLETE-MATRIX.md`와 함께). 주 checkout과 다른 worktree는 수정하지 않는다.
- 원격 Supabase/Cloudflare/DNS, 운영 트래픽, 유료 provider, 실계정·실지급, GitHub 쓰기는 별도 경계다. 이 인계는 새 권한을 주지 않는다.

## 목표와 기준

사용자 목표는 제공한 10월 4일 데스크톱·10월 3일 모바일 목업에 맞춰 공개 26 + 로그인 회원 17 + 관리자 20 경로를 비교하고, 버튼·폰트·크기·색·배경·로고·모션·반응형과 theme(light/dark/system)를 검수하는 것이다. 백엔드/엔진 계약과 충돌하는 요소는 아키텍처에 맞춰야 한다. 모든 적용 증거가 모이기 전 100%/전수 PASS를 선언하지 않는다.

원본 ZIP: F:\_PUTDUK\Mockups\10월4일 퍼뜩목업사진.zip, F:\_PUTDUK\Mockups\퍼뜩채굴 모바일 목업사진.zip.
검수용 복사본: D:\PUTDUK-MINING-QA\mockup-ui-audit-20261017-run-03 (D:는 ESD-USB 확인). source-desktop/, source-mobile/, public-route-capture.json, capture-public-routes.cjs와 PNG를 사용한다. 다른 D: 자료를 스캔하지 않는다.

## 확인된 현재 상태

- 공개/인증 26 경로 × 4 테마 조합의 JSON 기록 104건. 기록된 응답은 HTTP 200이다. ~~103 PNG~~ **2026-10-18:** `system-light-22-login.png` 재촬영 반영으로 JSON 104행 모두 screenshot 필드 채움. QA 폴더에 `system-light-22-login-recapture.png` 보존(105 PNG 파일).
- /auth/update-password는 미인증 시 /recover로 이동한다. 정상 보호 흐름으로 취급하며 우회하지 않는다.
- /offline의 SYSTEM-Light 항목에 hydration 경고 1개가 **배치 캡처(한 탭에서 /login 직후 /offline)** JSON에만 기록됐다. **2026-10-18:** Cursor 브라우저·Playwright **경로별 isolated context** 재현에서 `/offline` 단독·`/login`→`/offline` 모두 hydration 콘솔 0건. `capture-public-routes.cjs`는 **프로필×경로마다 새 context** + `/login` 스크린샷 60s로 갱신(D: run-03). 제품 `/offline` 결함으로 확정하지 않는다.
- **2026-10-18 launch verify → triage 완료:** `/login` hydration 1건은 Playwright `screenshot()` 기본 `caret:hide`가 form input(숨김 `next` 포함)에 `caret-color: transparent`를 넣어 dev React가 mismatch로 기록한 **계측 오탐**. `caret: "initial"` 또는 스크린샷 생략 시 0건. `/wallet/withdraw` hydration CLOSED와 동일. AuthForm 제품 수정 없음. `launch-verify-ui-audit-subset.mjs`만 `caret: "initial"` 반영.
- /login은 1672×941에서 실제 확인했다. 직접 목업 source-desktop/ChatGPT 이미지 2026년 10월 4일 오전 11_08_08-6.png와 현재 화면의 비주얼·카피·배치가 크게 다르다. 현재는 반도체 공장 장면이고 목업은 금빛 도시/지구다. 애플 로그인 미지원, 계정 ID/복구 이메일과 실제 서버 계약은 유지한다.
- 회원 17개 경로는 서버 로그인 보호를 받는다. 이번 QA에 합법적으로 로그인된 test user가 없어 회원 UI·상태·기능은 검증되지 않았다. 인증을 우회하거나 임의 credentials를 만들지 않는다.
- 관리자 20개 경로는 실제 렌더 미검증이며 제공 ZIP에서 직접 대응 목업을 찾지 못했다. 다수 공개·회원 상세 상태도 직접 목업이 없다.
- mockup의 증권시장 표현, 고정 잔액·수익률, L5 PRO 등은 승인된 경제 규칙이 아니다. 그대로 복사하지 않는다. 화면 문구는 HTML/SVG로 두고 한글을 raster에 굽지 않는다. 현재 BrandMark/P·새싹 identity를 유지한다.
- 최종 아키텍처는 /terms, /privacy를 참조하지만 현재 app/docs에서 승인된 법률 본문을 찾지 못했다. 가입 폼의 짧은 설명만으로 법률 문서를 만들지 않는다. 정본/legal review본 없이는 이 범위를 차단으로 기록한다.
- 로컬 dev server는 http://127.0.0.1:3000/, 현재 SYSTEM 테마다. 안전한 테스트 API 포트는 63421이다. 기존 승인 세션·프로세스를 보존하고 다른 listener/Docker를 조사하지 않는다.

## 이번 턴 수정·검증

상품 카탈로그 문서는 운영자 승인·게시를 전제로 하지만 공개 사실은 5개 월드가 현재 이용 가능하다고 단정했다. 게시된 카탈로그 기준으로 표현을 바로잡고 랜딩 구역은 상품 제공 목록이 아닌 장면 미리보기로 고쳤다.

- 수정: app/page.tsx, lib/trust/public-content.ts, tests/unit/trust-content.test.ts
- vitest: tests/unit/trust-content.test.ts + tests/unit/public-discovery.test.ts — 2 files / 12 tests PASS
- **2026-10-18 추가:** domain unit smoke 9 files / 84 tests PASS (`ws04-*`, ledger, trial, referral, settlement, outbox + trust) — `launch-verify-vitest-domain-smoke-20261018.log`
- Prettier 세 파일 + eslint.config.mjs PASS, git diff --check PASS
- **2026-10-18:** `pnpm lint` PASS, `pnpm build:web` + `build:admin` PASS (로그 `docs/quality/launch-verify-*-20261018.log`)
- Cursor browser MCP: http://127.0.0.1:3000 `/`, `/login`, `/signup` HTTP 200·주요 h1/폼 확인 (기존 `pnpm dev`)
- `/login` PUT-9 시각 GAP → **BLOCKED** on design decision: `docs/quality/LOGIN-MOCKUP-GAP-DECISION-20261018.md` (옵션 A 반도체 유지 / B 목업 장면 / C 하이브리드). **승인 전 시각 리라이트 없음.**
- 출시 한줄 요약: `docs/quality/LAUNCH-STATUS-SUMMARY-20261018.md`
- 브라우저 DOM에서 수정된 랜딩 문구 확인. 변경은 로컬 미커밋이다.
- Full CI, 인증 회원/관리자 PRODUCT QA, 실기기, 전체 visual acceptance는 미실행/ OPEN. **2026-10-18:** `pnpm test:e2e:auth:smoke` **4/4 PASS** (WS-05 §11; E2E automation **재확인** §12 — `supabase start` without `--ignore-health-check`, `run-local-authenticated-e2e.mjs`, lint+build+vitest green).

## 다음 순서

1. 지침과 git 상태를 다시 읽고 SHA/worktree가 여전히 맞는지 확인한다. 위 3개 수정과 기존 미추적 파일을 보존한다.
2. ~~캡처 104행/PNG 103개~~ **2026-10-18 해소(JSON·PNG 정합).** 다음 전체 재캡처 시 D: 갱신 스크립트(isolated context) 사용. `/offline` JSON consoleErrors 1건은 재캡처 시 덮어쓰기.
3. ~~63개 경로 표~~ **2026-10-18:** `docs/quality/VISUAL-ACCEPTANCE-ROUTE-MATRIX-20261018.md` (공개 26 PARTIAL, 회원·관리자 37 NOT_RUN, 시각 PASS 0). 인증 화면은 LOCAL_QA 있을 때만 검증한다.
4. 원본과 같은 뷰포트에서 직접 대응 화면을 비교한다. 로그인 불일치를 우선 처리하고, 폰트/줄바꿈/로고/메뉴 중복/포커스/키보드/로딩·빈 상태·오류복구를 실제 확인한다.
5. UI 변경을 실제 백엔드 명령/원장/RLS 계약과 검토한다. DRAFT 카탈로그 노출, 금융 결과불명을 완료로 표현, 가짜 AI 타이핑을 허용하지 않는다.
6. 목업 없는 화면은 공통 디자인 시스템 기반 PROPOSED 화면으로 구분한다. /terms·/privacy는 승인된 본문 없이는 법률 카피를 쓰지 않는다.
7. 작은 파일 단위로 수정, 적절한 테스트 및 실제 브라우저 렌더·테마·반응형·접근성 검사를 완료한다. 전체 CI와 제품완료 증거 전에는 전수 통과/출시 완료로 표시하지 않는다.
8. 검증한 파일만 선별 커밋한다. 이 문서는 원격 push, PR, DB/Cloudflare mutation, 배포, 유료 호출을 허가하지 않는다.

Cursor 첫 메시지: 이 파일과 현재 AGENTS를 읽고, 기준점이 맞는지 확인한 결과를 짧게 남긴 뒤 미완 검증을 실제로 이어간다. 계획만 답하고 멈추지 않는다.
