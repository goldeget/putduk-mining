# 실제 도메인 원본의 본인 알림 연결

기존 outbox completion이 실제 원본을 확인하고 ACK하던 경로에 빠져 있던 본인 알림을 연결한다. 기존 입금·출금·채굴·체험 writer와 원장·원금 시계를 그대로 사용하며 새로운 금액, 보상 정책, 공개 command 별칭은 추가하지 않는다.

단일 closed consumer는 봉인된 실제 원본에서 소유자와 발생 시각을 다시 얻는다. 활성 회원과 당시 category 동의를 확인하여 본인 IN_APP 기록 또는 불변 억제 원본을 같은 거래에서 저장한다. 기기별 push 큐는 기존 opt-in·quiet hours·current preference·subscription fence와 receipt 경로를 사용한다. IN_APP SENT는 저장 사실이며 실제 브라우저 표시 또는 외부 전송 성공을 뜻하지 않는다.

namespace와 actual source type에 대한 deferred INSERT 검증, 원본 append-only, projection immutability, 논리적 원본별 unique key가 위조와 중복을 차단한다. 호출자가 SET CONSTRAINTS ALL IMMEDIATE를 이미 실행했어도 producer는 자기 세 constraint만 작성 구간에서 지연하고 완성 직후 검증한다. 직접 service INSERT/새 private producer 실행 권한은 추가하지 않는다. 기존 closed consumer의 service_role 실행 grant와 SQL/JWT 이중 검사는 유지한다.

알림 기록 원문은 금액·계좌·수식·개인정보 없이 한국어 사실과 기존 allowlisted route로 제한한다. 처음 category opt-out으로 억제된 원본은 나중에 opt-in하더라도 과거 알림을 생성하지 않는다.

## 검증 경계

현재 검증은 173 fresh local DB에 추가 migration을 각각 transaction 안에서 적용한 뒤 actual canonical writer/claim/complete를 실행하고 ROLLBACK한 증거다. 영구 적용·최종 통합 HEAD의 fresh whole suite·실제 외부 push/device 표시는 별도이며 아직 완료로 승격하지 않는다.

원본별 native는 actual KRW credit, 출금 FINALIZE, START 전환, 30일 만기 채굴 지급/원본 두 종, 체험 terminal 원본을 사용한다. ordinary family를 따로 검증하고 reward-only 기존 assertion/lease fixture는 award source 범위로 분리하여 기존 의미를 보존한다. forced notification failure는 consumer receipt/원본/알림 전체 rollback, 재시도·응답 손실은 중복 없음, 회원 RLS·원본 forge·권한·동의·quiet·ledger 불변을 확인한다.

REFERRAL_REWARD_PAID의 기존 writer/운영 qualification 근거가 없으므로 자동 지급·알림을 발명하지 않는다. Rank·maintenance도 새 원본을 발명하지 않는다. 대량 처리 성능, 운영 30일 관측, 실제 기기 표시, 전체 제품 완료 또는 배포 준비를 주장하지 않는다.

수동 USDT의 기존 USDT_MANUAL_DEPOSIT_CONFIRMED.v1 원본은 별도 private invoker reader가 실제 USDT_KRW_DEPOSIT credit·완료 승인·균형 원장·wallet·audit·idempotency 봉인을 재검증한다. 기존 mission reader와 evaluator는 확장하지 않고 USDT reward qualification은 실행하지 않는다. 공개 함수 추가0, 새로운 private SECURITY DEFINER0(기존67 유지). Worker exact envelope는 기존 user_id/credited_krw/ledger_transaction_id 세 필드만 허용한다.
