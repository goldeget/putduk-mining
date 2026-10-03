# 원금 출처 기록 검증

상태: **PR46 MERGED / POST_MERGE_VERIFIED / NOT PRODUCT COMPLETE**

## 최종 후보와 병합 검증

최종 head `1b2b0fb4907f22cf8e9582d1c1b924b85bb900c9`의 PR run
`37114935163` attempt 1은 18개 job 모두 success였다. 생성부터 완료까지
`10:00:23Z`–`10:18:28Z`, **18분 5초**다. DB 23 files / 674 assertions,
실제 두 세션 KRW 9 / USDT 13 / Safe Mode 6 assertions와 lint/advisors가
통과했다. 이전 후보의 성공 job을 합친 결과가 아니다.

정상 develop 병합은 `034c78ccc8002c7eb9f34ca70ac88712f1cc16de`다.
부모는 `5a7ba0c462307a26788a6f4749e45a0ba4fa64a3`와 최종 PR head다.
병합 후 push run `37116286293` attempt 1도 정확한 병합 SHA에서 success다.
`10:23:57Z`–`10:41:17Z`, 전체 **17분 20초**에 완료했다. 18개 job 중 PR
전용 Exact diff integrity만 skip이며 나머지 17개는 success다. 모든 시각은
2026-10-03 UTC다. independent identity/job/budget 검증은 다음 경로에 있다.

- PR: `D:\PUTDUK-MINING-QA\codex-2026-10-03T10-04-9c24fbfd`.
- 병합 후: `D:\PUTDUK-MINING-QA\codex-pr46-postmerge-20261003T1024Z-54dfc302`.

실제 mobile-chrome source PNG 48개를 수집하고 24개 자금 panel과 대표
전체 화면 8개를 직접 검토했다. chromium은 별도 48개 전체/panel pixels를
직접 검토했다. 두 실제 승인 원금 3,000원+7,000원과 미분류 history의
현재 원금/누적값 확인 필요가 구별된다. 이 범위의 잘림은 관측하지 않았다.
chromium 검토/hash는
`D:\PUTDUK-MINING-QA\pr46-shard1-source-pixels-20261003T101838Z-0b0158a8`에 있다.

긴 모바일 12지표, 기존 overview의 partial 경고·영문 활동 코드는 후속 UI
개선 대상으로 남긴다. 실제 기기·200%·측정 대비·성능·production acceptance나
Member 360 전체 제품 완료를 주장하지 않는다. 아래의 미실행·후보 표현은
각 당시의 검증 기록이며, 최종 CI 상태는 이 절의 정확한 후보를 따른다.

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

첫 PR #46 후보 `6c33dfff8e2253e48b38edd6011a297b4b855260`의 CI
`37113067397` attempt 1은 새 migration의 PL/pgSQL IF 조건에 있는
CASE 표현식에서 syntax error로 실패했다. 데이터베이스 검사가 실패했으므로
남은 실행을 취소했다. 최종 상태는 CANCELLED이며 09:26:41Z–09:34:26Z,
7분 45초다. 일부 성공 job을 전체 통과로 집계하지 않는다.
원본 실패 로그와 run/jobs는
`D:\PUTDUK-MINING-QA\codex-2026-10-03T09-26-33-954Z-bb2ed87b`에 보존한다.

IF 조건의 CASE 4곳을 괄호로 감싸 분기 내부 THEN을 IF 종료 토큰과 구별했다.
원본 키·계정·영수증 검증의 값이나 분기는 변경하지 않았다. 기존 정상 세 명령과
위조·충돌·rollback 검사를 모두 유지한다. 수정 후보의 새 전체 CI 전에는
**DB/브라우저 PASS를 주장하지 않는다.**

두 번째 후보 `4a17d458a6e5f425a18fc69d0357c90aaf6ea428`의 run
`37113617105` attempt 1은 migration 설치를 통과한 뒤 새 pgTAP fixture의
`INSERT ... SELECT ... UNION ALL`에서 side 문자열이 text로 추론되어
`ledger_side` enum INSERT에 실패했다. 앞선 38개 assertion의 실패는 0이지만
전체 pgTAP 완료가 아니므로 PASS로 처리하지 않는다. 실행은 취소했으며
09:36:24Z–09:39:40Z, 3분 16초다. 로그와 run/jobs는
`D:\PUTDUK-MINING-QA\codex-2026-10-03T09-36-47-333Z-cf08474e`에 보존한다.
fixture의 원래 DEBIT/CREDIT 값을 실제 enum으로 명시하며 검사 조건·원장
구조·영수증 검증을 완화하지 않는다. 새 후보는 전체 CI로 다시 검증한다.

