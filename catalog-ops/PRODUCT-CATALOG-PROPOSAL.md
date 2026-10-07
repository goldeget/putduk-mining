# 조건부 출시 상품 편성

시장 사실을 확인한 24개가 아니라 조사 차단 상태에서 설계한 24개 조건부 후보다. effective_wave는 모두 HOLD이며 출시 시각은 null이다. 현재 공개 상품 수나 사용자의 자산 소유를 뜻하지 않는다.

## P0_LAUNCH_CORE

삼성전자, SK하이닉스, 현대자동차, LG에너지솔루션, 엔비디아, 테슬라, 애플, 마이크로소프트, SPY, QQQ, 비트코인, 이더리움, 금, 은

## P1_LAUNCH_EXPANSION

NAVER, KB금융, 로켓랩, 샌디스크, 아마존, 알파벳, 메타, SOXX, SCHD, 솔라나

## P2_LATER

LG전자, 카카오, 삼성바이오로직스, 한화에어로스페이스, HD현대중공업, HD현대일렉트릭, SK이노베이션, 아모레퍼시픽, AMD, 브로드컴, 팔란티어, JP모건, 넷플릭스, VTI, AIQ, BND, IAU, KODEX 200, TIGER 미국S&P500, KODEX 반도체, TIGER 미국나스닥100, KODEX 국고채3년 조사안, BNB, XRP

## HOLD

SpaceX, 국내 AI ETF 개별상품 조사, 국내 배당 ETF 개별상품 조사, KODEX 골드선물(H) 조사안, TQQQ 레버리지 조사안

## REJECT

USDT 결제 수단 조사, USDC 결제 수단 조사

현재 seed의 BNB/XRP만 P2로 보류 제안한다. 나머지 기존 9개는 조건부 출시 편성에 남긴다. 소스·코드·법적 사용권이 확인되지 않으면 공개하지 않는다.

한국 산업과 미국 산업, 4개 ETF, 3개 크립토, 2개 귀금속으로 장면을 분산한다. 반도체 단일기업과 SOXX/QQQ는 설명 중복을 줄이고 묶음과 단일 기업의 의미를 구별한다. VTI/SPY 중복, AMD/NVDA 중복과 새 Scene 제작 부담 때문에 P2를 한꺼번에 공개하지 않는다.

SpaceX는 현재 SPCX 상장 여부를 확인하지 못했다. 상장/비상장 어느 쪽도 단정하지 않는다. SNDK도 현재 발행회사·분리 후 상장·거래소를 확인해야 한다. Alphabet은 A주 GOOGL 가설로만 편성하며 공식 share class 교차 확인이 필요하다. 국내 AI·배당 ETF는 특정 상품 이름과 코드가 미정인 조사 슬롯이므로 출시 후보에 넣지 않았다. 레버리지·선물·헤지 상품은 추가 복잡성 검토가 필요하다. USDT/USDC는 채굴상품 편성 거절이며 입출금 지원 여부를 새로 주장하지 않는다.

신규 15개 출시 제안은 기존 catalog/scene 패키지에 없다: 현대자동차, LG에너지솔루션, NAVER, KB금융, 테슬라, 로켓랩, 샌디스크, 아마존, 알파벳, 메타, SPY, QQQ, SOXX, SCHD, 솔라나. 모든 신규 후보에 SCENE_SPEC_REQUIRED, DESKTOP_MASTER_REQUIRED, MOBILE_MASTER_REQUIRED를 연결했다. 24개 모두 실제 상품 browser QA가 필요하다.
