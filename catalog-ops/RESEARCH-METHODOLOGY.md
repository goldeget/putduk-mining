# 조사 방법과 확인 기준

공식 회사 IR·거래소·ETF 운용사·프로토콜·LBMA를 먼저 읽고 이름·코드·거래소·자산 종류·주식 종류·현재 존재 여부를 사실별로 분리한다. 가격·수익률·시가총액은 PUTDUK 경제값의 입력이 아니다. 한국어 제목은 편집 번역이며 실제 법적 등록명을 확인한 것으로 표시하지 않는다.

이번 continuation은 실제 97개 요청에서 HTTP 200 응답 76개를 확보했다. 그중 29개 출처에서 후보 신원 근거를 읽었다. 55개 평가 결과 VERIFIED 13 / PARTIAL 31 / UNKNOWN 11이다. HTTP 성공, 현재 명부의 항목, 상품 세부 확인, PUTDUK 승인, 현재 회원 공개 상태는 서로 다른 증거다. 전체 신원 확인 완료는 아니다.

각 source의 attempted/accessed_at, requested/final URL, original byte SHA256, source class, 실제 짧은 인용을 남겼다. 원본은 lossless .txt.gz이며 압축을 풀어 해시와 인용을 재검증한다. 날짜가 미래이거나 30일보다 오래되면 validator가 거절한다. HTTP 200만으로 verified를 채우지 않고, source URL만으로 canonical 정보를 만들지 않는다.

SEC 현재 directory는 회사명·티커·거래소를 확인하지만 주식 종류나 거래 가능 여부를 확인하지 않는다. 미국 주식은 그 세부가 남아 PARTIAL이다. Space Exploration Technologies Corp / SPCX / Nasdaq 항목이 실제 있어 비상장이라는 과거 기억으로 제외하지 않았다. QQQ 자료로 ProShares TQQQ를 확인하지 않는다. VTI는 현재 sponsor 제목의 Morningstar 이름을 반영했다. 국내 AI 조사 슬롯은 실제 KODEX 홈페이지의 471990으로 특정했지만 거래소 상세는 PARTIAL이다.

KRX 공개 query는 400/403, 일부 issuer는 JavaScript 또는 외부 시세 frame만 보여 세부 확인이 남았다. 금·은은 LBMA가 확인한 물리적 금속 주제이며 XAU/XAG는 기존 내부 catalog code다. LBMA exchange ticker라고 주장하지 않는다. USDC는 Coinbase secondary 설명만 확인해 issuer check가 남고, USDT/USDC를 mining 상품으로 승인하지 않는다.

기존 52개 403 조사 기록은 previous-proxy-403-sources.json에 보존했다. 새로 실제 차단을 확인한 data.sec.gov / www.proshares.com / tether.to / www.circle.com만 restricted network 초안에 추가했다. 최신 초안은 saved / requires_publish=true, runtime 재요청은 여전히403이다. Save와 runtime 적용/Publish는 다르다. 프록시를 우회하거나 공식 사이트 제한을 깨지 않는다. Publish만으로 KRX query/JS 문제가 해결된다고 가정하지 않는다.

현재 사용 상태는 PUBLIC_MARKET_VERIFIED/PARTIAL/UNKNOWN이다. bare UNKNOWN은 exact 8f68be2 historical tests에서만 보존한다. P0는 공개 신원 VERIFIED만 허용해 6개, P1은 조건부19개로 편성했다. 모든 effective wave는 HOLD이고 승인·게시·LIVE DB는 입증되지 않았다.

16개 편성 점수는 편집 가설이며 설문·인지도 통계·투자 평가가 아니다. 합산 점수로 법무나 정책 승인을 대신하지 않는다. 신원 상세와 각 score의 scope는 product-candidates.json / product-source-evidence.json을 읽는다. 추가 요청은 research-extend.py로 보존하고 새 응답을 읽은 뒤 재분류한다. 역사적 build-catalog.py나 전체 fetch를 자동으로 실행해 검증된 내용을 덮어쓰지 않는다.
