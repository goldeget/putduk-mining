# Primary 인수 — 출시 운영·콘텐츠 lane

브랜치: `parallel/launch-ops-content`. 기준: origin/develop `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`. Member/shared 작업과 겹치지 않도록 **launch-content/**만 추가·수정했습니다. Admin 브랜치 `parallel/admin-release`는 `f9b454a7c1b86dde1099b6e5a264092118258ead` 그대로 보존합니다.

콘텐츠 체크포인트: `822eb61758a0a7535f6a124bc825d3e03704ae8a`. 운영 절차·등록/환경 gate: `7f65867fa298837e12209a331e51ce46ea563eff`. 마지막 검증 보강과 감사 확장도 같은 전용 브랜치의 추가 체크포인트로 제공합니다. 실제 최종 SHA는 원격 feature HEAD를 확인하세요. main/develop merge, production push, PR 생성·전체 CI 자동 실행은 하지 않았습니다.

## 전달물

30개 이벤트, 26개 공지, 68개 FAQ, 28개 지원 답변, 32개 Push/In-app 템플릿, 8개 장애 안내와 1개 전체 출시 운영 절차입니다. 총 **193개 구조화 record**와 한국어 전체 원고를 제공합니다. 이벤트 28개는 보상 없는 안내 캠페인이고, 정책 설명 2개는 POLICY_VALUE_REQUIRED입니다. 모든 일정·게시·발송·승인·경제 정책은 미확정 값을 임의로 채우지 않았습니다.

JSON과 전체 문서 위치·재현 command는 README.md를 사용하세요. 운영 절차는 초보 운영자가 읽을 한국어로 작성했으며 runbook.json의 전체 본문·단계와 일치합니다. 현재 등록 계약에 없는 필드는 metadata에 분리했습니다. 실제 importer나 새 backend는 만들지 않았습니다.

## 검증과 실제 상태

- 독립 content validator: PASS_DRAFT_ONLY. duplicate slug·빈 제목/본문·달력/offset/window·CTA/audience·미승인 경제값·필수 문구·템플릿 변수·기존 storage 필드·runbook 일치를 확인합니다.
- rejection tests 11개 PASS. 카드 문구·배너 아이디어·중첩 array/camelCase metadata의 미승인 배수/경제값도 거부합니다. 실패를 0원으로 해석하지 말라는 문구만 좁게 허용합니다.
- publication readiness: **BLOCKED / exit 2**. draft validity를 게시 승인으로 바꾸지 않습니다.
- source copy audit: app/components와 실제 회원 presentation/public help/read models의 209개 파일을 읽었습니다. 전체 pattern match 544건, 한국어 문구/API 후보 **27개 고유 위치**를 REPORT로 남겼습니다. raw enum/error literal 후보는 실제 노출로 단정하지 않았습니다. 원본 UI/helper는 수정하지 않았습니다.
- frozen Admin 환경: Node/pnpm/CLI/ref·시스템 Chromium151 launch PASS. pinned Chromium153 HTTP 403, local Supabase layer 공간/registry 실패로 실제 DB/auth E2E 8종은 BLOCKED/executed=false입니다.
- 안전하게 정리한 것은 자체 패키지 metadata cache 287,971,915 bytes뿐입니다. Docker prune·무관한 자원·repo/worktree/commit/stash 삭제는 하지 않았습니다.
- Cloud 시작 지침은 새 콘텐츠 역할과 Admin freeze 기준으로 draft 저장했습니다. 설치·제한 네트워크·기존 변수는 유지했고 secrets를 추가하지 않았습니다. 저장된 지침을 적용하는 **Publish**가 남아 있습니다.

현재 원고는 검토·등록 준비 완료이며 실제 등록·발송·전체 제품 출시 완료가 아닙니다. 실제 생성 ID/readback/CMS render/rollback은 UNRUN입니다. production에는 게시·등록하지 않았습니다.

## Primary 통합 시 필요한 작업

1. CONTENT/LEGAL/POLICY 검토 후 실제 일정·대상·변수·정책 버전을 승인하세요. 공식 오픈 문구는 오픈 승인 후에만 사용합니다. 환영 전환·용량/속도 캠페인은 실제 runtime·정산 증거 전 게시하지 않습니다.
2. CONTRACT-MAPPING.md의 정확한 요청을 해결하세요. 이벤트 전체 본문/card/CTA/audience와 공지 전체 본문 렌더가 현재 read model에 없습니다. 승인된 draft/preview/publish/cancel command·역할/세션/origin·revision·idempotency·audit·rollback이 필요합니다. economy publisher나 test fixture SQL로 우회하지 않습니다.
3. 실제 domain-event 기반 회원 notification fanout/delivery와 지원 채널·FAQ/운영 템플릿 저장 계약을 확정하세요. source event/user/dedup과 푸시 권한·선호·조용한 시간·cap은 기존 권위 경계를 따릅니다. 외부 provider 전송은 별도 승인 전 하지 않습니다.
4. 등록 command가 준비되면 registration-plan.json/CONTRACT-MAPPING.md의 LOCAL 또는 별도 승인 STAGING 절차에서 실제 ID·readback·전체 본문·CTA·역할·retry·rollback 증거를 수집하세요. PRODUCTION은 별도 사용자 승인 대상입니다.
5. 회원 문구 감사는 현재 Primary UI SHA에서 재실행하고 실제 state/화면/접근성/오류/복구를 확인하세요. 기존 REPORT 위치와 파일 hash가 달라지면 오래된 결과를 그대로 채택하지 않습니다.
6. 플랫폼의 Docker layer 공간·quota/inode와 실제 network 정책을 복구한 뒤 ADMIN-E2E-PREPARATION.md의 frozen Admin focused suites를 실행하세요. 이 lane의 browser launch/정적 검증/이전 합성 컴포넌트 증거는 DB/auth 결과가 아닙니다.
7. 최종 통합·Member 제품 증거·전체 CI·오픈/배포 결정은 Primary가 소유합니다. 운영 카드의 실제 연락·공지·지원·복귀 경로를 확정하기 전 1인 운영 오픈을 승인하지 않습니다.
