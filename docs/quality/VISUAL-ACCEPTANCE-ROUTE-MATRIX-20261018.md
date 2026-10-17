# 시각 수용 경로 매트릭스 — 2026-10-18

63경로 = 공개 26 + 회원 17 + 관리자 20. 이 표는 수용 선언이 아니다. 시각 PASS 0, 제품 완료 0.

## 기준점

- 작업 폴더: `C:\Users\PC\Desktop\putduk-mining\.worktrees\cloud-ui-20261012`
- 브랜치 `codex/cloud-ui-recovery-20261012`, HEAD `9efa9bdab491a11c5d64a2bb66dacf22393d4dc9` (2026-10-18 재확인)
- 인계: `CURSOR_HANDOFF_20261017.md`. 이 인계가 미검증이라고 한 화면은 `NOT_RUN`
- 공개 캡처: `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261017-run-03\public-route-capture.json` 104행 (26경로 × 4프로필). 뷰포트는 `capture-public-routes.cjs` 기준 **1440×1000**, full page, 애니메이션 끔
- 4프로필: `light`, `dark`, `system-light`, `system-dark`. system은 `putduk-theme` 제거 후 colorScheme만 강제
- 목업 파일명만 확인: `source-desktop/` 20개, `source-mobile/` 32개. 같은 폴더의 PNG 픽셀은 이 문서에서 다시 열지 않음
- 경로 연결은 저장소 `docs/design/REFERENCE-RECONSTRUCTION-REVIEW-2026-10-06.json`의 `route_mapping`이다. 2026-10-06 분류이지, 이번 시각 수용이 아니다
- 회원 인벤토리: `app/(product)/**/page.tsx` 17개. 보호: `proxy.ts` matcher, 미인증 GET → `/login`
- 관리자 인벤토리: `apps/admin/app/**/page.tsx` 20개. 보호: `apps/admin/lib/supabase/proxy.ts`
- 미커밋 보존: `app/page.tsx`, `lib/trust/public-content.ts`, `tests/unit/trust-content.test.ts`. 104행 JSON은 이 수정 반영 증거가 아니다
- 원격 push, 커밋, PR은 이 문서의 범위가 아니다

## 추적

