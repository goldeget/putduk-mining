# PUTDUK MINING — 2026-10-04 재개 상태

이 문서는 원본 인계 뒤 사용자가 통합 구현 재개와 일반 GitHub 작업을 승인한 세션의
소스 스냅샷이다. 원본 `CODEX_HANDOFF.md`, `CURRENT_STATE.md`, `NEXT_STEPS.md`는
수정하지 않았다. 해당 문서의 일시 중단, 숫자 미정, 반도체 원본 적용 보류는 이후
직접 사용자 결정으로 해제되었다. 원격 DB·Cloudflare·DNS·배포·실제 지급은 계속 동결이다.

## 정확한 대상과 후보

- Workspace: `C:\Users\PC\Desktop\putduk-mining`.
- Origin: `https://github.com/goldeget/putduk-mining.git`.
- Branch: `codex/product-ai-navigation`; PR [#47](https://github.com/goldeget/putduk-mining/pull/47), base `develop`.
- 이 문서 작성 전 구현 HEAD: `eb9b90ec2127dc0ae25704e9714a06468c8c0d26`.
- 마지막 확인한 원격 PR head: `e9c60898abd8b79cfa6a96b37249c383890e682a`.
- 이전 develop: `034c78ccc8002c7eb9f34ca70ac88712f1cc16de`.
- 새 구현 40파일은 `0906375`, `1fd0545`, `eb9b90e` 세 커밋에 분리했다.
- `git fsck --full` exit 0, reachable missing object 0. dangling 객체는 보존했다.

## 변경과 실제 완료 경계

회원 인증 7화면과 관리자 인증 5화면을 한국어·키보드·오프라인 복구와 함께 구성했다.
반도체 원본의 색상·조명·금속 질감을 보존한 손실 없는 master와 8개 runtime 파생본,
승인된 전체 로봇 얼굴 4개 파생본을 사용한다. 기존 에셋을 보존하여 manifest는
96개, `2026.10.03-v3`다. 그림에 운영 문구나 금전값을 넣지 않는다.

회원 공통 AI 대화·초안은 세션 메모리이며 영속 대화 기억이 아니다. 서버 owner 검증,
stream 복구와 화면 전환을 연결했다. 상품은 실제 유효 PUBLISHED catalog만 읽는다.
현재 DRAFT seed를 승인된 판매 상품이나 실제 선택 command로 표시하지 않는다.

승인 경제 V1 값은 승인 원문과 JSON, versioned Admin Economy lifecycle에 반영했다.
BigInt micro-KRW 계산과 정확한 microsecond 정책 reader는 구현했으나
`POLICY_CONSUMER_NOT_ENABLED`다. 실제 Funding Engine, Principal lot/cycle 저장,
verified earned producer, balanced mining settlement/worker는 연결되지 않았다.
Retention 미확정분을 확정 돈으로 표시하지 않는다. 경제 활성화·출시 완료가 아니다.

새 일반 출금은 최종 private writer에서 원본 owner/key 복구 후 차단한다. 외부 응답은
`409 WITHDRAWAL_SOURCE_UNAVAILABLE`이며 원금·일반 BONUS를 자동 소비하지 않는다.
START는 기존 원본 conversion·qualification·complete CREDIT 증거를 확인하며,
입금 없이 최대 5,000원·fee 0인 전용 출금을 보존한다. 기존 held request의 복구와
release/finalize 검증은 source-less historical test fixture로 분리했다. 이 fixture는
postgres-only `pg_temp`이며 migration이나 실제 검증된 채굴 수익이 아니다.

## 검사 스냅샷과 CI 재개

- 최신 전체 unit: 회원 90파일/1,036개, 관리자 29파일/281개 PASS.
- 96개 asset 검증, 전체 lint, 40개 소유 파일 포맷·diff 검사 PASS.
- 새 `.next-qa-final-source-8b77a6fd`에서 회원·관리자 production build/type 검사 PASS.
  임시 변경한 두 tsconfig와 두 next-env는 원래 bytes로 복원했다.
- 보호 변경 11개 SHA256 그대로. 기존 root 인계 3개도 보존했다. 전역 포맷 금지.
- local Supabase CLI와 local preview 실행은 자동 승인 검토에서 차단됐다. 우회하지
  않았으며 이 스냅샷의 신규 실제 DB·브라우저 증거는 다음 exact-head CI가 필요하다.
- CI `37132971570` / `e9c6089`는 18분59초에 cancelled: 병합 불가. DB 26파일/823개
  pgTAP과 기존 동시성 검사는 성공했으나 schema lint의 shadowed `v_index`로 실패했다.
- 같은 실행의 상품 320px intrinsic grid overflow와 관리자 정책 E2E의 Node HTTP
  Secure-cookie 미전달을 수정했다. 운영 인증을 약화하지 않고 실제 브라우저 fetch를
  사용했다. 실제 재검증은 아직 필요하다.
- 신규 정책 reader 동시성 도구는 CI의 정확한 origin/container/DB를 확인하고 실제
  두 세션의 commit 양방향·rollback·microsecond 경계·stale isolation 거절을 검사한다.
  source unit 29개와 독립 리뷰는 PASS, 실제 실행은 다음 DB CI에서 확인한다.
- CI는 기존 18 job/인증 8 shard/공유 production build/fail-on-flaky를 유지한다.
  공개 인증 글자 검사만 115 tests/110 screenshots로 확장했다. 보호 matrix는 그대로다.
  전체 exact-head 실행이 성공하고 20분 이내여야 develop 병합할 수 있다.

QA 저장소는 확인한 `ESD-USB`의 다음 실행 전용 폴더다. 최신 후보 SHA·전체 CI 결과와
화면 증거는 이 폴더의 후속 receipt로 대조하고, 이 문서의 이전 검사와 혼합하지 않는다.

`D:\PUTDUK-MINING-QA\auth-reader-integrated-20261004-804cbaf7`

## 다음 구현 순서

1. 다음 PR 후보의 전체 CI 실패를 실제 로그·trace로 해결하고 exact-head 전체 증거를
   확인한다. 정상 develop 병합 후 그 merge SHA의 전체 CI를 별도로 확인한다.
2. 로그인부터 모든 회원·관리자 화면을 PC/모바일·System/Light/Dark·320px·200%·복구
   상태·reduced motion으로 실제 검수한다. 현재 전체 화면의 100% 동일 품질은 미확인이다.
3. 기존 WS-04 command와 money/source 계약 안에서 Principal lot/cycle/entitlement/
   verified earned producer/settlement/worker를 연결한다. 별도 money writer나 alias를
   만들지 않는다. 일반 MINING_REWARD 출금은 그 증거를 소비한 뒤에만 개방한다.
4. 일반 원금 회수는 `NEWEST_FIRST`다. 정렬은 `effective_at` DESC, `recorded_at` DESC,
   lot id DESC이고 부분 배분한다. reversal, chargeback, correction은
   `ORIGINAL_LOT_TARGETED`다. 대상 lot이 부족하면
   `PRINCIPAL_RECOVERY_ORIGINAL_LOT_SHORT`다. FIFO, 비례 배분, 사용자 lot 선택은
   쓰지 않는다. 다른 승인 경제 숫자는 다시 미정으로 돌리거나 임의 변경하지 않는다.
5. V3 HUD·scene은 실제 서버 결과와 승인 상품만 표현한다. 현재 반도체 family 외에
   없는 장면·가짜 장비·상품·수익을 추가하지 않는다. 원격 적용은 별도 명시 단계다.

FOUNDATION / FUNCTIONALLY / PRODUCT COMPLETE를 구분한다. 전체 PRODUCT COMPLETE,
LAUNCH READY, 오류 0, 목업과 모든 화면 100% 일치를 이 스냅샷으로 주장하지 않는다.
