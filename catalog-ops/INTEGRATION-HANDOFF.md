# Primary에 전달할 상품·경제·콘텐츠 운영 패키지

CURRENT BRANCH: `parallel/catalog-product-ops`

EXACT HEAD: `node catalog-ops/verify-handoff.mjs --require-pushed --require-clean`이 최종 전체 SHA와 실제 원격 branch tip을 확인한다. 이 문서의 조사 anchor는 `6abe71b`(앞선 4개 checkpoint 완료)이며 자신의 최종 commit SHA를 문서에 자기 참조로 넣지 않는다. 클라우드 checkout의 fetch refspec이 제한되어 있어 remote-tracking ref 존재를 가정하지 않고 exact feature ref를 `git ls-remote`로 읽는다. 최종 채팅 보고에도 실제 push된 전체 SHA를 남긴다.

BASE SHA: `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`

요청 실행 설정은 GPT-6.1 Sol / High / Cloud다. 현재 도구에는 실행 모델·추론 강도를 조회하거나 변경하는 기능이 없어 실제 적용 여부는 미확인이다. 모델 설정을 바꾸었다고 주장하지 않는다.

COMMITS: research/audit → catalog/copy → economy simulation → content audit → validator/registration/handoff의 5개 checkpoint. 앞선 커밋은 `0a9bf7f`, `112d2fc`, `20f1179`, `6abe71b`. 마지막 checkpoint는 이 문서와 검증 스크립트를 포함한다. PR·merge·full CI는 실행하지 않았다.

CHANGED PATHS: `catalog-ops/**` only. 전체 목록은 `evidence/changed-paths.txt`, 최종 diff와 freeze는 verify-handoff 출력으로 재확인한다.

## 결과와 증거 상태

| 항목                                   | 결과                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| PUBLIC RESEARCH SOURCES                | 52개 요청, 0개 응답 본문, 0개 현재 시장 사실 검증                                |
| RESEARCH COMPLETED                     | NO — proxy 403. 공식 호스트 초안 saved, runtime 미적용, requires_publish=true    |
| CURRENT REPO PRODUCTS                  | 11개 REPOSITORY_DRAFT; seed 기본 공개 0; LIVE_DB_UNKNOWN                         |
| PROPOSED CANDIDATES                    | 55: US 15 / KR 14 / ETF 17 / CRYPTO 7 / PRECIOUS 2                               |
| CONDITIONAL LAUNCH                     | P0 14 + P1 10 = 24; 실제 effective_wave는 모두 HOLD                              |
| NEW PRODUCTS NOT IN REPO               | 조건부 출시 15개; 모든 후보 universe에서는 44개                                  |
| EXISTING PRODUCTS KEPT                 | 삼성전자/SK하이닉스/AAPL/MSFT/NVDA/XAU/XAG/BTC/ETH 9개                           |
| EXISTING PROPOSED HOLD                 | BNB/XRP P2; 삭제 실행 없음                                                       |
| PERSONALTIES / ECONOMY                 | 24개 개별 성격·배율·rationale; approved=null                                     |
| RECOMMENDED ECONOMY                    | A / 조정 balanced 1.00–1.18 / INHERIT_TIER_CAPACITY                              |
| ECONOMY SIMULATION                     | PASS_OFFLINE_SIMULATION; NORMALIZED_INDEX_ONLY                                   |
| 1.50 CAP                               | 정확한 유리수 곱 후 최종 한 번; 기존 runtime 구현 증거 아님                      |
| CONCENTRATION                          | HIGH: 속도만 보는 모형에서 유일 최고 선택 100%; 실제 사용자 분포 UNKNOWN         |
| EVENT REVIEW                           | KEEP 21 / REWRITE 5 / MERGE 3 / DROP 1 / ADD 10                                  |
| NOTICE REVIEW                          | KEEP 22 / REWRITE 4 / MERGE 0 / DROP 0 / ADD 8                                   |
| FAQ / SUPPORT / NOTIFICATION DELTA     | 16 / 8 / 8; 기존 68 / 28 / 32 보존                                               |
| CATALOG / CONTENT REGISTRATION COMMAND | NOT FOUND / NOT FOUND                                                            |
| LOCAL REGISTRATION                     | NOT RUN — 승인된 command 없음                                                    |
| READBACK / RENDER / ROLLBACK           | BLOCKED / BLOCKED / BLOCKED; 실제 ID·화면 증거를 발명하지 않음                   |
| VALIDATOR                              | PASS_DRAFT_VALIDATION; production-ready 판정이 아님                              |
| TESTS                                  | 최종 TAP 참조. 거절·positive·정수 carry/cap/allocation/큰 정수 테스트, skip 없음 |
| PRODUCTION                             | NOT TOUCHED                                                                      |

