# 기존 출시 콘텐츠 개별 감사

기준은 동결 launch-content SHA ba9ed931f756488ce4f67f945cffad9552842c09다. 30개 이벤트와 26개 공지 각각의 본문을 읽었다. 승인·일정·실제 feature gate는 KEEP여도 자동 통과가 아니다. 외부 공식 벤치마크 7분야는 403으로 읽지 못해 완료되지 않았다. 외부 패턴을 관찰했다고 쓰지 않았다.

## 이벤트

{"KEEP": 21, "MERGE": 3, "REWRITE": 5, "DROP": 1, "ADD_MISSING": 10}

| 기존 slug                    | 판정    | 이유                                                                                                       | 통합 대상                   |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| event-welcome-tour           | KEEP    | 입금 없는 첫 화면 안내와 별도 보상 없음이 명확.                                                            | —                           |
| event-start-guide            | KEEP    | 체험·실제 지갑 분리와 입금 불필요 경계 유지.                                                               | —                           |
| event-account-safety         | MERGE   | 비밀번호/낯선 로그인 안내를 피싱 캠페인에 통합. 보안 내용을 삭제하지 않음.                                 | event-phishing-check        |
| event-phishing-check         | REWRITE | 계정 안전/안전한 상담 2개를 통합한 전체 원고. 외부 송금 거절과 낯선 계정 변경·상담정보 최소화를 함께 유지. | —                           |
| event-wallet-tour            | KEEP    | 원금·보상·Bonus를 실제 출금 조건과 구분.                                                                   | —                           |
| event-pending-verified       | REWRITE | 정산 과정과 실제 지갑 반영을 구분. 상품 장면과 함께 읽어도 확정 잔액 오인 방지.                            | —                           |
| event-cycle-guide            | REWRITE | 주기 의미 유지, global capacity를 슬롯별 중복 계산하지 않는 설명 추가.                                     | —                           |
| event-offline-guide          | REWRITE | 화면/실제 처리 구분은 유지하고 재접속 후 확인 경로를 명확화. 무조건 지급 문구 금지.                        | —                           |
| event-product-read           | MERGE   | 새 자산 소유/제휴/시장가격 교육 안내에 통합하여 같은 목적 노출 중복 방지.                                  | catalog-event-theme-reading |
| event-krw-ready              | KEEP    | 입금 신청/송금/반영 차이를 설명하며 재신청 방지.                                                           | —                           |
| event-usdt-ready             | KEEP    | 주소·네트워크 오송금 위험과 수동 검토를 설명.                                                              | —                           |
| event-withdraw-ready         | KEEP    | 본인 확인·받는 곳·신청/완료 구분 유지.                                                                     | —                           |
| event-hold-guide             | KEEP    | 보류와 실패·완료 차이, 자료 최소 제출 설명.                                                                | —                           |
| event-notification-tour      | KEEP    | 알림과 거래 완료 차이 유지.                                                                                | —                           |
| event-notification-choice    | KEEP    | 선호 선택과 내역 확인을 분리; 출시 전 실제 설정 QA gate 필요.                                              | —                           |
| event-support-practice       | DROP    | 연습 참여용 상담 문의는 실제 운영 큐에 부담. 도움말/지원 공지로 안내하고 이벤트 노출 제외 제안.            | —                           |
| event-read-notices           | KEEP    | 공지 읽음을 이벤트 참여/보상으로 오인하지 않음.                                                            | —                           |
| event-status-check           | KEEP    | 장애 중 재요청 금지 및 복구 뒤 개별 거래 확인.                                                             | —                           |
| event-update-check           | KEEP    | 재접속 전 작성 내용 보호, 보안정보 요청 거절.                                                              | —                           |
| event-browser-readiness      | KEEP    | 관찰 피드백이며 모든 기기 지원 약속 없음.                                                                  | —                           |
| event-theme-choice           | KEEP    | 색상 선택과 경제 조건 독립; 실제 theme 기능 QA 필요.                                                       | —                           |
| event-accessible-guide       | KEEP    | 천천히 읽는 안내와 금전 보상 없음으로 고령 이용자 부담 완화.                                               | —                           |
| event-transaction-history    | KEEP    | 신청/반영 시각과 실제 거래 기록 확인.                                                                      | —                           |
| event-privacy-check          | KEEP    | 문의 개인정보 최소화와 권리 안내.                                                                          | —                           |
| event-weekend-guide          | KEEP    | 미확인 처리 시간을 약속하지 않음.                                                                          | —                           |
| event-maintenance-ready      | KEEP    | 점검 전 요청 결과 확인과 반복 금지.                                                                        | —                           |
| event-security-reminder      | MERGE   | 기존 피싱 캠페인과 내용 중복. 계정 안전 내용과 함께 통합 제안.                                             | event-phishing-check        |
| event-launch-feedback        | KEEP    | 실제 불편만 지원으로 수집, 금전 유인 없음.                                                                 | —                           |
| event-welcome-policy-review  | KEEP    | 입금 강제 금지와 전환 적격성 분리; 기존 경제 승인 gate 유지.                                               | —                           |
| event-capacity-policy-review | REWRITE | 상품별 속도 제안 이후 혼동 방지. 기존 POLICY_VALUE_REQUIRED gate는 그대로 보존.                            | —                           |

