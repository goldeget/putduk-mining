# 현행 런타임 감사와 Primary 연결 계약

Base `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`. 소스만 읽었다. 아래 EXTEND는 구현 완료가 아니다.

## 실제 경로와 경계

`app/(product)/mining/page.tsx`는 own `mining_active_session_snapshots`를 읽는다.
현재 조회 필드는 session/world/status/time/equipment이고 선택 product_id/catalog_version은 없다.
`resolveDefaultStageInput()`은 인자가 없고 명시 승인된 기본 배경을 반환한다.
`lib/mining-scene/product-presentation.ts`의 11개 코드는 catalog publication이 아닌 시각 표현 lookup이다.
000660만 SEMICONDUCTOR_MEMORY에 배정되고 나머지 10개는 null이다.
`resolveCatalogProduct()`는 이 lookup을 해석하지만 현재 mining page는 호출하지 않는다.
현재 mining 화면이 SK하이닉스를 선택했다거나 어느 상품을 채굴한다고 주장하면 안 된다.

`MiningLiveStage`는 hash/path allowlist, productionAssetActive, dimensions를 확인한다.
이미지 load 완료 후 `running`과 renderer=canvas-2d, webgl=false,
`timerAdvancesValue=false`, reducedMotion=false가 모두 맞아야 decoration을 그린다.
`lib/product/mining-display.ts:isConfirmedMiningRunning`은 NORMAL/REDUCED만 허용한다.
이 boolean은 REDUCED의 별도 cadence, STARTING, settlement, verified receipt를 구현하지 않는다.

`StageSceneInput`에는 anchor/extractionTarget가 있으나 경제·product/session identity는 없다.
`SceneDecoration`은 anchor만 받는다. extractionTarget는 현재 motion renderer에서 소비하지 않는다.
현재 particle은 cover에 투영한 anchor 주변의 gold/blue light motes이며 추출·money pulse가 아니다.

## KEEP

- 공통 MiningLiveStage와 renderer의 상품명/category별 layout switch 없는 구조.
- SceneRegistry, 명시 code binding, resolve/projectStageInput의 fail-closed 경계.
- 승인 source SHA와 asset path allowlist. 현재 source SHA와 derivative hash는 서로 다른 용도다.
- 실금액/조작은 children HTML 슬롯. Scene 입력에 경제 공식·회원 신원·금액을 싣지 않는다.
- server-running gate, image-ready gate, load 실패 시 static/retry, keyboard 가능한 실제 controls.
- static approved master의 품질 유지, reduced-motion/offscreen/hidden 정지와 RAF cleanup.

## 성능·접근성 계약

현행 `components/mining-live/scene-decoration.tsx` 기준:
30FPS, DPR<=1.5, particles<=12, 최대 dimension 2048, canvas pixels<=1,572,864.
saveData, hardwareConcurrency<=2(양수), deviceMemory<=2이면 constrained로 시작한다.
연속 expensive draw(8ms 초과 3회) 또는 delayed frame(100ms 초과 5회)에 degrade한다.
degraded: FPS<=15, particles<=4, DPR<=1. 화면 geometry는 돈을 바꾸지 않는다.
IntersectionObserver/document.hidden + fallback viewport 검사로 화면 밖을 멈춘다.
`prefers-reduced-motion` 변경은 RAF를 멈추고 정적 master를 유지한다.

명세의 새 machinery 효과는 이 기본 budget 안에서 측정 후 승인해야 한다.
추가 layer 때문에 GPU/CPU/메모리 비용을 검증 없이 높이지 않는다.
관찰 대상은 실제 저사양 mobile, desktop, hidden/resume, no-canvas, save-data, image failure다.
이번 lane은 해당 디바이스 실측을 실행하지 않았고 performance PASS를 주장하지 않는다.

## EXTEND — Primary 소유

1. 승인 catalog의 실제 UUID/version/availability/selected product를 server read model에서 검증해 명시적으로 연결한다.
   현재 code table로 새 금융 선택·API·RPC를 발명하지 않는다. 별도 shared 요구사항으로 처리한다.
2. family는 공통 산업 분류로 유지하되 개별 product profile/master/portrait/anchors를 좁은 시각 계약으로 연결한다.
   AAPL와 MSFT는 같은 SEMICONDUCTOR_COMPUTE 후보지만 이미지·장치·재료·공간은 완전히 다르다.
   ETH/BNB/XRP도 CRYPTO_NETWORK 아래 서로 다른 prism/switchyard/relay bridge를 갖는다.
3. 검토된 신규 source를 버전별 lossless master 경로에 저장하고 기존 builders/manifest policy를 따른다.
   public에는 최적화된 AVIF/WebP를 제공한다. 코드 allowlist 확장과 asset 변경은 Primary만 한다.
4. 생성 후 anchor/extractionTarget를 실제 pixels에서 재측정하고 desktop/portrait별 좌표를 cover 투영한다.
   manifest 좌표는 목표 구도이며 현재 이미지의 측정값이 아니다. HBM 기존값은 (0.5,0.235)/(0.5,0.695).
