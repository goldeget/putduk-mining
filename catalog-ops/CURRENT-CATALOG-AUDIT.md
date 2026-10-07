# 현재 카탈로그 감사

기준은 origin/develop `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`이다. 원본 seed 행을 다시 읽고 동결 Scene inventory의 UUID/slug와 대조했다. 증거는 `current-catalog-audit.json`, `evidence/current-catalog-evidence.json`에 있다.

현재 저장소에는 DRAFT version 1의 11개 상품이 있다: 삼성전자, SK하이닉스, 애플, 마이크로소프트, 엔비디아, 금, 은, BTC, ETH, BNB, XRP. 저장소 기본 seed 기준 공개 상품은 0개다. LIVE DB의 공개 수·UUID·혜택·회원별 노출은 UNKNOWN이다. seed의 출처 URL과 날짜는 과거 원고이며 이번 시장 조사 증거가 아니다.

읽기 경로는 `lib/product/published-catalog.ts` → `domain/products/published-catalog.ts` → `/products`다. 승인자·승인/게시 시각·digest·availability를 검증한다. 최신 게시 snapshot이 잘못되면 예전 snapshot으로 성공 처리하지 않는다. `display_profile`과 금융 rule_payload를 회원 projection에 노출하지 않는다. 실제 상품별 선택 command와 상세 route는 확인되지 않았다.

상품 category는 KR_STOCK/US_STOCK/GOLD/SILVER/CRYPTO다. Scene family에 ETF_BASKET이 있어도 ETF 카탈로그 계약은 없다. ETF를 US_STOCK로 위장하지 않는다. ETF 분류·world·운용사·share class·exchange metadata 확장은 Primary의 결정 사항이다.

Scene 동결 브랜치는 기존 11개 상품의 profile/prompt만 제공한다. 000660에 승인된 메모리 family master가 있지만 승인된 상품용 desktop/mobile 실화면 증거는 아니다. 현재 `/mining`은 기본 Scene 입력을 사용한다. 새 상품 추가 제안은 실제 Scene 선택 구현이나 출시 승인으로 연결되지 않는다.

BNB/XRP는 삭제 대신 P2 분산 후속 후보로 제안한다. 기존 session·receipt·ledger·정산 근거는 보존한다. 새 snapshot의 archive/retire 영향과 기존 보유자의 표시·정산 보존은 Primary가 구현된 command로 검증해야 한다.

등록 조사: 카탈로그 draft/preview/approve/publish/archive와 공지·이벤트 publisher는 미발견. private catalog transition trigger는 호출 가능한 Admin command가 아니다. 실제 economy command `manage_economy_policy_version`은 상품/콘텐츠 등록에 재사용하지 않는다. 전체 route/function 조사 증거는 `evidence/command-discovery.json`이다.

경제 문서에는 OWNER_APPROVED 30일 global cycle, principal 기준 Tier capacity, product 0.90–1.10 등이 있다. 이는 현재 LIVE 활성 정책 증거가 아니다. 비기본 product/user/event effect는 funding-entitlement에서 EFFECT_SCOPE_UNRESOLVED로 차단된다. 이번 1.00–1.18과 통합 cap 계산은 신규 정책 제안이며 기존 승인이나 코드 동작을 바꾸지 않는다.
