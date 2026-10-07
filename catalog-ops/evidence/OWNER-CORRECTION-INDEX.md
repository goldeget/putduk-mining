# 현재 Owner correction 증거와 역사 기록

현재 정책 방향은 owner-product-access-correction.txt와 product-access-policy.json이다.

Owner 읽기용 원문은 LF 줄바꿈으로 정규화했다. 원본 CRLF 바이트는
owner-product-access-correction.txt.gz에 lossless 보존했고 JSON이 원본·사본
해시를 따로 기록한다.

현재 결과는 owner-correction-status.json, owner-economy-simulation.json,
owner-validation.json, owner-correction-test-summary.json, owner-correction-tests.tap,
owner-correction-format-summary.json, owner-correction-cloud-save.json이다.

기존 economy-simulation.json, validation.json, finalize-summary.json,
finalize-test-summary.json, finalize-tests.tap, final-format-summary.json은
HEAD 783732492e70c312b33640e07ee0d8ffad68c3e5 당시의 역사 증거다.
해당 Tier-gated 상품 접근 추천·집중도·downgrade PAUSE 해석은
SUPERSEDED_BY_OWNER_CORRECTION이며 현재 통합 기준으로 사용하지 않는다.
역사 evidence는 수정하지 않는다.

superseded-tier-gate/manifest.json은 해당 HEAD의 28개 원본을 보존한
exact-byte archive와 SHA256을 가리킨다. 원본 archive를 재포맷하지 않는다.
현재 테스트는 해시와 실제 Git 원본 바이트를 대조한다.

research-sources.json, product-source-evidence.json과 original source-responses는
계속 유효한 조사 범위 근거이며 이번 정책 수정에서 변경하지 않았다.
공식 응답과 실제 신원 확인 범위, UNKNOWN을 서로 구분한다.
