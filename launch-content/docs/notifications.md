# Push·앱 안 알림 — 검토용 초안 32개

게시·발송·경제 정책 승인이 아닙니다. 변수는 실제로 확인한 값으로 채우고 운영자 검토를 받아야 합니다.

## 입금 신청을 받았어요

내부 slug: notification-deposit-received

입금 신청 내역에서 검토 상태를 확인해 주세요. 아직 지갑 반영 완료는 아닙니다.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인된 실제 신청 접수 영수증
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 입금을 확인하고 있어요

내부 slug: notification-deposit-review

기존 입금 내역을 확인해 주세요. 같은 입금을 반복 신청하지 마세요.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 현재 입금 검토 상태
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 입금 정보 확인이 필요해요

내부 slug: notification-deposit-info

입금 내역의 안내를 확인해 주세요. 필요한 거래 정보만 공식 고객지원으로 알려 주세요.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 회원에게 공개 가능한 실제 보완 요청
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 입금 반영 기록을 확인해 주세요

내부 slug: notification-deposit-posted

입금 내역과 지갑에서 실제 반영된 내용을 확인해 주세요.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 동일 원본의 확정 ledger posting 및 projection 확인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 입금 신청 결과가 나왔어요

내부 slug: notification-deposit-declined

기존 신청에서 확인 결과와 다음 안내를 읽어 주세요. 추가 송금 전 내용을 확인합니다.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 거절/불일치 상태와 공개 가능한 사유
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## USDT 전송 정보를 받았어요

내부 slug: notification-usdt-submitted

실제 거래 확인 뒤 반영됩니다. 제출했다고 원화 반영이 완료된 것은 아닙니다.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 제출 영수증
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## USDT 전송 안내를 확인해 주세요

내부 slug: notification-usdt-instruction

전송 전 주소·네트워크·유효 조건을 입금 화면에서 확인해 주세요.

CTA: 내역 확인 → /wallet/deposit
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 회원별 현재 유효 instruction 조회
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 출금 신청을 받았어요

내부 slug: notification-withdraw-received

내역에서 처리 상태를 확인해 주세요. 아직 실제 송금 완료는 아닙니다.

CTA: 내역 확인 → /wallet/withdraw
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 출금 신청 영수증
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 출금을 검토하고 있어요

내부 slug: notification-withdraw-review

기존 출금 내역을 확인해 주세요. 같은 요청을 반복하지 마세요.

CTA: 내역 확인 → /wallet/withdraw
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 검토 상태
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 출금 확인이 필요해요

내부 slug: notification-withdraw-hold

신청 내역에서 안내를 확인해 주세요. 별도 송금으로 보류를 해제하지 않습니다.

CTA: 내역 확인 → /wallet/withdraw
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 hold와 공개 가능한 보완 안내
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 출금 처리 상태가 바뀌었어요

내부 slug: notification-withdraw-sending

내역에서 최신 상태를 확인해 주세요. 실제 수령 여부는 처리 기록을 확인합니다.

CTA: 내역 확인 → /wallet/withdraw
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 승인된 송금 진행 상태
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 출금 완료 기록을 확인해 주세요

내부 slug: notification-withdraw-complete

출금 내역에서 실제 송금 확인 내용을 확인해 주세요.

CTA: 내역 확인 → /wallet/withdraw
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 외부 송금 영수증+finalization 원장 확인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 출금 신청 결과가 나왔어요

내부 slug: notification-withdraw-result

기존 신청에서 결과와 다음 안내를 확인해 주세요. 추가 신청 전 내용을 읽어 주세요.

CTA: 내역 확인 → /wallet/withdraw
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 거절/취소/복구 결과 중 해당 상태
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 채굴 적용 상태를 확인해 주세요

내부 slug: notification-mining-start

내 채굴 화면에서 현재 조건과 주기를 확인해 주세요.

CTA: 내역 확인 → /mining
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 승인된 activation과 최신 revision
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 확인 전 채굴 기록이 있어요

내부 slug: notification-mining-pending

아직 확정된 보상이 아닙니다. 채굴 화면에서 확인 상태를 살펴보세요.

CTA: 내역 확인 → /mining
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 pending 조회, 지급 영수증과 구분
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 확정된 채굴 기록을 확인해 주세요

내부 slug: notification-mining-verified

지갑에서 실제 반영된 채굴보상 기록을 확인해 주세요.

