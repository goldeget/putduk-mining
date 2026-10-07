# 상품별 경제 제안

모든 값은 PROPOSED_NOT_APPROVED다. 승인값은 null이다. Grade는 가상 상품 편성 표기이며 투자 등급·기업 평가가 아니다. 각 값의 비교 근거, whole KRW cue, Pending/Settlement/Verified 경계는 JSON에 있다.

| 상품(조사 힌트)   | 편성 제안           | Grade | 장면 성격     | 제안 속도 | Capacity              | 기존 정책                                     |
| ----------------- | ------------------- | ----- | ------------- | --------- | --------------------- | --------------------------------------------- |
| 삼성전자          | P0_LAUNCH_CORE      | A     | 정밀 스캔형   | 1.12      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| SK하이닉스        | P0_LAUNCH_CORE      | S     | 층별 신호형   | 1.15      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 현대자동차        | P0_LAUNCH_CORE      | B     | 차례 진행형   | 1.09      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| LG에너지솔루션    | P0_LAUNCH_CORE      | B     | 셀 순서형     | 1.08      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| NAVER             | P1_LAUNCH_EXPANSION | B     | 정보 탐색형   | 1.07      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| KB금융            | P1_LAUNCH_EXPANSION | C     | 기록 정리형   | 1.02      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 엔비디아          | P0_LAUNCH_CORE      | S     | 연산 흐름형   | 1.18      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 테슬라            | P0_LAUNCH_CORE      | A     | 조립 리듬형   | 1.13      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 로켓랩            | P1_LAUNCH_EXPANSION | S     | 임무 단계형   | 1.16      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 샌디스크          | P1_LAUNCH_EXPANSION | B     | 저장 정리형   | 1.09      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 애플              | P0_LAUNCH_CORE      | B     | 정밀 관찰형   | 1.08      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 마이크로소프트    | P0_LAUNCH_CORE      | A     | 연결 흐름형   | 1.10      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 아마존            | P1_LAUNCH_EXPANSION | B     | 경로 정리형   | 1.07      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 알파벳 A주 조사안 | P1_LAUNCH_EXPANSION | A     | 지식 연결형   | 1.11      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 메타              | P1_LAUNCH_EXPANSION | B     | 노드 교류형   | 1.06      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| SPY               | P0_LAUNCH_CORE      | C     | 묶음 균형형   | 1.03      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| QQQ               | P0_LAUNCH_CORE      | B     | 묶음 연결형   | 1.06      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| SOXX              | P1_LAUNCH_EXPANSION | A     | 묶음 검사형   | 1.10      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| SCHD              | P1_LAUNCH_EXPANSION | C     | 묶음 기록형   | 1.01      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 비트코인          | P0_LAUNCH_CORE      | A     | 블록 순서형   | 1.14      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 이더리움          | P0_LAUNCH_CORE      | A     | 구조 연결형   | 1.12      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 솔라나            | P1_LAUNCH_EXPANSION | A     | 나란한 흐름형 | 1.13      | INHERIT_TIER_CAPACITY | POLICY_VERSION_CHANGE_REQUIRED                |
| 금                | P0_LAUNCH_CORE      | C     | 정제 관찰형   | 1.00      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
| 은                | P0_LAUNCH_CORE      | C     | 표면 검사형   | 1.04      | INHERIT_TIER_CAPACITY | WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED |
