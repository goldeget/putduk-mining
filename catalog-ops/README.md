# PUTDUK 상품·경제·콘텐츠 운영 제안

이 브랜치는 `catalog-ops/**`만 작성한다. 최신 develop의 실행 코드를 읽고 세 선행 lane을 동결 상태로 보존한다. 시장 정보, 저장소 DRAFT, LIVE DB UNKNOWN, PUTDUK 제안, 사용자 승인, 실제 게시를 별도 상태로 다룬다.

공개 조사 연결이 차단되어 현재 결과는 **조건부 제안 패키지**다. 실제 조사 완료·상장 확인·상품 출시·금융 정책 활성화를 주장하지 않는다. 연구를 재개할 공식 자료 요청 스크립트와 정확한 차단 증거를 함께 남긴다.

검증은 Node 24.21.0으로 오프라인에서 실행한다. 의존 패키지·DB·API 키가 필요 없다. source `/workspace/.putduk-cloud-tools/activate.sh` 후 준비된 파일에 대해 다음을 실행한다.

```sh
python catalog-ops/audit-repository.py
node catalog-ops/economy-simulate.mjs
node catalog-ops/validate.mjs
node --test catalog-ops/validate.test.mjs
git diff --check
```

`research-fetch.py`는 공식 자료에 읽기 요청만 보낸다. `audit-repository.py`는 지정 저장소와 동결 브랜치만 읽는다. 어떤 스크립트도 SQL·RPC·등록·발송·게시를 실행하지 않는다. 돈의 권위는 서버의 승인된 정산·원장이며 시뮬레이션은 정상화 지수 비교다.
