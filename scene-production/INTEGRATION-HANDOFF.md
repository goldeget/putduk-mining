# Primary / GPT Image Generation 인계

## Git 대상과 exact checkpoint

- Branch: `parallel/product-scene-production`.
- Base SHA: `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d` — 새 fetch 및 최종 원격 read 확인.
- **Exact validated payload HEAD:** `ab6fa17e64dd160c53e453196ece6b6473ebc9bf` — 원격 동일 SHA 확인.
- 이 인계 문서와 최종 evidence를 추가하는 마지막 docs commit은 위 payload의 자식이다.
  자기 자신을 포함하는 commit의 SHA를 문서에 미리 쓸 수 없으므로 최종 handoff HEAD는
  `git rev-parse parallel/product-scene-production`과 아래 verifier로 정확히 읽는다.
  위 payload SHA를 최종 문서 commit SHA로 오인하지 않는다. 최종 응답에는 최종 HEAD를 별도로 보고한다.

| checkpoint | exact SHA | 내용 |
| --- | --- | --- |
| inventory | 8446fbf011739e226180ccb7b246550eff2b10a9 | 실제 SQL 식별자, source map, registry 감사 |
| scene specification | 78268d46bc28894d4b5b91c4a260f87c62979445 | 11 고유 profile / 22 prompts / runtime / acceptance |
| validation | ab6fa17e64dd160c53e453196ece6b6473ebc9bf | 50 tests, draft/금융/coverage gates, backlog와 evidence |
| final handoff | `git rev-parse HEAD` | docs(scene-production): record final integration handoff |

각 checkpoint는 사용자 승인 범위의 feature branch에 push했다. 마지막 문서 commit도 push한 뒤 동일 원격 HEAD를 확인한다.
main/develop merge, rebase, PR, 전체 CI, deployment, remote DB 조회/쓰기, production publication은 하지 않았다.
동결된 Admin `f9b454a7c1b86dde1099b6e5a264092118258ead`와 launch-content
`ba9ed931f756488ce4f67f945cffad9552842c09`는 로컬·원격 그대로다.

최종 exact SHA/전체 commits/변경 경로/JSON parse/Git integrity/원격 일치 확인:

```bash
source /workspace/.putduk-cloud-tools/activate.sh
cd /workspace/putduk-mining
node scene-production/verify-handoff.mjs --remote
```

`evidence/path-boundary.json`은 기록 당시 HEAD와 pending 파일을 명시한 checkpoint evidence다.
최종 HEAD 자체가 파일 안의 과거 evidence HEAD와 같다고 주장하지 않는다.
`evidence/changed-paths.txt`는 최종 패키지 파일 목록이다. 최종 verifier는 committed diff와 pending diff를 모두 검사한다.

## 수량과 실제 truth

| 항목 | 값 |
| --- | --- |
| audited actual repository rows | 11 |
| member-visible, repository default seed | 0 |
| live member-visible / selectable | UNKNOWN / UNKNOWN |
| US / KR / ETF / crypto / precious-other | 3 / 2 / 0 / 4 / 2 |
| Scene Families | 14 (승인 family 1, pending 13) |
| approved product-specific PRODUCT COMPLETE masters | 0 |
| family-master-only | 1 (000660) |
| new desktop production tasks | 11 (새 상품 master 10 + HBM 16:9 variant 1) |
| current weak-image regeneration required | 0 (실제 새 이미지 미생성; 합격 의미 아님) |
| mobile masters | 11 |
| legal/brand review required | 11 |
| catalog/product truth unresolved | 11 |
| current product-family assignments missing | 10 |
| member route runtime mapping required | 11 |
| missing proposed family enum | 0 |
| prompts | 22 = desktop 11 + mobile 11 |

11은 DRAFT seed 후보이지 승인된 live 출시 상품 수가 아니다. 운영자의 published snapshot 전체가 필요하다.
사용자 예시 Tesla/ETF를 카탈로그로 만들어 추가하지 않았다. 모든 UUID/code/slug/한국어·영어 이름은 실제 SQL 행이다.
sector metadata와 새 family assignment는 creative proposal로 분리했다. market·운영 상태를 추정하지 않는다.

현행 approved clean master는 SEMICONDUCTOR_MEMORY/default backdrop용이다.
source `5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`, RGB1539×1022,
public 8 AVIF/WebP derivatives. 000660 lookup binding은 있지만 현재 /mining은 선택 product 없이 default backdrop을 쓴다.
승인 master·family 배정·실제 상품 선택·member rendering/receipt 검증은 독립적인 gate다.

## 생성 우선순위

Provisional Wave 1: 005930(…001), 000660(…002), AAPL(…003), XAU(…006), BTC(…008).
seed의 first/featured/trial flags와 유일한 기존 family reference를 근거로 제안했다.
**실제 P0 launch hero는 UNKNOWN**. 운영자 확인 전 출시에 활성화하지 않는다.
Wave 2: MSFT(…004), NVDA(…005), XAG(…007), ETH(…009), BNB(…010), XRP(…011).
Wave 3: 확정된 future/disabled UUID 없음. 각 전체 UUID·이유는 PRODUCTION-STATUS.md.

## Native GPT Image Generation 다음 작업

1. 운영자가 승인 대상 snapshot/실제 UUID/version와 사용 명칭·brand policy를 확인한다.
2. manifest의 실제 product와 prompt_id를 고르고 positive + 모든 negatives + UI safe rectangles를 함께 전달한다.
   검토용 사전 제작은 draft로만 보존할 수 있으며 출시 이미지 승인을 뜻하지 않는다.