## 공지

{"KEEP": 22, "REWRITE": 4, "ADD_MISSING": 8}

| 기존 slug                     | 판정    | 이유                                                                               | 통합 대상 |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------- | --------- |
| notice-official-open          | KEEP    | 실제 기능 확인 gate가 있으며 오픈 시각·혜택을 임의 확정하지 않음.                  | —         |
| notice-introduction           | REWRITE | 상품 확장에 맞춰 가상 테마와 실제 자산·제휴·시장 연동 경계를 보강. 법무 검토 필요. | —         |
| notice-account-login          | KEEP    | 번호 사용 가능 여부를 문자/소유 인증으로 오인하지 않음.                            | —         |
| notice-security-phishing      | KEEP    | 공식 입금 안내와 보안정보 미제공 경계.                                             | —         |
| notice-wallet-terms           | KEEP    | 원금·보상·Bonus·보류와 출금가능 금액 구분.                                         | —         |
| notice-principal-reward-bonus | KEEP    | 세금액 원천·자격 증가 오인 방지; wallet 공지와 목적이 달라 유지.                   | —         |
| notice-krw-deposit            | KEEP    | 신청/송금/반영 차이 및 재요청 방지.                                                | —         |
| notice-usdt-deposit           | KEEP    | 네트워크/주소 확인과 실제 검토·원화 반영 분리.                                     | —         |
| notice-withdrawal             | KEEP    | 원화 잔액 기반 USDT 출금, 신청/실행 분리.                                          | —         |
| notice-withdrawal-hold        | KEEP    | 보류와 거절·송금 완료 분리, 미확인 처리시각 약속 없음.                             | —         |
| notice-mining-cycle           | REWRITE | global capacity/slot 중복 오인 방지와 잔여 한도·소액 carry 의미를 구분.            | —         |
| notice-pending-verified       | REWRITE | Pending→정산→지갑 확정 구분을 단순 한국어로 명확화.                                | —         |
| notice-products-mining        | REWRITE | 새 ETF/산업 테마에도 적용되는 설명/선택 구분과 속도/용량 독립성 추가.              | —         |
| notice-notifications          | KEEP    | 푸시 동의와 거래 완료를 분리; 실제 fanout 구현 gate 유지.                          | —         |
| notice-support                | KEEP    | 실제 문의 정보 최소화와 미확인 운영시간 약속 없음.                                 | —         |
| notice-scheduled-maintenance  | KEEP    | 시간/영향 변수와 재요청 금지; 실제 값 확인 전 DRAFT.                               | —         |
| notice-urgent-maintenance     | KEEP    | 확인 사실·다음 안내·종료 미정 분리.                                                | —         |
| notice-incident               | KEEP    | 관찰 현상과 원인/거래 영향 미확인 경계.                                            | —         |
| notice-recovery               | KEEP    | 기능 복구와 모든 거래 완료가 다름.                                                 | —         |
| notice-update                 | KEEP    | 회원 행동·작성 내용 보호·실제 적용 시간 변수.                                      | —         |
| notice-policy-change          | KEEP    | 전후 차이·기존 회원 영향·동의 내용 변수; 승인 필요.                                | —         |
| notice-privacy-change         | KEEP    | 권리 행사/정확한 승인 route 필요; 법무 gate 유지.                                  | —         |
| notice-browser-devices        | KEEP    | 지원 범위를 실제 출시 QA로 한정, 모든 기기 보장 없음.                              | —         |
| notice-known-limitations      | KEEP    | 현재 영향·대안·다음 안내를 확인된 사실로만 작성.                                   | —         |
| notice-start-conversion       | KEEP    | 체험/실제 전환 분리·입금 불필요 경계.                                              | —         |
| notice-event-participation    | KEEP    | 대상/기간/승인 보상/취소를 설명; 상품 공지와 목적 다름.                            | —         |

새 콘텐츠는 content-delta에만 작성했다. 보상 없는 교육 이벤트 10개, 공지 8개, FAQ 16개, support 8개, notification 8개다. 기존 5개 이벤트와 4개 공지의 전체 수정 본문만 별도 파일로 보관했다. 보안 MERGE의 실제 통합 본문도 event-phishing-check rewrite에 포함했다. publisher 준비 후 원고·링크·예약 중지·역사 보존을 preview하고 승인해야 한다. DROP은 운영 노출 제외 제안이며 삭제 실행이 아니다.

광범위한 기본 가입/입출금/보안/점검/장애 템플릿은 동결 패키지에 충분히 있어 복제하지 않았다. 기존 FAQ 68개와 매크로 28개는 보존한다. 신규 FAQ는 테마/실제 자산·속도/한도·장면/정산·ETF·retire 오해를 다룬다. 새 값·돈·대상·날짜를 채운 실제 등록/발송은 하지 않았다.

이벤트 storage에는 full body/CTA/audience 필드가 없고 일정 NOT NULL이다. 지금 null 일정은 안전한 초안이며 insert-ready 행이 아니다. 공지 상세 본문이 목록에 전부 렌더되는 계약도 미확인이다. 알림 user/source/dedup은 실제 domain command가 정해야 하며 초안 slug를 DB user_id처럼 쓰지 않는다.
