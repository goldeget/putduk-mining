# 상품·콘텐츠 계약 대응

기준 develop SHA `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`. 150개 migration/Admin lib/API 및 회원 API 파일의 hash/function 목록은 `evidence/command-discovery.json`에 있다. 이 범위에서 승인된 catalog/content 운영 등록 command를 발견하지 못했다. 테스트 SQL insert나 trigger는 운영 command가 아니다.

| 제안              | 현재 실제 저장·읽기 계약                                                                                                                 | metadata/Primary 결정 필요                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| catalog snapshot  | product_catalog_versions: version/status/snapshot_date/methodology/source_references/content_digest/approved_by/approved_at/published_at | 실제 operator draft/preview/approve/publish/retire command와 audit/idempotency                             |
| product identity  | mining_products: UUID/catalog_version/world/code/slug/category/name_ko/name_en/description/display_order/featured/trial/display_profile  | market/exchange/share class/sector/ETF 운용사, 새 world/category 대응                                      |
| product economics | product_rule_versions와 versioned economy policy                                                                                         | 상품별 배율 저장 위치·효력 구간·portion scope·공개 설명 projection; 현재 non-default scope 미정            |
| visuals           | product_visuals: theme/path/alt/dimensions                                                                                               | personality·art keywords·approval·desktop/mobile master·browser QA. metadata를 승인 자산으로 위장하지 않음 |
| availability      | product_availability: SCHEDULED/AVAILABLE/PAUSED/RETIRED + UTC window + segment                                                          | draft/public 노출·기존 세션 보존·동일 snapshot 일관성                                                      |
| event             | events: slug/title_ko/summary_ko/status/starts_at/ends_at/published_at                                                                   | full body/card/audience/CTA/operator/KPI 등 별도. 날짜 null은 초안, NOT NULL DB insert 금지                |
| notice            | notices: slug/title_ko/summary_ko/body_markdown/status/is_pinned/published_at/expires_at                                                 | 대상·승인·변수·policy gate·fanout 별도. 목록이 전체 본문 렌더 증거는 아님                                  |
| notification      | notifications: user_id/category/title_ko/body_ko/route/expires_at + source_event_id/dedup/priority/scheduled_at                          | 실제 domain event → 대상 → delivery IN_APP/WEB_PUSH, opt-in/quiet hours/cooldown/cap/receipt               |
| FAQ/support       | 정적 trust FAQ, Channel Talk session bridge                                                                                              | 실제 CMS FAQ/macro 저장·버전·승인 및 지원 답변 저장/전달 command 미발견                                    |

제안 ID `catalog-v1-*`는 DB UUID가 아니다. 기존 11개 `repository_draft_id`만 seed에서 읽은 실제 UUID이며 LIVE 행 존재 증거가 아니다. 신규 ID/world를 발명하지 않는다. proposed field는 metadata이며 실제 등록 payload로 직접 전달하지 않는다. 현재 code는 catalog version 안에서 unique이므로 서로 다른 거래소의 같은 ticker도 Primary가 namespace 충돌을 검토해야 한다.

`ETF`는 현재 product_category enum에 없다. ETF_BASKET Scene family의 존재로 category를 확장했다고 판단하지 않는다. ETF를 US_STOCK/KR_STOCK로 강제 매핑하지 않는다. 레버리지·선물/헤지·비확정 상품은 HOLD다. 이번 실제 SEC 명부에서 SPCX/Nasdaq/Space Exploration Technologies Corp를 읽었으나 주식 종류 확인은 PARTIAL이고 공개는 여전히 HOLD다.

실제 경제 command는 `manage_economy_policy_version`이다. Admin handler가 AAL2/high-impact role/session/같은 origin/논리 작업 key/revision을 검증하는 근거는 있지만 catalog/content에 동일 권한이 구현되었다는 증거는 없다. 이 lane은 RPC 이름을 새로 정하거나 해당 economy command에 상품 metadata를 끼워 넣지 않는다.

Primary가 연결해야 할 정확한 요구:

1. 원래 권위에 맞는 catalog/content command 이름과 roles·session·origin·revision·idempotency·reason·audit 계약. 조작 불가 preview에는 대상/날짜/노출/경제/발송/기존 기록 영향이 나와야 한다.
2. 신원 검증된 상품과 법무 승인된 원고만 수용. DTO에서 proposed/approved 값을 구분하고 unrecognized metadata를 명시적으로 반환. 숫자 값 범위·grade·효력 구간을 서버에서 검증.
3. product×user×event×temporary와 최종 cap의 portion/시간/retention 분리 확정. 이번 추천 1.00–1.10은 기존 문서 band 안이지만 새 Tier gate와 미정 효과 scope 때문에 별도 사용자 policy version 승인이 필요하다. 1.12/1.18 비교는 기존 band 자체도 바꿔야 한다. 부분 미정이면 EFFECT_SCOPE_UNRESOLVED 유지.
4. 저장한 불변 snapshot/원고 digest와 readback·실제 렌더 일치. 앞선 snapshot의 세션/정산/원장 영수증 보존. 승인 이후 변경은 새 revision/재승인.
5. 이벤트 body/CTA/audience와 FAQ/macro 등록/렌더·알림 전달 계약. 공지 게시를 자동 발송 영수증으로 간주하지 않음. 기존 경제 보상 rule에 운영 문구를 숨기지 않음.
6. 격리 LOCAL만 먼저 검증. 권한 없는 역할·취소 세션·replay·revision race·중복 발송·rollback 숨김까지 증거. 공유 staging은 Primary 소유로 미뤄 두며 production은 별도 사용자 승인.

Protected action: AI prepares → operator reviews → exact impact preview → confirmation → server authorization → audit. 서버만 돈의 권위다.

## 새 Tier metadata의 정확한 Primary 요구

`product-tier-eligibility.json`은 신규 proposal artifact이며 기존 `mining_products` 등록 payload가 아니다. `minimum_funding_tier`, `DERIVED_FROM_TIER`, `unlock_policy`, `why_this_tier`, downgrade, personality, source confidence는 현재 계약에 없는 metadata다. existing rule payload나 approved economy configuration에 임의로 삽입하지 않는다.

1. 기존 versioned catalog와 승인 economy receipt에 연결하는 minimum L-tier 계약 및 draft/preview/approval/publication의 불변 version/digest binding을 확정한다. 정책 문서만으로 현재 적용을 추측하지 않는다.
2. 기존 source provenance의 남은 인정 원금에서 Tier를 읽고 rewards/bonus/trial/HOLD를 제외한다. min Tier만 참조하고 제품별 KRW 문턱을 따로 저장하지 않는다. 계정/상품 snapshot/availability/정책 시각/slot/allocation을 같은 권위로 확인한다.
3. 추천 downgrade B의 서버 condition-change boundary에서 과거 accrual과 이후 PAUSE를 분리한다. 기존 cycle/age/used/carry/verified ledger/history를 보존한다. capacity 하향 시 clawback/RESET/자동 대체/소급 catch-up 없이 재확인한다. 원금 HOLD와 safe mode는 기존 guard가 우선한다.
4. Member-facing safe projection은 선택 가능/조건 확인 중/진행 멈춤/다음 행동만 설명한다. raw L 코드, private formulas, financial enums, engine internals를 client에 내보내지 않는다. START 체험·첫 출금에 Funding Tier gate를 전용하지 않는다.
5. 새로운 상품 공개/자격 변경 알림은 승인된 실제 domain event → user targeting/dedup/opt-in → delivery receipt로만 전달한다. 공지 publication을 notification delivery로 취급하지 않는다.

위 구현은 Primary 소유다. 이 lane은 shared schema, API, backend, financial policy, engine, UI를 변경하지 않았다.
