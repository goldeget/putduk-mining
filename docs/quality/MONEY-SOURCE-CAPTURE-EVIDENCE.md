# 원금 출처 기록 검증

상태: **IMPLEMENTATION CANDIDATE / NOT PRODUCT COMPLETE**

기준은 `docs/architecture/MONEY-SOURCE-PROVENANCE.md`의
`2026.10.03-eligible-principal-v1` 승인 계약이다. 누적 입금을 현재 원금으로
쓰지 않으며, 실제 원금·수익·보너스의 출처를 분리한다.

## 이번 후보의 범위

새 KRW 입금 승인과 수동 USDT→KRW 확인은 원본 도메인 영수증·balanced
journal·wallet·outbox와 같은 transaction에서 `PRINCIPAL`로 기록된다.
START 전환은 기존 최대 5,000원·무입금 조건을 보존하여 `BONUS`로 기록된다.
retry는 새 출처나 기준 시각을 만들지 않는다. capture 실패는 원본 승인까지
rollback한다. client 금전 writer·USDT 지갑·원장 변경·경제 활성화는 없다.

정적 검토에서 KRW 명령의 outbox 키 충돌은 INSERT capture 자체를 실행하지
않는다는 빈틈을 확인했다. 세 terminal 도메인에 deferred transaction
완결성 검사를 추가했다. 실제 원본 계정·키·actor와 입금 성공 감사·완료 키를
대조하며 START에 없는 감사·creator는 요구하지 않는다. 정상 세 명령·재시도,
충돌 전체 rollback·기존 이벤트 보존, 잘못된 계정·actor·키·감사와 설치 이전
호환성 검사를 새 pgTAP에 작성했다. rollback-only 테스트에서도 해당 deferred
guard를 명시적으로 실행한다. 이는 검사 작성과 정적 검토 상태이며 SQL PASS
근거는 정확한 후보의 CI 실행 뒤 기록한다.

원장 header의 회원 ID는 nullable이다. header만 보고 coverage를 판단하면
실제 회원의 KRW 계정에 들어간 보정 journal을 놓칠 수 있다. 회원별 header
index와 실제 소유 계정→entry index 두 경로를 journal 단위로 합쳐 확인한다.
다른 회원의 source row로 분류 완료를 대신하지 않는다. header가 없거나
다른 회원이어도 대상 계정에 영향이 있는 balanced journal은 미분류로
남긴다. 실제 service-role balanced debit와 기존 원장 deferred guard를
명시 실행하는 회귀 검사를 작성했으며 DB 실행 증거는 아직 없다.

관리자 회원 상세는 현재 원금과 누적 통계를 나눠 표시한다. 서버는 원본
영수증을 다시 검증하며, 미분류 wallet·journal·출금이나 잘못된 영수증이
있으면 현재 원금을 `NULL / UNRESOLVED`로 반환한다. 화면은 이를 0원으로
표시하지 않는다. 별도로 확인된 기록 기간의 입금은 누적 입금으로 오인하지
않도록 구분한다. 모든 금액 표시는 큰 정수를 보존한다.

source coverage는 이미 원장에 반영된 금전의 증거다. 아직 정산되지 않은
earned/pending 채굴 도메인의 부재까지 증명하지 않으므로 누적·미확정 채굴
수익은 연결 전까지 확인 필요로 표시한다. 조회할 수 없는 수익을 0으로
단정하지 않는다.

기존 elapsed-rate 정산 helper는 잘못된 시각·버전·중복·수치 범위를 거절하고
서버 전용으로 한정했다. 이 helper에는 실제 funding 원금·등급이나 runtime
command/worker 연결이 없다. 승인된 funding engine으로 간주하지 않는다.
프로모션·행사·START preflight도 잘못된 유효 시각·중복 정책·초과 지급을
거절하며, 원금으로 분류하지 않는다.

## 현재 실행 증거

변경된 후보의 전체 로컬 unit: **67 files / 662 tests PASS**.
관리자 전체 unit: **26 files / 244 tests PASS**.
양쪽 앱 typecheck와 변경 파일의 format/lint도 통과했다.
누적·미확정 채굴 수익 표시 보완 뒤 관리자 focused **2 files / 27 tests**도
다시 통과했다: `D:\\PUTDUK-MINING-QA\\codex-2026-10-03T09-11-58-555Z-8b97e9a9`.
로컬 unit 증거 경로:

- `D:\PUTDUK-MINING-QA\codex-2026-10-03T08-40-13-634Z-c7278e7d`
- `D:\PUTDUK-MINING-QA\codex-2026-10-03T08-40-13-588Z-2600b682`
- typecheck: `D:\PUTDUK-MINING-QA\codex-2026-10-03T08-33-03-900Z-3e9589b3`

첫 후보 unit의 reversal fixture는 의도한 원본 금액 검증 전에 동일 journal/event
중복 검증에 걸렸다. 두 번째 fixture의 원본 식별자를 독립적으로 수정했고
기존 중복/과도 reversal assertion은 그대로 보존했다. 관리자 기존 loaded
fixture에는 새 view 응답이 없어 partial이 됐다. 실제 empty-source snapshot을
추가하고, 누락 시 partial이 되는 별도 검사도 유지했다. 실패를 삭제하지 않는다.

새 SQL migration·pgTAP·원본 금전 검사·실제 관리자 브라우저는 아직 이 후보의
정확한 commit SHA CI에서 실행되지 않았다. **DB/브라우저 PASS를 주장하지 않는다.**
로컬 Supabase 실행은 자동 승인 검토에서 차단됐으므로 우회하지 않는다.
검증은 이 저장소의 CI 일회용 DB에서 새로 만들고 실행한다. 변경은 한 기능
묶음으로 제출하며 PR와 develop push의 18개 job·전체 20분 이내 완료를 각각
확인한다. 320/390/834/1440px × System/Light/Dark의 실제 confirmed/unresolved
화면 pixels도 검토해야 한다.

## 남은 연결과 승인

source-aware 출금 신청·원금 hold·release·finalize·정정/reversal의 DB 실행,
회원별 동시성, prospective 정산 경계, funding 등급/상품/사용자/캠페인 정책의
전체 runtime 연결은 이번 capture 후보에 포함되지 않는다. 미연결 이동을
service-role insert로 열거나 과거 generic 출금을 임의 분류하지 않는다.
이는 후속 완결 묶음과 호환성 조사 대상이다.

정확한 tier 구간·수익률·상품 수치·cap·campaign 수치는 미승인이다.
비주얼 master 승인과 환경/배포도 별도 gate다. 원격 Supabase·Cloudflare·
production·실제 송금은 변경하지 않는다. 이 후보나 CI 성공은 출시 완료가 아니다.
