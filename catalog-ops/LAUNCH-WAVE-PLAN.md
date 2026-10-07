# 재검증 후 조건부 25개 출시 편성

실제 공개 수는 0 (repository seed), LIVE_DB_UNKNOWN. P0/P1 편성은 승인/등록 완료가 아니다. 모든 effective wave는 HOLD, 날짜 null이다.

## P0_LAUNCH_CORE

삼성전자, SPY, 비트코인, 이더리움, 금, 은

## P1_LAUNCH_EXPANSION

SK하이닉스, LG전자, 현대자동차, LG에너지솔루션, NAVER, KB금융, 엔비디아, 테슬라, 로켓랩, 샌디스크, SpaceX, 애플, 마이크로소프트, 아마존, 알파벳, QQQ, SOXX, SCHD, 솔라나

## P2_LATER

카카오, 삼성바이오로직스, 한화에어로스페이스, HD현대중공업, HD현대일렉트릭, SK이노베이션, 아모레퍼시픽, 메타, AMD, 브로드컴, 팔란티어, JP모건, 넷플릭스, Vanguard Morningstar Total Stock Market ETF, AIQ, BND, IAU, KODEX 200, TIGER 미국S&P500, KODEX 반도체, TIGER 미국나스닥100, KODEX 국고채3년 조사안, BNB, XRP

## HOLD

KODEX AI반도체핵심장비 ETF, 국내 배당 ETF 개별상품 조사, KODEX 골드선물(H) 조사안, TQQQ 레버리지 조사안

## REJECT

USDT 결제 수단 조사, USDC 결제 수단 조사

LG전자는 생활 기기 장면과 한국 산업 선택 폭 때문에 P2→P1, SpaceX는 실제 SEC SPCX/Nasdaq 근거와 우주 통신 장면 때문에 HOLD→P1 조건부 승격했다. 주식 종류·현재 상세 상장·법무 확인은 계속 필요하다. Meta는 실제 SEC 신원을 읽었으나 연결 테마 중복/제작 예산으로 P1→P2. 점수는 편집 가설이며 시장 수익 데이터가 아니다. 국내 AI 슬롯 471990은 특정했으나 상세 확인 전 HOLD; 국내 배당 슬롯은 특정 전 HOLD. USDT/USDC 채굴 상품은 REJECT, 입출금 rail 지원 여부를 새로 승인하지 않았다.

25개 중 기존 seed 9개 유지, 신규 16개 SPEC_REQUIRED. 25개 모두 desktop/mobile master와 실제 상품 browser QA가 필요하다. frozen Scene 결과는 읽기만 했다. 법무·자격 정책·효과 범위·catalog command·LOCAL ID/readback/render/rollback 통과 전 어떤 상품도 게시하지 않는다.

출시 시각은 승인 전 미정이다. 승인된 command로 exact preview → human confirmation → server authorization → audit → local readback/render/rollback 검증 후 Primary가 별도 출시 승인을 받는다. 실패한 gate가 있는 상품은 HOLD. 모든 조건부 상품의 제작·법무 근거가 확보되기 전 동시 공개를 예약하지 않는다.
