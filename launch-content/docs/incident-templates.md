# 장애 안내 — 검토용 초안 8개

게시·발송·경제 정책 승인이 아닙니다. 변수는 실제로 확인한 값으로 채우고 운영자 검토를 받아야 합니다.

## 이용 지연 최초 안내

내부 slug: incident-first-notice

일부 기능의 이용이 지연되고 있습니다.

확인 시각: {{observed_at_kst}}
영향받는 기능: {{affected_features}}
확인된 현상: {{confirmed_facts}}
아직 확인 중인 내용: {{unknowns}}
다음 안내 시각: {{next_update_kst}}

같은 입출금 요청을 반복하지 마세요. 원인이나 거래 영향을 추측하지 않고 확인된 내용부터 안내하겠습니다.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: affected_features, confirmed_facts, next_update_kst, observed_at_kst, unknowns

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 이용 지연 중간 안내

내부 slug: incident-ongoing-delay

{{affected_features}}의 이용 지연을 계속 확인하고 있습니다.

새로 확인된 내용: {{new_confirmed_facts}}
현재 남은 영향: {{remaining_issues}}
아직 확인 중인 내용: {{unknowns}}
다음 안내 시각: {{next_update_kst}}

완료 시각은 아직 확인되지 않았습니다. 같은 거래를 반복하지 말고 기존 내역을 확인해 주세요.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: affected_features, new_confirmed_facts, next_update_kst, remaining_issues, unknowns

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 입출금 반영 지연 안내

내부 slug: incident-payment-review

일부 입출금의 확인 또는 반영이 지연되고 있습니다.

확인된 범위: {{affected_scope}}
현재 상태: {{confirmed_facts}}
다음 안내 시각: {{next_update_kst}}

신청 접수와 실제 송금·지갑 반영은 다릅니다. 같은 요청이나 송금을 반복하지 마세요. 확인되지 않은 잔액이나 완료 상태를 정상으로 안내하지 않습니다.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: affected_scope, confirmed_facts, next_update_kst

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 채굴 상태 반영 지연 안내

내부 slug: incident-mining-review

{{affected_scope}}의 채굴 상태 확인 또는 반영이 지연되고 있습니다.

현재 확인된 내용: {{confirmed_facts}}
아직 확인 중인 내용: {{unknowns}}
다음 안내 시각: {{next_update_kst}}

화면 움직임이나 지난 시간으로 보상 금액을 계산하지 마세요. 확인 전 금액은 확정된 보상이 아닙니다. 실제 처리 기록을 확인한 뒤 다시 안내하겠습니다.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: affected_scope, confirmed_facts, next_update_kst, unknowns

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 일부 기능 복구 안내

내부 slug: incident-partial-recovery

{{recovered_features}}의 이용을 다시 확인할 수 있습니다.

확인 시각: {{verified_at_kst}}
실제로 확인한 내용: {{verified_checks}}
아직 영향을 받는 기능: {{remaining_issues}}
다음 안내 시각: {{next_update_kst}}

모든 기능이나 거래가 완료됐다는 뜻은 아닙니다. 내 거래 내역은 별도로 확인해 주세요.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: next_update_kst, recovered_features, remaining_issues, verified_at_kst, verified_checks

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 복구 확인 안내

내부 slug: incident-verified-recovery

{{affected_features}}의 복구를 확인했습니다.

확인 시각: {{verified_at_kst}}
실제 확인 항목: {{verified_checks}}
남아 있는 제한 또는 지연: {{remaining_issues}}

내 거래가 완료됐는지는 해당 내역에서 확인해 주세요. 문제가 남아 있으면 공식 고객지원에 알려 주세요. 후속 안내는 확인된 내용을 기준으로 제공합니다.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: affected_features, remaining_issues, verified_at_kst, verified_checks

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 장애 후속 안내

내부 slug: incident-post-incident

이용에 불편을 드린 상황의 확인 결과를 안내합니다.

발생 기간: {{incident_window_kst}}
확인된 원인: {{verified_cause}}
실제 영향: {{verified_impact}}
복구와 대조 결과: {{verified_reconciliation}}
재발 방지 조치: {{approved_prevention}}
남아 있는 사항: {{remaining_issues}}

보상이나 별도 조치가 필요한 경우 승인된 내용을 따로 안내하겠습니다. 확인되지 않은 금전 혜택을 약속하지 않습니다.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: approved_prevention, incident_window_kst, remaining_issues, verified_cause, verified_impact, verified_reconciliation

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

## 이전 안내 정정

내부 slug: incident-correction

이전 안내의 일부 내용을 정정합니다.

이전 안내 시각: {{previous_notice_kst}}
잘못 안내한 내용: {{incorrect_statement}}
실제로 확인된 내용: {{verified_statement}}
이용에 미치는 영향: {{verified_impact}}
다음 확인 방법: {{member_actions}}

혼동을 줄이기 위해 원래 안내와 정정 내용을 함께 남깁니다. 거래 상태는 실제 내역에서 확인해 주세요.

CTA: 안내 보기 → /status
대상: MEMBERS. 승인: PENDING. 경제: NONE / NOT_APPLICABLE.

확인 후 채울 변수: incorrect_statement, member_actions, previous_notice_kst, verified_impact, verified_statement

운영자 메모: 미확인 원인·개인정보·내부 host·raw error·임의 보상 수치는 게시하지 않습니다. 조치·복구·대조 사실을 각각 확인합니다.

