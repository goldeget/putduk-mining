# 입금 원금과 자금 출처 계약

상태: **APPROVED ARCHITECTURE / IMPLEMENTATION IN PROGRESS**

버전: `2026.10.03-eligible-principal-v1`. 승인 근거는 2026-10-03 사용자가
직접 확정한 잔여 원금·자금 출처 정책이다. 이 문서는 경제 운영값 승인이나
원격 migration·배포·실채굴 활성화 승인이 아니다.

## 채굴에 인정하는 원금

`Eligible Funding Principal`은 현재 채굴에 인정되는 잔여 원금이다.
승인된 실제 원금성 입금과 명시적인 원금 보정을 더하고, 원금 회수와
원금 차감·취소·reversal을 뺀다. 누적 승인 입금액을 원금으로 쓰지 않는다.

원금에 포함되는 것은 실제 KRW 입금, 실제 USDT-TRC20 수신을 운영자가
확인하여 KRW 원금으로 반영한 입금, 승인된 원금성 보정뿐이다.
USDT 지갑·잔액·채굴 경제·자동 환율은 만들지 않는다.

START 전환·가입·환영·추천·행사·프로모션·캠페인·일반 관리자 보너스와
채굴 수익은 원금에 포함하지 않는다. 보너스와 채굴 수익을 받아도
Funding Tier가 올라가지 않는다.

실제 입금 누적 통계와 현재 인정 원금은 별도 값이다. 예를 들어
1억원을 입금하고 9천만원의 원금을 회수하면, 누적 입금은 1억원이고
현재 인정 원금은 1천만원이다. 채굴 등급·파워는 1천만원을 기준으로 한다.

## 자금 출처와 기존 원장

논리 출처는 `PRINCIPAL`, `MINING_REWARD`, `BONUS`,
`OTHER_NON_PRINCIPAL`이다. 출처가 불명확한 과거 거래는 이 네 종류 중
하나로 추정하지 않는다. `UNRESOLVED`는 호환성 상태이며 새 경제 bucket이 아니다.

기존 `ledger_transactions` / `ledger_entries`가 금전의 권위다.
`wallet_ledger`와 자금 출처는 append-only projection이다.
출처 projection은 새로운 지갑·통화·잔액 수정 기능이 아니다.
같은 balanced journal과 실제 도메인 영수증에 연결해야 한다.
출처 반영 실패 시 관련 새 금전 명령 전체가 rollback되어야 한다.

새 `public.money_source_movements`는 원본 journal, 지갑 projection,
outbox, 회원, 출처, 이동 종류, 정수 금액, 기준 시각을 연결한다.
한 원본 영수증을 두 번 분류하거나 원본 거래를 덮어쓰지 않는다.
`CREDIT`, `RESERVE`, `RELEASE`, `FINALIZE`, `REVERSE`는 원금·수익·보너스의
서로 다른 효과를 보존한다. 원금성 보정은 명시적인 원금 이동이며
일반 보너스 명령을 원금 보정으로 재해석하지 않는다.

첫 구현 단계는 새 KRW·USDT→KRW 입금과 START 전환의 실제 원본 영수증을
같은 transaction에서 분류하고, 미분류 거래·출금이 있는 회원의 현재
인정 원금을 확인 필요 상태로 반환한다. 이 단계가 모든 출금·보정의
실행 연결을 완료했다는 뜻은 아니다. 미연결 종류를 허용하는 fallback은 없다.

outbox INSERT 뒤의 capture만으로는 원본 명령의 이벤트 키 충돌을 막을 수
없다. 세 terminal 도메인은 거래 종료 시 원본 이벤트·출처가 한 개이며
회원·금액·journal·wallet·키·계정 구조가 맞는지 다시 검사한다. 입금은
원래 성공 감사와 완료 명령 키도 검사한다. START에 없는 감사나 creator를
새로 요구하지 않는다. capture 또는 종료 검증이 실패하면 금전 거래 전체를
취소하고 기존 충돌 이벤트를 보존한다. 설치 이전 journal에는 새 출처나
감사·완료 키를 사후 제조하지 않는다.

## 출금과 회수

송금 수단(`KRW_BANK` / `USDT_ADDRESS`)과 자금 출처는 독립적이다.
채굴 수익 출금은 `MINING_REWARD`를 줄이며 원금·등급은 바꾸지 않는다.
원금 회수는 `PRINCIPAL`을 줄이며 서버가 등급·파워를 다시 평가한다.
보너스 출금은 원금을 바꾸지 않는다. START 첫 출금의 최대 5,000원과
무입금 자격을 그대로 보존한다.

신청은 금액과 수수료의 출처 배분을 명시해 immutable snapshot으로 남긴다.
배분의 합은 hold journal의 전체 금액과 같아야 한다. 금액·수단·출처·수수료·
정책이 바뀌면 기존 확인을 다시 사용할 수 없다. 한 출처가 부족하다고
다른 출처에서 조용히 차감하지 않는다. 출처가 없거나 불분명하면
실채굴 원금 변경을 하지 않고 호환성 예외로 처리한다.

원금 hold는 예약된 원금을 채굴에서 제외한다. 거절·취소 release는
그 시점부터 원금을 복구하며, 완료는 이미 제외한 원금을 다시 차감하지 않는다.
외부 송금 기록 뒤에는 기존 명령의 취소 금지와 운영 복구 절차를 따른다.
중복 신청·동시 회수·release·finalize·reversal은 같은 원본과 논리 키로
정확히 한 번 처리한다. 수수료를 임의로 원금에서 차감하지 않는다.

