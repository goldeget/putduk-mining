# PUTDUK catalog 운영 패키지 — Owner correction 적용

상품 선택은 열려 있고 채굴 규모는 Funding Tier를 따른다. 현재 기준은 PRODUCT-ACCESS-POLICY.md, TIER-MINING-POWER-MODEL.md, PRODUCT-ECONOMY-MATRIX.md, INTEGRATION-HANDOFF.md다. 과거 Tier 상품 해금은 SUPERSEDED_BY_OWNER_CORRECTION이다.

25개 조건부 P0/P1 product access = ALL_ELIGIBLE_MEMBERS, Tier product access = ALL_PUBLISHED_PRODUCTS다. modifier1.00–1.10 제안은 유지하고 approved값은 null이다. 실제 effective wave는 전부 HOLD, LIVE_DB_UNKNOWN이다. 조사 근거13VERIFIED/31PARTIAL/11UNKNOWN은 그대로다. 별도 Tier 기본 속도 계약은 TIER_SPEED_CONTRACT_REQUIRED다.

변경 범위는 catalog-ops/** ONLY. shared/backend/member/Admin/Scene/runtime/SSOT/package/lock/workflow 변경 없음. 실제 등록/SQL/RPC/발송/Production 없음. frozen3개 lane 유지.

```sh
source /workspace/.putduk-cloud-tools/activate.sh
python catalog-ops/owner-correction.py
node catalog-ops/economy-simulate.mjs
python catalog-ops/report-owner-correction.py
node catalog-ops/validate.mjs
node --test --test-reporter=tap catalog-ops/validate.test.mjs catalog-ops/research.test.mjs catalog-ops/finalize.test.mjs catalog-ops/owner-correction.test.mjs
git diff --check
node catalog-ops/verify-handoff.mjs --require-pushed --require-clean
```

owner-correction.py는 독립 offline generator이며 DB·network 접근이 없다. 과거 finalize-catalog/report-finalize/tier-content-delta/build generators는 현재 access artifact가 있을 때 종료해서 폐기된 상품 잠금을 다시 만들지 않는다. research-fetch/audit historical generators도 자동 재실행하지 않는다. 추가 공식 조사만 research-extend와 검토된 원본 근거를 사용한다.

과거108개 tests는 exact8f68 SHA, 과거 Tier100개 tests는 exact7837324 SHA를 재현한다. 현재 research6개와 owner-correction tests가 현재 파일을 검증한다. exact counts/exit code는 evidence/owner-correction-test-summary.json, TAP는 evidence/owner-correction-tests.tap에 기록한다. 과거214tests evidence를 현재 모델 통과 증거로 오해하지 않는다.

Node24.21.0/pnpm12.6.0, formatter는 manifest-pinned Prettier3.9.9를 node node_modules/prettier/bin/prettier.cjs로 직접 실행한다. archive는 byte-identity 보존 대상이므로 재포맷하지 않는다. DB/API secret이나 새 dependencies가 필요 없는 workflow다. full CI/실제 DB/browser검증은 Primary 소유다.