전체 P0/P1 및 P2/HOLD/REJECT 목록은 `PRODUCT-CATALOG-PROPOSAL.md`에 있다. P0/P1 전체 경제 표는 `PRODUCT-ECONOMY-MATRIX.md`, 각 값의 상대적 이유는 `product-economy-proposal.json`에 있다. 고속은 시장 성장률이 아니라 가상 장면/카탈로그 편성의 편집 제안이다. member copy에 proposed 숫자를 노출하지 않았다.

## 법무·정책·제품 포지셔닝

모든 상품은 LEGAL_BRAND_REVIEW_REQUIRED, 회원 원고는 LEGAL_COPY_REQUIRED다. 상표 이름·로고·기업 제휴·실제 금융상품 분류를 승인한 상태가 아니다. virtual-theme 설명은 저장소 명세와 원고 제안이며 규제 판단을 대체하지 않는다. 시장가격이 내부 보상을 결정하지 않으며 실제 주식/ETF/금속/코인을 소유하지 않는다는 문구도 법무 검토가 필요하다.

기존 OWNER_APPROVED product 범위는 0.90–1.10이다. 24개 중 9개가 1.10을 넘으므로 POLICY_VERSION_CHANGE_REQUIRED다. 범위 안 15개도 자동 실행 가능이 아니다. 현재 non-default modifiers는 EFFECT_SCOPE_UNRESOLVED다. 사람 승인이 필요한 것은 새 정책 범위·상품별 값·scope·효력 구간·기존 사용자 영향이며, 별도 사용자 승인 전 실제 경제 policy는 바꾸지 않는다.

1.18은 1.20보다 headroom을 남기지만 최고속 선택 편중을 제거하지 못한다. 최종 승인 전에 1.00–1.12 또는 C fallback을 검토한다. 추천은 A 하나이며 B는 capacity 변경 위험 비교 전용이다. 실제 회원 행동·지원 통계 없이 “균형이 검증됐다”고 판단하지 않는다.

## Scene 연결

기존 동결 Scene 패키지에는 11개 명세/22개 프롬프트가 있다. 새 출시 제안 15개는 SCENE_SPEC_REQUIRED + DESKTOP_MASTER_REQUIRED + MOBILE_MASTER_REQUIRED다. 기존 9개 포함 24개 모두 제품용 desktop/mobile와 실화면 QA가 필요하다. 000660의 승인 family master는 최종 상품 QA가 아니다. `/mining`의 기본 입력을 상품 snapshot에 연결하는 작업은 Primary/새로 배정된 Scene lane 소유다. 이 브랜치는 SceneRegistry/runtime/asset를 수정하지 않는다.

## Primary가 진행할 순서

1. 환경 설정 초안의 정확한 조사 호스트를 적용한 뒤 공식 자료 읽기를 재개한다. 이름·code·exchange·asset class/share class를 현재 사실로 검증하고 source body hash·excerpt·시각을 기록한다. SpaceX/SPCX는 최신 사실을 확인하기 전 상장/비상장으로 단정하지 않는다. SNDK 발행회사와 Alphabet A주도 교차 확인한다.
2. ETF category/world/metadata와 approved catalog/content command를 확정한다. 이 lane의 proposal ID를 DB UUID로 쓰거나 US_STOCK 분류에 ETF를 숨기지 않는다. DTO에서 storage 지원 필드와 metadata를 나누고 unsupported 필드를 검토 결과로 반환한다.
3. 법무/브랜드와 경제 policy 검토를 사용자에게 올린다. 승인된 기존 범위와 신규 제안을 별개 version으로 취급한다. product×user×event×temporary와 final cap portion/시간/retention 경계를 계약으로 결정한다.
4. owned isolated LOCAL에서 실제 draft ID → 권한 있는 readback → 원고/snapshot digest 일치 → 실제 member/admin browser 렌더 → cancel/archive → 숨김 readback/audit를 수집한다. replay/역할/세션 취소/revision race/중복 발송/기존 기록 보존 검사를 포함한다. shared staging은 Primary 소유로 미룬다.
5. 관련 UI·backend·Scene 작업은 Primary가 별도 lane에서 처리한다. 이 브랜치에는 production registration, direct SQL, migration, fixture importer, API executor를 추가하지 않는다. 최종 통합과 full CI는 Primary 소유다.

## 유저가 승인해야 할 범위

네트워크/현재 lane 시작 지침 초안은 onboarding 기능으로 이미 saved 상태다. 도구는 requires_publish=true를 반환했다. 환경 설정에서 검토 후 Publish해야 runtime에 적용된다. 이는 상품 생산 게시 승인과 별개다. 스킬의 save 계약상 saved는 실행·runtime update·publication 증거가 아니다.

카탈로그 이름 사용/상품 포지셔닝/법무, 출시 편성, 새 policy version/값/효력시각, 실제 production 등록·발송은 별도 사람 승인이 필요하다. 비밀값은 추가하지 않았고 수동 JSON 입력도 요구하지 않는다. 필요한 결정 전에는 모든 운영 command 실행을 차단한다.

운영 준비와 안전한 초안 리뷰는 가능하지만 **공식 조사 미완료·command 부재로 출시 준비는 NO**다.
