# 최종 아키텍처 반영과 실행 순서

상태: **OWNER-APPROVED DIRECTION / IMPLEMENTATION PARTIAL**

사용자가 2026-10-03 직접 전달한 최종 원문은
`USER-APPROVED-FINAL-ARCHITECTURE-2026-10-03.txt`에 byte 그대로 보존했다.
SHA-256: `a8b082f4691d3cd6e94f1d707770c241df61c3c436076a5c46c511a49b8e0457`.
원문은 실행 방향이며 모든 기능의 구현·제품 완성 증거가 아니다.
기존 master·WS-04·원장·outbox·보안·시각 계약에 이 결정을 반영한다.

후속 UI 프롬프트는 `../design/USER-PROVIDED-VISUAL-PROMPT-2026-10-03.txt`에
원래 UTF-8/CRLF와 Markdown 줄바꿈 공백을 보존했다. SHA-256은
`361667675167a5fc9fffbd5cca268ad9fe96ce8b7a430c735bede85d06e5b4cd`다.
두 원문만 `.gitattributes`의 원본 보존 규칙을 적용하며 실행 코드·관리 문서의
검사는 그대로다. UI/UX는 금융 무결성·보안과 동급의 출시 관문이다.
큰 변화의 실제 시각 검토, adaptive 성능, 접근성·한국어·hydration/runtime
검증이 필요하며 이미지·CI 성공만으로 제품 완료를 선언하지 않는다.

## 충돌과 중복을 막는 해석

- 현재 develop의 실제 원장·입출금·관리자 보안·outbox·catalog·AI·Scene을
  재사용한다. 이름이 다른 두 번째 money service나 Stage를 만들지 않는다.
- Funding Tier와 중립 시각 rank-01~06은 별개다. 원문의 L1~L14 명칭·금액·
  속도·혜택은 예시이며 production 설정값으로 seed하지 않는다.
- 잔여 인정 원금과 사용자별 30일 cycle, capacity/speed 분리, 남은 기간
  proration은 승인된 구조다. 수익률·단위·반올림·한도·상품·loyalty/campaign의
  실제 숫자는 versioned 승인 데이터가 있어야 활성화된다.
- 원문에 든 AI tool/command 이름은 의도 예시다. 실제 public RPC 이름은
  WS-04 계약을 유지하며 기능이 없으면 계약 확장부터 review한다.
- Provider가 없으면 deterministic 안내와 일반 관리자를 사용할 수 있어야
  한다. 외부 AI 답변으로 위장하지 않는다. API key는 server secret에만 두고
  브라우저·plaintext DB·로그에 저장하지 않는다.
- 공개 지식 경로는 실제 route convention을 우선한다. protected mining,
  wallet, account, admin 경로를 SEO 페이지로 바꾸거나 인증을 완화하지 않는다.
- V3 원본은 시각 참고용으로 보존한다. prototype의 random/timer 보상,
  local settlement, baked HUD나 제한 없는 RAF를 runtime으로 가져오지 않는다.
- 이번 원문 승인은 원격 Supabase·Cloudflare·DNS·배포·실송금 승인이 아니다.

## 한 서버 경제와 한 Scene

실제 원금 변경은 회원별 직렬화된 원본 거래와 principal revision을 만든다.
원금 hold는 인정 원금에서 제외하고 release는 그때부터 복구한다. 출처가
없는 기존 출금은 추정하지 않는다. source reconciliation을 먼저 통과해야 한다.

같은 entitlement engine이 principal revision, tier/rule version, cycle,
상품, loyalty, campaign, override, global control, server time을 읽는다.
출력은 등급·속도·capacity·used/remaining·slot·scene profile·cycle state·revision이다.
preview와 실제 실행은 같은 계산 경계를 사용한다. UI·worker·AI가 각자
다른 공식을 갖지 않는다. 실제 금전 확정은 balanced ledger command가 담당한다.

