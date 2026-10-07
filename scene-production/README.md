# PUTDUK 상품별 시네마틱 장면 제작 패키지

이 패키지는 제작 명세다. 앱·백엔드·자산·SceneRegistry를 변경하거나 상품을 공개하지 않는다.
상품마다 별도의 산업 공간, 핵심 장치, 재료, 빛, 추출 지점을 설계한다. 기존 엔진과 금융 정본은 유지한다.

현재 base: `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d` (2026-10-07 origin 재확인).
브랜치: `parallel/product-scene-production`. 쓰기 범위: `scene-production/**`.
동결 Admin/launch-content 브랜치는 그대로 보존한다.

## 먼저 확인할 진실

저장소에는 11개 DRAFT 상품이 있다. 기본 seed의 회원 공개 상품은 0개다.
실제 배포 DB의 공개 상품 수는 UNKNOWN이다. 원격 DB를 읽거나 쓰지 않았다.
따라서 11개의 명세·22개의 프롬프트는 **실재하는 저장소 후보의 사전 제작안**이다.
운영자 승인 상품 목록, 실제 UUID/version/availability와 대조하기 전에는 출시 목록으로 사용하지 않는다.
`catalog_source.verified`는 행을 파일에서 확인했다는 의미이며 승인·회원 노출을 뜻하지 않는다.

## 읽기 순서

1. PRODUCT-CATALOG-INVENTORY.md와 JSON: 실제 식별자·출처·불확실성.
2. evidence/scene-registry-audit.json: 현행 14개 family와 단일 승인 family pack.
3. product-scene-manifest.json: 상품별 시각 세계와 11개 시각 상태.
4. scene-generation-prompts.json: desktop/mobile 각각의 실행 가능한 영어 생성 요청.
5. SCENE-ACCEPTANCE-CHECKLIST.md: 생성 후 직접 시각 평가. 약하면 재생성.
6. SCENE-RUNTIME-MAPPING.md와 INTEGRATION-HANDOFF.md: Primary 통합 경계.

## 이 lane의 검증

```bash
cd /workspace/putduk-mining
source /workspace/.putduk-cloud-tools/activate.sh
node --version  # v24.21.0
node scene-production/validate.mjs
node --test scene-production/validate.test.mjs
```

validator는 Node 내장 모듈만 사용한다. 추가 install, DB, 브라우저, 전체 CI가 필요 없다.
`build-inventory.mjs`는 현재 SQL 형태를 읽는 감사 도구다. 새 develop에 적용하면 source hash와 신규 카탈로그를 먼저 재감사한다.
기존 isolated checkout을 사용한다. 사용자가 별도로 요청하지 않으면 worktree를 만들지 않는다.

GPT Image Generation의 actual generation은 별도 단계다. 이 lane은 이미지·가짜 placeholder를 만들지 않는다.
생성한 lossless master는 Primary가 기존 `docs/design/generated-masters/` 정책에 맞춰 보존하고,
검토된 파생 자산만 public manifest에 등록한다. 이 JSON은 현행 DB/API에 바로 import할 수 있는 계약이 아니다.

요청 모델 설정은 GPT-6.1 Sol / High / Cloud, Extra High 금지다.
이 세션에서 모델 설정을 읽거나 바꾸는 기능이 제공되지 않아 실제 모델 선택은 검증하지 못했다.