5. server-normal/reduced/subcomponent truth와 별도 receipt cue를 binding해 local machinery/flow를 제한한다.
   extraction flow를 timer만으로 만들거나 running boolean으로 settlement 성공을 표현하지 않는다.
6. 금액/상태/receipt는 실제 React/HTML. main 금액은 정수 KRW, session은 “이번 세션 채굴액”과
   “실시간 계산 중 · 정산 전”을 표시한다. 승인된 정본 값이 없으면 상태 확인과 복구만 표시한다.

## 엔진 상태 / 시각 상태 / 사용자 명령 구분

| 시각 상태 | 현행 확인 가능한 입력 | 제안된 표현 / 미연결 경계 |
| --- | --- | --- |
| IDLE | 세션 없음은 ready/running 증거 아님 | dormant master; 실제 start eligibility는 기존 UI/서버가 결정 |
| STARTING | current snapshot에 독립 상태 없음 | accepted transition 계약이 있어야 짧은 local boot; 클릭만으로 running 금지 |
| RUNNING | NORMAL | local machinery/flow 가능; fixed camera |
| REDUCED | REDUCED | sparse local activity; 경제 배속 숫자 발명 금지 |
| PAUSED | current status copy에는 없음; entitlement domain의 paused는 별도 조건 | authoritative adapter 없으면 UNKNOWN/static; 새 user pause command 없음 |
| STOPPED | STOPPED | park effects, same static art + 실제 한국어 상태 |
| MAINTENANCE | MAINTENANCE | all financial/extraction cues off |
| PARTIAL_STOP | PARTIAL_STOP | subcomponent identity 없으면 효과 전부 정지 |
| SETTLEMENT | current scene input에 없음 | 실제 진행/receipt 계약이 있어야 bounded local acknowledgement |
| VERIFIED | current scene input에 없음 | 신규 검증 receipt만 성공 cue; catalog 승인과 다름 |
| UNKNOWN | 누락/실패/unsupported/stale/offline | 정적 이미지, 상태 확인 중, 복구; UNKNOWN != PASS |

명세의 11개 상태를 DB enum이나 새 command로 그대로 추가하라는 지시가 아니다.
Engine enum→presentation adapter를 명시적으로 검토한다. Member control에는 이미 승인된 실제 command만 노출한다.

## 금융 truth boundary

Authoritative Mining Engine → Live Snapshot → UI state machine → Product Visual Profile
→ Scene motion cue → visible animation.
SCENE IS NOT MONEY AUTHORITY. Money = Server / Ledger / Settlement. Scene = Presentation only.
AI = Explain / creative assets / propose. 실회원 돈 계산·승인·변경은 하지 않는다.

`domain/mining/economy-policy.ts`와 funding-entitlement의 단위는 1 KRW = 1,000,000 micro-KRW다.
baseRewardCarry/rewardCarryMicroKrw/rewardCarrySubMicroKrw는 domain에 있지만 browser snapshot에 연결된 증거는 없다.
`read_own_mining_server_display`와 `miningServerDisplaySchema`는 pending/retention 등 이미 계산된 값을 표시한다.
그 schema에는 live session delta/revision/settlement receipt/carry가 없다. 현재 formatter는 소수 KRW를 표시할 수 있다.
따라서 whole-KRW/live-session UI는 이번 lane에서 SPEC_ONLY다. Primary가 기존 정본의 읽기 계약을 확인해야 한다.

정수 KRW 경계 microcelebration은 동일 세션의 단조로운 신규 server revision에서 검증된 양수 delta로만 유발한다.
전체 pending 합계는 세션 금액으로 재명명하지 않는다. reconnect/receipt 중복은 재축하하지 않는다.
정산 확인 cue는 신규 검증 receipt에만 stronger bounded pulse; 예상값이나 낡은 cache로 verified를 만들지 않는다.
브라우저 타이머·RAF·AI가 금액을 진전시키거나 ledger/settlement를 호출하는 일은 금지한다.

## DO NOT REWRITE

mining engine, economy policy, ledger, settlement, withdrawal, RLS, worker, migration, auth,
기존 shared API/command 이름과 재시도·idempotency 경계. 이 lane에는 새 backend나 parallel renderer 구현이 없다.
상품 매핑이 없다면 정본 contract 요구사항을 Primary에 전달하고 UNKNOWN/static을 유지한다.

## 실제 통합 이후 검증

승인 snapshot + selected product readback → correct master hash/path → actual HTML amount/state →
normal/reduced/unknown/offline/settlement receipt → 320/390/834/1440 screenshots →
목업 비교·2초 식별·테마/zoom/keyboard → reduced motion/hidden/low power/FPS 측정.
현재 unit test 소스는 이러한 일부 경계를 검사한다. 이번 작업에서는 기존 app suites를 실행하지 않았다.