3. desktop 16:9와 전용 mobile 9:16을 각각 생성한다. no fake UI/text/money/yield/multiplier/logos/endorsement.
4. 실제 tool/time/dimensions/SHA를 기록하고 acceptance-matrix의 null/UNRUN을 실제 evidence로 채운다.
5. 2초 식별, material/depth/light, product machinery, focal/extraction, safe zones를 직접 검토한다.
   부족하면 REGENERATE; 기존 family를 색/로고만 교체해서 상품별 승인으로 쓰지 않는다.
6. 실제 source pixels로 anchors를 재측정한다. 현재 manifest의 좌표는 구도 목표다.
7. legal/operator/visual 승인된 versioned bundle만 Primary에 전달한다. 기존 승인 asset을 덮어쓰지 않는다.

## Primary 다음 작업 / shared 요구사항

- immutable approved catalog 전체의 actual id/code/slug/version/digest/publication/availability와 이 후보 inventory를 대조한다.
  추가 승인 상품은 신규 source 감사·profile·prompt가 필요하다. 이 package를 DB에 바로 import하지 않는다.
- authoritative selected product/session read model을 기존 command/API contract 안에서 확인한다.
  현재 snapshot에 product_id/catalog_version이 없으므로 explicit binding 계약이 필요하다. 회사명/world/category 추론 금지.
- reviewed product-specific master + portrait/visual profile를 기존 SceneRegistry/asset pipeline에 확장한다.
  같은 family여도 개별 제품별 master가 필요하다. Stage 경제/identity projection boundary는 유지한다.
- 공통 MiningLiveStage, fail-closed hash/path gate, server-running gate, static fallback을 유지한다.
  extractionTarget/local machinery flow/verified receipt cue는 실제 정본 adapter와 명시적으로 연결한다.
- “이번 세션 채굴액 / 실시간 계산 중 · 정산 전”을 real HTML로 표시한다.
  현재 schema의 pending 합계를 세션 delta로 바꾸어 부르지 않는다. 실제 server session revision/delta/receipt 확인이 필요하다.
  내부 micro-KRW 단위·carry 계약은 유지하고 main 정수 KRW 표시와 양수 delta boundary pulse는 presentation만 한다.
- 단일 money authority와 receipt dedup을 보존한다. browser/RAF/AI가 ledger/earned/reward를 계산·변경하지 않는다.
- 실제 mobile/tablet/desktop, Light/Dark/System, zoom, keyboard, reduced-motion/low-power/offscreen,
  no-canvas/image failure, NORMAL/REDUCED/UNKNOWN, settlement/reconnect screenshot·performance QA를 수행한다.
- 최종 integration/full CI는 Primary 책임이다. 이번 lane은 실행하거나 PR로 자동 trigger하지 않았다.

## 검증과 제한

- Node v24.21.0 / pnpm12.6.0 activation 확인, native Git read와 feature push 확인.
- `node scene-production/validate.mjs`: PASS_SPEC_ONLY, 모든 11 source 행/manifest/22 prompts coverage.
- `node --test scene-production/validate.test.mjs`: **50/50 PASS** — positive 1 + meaningful rejection 49.
- targeted ESLint, Prettier(mjs/json), JSON parsing, git diff --check: PASS.
  저장소 .prettierignore는 Markdown을 제외한다; Markdown formatter PASS라고 주장하지 않는다.
- 53 source fingerprints 일치, Git fsck/no missing reachable objects, scene-production-only scope 확인.
- app/backend/runtime/production code와 기존 production assets를 수정하지 않았다.
- 금융 claim/generic similarity 검사는 static heuristic이며 실제 visual/legal review를 대신하지 않는다.
- 실제 generated image/crop/2초 식별/browser/performance/backend/production 증거는 UNRUN이다.

Cloud onboarding setup skill에 따라 기존 activation을 재사용했고 새 role의 start_skill만 draft에 저장했다.
설치 스크립트·network·비밀 아닌 변수는 유지했다. `evidence/cloud-start-save.json`에 save 결과를 기록했다.
저장은 Publish나 runtime 적용이 아니다. 새 시작 지침을 후속 Cloud task에 적용하려면 환경 설정에서 검토/저장 후 Publish가 필요하다.
실제 모델 선택을 읽거나 바꾸는 기능이 없어 요청 GPT-6.1 Sol / High / Cloud 설정을 검증하지 못했다.

## 미해결 및 readiness

BLOCKED: approved live catalog coverage/launch priorities, legal/brand policy, 실제 image acceptance,
authoritative selected-product/live-delta/receipt binding. UNKNOWN을 상품 완료나 production approval로 변경하지 않는다.

명세 패키지는 Primary 리뷰·통합 준비 완료다. Native GPT는 저장소 후보의 **검토용** 이미지를 이 prompt로 생성할 수 있다.
승인된 출시 상품 전체의 production image generation readiness는 **NO** — 승인 snapshot과 브랜드 검토가 먼저 필요하다.
이 구분이 final READY FOR GPT IMAGE GENERATION의 판단 기준이다.

NOT DONE: actual image generation; Member UI modification; runtime code modification; backend change;
Production publication; develop/main merge; PR/full CI. 기존 엔진과 금융 정본을 그대로 유지했다.
