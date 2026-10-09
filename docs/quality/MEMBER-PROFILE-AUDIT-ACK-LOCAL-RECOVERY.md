# 가입 프로필 원본 내부 감사 ACK

현재 통합 `2a2cbf5e2efa11b183f1fcae72719949e48ca1fa`의 174 migration을 읽어
기존 `complete_outbox_event(uuid,text)`에 정확한 가입 프로필 유형을 연결한다.
이 초안은 등록 SQL/native/Worker 패키지이며 아직 DB 적용 또는 테스트 실행 전이다.

기존 `capture_public_signup_identity()`가 한 Auth 트랜잭션에서 identity,
계정 기반, 3개 SIGNUP 동의, `MEMBER_PROFILE_CAPTURED.v1`, timeline을 생성한다.
payload에는 TERMS/PRIVACY 버전 두 개와 별도 MARKETING boolean이 있다.
원본은 사용자가 수정할 수 있는 metadata나 나중 설정 변경으로 대체하지 않는다.

전용 private `consume_member_profile_audit(uuid,text)`만 owner 실행을 수행한다.
SQL service role와 JWT, 현재 lease, exact type/version/owner/request/key/payload,
원본 동의·timeline·identity·Auth 존재/시간 순서를 확인한 뒤 내부 delivery와
PII 없는 source snapshot/digest receipt를 기록하고 같은 transaction에서 완료한다.
이미 봉인된 receipt를 재검증해 replay하며 가짜·변조·만료 lease는 거부한다.
기존 공개 command 이름/입력과 다른 domain 소비자는 유지한다.

privileged function은 이 정확한 private 함수 한 개만 늘어 strict definer roster가
67→68로 바뀐다. 두 목록을 똑같이 갱신하며 wildcard나 직접 table/PII grant는 없다.
보상·금전·회원 알림·마케팅 가입·중복 timeline 쓰기는 추가하지 않는다.

native 초안은 실제 signup trigger의 controlled Auth SQL fixture를 사용한다.
BEGIN 후 다른 statement에서 가입해 transaction/statement 시간이 달라지는 사실을
관측한다. wrong worker/JWT/expired lease, captured false/true와 후속 설정 변화,
중간 receipt fault rollback, source/ACK immutability, replay, fake profile/delivery,
원장/알림/timeline 무변경을 검증한다. GoTrue 실제 UI proof와 별도로 분류한다.

실제 이전 두 가입 원본은 `DEAD_LETTER / UNSUPPORTED_EVENT_TYPE` 상태였다.
이 패키지는 그 행을 삭제하거나 자동 재등록하지 않는다. 적용 뒤 현재 원본 검증과
별도 승인된 recovery/재시도 절차로 처리해야 한다. 존재만으로 과거 성공을 주장하지 않는다.

실행 전 상태: `SOURCE_ONLY_UNEXECUTED`. root가 exact package를 검토한 뒤
단일 DB 슬롯에서 targeted native → 실제 Node canonical claim/complete → 보안 roster와
Worker 회귀를 검증한다. runtime inventory/guard successor는 최종 candidate로 갱신한다.
