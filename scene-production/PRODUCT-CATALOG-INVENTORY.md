# 실제 상품 전수조사

대상: goldeget/putduk-mining. Base `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`.
새 fetch 후 확인했다. main은 초기 문서 scaffold이며 구현 baseline으로 사용하지 않았다.

## 정본과 범위

정본 후보는 `product_catalog_versions`의 최신 PUBLISHED snapshot과 그 `mining_products` 행이다.
`lib/product/published-catalog.ts`는 인증 후 status=PUBLISHED, published_at<=observedAt로 단일 snapshot을 읽는다.
`domain/products/published-catalog.ts`는 UUID/code/slug/order 중복, 출처, 승인/공개 시간과 availability를 검증한다.
segment별 eligibility resolver가 없어 일반 segment만 제공 상태로 해석한다.
`app/(product)/products/page.tsx`와 view는 승인 snapshot의 모든 행을 목록으로 표시한다.
일부 paused/retired 행도 공개 snapshot 안이면 목록에 보인다. visible과 selectable을 같은 개념으로 취급하지 않는다.
상품별 상세 URL·선택 명령은 이 경로에 없다. 현재 route는 모든 후보에 `/products`; mining은 `/mining`이다.

`20260926192208_ws02_commands_and_catalog_seed.sql:1081`은 version 1을 DRAFT로 만들고,
1159–1169는 아래 11개 행을 만든다. availability/product_visuals 삽입은 없다.
RLS(`20260926192203_ws02_foundation_schema.sql:1324`)는 공개되지 않은 catalog를 숨긴다.
실제 DB 조회 없이 “현재 회원 11개 사용 가능”이라고 말할 수 없다.

| 코드 | seed UUID 끝자리 | slug | 한국어 이름 | category | 순서 / featured / trial |
| --- | --- | --- | --- | --- | --- |
| 005930 | 001 | samsung-electronics | 삼성전자 테마 | KR_STOCK | 1 / true / true |
| 000660 | 002 | sk-hynix | SK하이닉스 테마 | KR_STOCK | 2 / false / false |
| AAPL | 003 | apple | 애플 테마 | US_STOCK | 3 / true / false |
| MSFT | 004 | microsoft | 마이크로소프트 테마 | US_STOCK | 4 / false / false |
| NVDA | 005 | nvidia | 엔비디아 테마 | US_STOCK | 5 / false / false |
| XAU | 006 | gold | 골드 테마 | GOLD | 6 / true / false |
| XAG | 007 | silver | 실버 테마 | SILVER | 7 / false / false |
| BTC | 008 | bitcoin | 비트코인 테마 | CRYPTO | 8 / true / false |
| ETH | 009 | ethereum | 이더리움 테마 | CRYPTO | 9 / false / false |
| BNB | 010 | bnb | BNB 테마 | CRYPTO | 10 / false / false |
| XRP | 011 | xrp | XRP 테마 | CRYPTO | 11 / false / false |

모든 UUID prefix는 `30000000-0000-4000-8000-000000000`이다. 전체 UUID·영어명·원문·행번호는 JSON에 보존했다.
이는 seed에서 지정한 신원이고 live DB의 동일 신원을 증명하지 않는다.
시장 KR/US는 world에서 읽었다. crypto/금/은의 market은 UNKNOWN이다.
code를 ticker로 보존하되 독립적인 거래소 심볼 검증으로 주장하지 않는다.
sector는 schema에 없으므로 UNKNOWN; manifest의 visual sector는 제작 제안 metadata다.

## 집계

- 실제 저장소 상품 행 11: US 3 / KR 2 / crypto 4 / 금·은 2 / ETF 0.
- 기본 repository seed 공개 상품 0. 실제 회원 공개 수 UNKNOWN. 활성/비활성 운영 상태 UNKNOWN.
- 현재 product→family 배정 1 (`000660`→SEMICONDUCTOR_MEMORY), 미배정 10.
- family/default용 승인 pack 1, 상품별 PRODUCT COMPLETE 승인 master 증거 0.
- 모든 11개 후보의 live 승인/공개/availability/법무/런타임 검수는 미확정.

`APPROVED_PRODUCT_PRESENTATIONS`라는 이름 자체는 catalog publication 승인이 아니다.
000660의 family master는 현재 채택된 clean art지만 상품별 responsive/state/crop acceptance는 별도다.
mining route는 `resolveDefaultStageInput()`을 사용하므로 11개 상품 중 어느 것을 선택했다고 추론할 수 없다.

## 제외 항목과 재감사 방법

Tesla는 사용자 품질 기준이며 실제 카탈로그에 없다. 생산 상품·prompt에 넣지 않았다.
ETF_BASKET은 registry future seam이고 catalog category/상품은 없다. Amazon/Hyundai/LG도 추가하지 않는다.
TEST_THEME, OTHER와 테스트용 UUID는 synthetic fixtures이며 제품 inventory에서 제외했다.
PUTDUK START와 5개 asset_worlds는 trial/world 계약이고 별도 mining_products 행이 아니다.

`evidence/catalog-source-map.json`에 53개 exact source hash와 discovery 경로를 기록했다.
Primary가 승인 snapshot을 제공하면 version/digest/approval/publishedAt/전체 products를 대조한다.
없는 코드가 발견되면 UNKNOWN/BLOCKED로 신규 감사하고 prompt를 작성한다. 기존 목록에 억지로 매핑하지 않는다.
이 파일만으로 승인 snapshot의 실제 coverage가 완료되었다고 주장하지 않는다.