- [PUT-9](https://linear.app/putduk-mining/issue/PUT-9/full-visual-acceptance-mockup-truth-vs-browser) — Urgent, Backlog, `EVIDENCE` `RELEASE_BLOCKER`. 필수 매트릭스는 320/390/834/1440, Light/Dark/System, PC/Mobile, ready/loading/empty/error/unauthorized/offline/recovery, keyboard/focus/200% zoom/reduced-motion/safe-area. 브라우저 CI 통과와 수동 시각 수용은 별개다
- [PUT-22](https://linear.app/putduk-mining/issue/PUT-22/cloud-codex-제품-uiux를-최종-기준으로-복구통합전체-수용) — High, In Progress. Cloud Codex 제품 UI가 최종 방향이다. 이슈가 In Progress인 것은 복구 완료나 전체 수용이 아니다. Cloud 당시 기록은 현재 로컬 합격 증거가 아니다

모든 행의 비고는 이 두 이슈의 증거 공백을 가리킨다.

## 상태 정의

| 열 | 값 | 이번 문서에서의 뜻 |
| --- | --- | --- |
| 목업 출처 | `desktop+mobile` | `source-desktop`과 `source-mobile` 모두에 해당 경로로 분류된 파일이 있음 |
| 목업 출처 | `mobile` | `source-mobile`에만 있음 |
| 목업 출처 | `PROPOSED` | 이번 ZIP 파일명에 직접 대응이 없음. 인계 6항: 공통 디자인 시스템 제안 화면. `none`으로 두지 않음 |
| 목업 출처 | `none` | 사용하지 않음 (0행) |
| 시각 상태 | `PARTIAL` | 1440×1000 × 4프로필 스크린샷은 있음. PUT-9 수용은 아님. PASS 아님 |
| 시각 상태 | `NOT_RUN` | 인계가 렌더·목업 대조를 미검증으로 적은 화면 |
| 시각 상태 | `PASS` / `BLOCKED` | 63행 안에서 0. 표 밖 `/terms`·`/privacy`만 차단 |
| 기능 상태 | `NOT_RUN` | 버튼·폼·권한 데이터·오류 복구를 이번 런에서 수행하지 않음 |
| 제품 상태 | `NOT_RUN` | `PRODUCT COMPLETE` 증거 없음. 페이지 파일·HTTP 200은 완료가 아님 |

## 행 수

| 구분 | 행 | 시각 PASS | PARTIAL | BLOCKED | NOT_RUN | 기능 NOT_RUN | 제품 NOT_RUN | desktop+mobile | mobile | PROPOSED | none |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 공개 | 26 | 0 | 26 | 0 | 0 | 26 | 26 | 2 | 0 | 24 | 0 |
| 회원 | 17 | 0 | 0 | 0 | 17 | 17 | 17 | 5 | 1 | 11 | 0 |
| 관리자 | 20 | 0 | 0 | 0 | 20 | 20 | 20 | 0 | 0 | 20 | 0 |
| 합계 | 63 | 0 | 26 | 0 | 37 | 63 | 63 | 7 | 1 | 55 | 0 |

직접 목업이 연결된 경로는 8개뿐이다. `/login`, `/signup`, `/home`, `/mining`, `/products`, `/wallet`, `/menu`, `/ai`.

## P0 공백

1. 시각 PASS 0, 제품 상태 63행 `NOT_RUN`. PUT-9 전체 매트릭스(320/390/834, 상태 화면, 키보드·포커스·200%·reduced-motion·safe-area)는 미실행이다.
2. `/login`은 직접 목업과 다르다. 인계가 `source-desktop/ChatGPT 이미지 2026년 10월 4일 오전 11_08_08-6.png`와 1672×941 화면을 비교했다. 현재는 반도체 공장, 목업은 금빛 도시/지구. 애플 로그인은 미지원이고, 계정 ID·복구 이메일 서버 계약은 유지한다. 캡처 JSON의 뷰포트는 1440×1000이다.
3. 회원 17경로는 서버 로그인 보호다. 이번 QA에 합법적으로 로그인된 테스트 사용자가 없어 UI·상태·기능이 미검증이다. 인증을 우회하거나 임의 계정을 만들지 않는다.
4. 관리자 20경로는 실제 렌더가 없고, 제공 ZIP에서 직접 대응 목업을 찾지 못했다. 전부 `PROPOSED` + `NOT_RUN`.
5. 공개 랜딩 `/`는 캡처됐지만 ZIP `route_mapping`에 없다. 목업의 홈은 회원 `/home`이다. 둘을 같은 화면으로 합치지 않는다.
6. 목업의 증권 시세, 고정 잔액·수익률, L5 PRO는 승인된 경제 규칙이 아니다. `/home` `/mining` `/products` `/wallet`에 그대로 복사하지 않는다. 금액·수익·정산의 권한은 서버에 있다.
7. `/terms`와 `/privacy`는 63행에 없다. `lib/trust` 문서 목록에도 없다. 인계: 승인된 법률 본문 없이 가입 문구로 법률 문서를 만들지 않는다. 표 밖 **BLOCKED**.
8. `/auth/update-password`는 미인증이면 `/recover`로 보낸다 (`app/auth/update-password/page.tsx`). 캡처는 프로필마다 끝 URL이 다르다. 복구 세션이 있는 변경 화면은 촬영되지 않았다.
9. `/offline`의 `system-light` JSON에 hydration 콘솔 1건이 남아 있다. 스택은 배치 캡처의 `/login` 트리이다. 인계의 2026-10-18 isolated 재현은 콘솔 0건이라 제품 결함으로 확정하지 않는다. JSON은 아직 배치 기록이다.
10. 공개 카피 수정 3파일은 미커밋이다. 랜딩 카탈로그 문구를 고친 변경이 104행 캡처에 들어 있다고 보지 않는다.

## 공개 26

출처: 캡처 JSON 경로 순서. 신뢰 문서 16개는 `app/(trust)/[...document]/page.tsx` + `lib/trust/public-presentation.ts`. 나머지 10개는 `app/**/page.tsx`. 인증 열의 「아니오」는 회원 `proxy.ts` matcher 밖이다.

스크린샷 이름: `{profile}-{번호}-{slug}.png`. 4프로필 모두 `screenshot` 필드가 채워져 있다 (104/104).

| 경로 | 앱 | 인증 | 목업 출처 | 테마×뷰포트 증거 | HTTP/상태 | 시각 상태 | 기능 상태 | 제품 상태 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final `/` · console 0 · `*-01-home.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「일상에 더하는 부수입, 퍼뜩 채굴로 시작하세요.」 ZIP은 회원 `/home`만 연결. 미커밋 랜딩 카피와 JSON 불일치 가능. PUT-9 · PUT-22 |
| `/about` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-02-about.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「채굴의 시간을, 검증 가능한 기록으로.」 직접 목업 없음. PUT-9 · PUT-22 |
| `/how-it-works` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-03-how-it-works.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「사용은 단순하게, 결과는 확인된 값으로.」 PUT-9 · PUT-22 |
| `/putduk-facts` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-04-putduk-facts.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「공식 사실은 한곳에서 관리합니다.」 PUT-9 · PUT-22 |
| `/verification` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-05-verification.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「결과만이 아니라 근거를 확인합니다.」 PUT-9 · PUT-22 |
| `/mining-rules` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-06-mining-rules.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「정산 규칙은 시간 구간과 버전으로 고정됩니다.」 PUT-9 · PUT-22 |
| `/trial` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-07-trial.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「최대 24시간, 실제 자산과 분리된 첫 경험.」 회원 `/start`와 별개. PUT-9 · PUT-22 |
| `/economy` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-08-economy.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「경제 규칙은 버전으로 관리되며, 변경은 미래 시점부터 적용됩니다.」 관리자 `/economy`와 별개. PUT-9 · PUT-22 |
| `/deposit` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-09-deposit.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「입금 요청과 잔액 반영은 같은 일이 아닙니다.」 회원 입금 화면 아님. PUT-9 · PUT-22 |
| `/withdrawal` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-10-withdrawal.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「출금은 가용 금액, 검증, 승인을 분리합니다.」 PUT-9 · PUT-22 |
| `/faq` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-11-faq.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「자주 묻는 질문에 같은 기준으로 답합니다.」 PUT-9 · PUT-22 |
| `/status` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-12-status.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「현재 정식 서비스 오픈을 준비하고 있습니다.」 PUT-9 · PUT-22 |
| `/changelog` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-13-changelog.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「사용자에게 영향을 주는 변경을 숨기지 않습니다.」 PUT-9 · PUT-22 |
| `/ai/about` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-14-ai-about.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「설명은 깊게, 권한은 좁게.」 회원 `/ai`와 별개. PUT-9 · PUT-22 |
| `/ai/facts` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-15-ai-facts.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「AI가 참조하는 공개 사실도 같은 버전을 사용합니다.」 PUT-9 · PUT-22 |
| `/ai/faq` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-16-ai-faq.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「PUTDUK AI의 답변 경계를 먼저 공개합니다.」 PUT-9 · PUT-22 |
| `/ai/how-it-works` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-17-ai-how-it-works.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「질문, 근거, 응답과 사용량을 서로 분리해 기록합니다.」 PUT-9 · PUT-22 |
| `/auth/error` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-18-auth-error.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「계정 확인을 완료하지 못했습니다」. 오류 원인별 상태는 미실행. PUT-9 · PUT-22 |
| `/auth/forbidden` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-19-auth-forbidden.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「운영 권한이 없습니다」. PUT-9 · PUT-22 |
| `/auth/update-password` | 공개 | 복구 세션. 없으면 `/recover` | PROPOSED | 1440×1000 × 4프로필 캡처. 복구 세션 화면 없음 | 200×4 · console 0 · light final은 경로, title `Loading http://127.0.0.1:3000/recover` · dark final은 경로, title 「새 비밀번호 설정」 · system-light/dark final `/recover` · `*-20-auth-update-password.png` | PARTIAL | NOT_RUN | NOT_RUN | h1는 4행 모두 「비밀번호 다시 설정하기」. 미인증 이동은 정상 보호. 세션이 있는 변경·완료는 NOT_RUN. PUT-9 · PUT-22 |
| `/find-id` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-21-find-id.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「내 계정으로 돌아오는 안전한 길.」 찾기 제출은 미실행. PUT-9 · PUT-22 |
| `/login` | 공개 | 아니오 | desktop+mobile | JSON 1440×1000 × 4프로필. 인계 육안 1672×941 1회. 320/390/834 캡처 없음 | 200×4 · final `/login` · console 0 · h1 「로그인」 · `*-22-login.png` | PARTIAL | NOT_RUN | NOT_RUN | P0 불일치. 비교 파일 `ChatGPT 이미지 2026년 10월 4일 오전 11_08_08-6.png` (desktop 3, mobile 6). 장면·카피·배치가 목업과 다름. 폼 제출·오류 상태는 미실행. PUT-9 · PUT-22 |
| `/offline` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · system-light console 1 · 나머지 console 0 · `*-23-offline.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「잠시 연결이 끊겼어요.」 hydration 1건은 배치 JSON에만 있고 스택은 `/login`. isolated 재현 0건은 제품 결함 확정 아님. 재연결 동작은 미실행. PUT-9 · PUT-22 |
| `/recover` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-24-recover.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「비밀번호 다시 설정하기」. 메일 발송·복구 완료는 미실행. PUT-9 · PUT-22 |
| `/signup` | 공개 | 아니오 | desktop+mobile | 1440×1000 × 4프로필 캡처. 320/390/834 없음. 목업 나란히 비교는 이 런에 없음 | 200×4 · final 경로 · console 0 · h1 「회원가입」 · `*-25-signup.png` | PARTIAL | NOT_RUN | NOT_RUN | desktop 2, mobile 3. 가입 제출·휴대폰 사용 가능 문구·법률 링크는 미검증. `/terms`·`/privacy`는 표 밖 BLOCKED. PUT-9 · PUT-22 |
| `/support` | 공개 | 아니오 | PROPOSED | 1440×1000 × 4프로필 캡처. 320/390/834 없음 | 200×4 · final 경로 · console 0 · `*-26-support.png` | PARTIAL | NOT_RUN | NOT_RUN | h1 「필요한 도움을 바로 확인해요.」 PUT-9 · PUT-22 |

## 회원 17

출처: `app/(product)/**/page.tsx`. 인계: 로그인된 테스트 사용자 없음. 시각·기능·제품 모두 `NOT_RUN`. 미인증 GET은 `lib/supabase/proxy.ts`가 `/login`으로 보낸다. 이번 런의 HTTP 상태는 없다.

목업이 있는 6경로도 화면을 열지 못했다. 파일 연결만 있고 수용은 아니다. 시세·고정 잔액·L5 PRO는 복사 금지.

| 경로 | 앱 | 인증 | 목업 출처 | 테마×뷰포트 증거 | HTTP/상태 | 시각 상태 | 기능 상태 | 제품 상태 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/home` | 회원 | 예 · 미인증 GET → `/login` | desktop+mobile | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/home/page.tsx`. desktop 4, mobile 5. 공개 `/`와 다른 화면. 목업 금액은 권한 없음. PUT-9 · PUT-22 |
| `/mining` | 회원 | 예 · 미인증 GET → `/login` | desktop+mobile | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/mining/page.tsx`. desktop 4, mobile 5. PUT-9 · PUT-22 |
| `/products` | 회원 | 예 · 미인증 GET → `/login` | desktop+mobile | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/products/page.tsx`. desktop 3, mobile 3. 카탈로그는 운영자 승인본. 목업 등급명 복사 금지. PUT-9 · PUT-22 |
| `/products/allocation` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/products/allocation/page.tsx`. 직접 목업 없음. PUT-9 · PUT-22 |
| `/wallet` | 회원 | 예 · 미인증 GET → `/login` | desktop+mobile | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/wallet/page.tsx`. desktop 3, mobile 5. 고정 잔액 목업은 원장 권한이 아님. PUT-9 · PUT-22 |
| `/wallet/deposit` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/wallet/deposit/page.tsx`. 공개 `/deposit` 안내와 별개. PUT-9 · PUT-22 |
| `/wallet/withdraw` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/wallet/withdraw/page.tsx`. PUT-9 · PUT-22 |
| `/start` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/start/page.tsx`. 공개 `/trial`과 별개. PUT-9 · PUT-22 |
| `/events` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/events/page.tsx`. PUT-9 · PUT-22 |
| `/events/[slug]` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/events/[slug]/page.tsx`. 샘플 slug 미촬영. PUT-9 · PUT-22 |
| `/events/notices/[slug]` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/events/notices/[slug]/page.tsx`. 샘플 slug 미촬영. PUT-9 · PUT-22 |
| `/notifications` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/notifications/page.tsx`. PUT-9 · PUT-22 |
| `/ai` | 회원 | 예 · 미인증 GET → `/login` | mobile | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/ai/page.tsx`. 파일 1개 `…08_18_23-8.png`는 source-mobile에만 있고, 2026-10-06 분류 viewport는 desktop. 공개 `/ai/*`와 별개. 스트림·중단·재시도 미실행. PUT-9 · PUT-22 |
| `/menu` | 회원 | 예 · 미인증 GET → `/login` | desktop+mobile | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/menu/page.tsx`. desktop 1, mobile 4. PUT-9 · PUT-22 |
| `/menu/account` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/menu/account/page.tsx`. PUT-9 · PUT-22 |
| `/menu/ai` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/menu/ai/page.tsx`. 회원 `/ai`와 별개. PUT-9 · PUT-22 |
| `/menu/notifications` | 회원 | 예 · 미인증 GET → `/login` | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `app/(product)/menu/notifications/page.tsx`. `/notifications`와 별개. PUT-9 · PUT-22 |

## 관리자 20

출처: `apps/admin/app/**/page.tsx`. 회원 앱 경로가 아니다. 인계: 렌더 미검증, ZIP 직접 대응 없음. 20행 모두 `PROPOSED` + `NOT_RUN`.

게이트 5경로는 `publicPath`라 세션 없이 페이지 진입이 가능하다. 나머지 15경로는 `getClaims()`의 `sub`가 없으면 운영자 로그인으로 보낸다. 이번 런의 HTTP 상태는 없다. AAL2·지급·감사 동작은 확인하지 않았다.

| 경로 | 앱 | 인증 | 목업 출처 | 테마×뷰포트 증거 | HTTP/상태 | 시각 상태 | 기능 상태 | 제품 상태 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/login` | 관리자 | 아니오 · 게이트 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/login/page.tsx`. 회원 `/login`과 다른 앱. PUT-9 · PUT-22 |
| `/mfa` | 관리자 | 아니오 · 게이트 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/mfa/page.tsx`. `pathname.startsWith("/mfa")`. PUT-9 · PUT-22 |
| `/reauth` | 관리자 | 아니오 · 게이트 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/reauth/page.tsx`. PUT-9 · PUT-22 |
| `/session-expired` | 관리자 | 아니오 · 게이트 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/session-expired/page.tsx`. PUT-9 · PUT-22 |
| `/unauthorized` | 관리자 | 아니오 · 게이트 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/unauthorized/page.tsx`. PUT-9 · PUT-22 |
| `/` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/page.tsx`. 회원 랜딩이 아님. PUT-9 · PUT-22 |
| `/members` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/members/page.tsx`. PUT-9 · PUT-22 |
| `/kyc` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/kyc/page.tsx`. PUT-9 · PUT-22 |
| `/restrictions` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/restrictions/page.tsx`. PUT-9 · PUT-22 |
| `/exceptions` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/exceptions/page.tsx`. PUT-9 · PUT-22 |
| `/deposits/krw` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/deposits/krw/page.tsx`. PUT-9 · PUT-22 |
| `/deposits/krw/[id]` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/deposits/krw/[id]/page.tsx`. 샘플 id 미촬영. PUT-9 · PUT-22 |
| `/deposits/usdt` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/deposits/usdt/page.tsx`. 수동 입금 검토. 회원 USDT 잔액 표현 금지. PUT-9 · PUT-22 |
| `/withdrawals/krw-bank` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/withdrawals/krw-bank/page.tsx`. PUT-9 · PUT-22 |
| `/withdrawals/usdt` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/withdrawals/usdt/page.tsx`. 원화 잔액 대비 출금. PUT-9 · PUT-22 |
| `/economy` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/economy/page.tsx`. 공개 `/economy`와 별개. PUT-9 · PUT-22 |
| `/catalog` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/catalog/page.tsx`. PUT-9 · PUT-22 |
| `/content` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/content/page.tsx`. PUT-9 · PUT-22 |
| `/assistant` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/assistant/page.tsx`. PUT-9 · PUT-22 |
| `/ai-conversations` | 관리자 | 예 · claims 없으면 로그인 | PROPOSED | 없음 | 이번 런 없음 | NOT_RUN | NOT_RUN | NOT_RUN | `apps/admin/app/(control)/ai-conversations/page.tsx`. 검색·본문·열람 감사 미실행. PUT-9 · PUT-22 |

## 목업 파일 수

2026-10-06 `route_mapping`과 run-03 파일명이 52/52 맞다. 10월 4일 ZIP(`source-desktop`) 안에도 폰 프레임으로 분류된 파일이 있다. 폴더 이름과 분류 viewport는 항상 같지 않다.

| 경로 | source-desktop | source-mobile |
| --- | ---: | ---: |
| `/login` | 3 | 6 |
| `/signup` | 2 | 3 |
| `/home` | 4 | 5 |
| `/mining` | 4 | 5 |
| `/products` | 3 | 3 |
| `/wallet` | 3 | 5 |
| `/menu` | 1 | 4 |
| `/ai` | 0 | 1 |
| 합계 | 20 | 32 |

`/login` 비교에 인계가 지목한 파일은 desktop의 `ChatGPT 이미지 2026년 10월 4일 오전 11_08_08-6.png` 하나다. 나머지 51개 파일은 이 런에서 화면과 나란히 보지 않았다.

## 표 밖

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| `/terms`, `/privacy` | BLOCKED | 63행·`lib/trust` 문서 목록에 없음. 승인 법률 본문 전 카피 작성 금지. PUT-9 · PUT-22 |
| 로딩·빈·오류·권한없음·복구 상태 화면 | NOT_RUN | PUT-9 상태 축. 공개 캡처는 ready에 가까운 단일 화면뿐 |
| 320 / 390 / 834, 200% zoom, reduced-motion, 키보드·포커스 | NOT_RUN | 공개 증거는 1440×1000 × 4테마 프로필뿐 |
| 회원·관리자 로그인 렌더 | NOT_RUN | 합법 LOCAL_QA 절차가 있을 때만. 이번 인계는 그 절차를 실행하지 않음 |