세 번째 후보 `79ff83b6c8e6f1c71f38512361d989a2616d9b29`의 run
`37113888331` attempt 1은 23개 파일·672개 assertion을 실행했으나 새
64개 중 2개가 실패했다. 과거 journal fixture의 legacy 회원 liability
계정이 없어 CREDIT 항목이 0행이었고, 뒤쪽 균형 검사에서 원래의 deferred
원장 guard가 이를 거절했다. 최신 bootstrap은 wallet만 만들며 해당 계정을
만들지 않는다는 실제 정의를 확인했다. 실행은 취소했고
09:41:16Z–09:45:28Z, 4분 12초다. 증거는
`D:\PUTDUK-MINING-QA\codex-2026-10-03T09-44-54-648Z-4387063f`에 보존한다.
과거 fixture에 원본 계정 계약의 liability를 명시하고 두 항목·합계·통화와
즉시 균형 guard 검사를 추가한다. 기존 실패 assertion과 금융 guard는
유지한다. 부분 통과·문서·정적 추적은 전체 DB PASS가 아니다.

네 번째 후보 `728cf797f9fba16a1c66157ef083c644c373cea7`의 run
`37114352291` attempt 1은 main DB suite **23 files / 674 assertions PASS**를
확인했다. 그 뒤 실제 두 DB 세션 KRW 승인 7개 단언도 통과했지만, spec
끝의 outbox DELETE cleanup이 새 source 원본 FK에 막혀 job은 실패했다.
최종 전체 상태는 CANCELLED, 09:49:42Z–09:54:21Z, 4분 39초다. 증거는
`D:\PUTDUK-MINING-QA\codex-2026-10-03T09-50-27-452Z-ebc9fbc8`에 보존한다.
이를 Database job 전체 성공이나 PR 성공으로 기록하지 않는다.

workflow는 main suite 뒤 DB를 reset한 다음 동시성 세 파일과 schema
lint/advisors를 실행한다. 뒤에 공유 데이터 suite가 없으므로 금융 원본을
행별로 삭제할 필요가 없다. KRW의 금융 cleanup 블록을 제거하고 영수증은
일회용 러너가 폐기될 때까지 보존한다. source FK·append-only·원장·감사
기록은 완화하지 않는다. 원래 KRW 7개 / USDT 11개 / safe-mode 6개 단언과
실제 세션 종료를 유지한다. KRW와 USDT에 source 영수증 단일성과 원본
journal/wallet/event/effective_at 대조를 각각 2개 추가하여 후보 수는
**9 / 13 / 6**이다. 이는 아직 새 전체 실행의 통과 결과가 아니다.
로컬 Supabase 실행은 자동 승인 검토에서 차단됐으므로 우회하지 않는다.
검증은 이 저장소의 CI 일회용 DB에서 새로 만들고 실행한다. 변경은 한 기능
묶음으로 제출하며 PR와 develop push의 18개 job·전체 20분 이내 완료를 각각
확인한다. 320/390/834/1440px × System/Light/Dark의 실제 confirmed/unresolved
화면 pixels도 검토해야 한다.
각 상태의 전체 화면과 자금 구분 panel을 각각 저장한다. 긴 모바일 전체
페이지 축소 이미지 하나만으로 금액·문구의 읽기 품질을 판단하지 않는다.

## 남은 연결과 승인

source-aware 출금 신청·원금 hold·release·finalize·정정/reversal의 DB 실행,
회원별 동시성, prospective 정산 경계, funding 등급/상품/사용자/캠페인 정책의
전체 runtime 연결은 이번 capture 후보에 포함되지 않는다. 미연결 이동을
service-role insert로 열거나 과거 generic 출금을 임의 분류하지 않는다.
이는 후속 완결 묶음과 호환성 조사 대상이다.

정확한 tier 구간·수익률·상품 수치·cap·campaign 수치는 미승인이다.
비주얼 master 승인과 환경/배포도 별도 gate다. 원격 Supabase·Cloudflare·
production·실제 송금은 변경하지 않는다. 이 후보나 CI 성공은 출시 완료가 아니다.