Cycle anchor는 첫 원금 activation에서 고정된다. 추가입금·회수·재입금이
reset을 앞당기지 않는다. 정책·원금 변경 경계에서 segment를 나누고 남은
기간의 entitlement 차이만 반영한다. 과거 reward는 소급 계산하지 않는다.
누적 used capacity는 earned monetary accrual을 한 번만 센다. 정산·수익 출금은
이를 새로 채우거나 비우지 않는다. downgrade로 used가 capacity를 넘으면
기존 reward를 취소하지 않고 추가 accrual을 정지한다.

사용자의 후속 확정으로, 소진 뒤 같은 cycle의 유효 capacity가 used보다
커지면 그 effective_at부터 remaining 차이만 자동 재개한다. 주기 anchor/end와
used는 그대로다. 소진 중 과거 시간은 새 tier로 계산하지 않는다. capacity
boost도 실제 기간에만 적용하며, speed boost는 capacity를 늘리거나 소진을
풀지 않는다. pause/safe mode/자격 제한을 자동 재개로 우회하지 않는다.
이 결정은 원문 중 다음 reset까지 무조건 정지한다는 해석을 대체한다.
상세 계약은 `MINING-ENTITLEMENT-CYCLE-CONTRACT.md`를 따른다.

`MiningLiveStage`는 공통으로 유지한다. Scene family와 상품 mapping은
등록된 approved data를 따른다. raster master + bounded transparent motion
canvas + 접근 가능한 HTML HUD/controls의 세 계층을 사용한다. 실제 서버
snapshot delta에만 monetary cue를 붙이며 pending 감소/verified 증가를
신규 수익으로 두 번 보여주지 않는다. cycle 완료·권한 없음·오프라인·오류는
ambient/정지 상태를 명확히 구분한다.

## UI 목업과 성능 gate

새 화면 또는 큰 시각 변경 전에는 imagegen 이미지 목업을 먼저 만든다.
canonical Visual Lab과 master를 읽고 구도·정보 우선순위·모바일 구성을
직접 검토한 뒤 HTML/CSS와 기존 Scene runtime으로 구현한다. mockup은
시각 설계 증거이며 승인 경제 수치나 실제 기능의 증거가 아니다.

generated lossless master는 `docs/design/generated-masters/`에만 보존한다.
runtime은 검토된 responsive derivative와 assets manifest를 사용한다.
글자·금액·버튼은 raster/canvas 안에 고정하지 않는다. 모바일은 desktop을
그대로 축소하지 않는다. 관리자 화면은 읽기와 조작에 집중하고 background
RAF를 추가하지 않는다. 실제 화면의 320/390/834/1440, theme, 확대, 상태, focus,
reduced motion과 canonical 비교를 별도로 검증한다.

사용자가 후속 확정한 기본 구성은 모바일과 PC 모두 큰 V3 장면과 핵심
정보 3~5개다. 원금·현재 등급·오늘 채굴·용량·속도만 우선 표시하고 자세한
정산·기록·등급표·상품 규칙·설정은 펼쳐 본다. 모바일 하단은
`홈 · 채굴 · 상품 · 지갑 · 더보기`의 5개 탭이다. 이벤트·공지·알림·지원·
설정은 더보기와 적절한 바로가기로 열며 AI는 탭이 아닌 모든 화면의 같은
위치의 플로팅 버튼으로 연다. 실제 route·권한·safe area·키보드·dialog와
접근성 검토 후 연결한다. 합성 목업이나 탭 명세를 구현 완료로 세지 않는다.

Scene은 화면 밖·hidden·reduced motion에서 멈춘다. effect 수·해상도·frame
budget을 capability별로 제한하고 정적 fallback에서도 모든 조작이 가능해야
한다. FPS·long-task·memory·bundle·LCP/CLS/INP 측정 없이 “렉 없음”을
보증하지 않는다. 경제 숫자를 client frame이나 timer에서 계산하지 않는다.
Stage당 canvas와 RAF owner를 하나로 제한하고 고품질 master는 저성능
profile에서도 유지한다. 가족별 원형 master는 서로 달라야 하며 색만 바꿔
새 가족으로 제출하지 않는다. 앱 shell과 금융 화면은 명확한 premium minimal,
채굴 장면은 cinematic island로 설계하며 System/Light/Dark를 보존한다.
60fps는 측정 대상의 목표다. 실제 기기 결과 없는 보증이나 고정 DPR/particle
수의 승인으로 해석하지 않는다. master의 runtime 게시 전에는 사용자 검토·
승인과 hash/version, derivatives·anchors·profiles 및 직접 pixels QA가 필요하다.

