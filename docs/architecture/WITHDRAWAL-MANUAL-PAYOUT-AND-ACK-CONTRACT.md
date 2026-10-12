# 출금 수동 지급 및 기존 원본 ACK 계약 — 로컬 후보

2026-10-11 사용자 승인 범위: USDT 계약 공백, Worker 출금 이벤트 3종,
AI 감사 오류의 서버 수정. UI, 운영 DB, Push/Merge/배포, 실행 검사는 보류한다.
이 문서는 기능 동작 검증 증거가 아니다. 상태: CODE_WRITTEN / NOT_TESTED.

## 지급 권위

플랫폼 수수료는 영구 0이다. 운영자가 요청 금액 전액을 직접 수동 송금한 뒤
기존 관리자 명령으로 송금 기록과 원장 완료를 처리한다. 서버는 송금을 실행하지
않으며 자동 환율, 체인 검증, 부분·분할 지급 정책을 도입하지 않는다.

KRW의 기존 전액 대조는 보존한다. 새 USDT 영수증은 요청 시 참조한 목적지의
append-only REGISTERED 네트워크와 정확히 일치해야 한다. 이후 REPLACED
이력이나 표시 문자열은 원본 네트워크로 사용하지 않는다.

## 새 USDT 송금 증빙 v1

기존 RECORD_USDT_SEND의 conversionEvidence에 다음 8개 필드를 모두 담는다.
추가 필드는 거절한다. 금액은 부동소수점 대신 문자열/정확한 numeric을 사용한다.

| 필드 | 계약 |
|---|---|
| version | 숫자 1 |
| basis | OPERATOR_MANUAL_FULL_PAYOUT |
| withdrawalId | 해당 출금 UUID의 lowercase 문자열 |
| requestedKrwAmount | 원본 요청 원화액과 같은 양의 정수 문자열 |
| actualUsdtAmount | 실제 송금액과 같은 양의 canonical 소수 문자열, 최대 소수 6자리 |
| network | 등록 원본과 일치하는 TRC20 / ERC20 / BEP20 |
| feeKrw | 문자열 0 |
| fullPayoutConfirmed | boolean true |

운영자의 수동 전액 지급 확인을 원본 요청·실제 송금 사실에 묶는 계약이다.
환산율의 경제적 타당성, 실제 수취, 체인 finality를 자동 입증하지 않는다.
승인된 FX/견적/반올림/회원 고지 정책은 발견되지 않았으므로 별도 확정 대상으로
남는다. 임의의 시장 환율이나 기존 asset_reference_rates를 출금 규칙으로 쓰지 않는다.

기존 opaque/null 증빙은 동일 영수증 재조회에서 그대로 유지한다. INSERT 전의
기존 동일-key/동일-withdrawal replay 경로를 변경하지 않는다. 새 영수증과
미완료 상태에서 LEDGER_FINALIZED/COMPLETED로 전이하는 경로는 trigger가
네트워크·방법·증빙을 검사한다. 부족한 과거 미완료 영수증은 fail-closed로 남는다.
원본 수정, 증빙 자동 보충, 재송금은 이 패치의 동작이 아니다. 이미 완료된 원장
재조회는 읽기 경로로 보존한다.

## Worker 3종

| 이벤트 | DB에서 대조하는 이미 확정된 원본 |
|---|---|
| WITHDRAWAL_REQUESTED.v1 | 요청·회원·지갑, HOLD 원장과 정확한 2개 분개, 거래 영수증 |
| WITHDRAWAL_EXTERNAL_SENT.v1 | 불변 송금 영수증, 실제 방식·금액·운영자·명령 키, 감사 연결 |
| WITHDRAWAL_HOLD_RELEASED.v1 | 원 HOLD의 REVERSAL 원장과 2개 분개, 취소/반려·사유·행위자·감사 연결, 외부 송금 없음 |

Worker는 exact payload 및 버전·aggregate·UUID·정확한 금액 표현을 먼저 검사한다.
DB는 owned PROCESSING lease와 원본을 다시 검사한 뒤
withdrawal_lifecycle_ack.v1 소비 영수증과 PROCESSED 상태만 기록한다.
HOLD/해제/원장/송금/보상/알림을 재실행하지 않는다. 요청 이후 이미 완료된 출금의
늦은 요청 ACK도 허용한다. 과거 USDT 송금 ACK는 지급 완료 승인이 아니다.

private ACK의 단일 SECURITY DEFINER는 소비 영수증 INSERT 권한이 service_role에서
철회된 기존 보안 경계를 유지하기 위한 좁은 실행자이다. postgres 소유자,
service_role SQL role와 JWT role, owned lease, 원본 검증을 함께 요구한다.
public dispatcher는 INVOKER를 유지하고 원래 dispatcher alias 및 기존 nonmoney
award 분기를 보존한다. 서비스 역할의 포괄적 테이블 INSERT 권한을 추가하지 않는다.

기존 DEAD_LETTER 이벤트는 migration이 변경하거나 자동 재생하지 않는다.
별도 승인된 관리자 replay·격리 검증이 필요하다.

## 실행 재개 전 조건

새 후보는 총 195개 migration 파일이다. 기존 191/193 source fixture와 runtime pin은
역사적 증거로 보존한다. 새 후보용 closed source boundary와 CI 소비자에 대한
독립 검토가 필요하며 옛 핀을 넓히거나 덮어써 검증된 후보로 만들지 않는다.

필수 대기 검증: fresh 및 upgrade DB, 네트워크 불일치/REGISTERED 원본 누락,
새 typed 증빙 누락·변조, 정확한 기존 receipt replay, 미완료 과거 증빙 차단,
완료된 과거 원장 읽기, ADMIN/AAL2/step-up, 실제 HTTP→DB→Worker,
3종 정상/위조 원본·늦은 ACK·lease 유실·재시도 및 원장 부작용 0,
보안 roster 77의 정확한 권한, 전체 출금 E2E·CI. UI_INTEGRATION_PENDING.
