# 조사 방법과 확인 기준

조사 대상과 실제 확인 사실을 구분한다. URL을 알고 있거나 이전 문서에 티커가 적혀 있어도 현재 상장 확인이 아니다. 공식 회사 IR·거래소·ETF 운용사·프로토콜·LBMA를 우선 조회하고, 이름·티커·거래소·자산 종류·주식 클래스·기준일을 확인한다. 가격·수익률·시가총액 순위는 상품 경제값의 입력이 아니다.

이번 실행은 공식 대상 52곳 모두 egress proxy의 `Tunnel connection failed: 403 Forbidden`으로 차단됐다. HTTP 본문을 읽지 못했다. `attempted_at`은 요청 시각이며 `accessed_at`은 null이다. `verified_facts=[]`, `verified=false`, 신뢰도 UNKNOWN을 유지한다. 공식 호스트 요구사항을 환경 설정 초안에 저장했으며 Publish 전까지 현재 실행의 허용 증거로 간주하지 않는다. 프록시 우회는 하지 않는다.

연결 복구 후 `python catalog-ops/research-fetch.py`를 실행한다. 200 응답도 검증 완료가 아니다. 응답 본문을 읽어 후보별 이름·코드·시장·거래소·자산 종류와 그 사실의 정확한 위치를 기록해야 한다. 미국 종목은 SEC current ticker/exchange 자료와 IR을 교차 확인한다. 한국 종목은 KRX 개별 상장 자료로 확인한다. ETF는 실제 운용사 문서와 거래소, 상품명·레버리지/인버스 여부를 확인한다. `SpaceX/SPCX`는 최신 SEC 상장·IR 사실을 조사한 후에만 판단하며 과거 비상장 기억을 사용하지 않는다. 요청받은 SPCX는 지금 `ticker_hint`일 뿐 확정 티커가 아니다.

검증일이 실행일보다 미래이거나 증거가 30일보다 오래되면 재검토한다. 임시 응답 제한·공식 사이트 리디렉션은 별도로 기록한다. 새 리디렉션 호스트가 실제 차단된 경우에만 그 정확한 호스트를 설정에 추가한다. 비공식 투자 블로그는 상장 확인 근거로 사용하지 않는다.

상태는 REPOSITORY_DRAFT / REPOSITORY_PUBLISHED / LIVE_DB_UNKNOWN / PUBLIC_MARKET_VERIFIED / PUTDUK_PROPOSED / PUTDUK_APPROVED로 구분한다. 이번 후보는 PUTDUK_PROPOSED이며 외부 신원 상태는 UNKNOWN이다. 원하는 P0/P1 편성은 조건부 기획으로 보관하되 실제 `effective_wave`는 HOLD이다. UNKNOWN 후보를 실효 P0로 통과시키지 않는다.

16개 편성 점수는 1–5점의 편집 가설이며 조사 결과·설문·인지도 통계가 아니다. 공개 정보 검증 점수는 1이다. 인지도·스토리·산업 분산 등 추정 항목은 실제 회원 데이터로 교정해야 한다. 합산 점수로 투자 우수성이나 출시 승인을 주장하지 않는다.
