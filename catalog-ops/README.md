# PUTDUK 상품·경제·콘텐츠 운영 제안

이 브랜치는 `catalog-ops/**`만 작성한다. 최신 develop의 실행 코드를 읽고 세 선행 lane을 동결 상태로 보존한다. 시장 정보, 저장소 DRAFT, LIVE DB UNKNOWN, PUTDUK 제안, 사용자 승인, 실제 게시를 별도 상태로 다룬다.

이번 continuation은 실제 공식 응답 76개를 확보하고 29개 출처에서 신원 근거를 대조해 55개 후보를 평가했다. PUBLIC_MARKET_VERIFIED 13 / PARTIAL 31 / UNKNOWN 11이며 전체 신원 조사 완료는 아니다. P0는 확인된 6개, P1은 조건부 19개로 조정했다. 모든 effective wave는 HOLD, 법무·자격 정책·Scene·등록은 승인 전이다. 25개 Tier-gated 제안은 현재 공개 상품 수가 아니다.

검증은 Node 24.21.0, 기본 Python으로 실행한다. DB/API 키·새 의존 패키지는 필요 없다. source `/workspace/.putduk-cloud-tools/activate.sh` 후 준비된 파일에 대해 다음을 실행한다.

```sh
node catalog-ops/economy-simulate.mjs
node catalog-ops/validate.mjs
node --test catalog-ops/validate.test.mjs catalog-ops/research.test.mjs catalog-ops/finalize.test.mjs
git diff --check
node catalog-ops/verify-handoff.mjs --require-pushed --require-clean
```

214 tests PASS, fail/skip 0. 기존 108개는 시작 HEAD `8f68be2`의 exact 입력으로 보존했고 새 106개는 현재 공식 근거와 Tier 제안을 검증한다. 실제 UI·DB E2E/full CI는 이 lane에서 실행하지 않았다.

추천: Policy A + Tier gate + inherited global capacity + product speed, 1.00–1.10. approved speed는 null, 원화 상품 문턱은 금지, 최소 L-tier 참조로만 DERIVED_FROM_TIER한다. 문서 승인과 live publication receipt는 다르다. 원금 HOLD는 PAUSE_NOT_RESET이다.

추가 조사에는 `research-extend.py`를 사용하고 원본·시각·해시·인용을 보존한다. `research-fetch.py`, `audit-repository.py`, 역사적 `build-catalog.py`는 자동 재실행하지 않는다. 기존 완료 evidence를 초기 UNKNOWN 초안으로 덮어쓸 수 있다. 변경 후 `research-review.py` → `finalize-catalog.py` → simulation → `tier-content-delta.py` → `report-finalize.py` → scoped formatter → validator/tests 순서로 검토한다. 현재 원본은 lossless gzip이며 validator는 압축 해제한 원본 SHA256과 실제 인용을 비교한다.

formatter는 manifest/lock에 설치된 Prettier 3.9.9를 `node node_modules/prettier/bin/prettier.cjs --check --ignore-path /dev/null <catalog-ops files>`로 실행한다. 일반 `pnpm exec`는 상속된 pnpm 11로 자동 설치를 시도할 수 있어 이 오프라인 lane에서 의존 설치를 유발하지 않는다. Node 24.21.0 / pnpm 12.6.0 버전 확인은 PASS, 버전/manifest/lock 변경 없음.

`INTEGRATION-HANDOFF.md`, `PRODUCT-TIER-ELIGIBILITY.md`, `TIER-PROGRESSION-ANALYSIS.md`, `CONTRACT-MAPPING.md`을 함께 읽는다. 어떤 스크립트도 SQL·RPC·등록·발송·게시를 실행하지 않는다. 돈의 권위는 승인된 서버 정산·원장이다. 추가 공식 호스트 4개와 최신 시작 지침은 환경 초안에 저장했지만 Publish/current runtime 검증은 별개다.