기존 `request_krw_withdrawal`, `request_usdt_withdrawal`,
`release_withdrawal_hold`, `finalize_withdrawal_ledger`의 이름을 유지한다.
출처 입력·영수증 연결 확장은 기존 WS-04 계약에 먼저 기록하고 새 migration으로
구현한다. 기존 generic 출금의 금액만 보고 출처를 추정하거나 public RPC 별칭을
추가하지 않는다. 현재 provenance가 없는 기존 신청은 별도 호환성 finding이다.

## 시간·등급·보상

원금 변경은 승인된 기준 시각부터만 적용한다. 이미 확정된 보상은 재작성하지 않는다.
정산 구간에 원금·등급·상품·사용자 override·캠페인·상태 변경이 있으면
모든 경계에서 구간을 나누고 각 원본과 승인 버전을 보존한다.
원금 변동의 처리 순서를 회원별로 직렬화하고 마지막 정산 cursor와 대조한다.
응답 지연이나 retry 시각을 원래 적용 시각으로 바꾸지 않는다.

개념식은 현재 인정 원금 × Funding Tier Rule × Product Rule × User Override
× Global/Campaign Multiplier × Eligible Elapsed Time이다.
실제 rate의 기간 단위·분모·반올림·cap도 승인된 버전 데이터로 명시해야 한다.
서버만 계산하며 브라우저·AI·Scene·시각 타이머는 금액을 결정하지 않는다.
운영값이 없거나 출처가 불명확하면 채굴 계산을 활성화하지 않는다.

`D-ECONOMY-RATE`의 **원금 기준은 APPROVED**다. 남은 미결 사항은
Tier 금액 구간·base rate·multiplier·상품 규칙 수치·정확한 cap·loyalty 및
campaign 수치다. 기본값이나 테스트 숫자를 production 정책으로 게시하지 않는다.

## 관리자와 도우미

회원 상세는 누적 KRW 원금 입금, 누적 USDT 환산 원금, 누적 원금 회수,
현재 인정 원금, 현재 등급·파워, 누적 채굴 수익, 미확정·확정 채굴 수익,
누적·현재 보너스, 총 출금을 각각 표시한다. 알려지지 않은 값은 0으로 표시하지 않는다.
출처 확인 필요 상태와 수익률 미설정 상태는 서로 다른 상태다.

운영자 입력은 값·대상·시점·미리보기·확인으로 끝나야 한다.
실제 입금 반영, USDT 환산 원금 반영, 보너스 지급, 원금 차감,
채굴 수익 보정, 원장 정정/reversal은 별도 의미의 명령이다.
각 명령은 현재 permission, step-up, reason, idempotency, balanced ledger,
audit, outbox를 따른다. raw balance edit는 제공하지 않는다.
운영 도우미는 같은 입력의 조회·초안만 준비하고 최종 실행은 기존 서버 명령과
운영자 확인을 거친다. 도우미에 별도의 금전 writer를 만들지 않는다.

## 호환성·검증·활성화

새 migration은 설치 시점을 기록하고 과거 원장·잔액을 자동 backfill하지 않는다.
기존 generic 출금, 미연결 credit/debit, 보정·reversal, 기록 누락을 조사 결과로 남긴다.
회원 영향은 nullable journal header뿐 아니라 실제 소유 KRW 계정의 원장 entry도
확인한다. 다른 회원의 source나 누락된 wallet projection으로 분류 완료를 대신하지 않는다.
사후 분류는 별도의 승인된 출처 증거·정정 명령·감사와 reconciliation이 필요하다.
기존 journal을 수정하거나 감사 기록을 삭제하여 정합성을 맞추지 않는다.

필수 검증은 원금/수익/보너스 분리, 큰 정수 정밀도, 원금 회수 후 등급 하락,
수익 출금 후 원금 불변, 같은 키의 다른 출처 거절, 동시 회수·hold/release/finalize,
rollback, 소급 보상 변경 금지, 교차 회원/RLS/서비스 최소 권한,
미분류 legacy 거절, 실제 관리자 양식·도우미의 동일 명령과 제품 gate다.
활성화는 provenance 전체 연결, 정확한 운영값 승인, 후보 전체 CI와 별도의
환경·배포 승인이 모두 있어야 한다. 원격 서비스 잠금은 그대로다.

첫 capture migration은 `20261003081200_money_source_credit_provenance.sql`이다.
새 table·index·view·private trigger만 추가하며 기존 RPC 이름·입력·영수증은
바꾸지 않는다. table 생성과 trigger 설치에는 짧은 schema lock이 필요하다.
기존 원장 전체를 갱신하거나 역분류하지 않으며, 조회는 회원의 KRW wallet과
회원별 원장·출처 index를 사용한다. large-account 조회 비용은 별도 성능 gate다.

적용 후 이전 앱으로 되돌려도 기존 금전 명령은 같은 transaction의 capture를
계속 사용한다. 장애 시 원격 삭제/down migration을 자동 실행하지 않는다.
운영자는 기존 안전 모드로 새 입금을 일시 중지하고 원본 영수증과 migration
후보를 대조한다. 출처 실패를 무시하거나 원장·감사를 삭제해 입금을 통과시키는
복구는 금지한다. 실제 환경의 설치·recovery는 후속 승인 단계에서 검증한다.
