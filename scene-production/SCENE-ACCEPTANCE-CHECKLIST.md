# Scene Master 수락 기준 — UNKNOWN은 통과가 아니다

기준: 사용자 Tesla/SK hynix 시네마틱 품질 방향과 저장소 clean semiconductor master의 재료·빛·공간 깊이.
Tesla 승인 이미지 파일은 현재 저장소에서 확인되지 않았다. 보았다고 주장하지 않는다.
실제로 직접 열어 본 기준은 `semiconductor-memory-v3-clean-master-v1.png`다.
이미지 파일이나 명세 존재는 visual/product approval이 아니다. 생성·시각 검토·상품 계약·법무·runtime QA는 각각 별도 gate다.

## 모든 이미지에 기록할 evidence

product_id/code, 실제 catalog version/digest와 operator approval, prompt_id/version,
생성 도구/실제 timestamp, 파일 source SHA256/원본 dimensions, desktop/mobile target,
reviewer, 각 항목 PASS/FAIL/UNKNOWN과 사유, screenshot/비교 이미지 경로, 결정 ACCEPT/REGENERATE/BLOCKED.
승인 source와 derivative path/hash를 혼동하지 않는다. 새 이미지 없이 fake 파일/hash/approval을 만들지 않는다.

## 필수 시각 gate

- [ ] 승인 snapshot의 실제 상품과 코드/UUID/version이 일치한다. 미확정이면 BLOCKED.
- [ ] 서로 다른 상품 이미지를 이름·로고를 가리고 2초간 보여 주었을 때 산업/상품 세계를 구별할 수 있다.
      최소 세 명의 실제 검토자가 product profile 기준과 대조한다. 테스트 전에는 UNKNOWN.
- [ ] 단순 hue/logo/name swap이 아니다. environment/hero/machinery/material/lighting/flow/composition 모두 product story에 맞는다.
- [ ] premium cinematic 3D/CGI이며 cheap 2D/vector/cartoon/primitive/game-like rendering이 없다.
- [ ] hero가 분명하고 물리적으로 설득력 있는 scale, 연결부, 구조를 갖는다.
- [ ] foreground/midground/background가 구별되고 volumetric light와 실제 재료 반사가 깊이를 만든다.
- [ ] 조악한 AI 패턴, 엉킨 로봇 팔, 잘못 연결된 냉각 관, 비현실적인 핵심 제조 장치가 없다.
- [ ] machinery/environment가 실제 제품 테마의 산업 정체성을 설명한다.
- [ ] gold/silver 또는 ETH/BNB/XRP는 동일 방의 색상 변경으로 통과하지 않는다.
- [ ] 전체 light가 노이즈/과도한 glow로 재료와 정보를 가리지 않는다.
- [ ] hero/extraction이 safe zone 밖에서 온전히 보이고 UI 레이아웃을 견딘다.
- [ ] desktop master는 실제 16:9. 기존 1539x1022를 늘리거나 자른 것만으로 새 합격을 만들지 않는다.
- [ ] mobile은 승인된 portrait 9:16 master 또는 직접 검토한 안전한 crop 전략이 있다.
      현재 후보 11개는 MOBILE_MASTER_REQUIRED이며 crop PASS는 없다.
- [ ] no fake money/yield/APR/reward/balance/multiplier, no charts/member UI/HUD.
- [ ] no raster text/letters/numbers/logos/watermarks; 모든 copy와 수치는 real HTML.
- [ ] no sponsorship/partnership/endorsement; LEGAL_BRAND_REVIEW_REQUIRED는 미승인이다.
- [ ] static idle master 자체가 프리미엄 품질이다. particle 없이도 제품이 구별된다.
- [ ] 생성물에 과도한 움직임/trails를 박아 넣지 않고 runtime layer에 local motion 공간을 남긴다.

## Composition·상태 gate — 실제 브라우저 통합 후

- [ ] 320/390 mobile, 834 tablet, 1440 desktop에서 product name, status, amount, controls와 art가 겹치지 않는다.
- [ ] top/left/right/bottom safe zones와 focal/extraction을 실제 pixels로 측정하고 source별 좌표를 기록한다.
- [ ] UI/한국어 줄바꿈/200% zoom/Light/Dark/System에서 정보를 읽을 수 있다.
- [ ] profile에 정의한 motion anchors가 생성된 hero와 물리적으로 연결된다.
- [ ] IDLE/UNKNOWN은 extraction/earning motion 없음. RUNNING은 실제 NORMAL 이후만.
- [ ] REDUCED/PARTIAL_STOP은 실제 상태를 유지하고 금융 배속/하위 활동을 추측하지 않는다.
- [ ] STARTING/PAUSED는 없는 engine state나 사용자 명령을 만들지 않는다.
- [ ] SETTLEMENT/VERIFIED cue는 실제 receipt/revision과 연결되고 replay되지 않는다.
- [ ] 고정 카메라. 로봇 팔/관/scan/node 등 local motion만 사용한다.
- [ ] viewport zoom in/out, 흔들림, 전후 이동, 멀미 유발 parallax/sway 없음.
- [ ] reduced-motion, no-canvas, image failure, hidden/offscreen, low-power에서도 모든 상태와 조작은 유지된다.
- [ ] 기존 FPS/DPR/canvas/particle budget와 실제 device frame/memory evidence가 있다.
- [ ] scene time과 money authority가 분리되고 animation failure가 정산을 중복/취소하지 않는다.

## 판정

핵심 시각 gate 하나라도 FAIL이면 REGENERATE다. “이미 생성했으므로 사용”은 허용하지 않는다.
identity/catalog/legal UNKNOWN은 BLOCKED다. 이미지 품질 평가 자체도 UNKNOWN이면 승인하지 않는다.
좋은 family art가 있어도 다른 상품에 자동 승인·재사용하지 않는다.
재생성은 새 version/source hash/prompt 이유를 기록하고 이전 승인 자산을 덮어쓰지 않는다.
이 패키지의 신규 22개 master는 미생성으로 모든 실제 visual/runtime 판정이 UNRUN이다.
