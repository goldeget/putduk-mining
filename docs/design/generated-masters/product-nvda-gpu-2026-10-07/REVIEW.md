# NVDA GPU 장면 원본 검토 — 2026-10-07

사용자가 위임한 native GPT 시각 제작에 따라 네 원본 전체를 각각 직접 확인했습니다. 서버 랙, GPU 연산 모듈, 양쪽 로봇과 원형 추출 장치를 독립적인 NVDA 장면으로 채택합니다. 원본에는 상품 가격·수익률·원금·상태·버튼·한국어 운영 문구를 넣지 않았습니다. HTML 금융값과 인터랙션은 실제 앱이 담당합니다.

## 네 독립 원본

| 테마 | 구도 | 원본 | 해상도 | SHA-256 |
|---|---|---|---|---|
| dark | portrait | `product-nvda-gpu-v1-dark-portrait-master.png` | 1024×1536 | `0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d` |
| dark | landscape | `product-nvda-gpu-v1-dark-landscape-master.png` | 1672×941 | `b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1` |
| light | portrait | `product-nvda-gpu-v1-light-portrait-master.png` | 1024×1536 | `56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115` |
| light | landscape | `product-nvda-gpu-v1-light-landscape-master.png` | 1672×941 | `abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736` |

## 검토 범위

- Dark는 짙은 남색 서버실, 금속 GPU 모듈과 파란 배선을 유지했습니다. Light는 흰색·은색 서버실에서 같은 구성과 파란 배선을 유지했습니다.
- 모바일 세로와 넓은 가로 구도는 별도 native GPT 원본입니다. 이미지를 잘라 다른 화면용 원본처럼 등록하지 않았습니다.
- 네 PNG 원본 바이트는 그대로 보존했습니다. 런타임에는 원래 비율을 유지한 Lanczos 축소, lossless WebP 및 quality 85 / 4:4:4 AVIF만 제공합니다. 크롭·리컬러·업스케일·텍스트 삽입을 하지 않았습니다.
- 테마별 portrait source는 `(max-width: 699px)`, landscape source는 그 뒤의 기본 source로 제공합니다. 모든 경로는 독립 원본 SHA와 실제 encoding 해상도로 검증됩니다.
- Portrait 좌표는 GPU `(0.50,0.50)`, 원형 장치 `(0.50,0.75)`입니다. Landscape는 GPU `(0.73,0.50)`, 원형 장치 `(0.73,0.78)`입니다. `SOURCE.json`에 원본 기준 픽셀과 정규화 좌표를 함께 보존했습니다. 반응형 compositor가 현재 선택한 source와 레터박스를 반영해야 합니다.

## 상품·경제 경계

- `NVDA` + `US_STOCK` + `AI_GPU_COMPUTE` + `product-nvda-gpu-v1`의 명시적 조합에만 시각 팩을 제공합니다. 이름 유사성, 상품 UUID, Funding Tier로 선택하지 않습니다.
- 공통 `AI_GPU_COMPUTE` family 기본값은 `VISUAL_MASTER_REQUIRED`로 유지합니다. 다른 GPU 상품은 이 NVDA 팩을 빌려 쓰지 않습니다.
- 실제 member binding은 authoritative published/available 상품과 확인된 allocation을 확인해야 합니다. 자산 등록은 상품 publication이나 runtime mining을 승인하지 않습니다.
- multiplier, capacity, slot, 원장, 채굴량, 정책 승인값을 바꾸지 않았습니다. timerAdvancesValue는 false입니다.

## 완료 상태

**SOURCE REVIEW ONLY / PRODUCT COMPLETE: false.** 원본 검토와 파일 무결성은 실제 앱 시각 완료와 다릅니다. Primary가 실제 Chromium 렌더와 responsive composition, reduced motion, 실패·재시도, 접근성, console/network 및 경제 경계를 검증해야 합니다.
