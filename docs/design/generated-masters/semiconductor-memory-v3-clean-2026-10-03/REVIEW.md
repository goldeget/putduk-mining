# V3 반도체 메모리 clean master 후보

상태: **OWNER-DELEGATED VISUAL SELECTION / RUNTIME PACK REGISTERED / PRODUCT QA PENDING**

후속 결정(2026-10-03): 사용자가 운영자·디자이너·사용자 관점의 시각 선택을
위임했고, 그 범위에서 이 기존 clean master를 실제 앱 배경으로 채택했다.
새 사진을 받았다는 이유로 승인한 것이 아니며 경제 값·상품 mapping·다른
13개 family의 승인이 아니다. 생성 당시 `PRODUCTION APPROVAL PENDING`
상태와 아래 생성·검토 이력은 보존한다. 완성된 제품/출시 승인도 아니다.

파일: `semiconductor-memory-v3-clean-master-v1.png`.
SHA-256: `5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`.
2026-10-03 built-in image_gen의 precise-object-edit 결과이며 원본은 보존했다.

사용자가 명시한 현재 저장소의 `putduk-sk-hynix-mining-v3-precision.html`에서
embedded JPEG의 bytes만 새 프로젝트 QA 폴더로 추출했다. prototype 코드를
실행·이식하거나 수정하지 않았다. 추출 증거와 원본 hash는
`D:\PUTDUK-MINING-QA\codex-2026-10-03T08-48-23-433Z-ffe13633\reference.json`에 있다.
이를 먼저 직접 보고 reference로 제공했다. 기존 canonical brand/rank master는
변경하지 않았다.

## 생성 요청

Use case: precise-object-edit. Keep the original floating HBM stack, silicon
wafer at left, semiconductor assembly at right, circular extraction platform,
deep fab composition, physically detailed titanium/glass/metal, warm gold and
electric blue lighting. Maintain striking cinematic spatial depth and premium
material detail. Remove all logos, letters, numbers, labels, bottom UI, baked
HUD and counters. Remove airborne gold cubes, sparks, arcing energy trails and
streaming columns; real dynamic effects belong to a later bounded transparent
layer driven by actual server events. Preserve a subtly lit idle reactor and
reflected environmental light. No extra objects or characters, flat/vector
substitute, fake financial motion or readable production text.

## 직접 시각 검토

원본의 HBM·wafer·fab·extraction 구조와 깊은 구도를 유지했다. 금속 표면,
blue/gold 반사와 idle ring을 확인했다. 로고·문구·HUD·금액·money cube/trail은
새 pixels에서 보이지 않는다. 정지 장면의 기반 후보로 보존한다. 사진은
실제 economic state나 frame 성능의 증거가 아니다.

이 파일은 lossless design master다. 초기 검토 당시 runtime manifest/derivative나
상품 mapping에는 게시하지 않았다. 320px crop과 읽기 영역, family anchor,
normal/reduced motion, 화면 밖 정지, capability별 effect/frame/memory budget,
서버 snapshot/revision/receipt 연결을 검증한 뒤 별도 후보로 통합한다.
당시 clean master의 production 승인과 PRODUCT COMPLETE는 미확정이었다.

## 후속 승인 pack과 검증

- 원본은 RGB 1539×1022이며 SHA-256은 위 값과 같다. PNG bytes를 변경하거나
  public에 게시하지 않았다. 전체 구도·색상·물체를 보존하고 crop·upscale·
  재생성·새 copy 없이 width만 640/960/1280/1539로 최적화했다.
- `scripts/build-semiconductor-scene-assets.py`는 hash-locked 입력을 사용한다.
  Pillow 12.3.0, AVIF quality 94/4:4:4, WebP lossless/method 6이다. AVIF는
  압축으로 pixel 차이가 생기므로 원본과 byte/pixel 동일하다고 주장하지 않는다.
  WebP는 각 Lanczos 축소 기준 image와 decoded RGB pixels가 모두 일치했다.
- 새 runtime pack은 `2026.10.03-semiconductor-memory-v1`, manifest는
  `2026.10.03-v3`/96종이다. 기존88 entry digest
  `e29fa4778a445da4fd99bedd551943573c0ba247b7b83b42ea5960b5c2f3893c`와
  기존 파일 hash를 보존했다. 8종을 `/brand/scenes/semiconductor-memory/`에 추가했다.
- 원본에서 HBM 중심 약(770,240)과 reactor 중심 약(770,710)을 직접 확인했다.
  normalized anchor는 (0.5,0.235), extraction target은 (0.5,0.695)다.
  모바일/PC가 같은 원본 좌표를 쓰며 viewport cover crop은 renderer에서
  좌표를 투영한다. 파생파일 자체는 전체 구도를 유지한다.
- `SEMICONDUCTOR_MEMORY`만 approved, 다른13종은 pending이다.
  `DEFAULT_STAGE_BACKDROP`는 명시 기본 배경이며 상품·이름·category·회원
  상태를 추론하지 않는다. SK Hynix prototype/reference SHA는 승인하지 않는다.
- asset verifier96종, brand unit9개, builder syntax/decoded dimensions/hash가
  통과했다. AVIF4종 최소 PSNR은41.067dB, WebP4종은 lossless였다. decoded
  640/1539 AVIF를 직접 보고 금속·빛·색상·HBM/wafer/fab/ring 구도를 확인했다.
  이는 앱 responsive/theme/crop/performance acceptance를 대신하지 않는다.

fresh QA: `D:\PUTDUK-MINING-QA\scene-assets-20261003-2216-9df68e6d`.
D: `ESD-USB`를 확인한 뒤 이 실행 폴더만 생성했다. report는
`asset-fidelity-report.json`, 확인한 pixels는 두 `*-decoded.png`다.
실제 앱의 viewport/키보드/접근성/reduced motion/정지·재개/성능 및 서버
snapshot/revision/receipt 연결은 통합 후보에서 별도로 검증한다.
