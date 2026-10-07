# 실제 제작 gap

이 집계는 저장소 DRAFT 후보 11개에 대한 것이다. 실제 live catalog 수는 UNKNOWN이다.
기본 seed의 회원 공개 상품은 0개이며, 이 환경에서 DB reset/read를 실행한 결과로 주장하지 않는다.
명세 validator PASS는 모든 승인 회원 상품을 실DB와 대조했다는 증거가 아니다.

| 항목 | 수 | 범위 / 이유 |
| --- | --- | --- |
| repository-known products | 11 | seed 행 + presentation 목록 일치 |
| repository-default member-visible | 0 | DRAFT seed와 PUBLISHED read/RLS 계약 |
| live member-visible | UNKNOWN | 원격 DB 미조회; 승인 snapshot 필요 |
| US / KR / ETF / crypto / precious-other | 3 / 2 / 0 / 4 / 2 | 알려진 seed 후보 분류 |
| approved product-specific masters | 0 | 상품별 PRODUCT COMPLETE 승인 증거 없음 |
| approved family/default masters | 1 | SEMICONDUCTOR_MEMORY clean pack, 8 derivatives |
| family-master-only products | 1 | 000660; 현행 family lookup 연결은 있음 |
| product desktop master production tasks | 11 | 신규 10 + 000660의 새 16:9 variant 1 |
| weak-image regeneration required now | 0 | 미생성 후보가 약하다고 평가하지 않음; 기존 master 거절 증거 없음 |
| mobile masters required | 11 | portrait에서 산업 물체/경로를 보존할 별도 구도 |
| legal/brand review required | 11 | 로고 없는 방향이어도 승인 정책이 없으며 임의 면제하지 않음 |
| catalog truth unresolved | 11 | live UUID/version/publication/availability/launch approval 미확정 |
| member runtime mapping required | 11 | mining route는 상품 선택 없는 기본 배경 |
| current product-family unassigned | 10 | 000660 외 null |
| proposed family key absent from registry | 0 | 모든 제안은 현행 14개 key 안에 있음 |
| family pack missing | 13 | 14개 중 memory만 APPROVED; 제품 없는 future family도 포함 |
| prompt pack | 22 | 16:9 desktop 11 + 9:16 mobile 11 |

primary scene status는 상호 배타적으로 FAMILY_MASTER_ONLY=1 / PRODUCT_MASTER_REQUIRED=10이다.
나머지 tags는 별도 축이다. NOT_MEMBER_VISIBLE=11은 seed 상태이며 live disabled/retired 증거와 다르다.
CATALOG_TRUTH_UNRESOLVED/법무/runtime/mobile tags를 더해 11보다 큰 상품 수로 계산하지 않는다.
000660의 DESKTOP_VARIANT_REQUIRED와 MOBILE_VARIANT_REQUIRED는 기존 family pack을 재생성 승인 없이 지우라는 뜻이 아니다.
새 master가 약하면 이후 REGENERATION_REQUIRED로 바꾸고 정확한 실패 증거를 추가한다.

## 상품별 누락과 우선순위

| 코드 | 현재 | 제안 family | 필요한 제작/연결 |
| --- | --- | --- | --- |
| 005930 | no assignment/master | SEMICONDUCTOR_FOUNDRY | wafer + foundry + device ecosystem desktop/portrait |
| 000660 | approved family-only | SEMICONDUCTOR_MEMORY | 새 16:9/portrait, 승인 이미지 보존, product QA |
| AAPL | no assignment/master | SEMICONDUCTOR_COMPUTE | precision silicon/device atelier |
| MSFT | no assignment/master | SEMICONDUCTOR_COMPUTE | distributed cloud atrium; Apple와 별도 이미지 |
| NVDA | no assignment/master | AI_GPU_COMPUTE | GPU cold plate/coolant/rack canyon |
| XAU | no assignment/master | PRECIOUS_GOLD | crucible/casting channel/mold |
| XAG | no assignment/master | PRECIOUS_SILVER | electrorefining bath/crystal/gantry |
| BTC | no assignment/master | BLOCKCHAIN_HASH | block press/hash channels |
| ETH | no assignment/master | CRYPTO_NETWORK | validator prism + node conservatory |
| BNB | no assignment/master | CRYPTO_NETWORK | ceramic routing switchyard |
| XRP | no assignment/master | CRYPTO_NETWORK | optical relay bridge + two halls |

Wave 순서는 PRODUCTION-STATUS.md에 실제 UUID와 근거를 기록했다.
launch hero가 승인된 증거가 없으므로 P0를 확정하지 않는다. 현재 queue는 운영자 확인 전 provisional creative production 순서다.
Tesla는 reference 방향만 있고 catalog에 없어서 이미지 backlog에 포함하지 않았다.

## 미해결 책임자

운영자/Primary: 승인 snapshot 전체와 실제 selected-product binding, 출시 우선순위.
법무/브랜드 담당: 명칭/산업 테마 사용 정책과 endorsement 방지 검토.
Native GPT Image Generation: draft prompt로 실제 desktop/mobile 제작, 실패작 재생성, hash/version 기록.
Primary: approved asset derivatives/allowlists/profiles/authoritative state and receipt adapter, browser/mobile/performance QA.
이 lane은 조달되지 않은 증거를 PASS나 완료 상품으로 만들지 않는다.
