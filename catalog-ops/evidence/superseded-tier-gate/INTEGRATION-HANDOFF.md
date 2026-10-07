# Primary 통합 검토 인계 — Research/Tier Finalization

CURRENT BRANCH: `parallel/catalog-product-ops`

BASE SHA: `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`

CONTINUATION START: `8f68be2005e16f1ac257626b3418cd3b8a96f1e3`

EXACT HEAD: `node catalog-ops/verify-handoff.mjs --require-pushed --require-clean`이 현재 전체 SHA와 실제 원격 tip을 출력한다. 최종 자기 참조 SHA를 파일 안에 발명하지 않는다. 사용자 최종 보고에도 전체 SHA를 남긴다.

기존 5개 checkpoint를 보존하고 이번에는 research → Tier/economy/content → final evidence/handoff의 3개 logical checkpoint를 추가했다. 마지막 문서 commit 직전 head는 `b3937937a8f2f998a66ce499e4cc5299ca438b4f`. develop/main merge, rebase, PR, 전체 CI 없음. 실행 모델 요청 GPT-6.1 Sol / High / Cloud의 실제 모델 설정은 도구로 조회/변경할 수 없어 미확인이다.

## 현재 확인 결과

| 항목               | 결과                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실제 공식 조사     | 97 requests / 76 HTTP 200 / 29 identity sources reviewed; HTTP success와 facts 분리                                                                         |
| 후보 신원          | VERIFIED 13 / PARTIAL 31 / UNKNOWN 11; all55 assessment complete, full identity completion NO                                                               |
| canonical 증거     | evidence/product-source-evidence.json + original .txt.gz SHA256 + actual short quote/access time                                                            |
| 최신 발견          | SEC Space Exploration Technologies Corp / SPCX / Nasdaq 존재; share class PARTIAL. VTI sponsor 현재 명칭 변경 반영. 국내 AI 471990 특정, 상세 거래소 미확인 |
| 후보 universe      | US15 / KR14 / ETF17 / CRYPTO7 / PRECIOUS2                                                                                                                   |
| 실제 repository    | DRAFT11, seed member-visible0; LIVE_DB_UNKNOWN                                                                                                              |
| 조건부 출시        | P0 6 / P1 19 =25, effective all HOLD; public dates/approvals null                                                                                           |
| 재편성             | LG전자 P2→P1, SpaceX HOLD→P1, Meta P1→P2. 미확인 P0 8개는 P1 조건부로 이동                                                                                  |
| Tier SSOT          | docs/product/economy-v1-approved-2026-10-03.json, 14 unchanged document tiers; live receipt/effective_from UNKNOWN                                          |
| 경제 추천          | Policy A + Tier gate + inherited global capacity + product speed, 1.00–1.10                                                                                 |
| 자격               | 25 profiles, minimum L-tier + DERIVED_FROM_TIER, new gate PROPOSED_NOT_APPROVED                                                                             |
| capacity           | 하나의 global cycle, slot/product별 증가 없음; conditional retention 분리                                                                                   |
| 시뮬레이션         | NORMALIZED_INDEX_ONLY, 3bands×14tiers=42rows, BigInt/rational, no market price/money authority                                                              |
| 최고속 pool        | L14에서 5개 distinct personality가 같은1.10; uniform tie 1/5는 가정, 실제 분포UNKNOWN                                                                       |
| final cap          | product×user×event×temporary 정확한 곱 후 최종1.50 한 번. scope 실제 backend 구현 아님                                                                      |
| downgrade          | 추천B, ineligible selection forward PAUSE. principalHOLD PAUSE_NOT_RESET. history/age/cycle/used/carry/verifiedledger 보존                                  |
| Scene              | 신규16개 SPEC_REQUIRED; 25개 desktop/mobile/product browser QA 필요. frozen Scene 수정/이미지 생성0                                                         |
| 기존 content 감사  | Event21KEEP/5REWRITE/3MERGE/1DROP/ADD10, Notice22KEEP/4REWRITE/ADD8 유지                                                                                    |
| 새 Tier delta      | Event1/Notice4/FAQ6/Support3/Notification4, 모두DRAFT/정책·실제 상태 확인 전 게시발송금지                                                                   |
| combined additions | Event11/Notice12/FAQ22/Support11/Notification12; 기존 rewrite 유지                                                                                          |
| 법무               | LEGAL_BRAND_REVIEW_REQUIRED, 실제 자산소유·제휴·투자/수익 보장 주장 금지                                                                                    |
| 승인 command       | catalog/content NOT_FOUND; exact base source와 frozenAdmin tree read-only 재확인                                                                            |
| 실제 등록          | LOCAL NOT_RUN / generatedID[] / readback-render-rollback BLOCKED; SQL/fixture/migration 대체없음                                                            |
| validator/tests    | PASS, 214tests=baseline108+new106, fail0/skip0; rootCI/DB/browserE2E 실행아님                                                                               |
| 변경 경계          | catalog-ops/** ONLY; 세 frozen branch local+origin+live exact remote 모두 보존                                                                              |
| runtime 환경       | Node24.21.0 / pnpm12.6.0 확인, Prettier3.9.9 scoped PASS, manifest/lock 버전 변경없음                                                                       |

## 추천 근거와 남은 결정

1.00–1.10은 승인 문서 범위 안이며 최고속의 추가 modifier 여유 15/11을 남긴다. 동일한 modifier 비교에서 cap에 닿는 상품은 0개이고, 1.18에서는 11개다. 1.12/1.18은 승인 범위도 바꿔야 한다. 1.10이어도 새 Tier gate와 효과 범위·적용 시각이 미정이므로 새로운 policy version 승인이 필요하다. 승인 배율은 전부 null이다.

L1의 4개부터 모든 14단계가 새 선택을 추가한다. 상위 NVIDIA 단독 속도 우위는 없지만, 속도만 보는 모형의 최고속 그룹 집중과 낮은 상품의 불리함은 남는다. 유명 테마를 높은 원금 단계에 배치하고 입문 단계에서 crypto/미국 단일 기업을 제공하지 않는 안은 박탈감·입금 유도 위험을 갖는다. Owner가 접근성·제작 예산·설명 품질을 검토해야 한다. 숨은 capacity·bonus·무작위 금액으로 균형을 강제하지 않는다. 25개는 아직 공개 가능한 수가 아니다. P0는 신원 VERIFIED만 허용하고 P1 PARTIAL은 공개 금지 gate를 유지했다.

남은 인정 원금은 누적 입금액이 아니다. 보상·Bonus·체험 금액을 포함하지 않고 원금 HOLD를 제외한다. 과거 확정 원장·source journal·이력·채굴 나이·주기·사용량·carry를 고치지 않는다. 추천 하향안 B는 새 조건 시각 이후 자격 없는 선택을 멈추고, 자동 대체 없이 slot·allocation·정책 receipt를 다시 확인한다. 금융 엔진 변경은 Primary 소유이며 이 모형에 돈을 결정할 권한은 없다.

## Primary가 수행할 정확한 작업

1. `RESEARCH-SOURCES.md`와 evidence/product-source-evidence.json의 31 PARTIAL / 11 UNKNOWN 세부를 확인한다. 주식 종류를 COMMON으로 추측하지 않는다. SEC filings·issuer·개별 fund·한국 공식 상장 자료의 원본·날짜·인용을 추가하고 확인된 항목만 승격한다. 법무·상표·명칭·실제 시설 오인 검토는 별도 필수다.
2. `PRODUCT-ECONOMY-MATRIX.md`의 14필드와 Tier JSON을 Owner에게 정확히 preview한다. 추천 1.00–1.10, 25개 minimum Tier, 접근성 문제, downgrade B, 별도 retention, 효과 범위, START 경계를 승인받는다. 이 branch가 승인 SSOT를 변경했다고 오인하지 않는다.
3. 기존 versioned catalog/economy/server receipt 및 source provenance에 연결할 minimum L-tier 계약과 정책 version/digest/적용 시각을 확정한다. 상품별 원화 문턱이나 capacity를 만들지 않는다. 25개 proposal metadata를 기존 runtime payload에 그대로 삽입하지 않는다.
4. 기존 권위에서 product×user×event×temporary의 범위·우선순위·portion·조건 변경을 결정하고, final cap once·fractional carry·global allocation·slot·safe mode·HOLD·capacity 하향·과거 확정 기록 보존을 검증한다. 대체 engine이나 client 돈 판정은 금지한다.
5. ETF category·공개 projection·catalog command 및 content body/CTA/FAQ/macros/delivery 계약이 없으면 기존 권위의 계약에 추가한다. 상세 요구는 CONTRACT-MAPPING.md에 있다. Draft → preview → confirmation → server authorization → audit → readback을 revision/idempotency/role/AAL2/session/origin으로 검증한다.
6. Frozen Scene에서 선택된 9개 spec과 신규 16개 요구를 읽고, desktop/mobile masters·회원/Admin 실제 렌더·돈 표시·상태·오류·해금·HOLD·모바일 browser QA를 별도 lane에서 수행한다. 이 패키지는 SceneRegistry/assets를 변경하지 않았다.
7. 승인된 명령이 생기면 owned isolated LOCAL에서 실제 ID → readback → 권한/공개/노출 → render → cancel/archive → readback/숨김과 retry/replay/revoked session/역할 거절을 검증한다. Shared staging은 Primary 소유로 별도 승인하며 Production 등록은 별도 사용자 승인 전 금지한다.
8. Integration·전체 CI·출시는 Primary가 수행한다. 이 branch는 PR로 자동 CI를 시작하지 않았다. 기존 세 frozen lane을 변경하거나 회원 UI/shared financial 파일을 동시에 편집하지 않는다.

## 자동 저장한 Cloud 설정과 실제 네트워크 제한

기존 restricted allowlist 54개, package-manager presets, cdn.playwright.dev/public.ecr.aws를 보존하고 실제 403을 관찰한 공식 호스트 4개(data.sec.gov, www.proshares.com, tether.to, www.circle.com)만 추가했다. 최신 start_skill도 저장했고 install_script·비밀값은 변경하지 않았다. Draft status는 saved / requires_publish=true다. Save는 runtime 변경이나 Publish가 아니다. 사용자가 환경 UI에서 최신 초안을 Save & Publish해야 한다. 이 lane에는 Publish 도구가 없다.

기존 공식 사이트 요청은 실제로 응답했다. 새 호스트 4개의 재요청은 현재 runtime에서 403이라 미확인 정보를 완료 처리하지 않았다. KRX query 400/403과 일부 JavaScript·외부 frame 문제는 Publish만으로 해결된다고 주장하지 않는다. 실제 응답·원본 해시·접근 시각을 확인한 후 조사를 재개한다. Secret 발명·전체 인터넷 허용·프록시 우회는 없었다.

## 검증과 실행

```sh
source /workspace/.putduk-cloud-tools/activate.sh
node catalog-ops/economy-simulate.mjs
node catalog-ops/validate.mjs
node --test catalog-ops/validate.test.mjs catalog-ops/research.test.mjs catalog-ops/finalize.test.mjs
node node_modules/prettier/bin/prettier.cjs --check --ignore-path /dev/null catalog-ops/*.mjs catalog-ops/*.json catalog-ops/*.md
git diff --check
node catalog-ops/verify-handoff.mjs --require-pushed --require-clean
```

일반 pnpm exec의 자동 의존 갱신은 상속된 pnpm 11과 충돌했지만, scoped formatter는 이미 설치된 manifest-pinned 3.9.9로 직접 검증했다. Node·pnpm·package·lock·workflow 수정은 없었다. DB나 API secret이 필요 없는 오프라인 workflow만 준비됐다. 명령·카운트·TAP 원본은 evidence/finalize-test-summary.json과 finalize-tests.tap에 있다. 과거 108개 입력은 정확한 Git SHA에 고정했고 현재 모형에는 새 106개 tests를 실행했다. Synthetic unit fixtures를 공개 조사·실제 DB 등록·확정 금액의 근거로 사용하지 않았다.

READY FOR PRIMARY REVIEW: YES
READY FOR POLICY APPROVAL: NO — unresolved official detail, live/effect/Tier implementation contracts and legal/accessibility approval remain.
READY FOR PRODUCTION: NO

NOT DONE: Production publication/economy activation, shared staging write, SQL, migration, Member UI/backend/Mining Runtime/SceneRegistry changes, develop/main merge, PR, full CI, live DB ID/readback/browser registration evidence.