CTA: 내역 확인 → /wallet
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 earned receipt와 balanced posting 대조
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 채굴 한도 상태가 바뀌었어요

내부 slug: notification-mining-capacity

내 채굴 화면에서 현재 주기와 적용 상태를 확인해 주세요.

CTA: 내역 확인 → /mining
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인 정책+현재 capacity/used/remaining revision
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 내 채굴 주기를 확인해 주세요

내부 slug: notification-mining-cycle

주기 화면에서 시작·종료와 현재 적용 조건을 확인해 주세요.

CTA: 내역 확인 → /mining
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 cycle boundary와 worker 처리 결과
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 채굴 적용 상태를 확인해 주세요

내부 slug: notification-mining-pause

현재 상태와 안내를 확인해 주세요. 화면 효과만으로 보상 지급을 판단하지 마세요.

CTA: 내역 확인 → /mining
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 pause/safe mode 상태 중 공개 가능한 사항
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 이벤트 안내가 시작됐어요

내부 slug: notification-event-start

대상·기간·참여 조건을 이벤트 화면에서 읽어 주세요. 열람만으로 보상이 확정되지 않습니다.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인된 실제 live publication; marketing consent/조용한시간 적용
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 이벤트 종료 안내를 확인해 주세요

내부 slug: notification-event-ending

종료 시각과 내 참여 조건을 확인해 주세요. 확인되지 않은 지급은 약속하지 않습니다.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인된 종료 예정 시각과 현재 live 상태
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 이벤트가 종료됐어요

내부 slug: notification-event-ended

이벤트 화면에서 종료 안내와 실제 처리 결과를 확인해 주세요.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 ended publication; 미처리 reward 별도 확인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 이벤트 변경 안내가 있어요

내부 slug: notification-event-cancelled

취소 또는 변경 내용을 확인해 주세요. 기존 거래 영향은 실제 안내를 따릅니다.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인된 실제 취소·변경 readback
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 새 공지가 있어요

내부 slug: notification-notice-published

적용 대상과 시각을 이벤트 화면의 공지에서 확인해 주세요.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 published notice와 expiry 확인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 계정 보안 안내를 확인해 주세요

내부 slug: notification-security-change

낯선 변경이면 공식 계정 화면을 확인하세요. 비밀번호나 인증 코드는 보내지 마세요.

CTA: 내역 확인 → /menu/account
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 보안 사건의 회원 공개 허용 결과
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 가짜 안내에 주의해 주세요

내부 slug: notification-security-phishing

입금 정보는 공식 화면에서 확인하세요. 출금 해제를 위한 별도 송금은 하지 마세요.

CTA: 내역 확인 → /notifications
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인된 보안 공지, critical override 별도 승인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 점검 안내를 확인해 주세요

내부 slug: notification-maintenance-start

영향받는 기능과 시간을 공지에서 확인하세요. 같은 거래 요청을 반복하지 마세요.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 승인된 실제 점검 시작
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 점검 후 상태를 확인해 주세요

내부 slug: notification-maintenance-end

공지의 복구 확인 내용과 내 거래 내역을 확인해 주세요.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 복구 probes와 남은 제한 확인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 일부 기능 이용이 지연돼요

내부 slug: notification-incident-open

확인된 영향과 다음 안내를 공지에서 확인하세요. 거래 요청을 반복하지 마세요.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 확인된 incident 영향과 운영 승인
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 이용 지연 안내가 갱신됐어요

내부 slug: notification-incident-update

새로 확인된 내용과 남은 영향을 공지에서 확인해 주세요.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 업데이트 된 incident 사실
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 복구 확인 안내가 있어요

내부 slug: notification-incident-recovered

복구 범위와 남은 제한을 확인하세요. 내 거래는 내역에서 따로 확인합니다.

CTA: 내역 확인 → /events
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 recovery verification, 정산완료 전체단정 금지
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

## 문의 답변을 확인해 주세요

내부 slug: notification-support-reply

공식 상담 채널에서 답변을 확인해 주세요. 개인정보는 푸시에 넣지 않습니다.

CTA: 내역 확인 → /notifications
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

발송 전 실제 증거: 실제 승인된 상담 답변 저장·전달 영수증
전달 정책: 인앱 기록을 먼저 보존. 푸시는 실제 권한·수신 선택·조용한 시간·cooldown·cap 확인. 임의 critical override 금지.
중복 방지: 실제 domain event ID + 회원 ID + 승인된 template version 기준; 재시도에서 금전 명령 재실행 금지