## 실제 작업 묶음

| Wave | 결과 | 현재 상태와 gate |
| --- | --- | --- |
| 1 | PR #45 운영 도우미·안전 모드·worker 통합 | 최종 head e9b3c32 전체 18 job/16분 55초와 실제 pixels 검토. develop 병합 5a7ba0c, push CI 37111792067 success/전체 17분 16초 독립 검증 완료. scoped 기능 증거이며 PRODUCT COMPLETE는 아님 |
| 2 | 원금 출처와 Eligible Principal | 새 실제 입금/START capture·readback·admin 후보 작성. source-aware 출금/보정은 후속 연결 필요 |
| 3 | Tier·Entitlement·Cycle·Segment·Proration | 승인 구조 반영, 실제 transactional engine 미구현. 숫자 없는 draft/검증은 가능하며 활성화는 보류 |
| 4 | 서버 정산·Live Snapshot | 기존 helper와 command gap 확인. 단일 권위 engine·balanced posting·lease/retry·revision 연결 필요 |
| 5 | 사용자 Capacity UX | 목업 먼저, 승인 snapshot의 원금·등급·오늘 채굴·capacity·다음 등급을 HTML로 표시 |
| 6 | 관리자 경제 제어 | simple 입력·영향 preview·confirm/step-up·버전 예약/취소·복구 필요 |
| 7 | AI Gateway·관리자 도우미 | 기존 read/draft 재사용, provider-neutral routing·정책·cost/quota·eval·실패 상태 확장 |
| 8 | 사용자 AI | 기존 read-only/money denial·launcher/context 재사용. 최소 권한·실제 정책 설명·quota 분리 |
| 9 | V3 clean master·Scene runtime | immutable reference 보존, imagegen clean master 검토·derivative·단일 bounded renderer·실제 delta 연결 |
| 10 | 다른 Scene family | 공통 Stage 유지, 승인 catalog/mapping·가족별 자산/anchor/profile·fallback 증거 |
| 11 | CMS·Trust/Discovery | 실제 Canonical Facts·SSR content·운영자 preview/publish·audit/outbox 재사용/확장 |
| 12 | 검색·AI crawler·IndexNow | 공식 최신 지침 확인, robots/sitemap/canonical/JSON-LD/private-noindex·중복 방지·실패 재시도 검증 |
| 13 | Staging | 대상·설정·backup/restore·deployment 승인 필요. 현재 원격 잠금 유지 |
| 14 | Production | 승인 정책·PRODUCT COMPLETE·배포와 smoke·관찰/복구 증거 후 별도 release |

Wave는 사소한 커밋마다 전체 CI를 돌리는 단위가 아니다. 관련 입력·권한·
DB·worker·UI·복구를 local 집중 검사로 묶고 안정된 후보의 전체 CI를 수행한다.
필수 모든 job과 8개 authenticated shard를 유지하며 PR와 post-merge workflow를
각각 20분 안에 끝내야 한다. 실패·취소·flaky 성공이나 이전 head 증거는
통과로 합치지 않는다. CI 중에는 다음 묶음의 독립 작업을 계속한다.

공식 검색 노출·AI 인용은 보장하지 않는다. 공개 콘텐츠의 crawler 허용과
training 정책을 분리하고 public host만 검증한다. 실제 외부 provider 요청,
IndexNow 송신, secret 설치나 검색 콘솔 연결은 해당 단계의 target·설정·
권한과 실제 증거가 확보된 후 수행한다. 현재 원문은 이 외부 연결의
설계 요구이며 인증 보호나 원격 잠금을 우회할 근거가 아니다.
