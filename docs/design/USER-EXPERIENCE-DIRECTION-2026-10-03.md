# 사용자 경험 방향 — 장면 중심 퍼뜩

상태: **OWNER-APPROVED UX DIRECTION / SCREEN MOCKUP REVIEW REQUIRED / RUNTIME INTEGRATION NOT COMPLETE / LAUNCH NOT READY**

기준일: `2026-10-03`. 이 문서는 현재 사용자 앱을 읽기 전용으로 조사한
inventory와 사용자가 직접 확정한 UX 방향을 연결한다. code, route, DB,
runtime asset, Git 또는 CI를 변경한 결과가 아니다. 화면별 실제 backend,
pixels, 접근성·성능 증거는 아직 별도 검증이 필요하다.

추가 승인 근거는 [사용자 제공 UI/UX 원문](USER-PROVIDED-VISUAL-PROMPT-2026-10-03.txt)이다.
사용자가 읽기를 허용한 정확한 첨부를 직접 확인했으며 SHA-256은
`361667675167a5fc9fffbd5cca268ad9fe96ce8b7a430c735bede85d06e5b4cd`다.
아래 제작·renderer·출시 gate는 이 추가 프롬프트를 반영한다. 원문 속
등급/금액, DPR 2, 화면 품질의 80~90%라는 표현과 성능 단정은 production
승인값·측정 사실이 아니다. 경제 숫자와 renderer budget은 각각 승인·
실측 gate를 통과해야 한다.

## 1. 사용자 승인과 시각 기준

2026-10-03 사용자 직접 승인 사항은 다음과 같다.

- 모바일과 PC 모두 V3 cinematic Scene을 크게 보여 준다. 장면 위 핵심
  오버레이는 3~5개로 제한하고 원금·현재 Tier·오늘 채굴·capacity·speed를
  읽을 수 있게 한다.
- pending/verified, 기록, Tier 표, 다음 Tier, loyalty, 상품, 규칙과 설정의
  상세는 drawer 또는 accordion으로 연다. 첫 화면을 정보 카드로 채우지 않는다.
- 시각 품질을 최우선으로 둔다. 눈이 즐겁고 계속 보고 싶으면서 복잡하지
  않아야 한다. 허술한 평면 scene이나 placeholder는 최종 결과가 아니다.
- UI/UX·시각 품질·애니메이션·반응성은 금융 무결성·보안과 동급의 출시
  gate다. Money/Security/DB가 통과해도 시각·responsive·motion·성능·
  접근성·한국어 typography·hydration/runtime 검증이 남으면 출시할 수 없다.
- 모바일 하단 탭은 **홈·채굴·상품·지갑·더보기**로 확정했다. PC도 같은
  정보 구조의 안정적인 왼쪽 navigation을 사용하고 Scene이 주인공이다.
- AI는 탭에서 제외한다. 모든 사용자 화면에서 같은 위치의 floating
  **퍼뜩 AI** 버튼으로 접근한다. 돈·CTA·keyboard·focus·modal을 가리지 않는다.
- 새로운 큰 화면 결정은 이미지 목업과 추천안을 먼저 보여 주고 사용자
  의견을 받은 뒤 구현한다. 위 구조 승인이 최종 위치·crop·색·크기까지
  자동 승인한 것은 아니다.

품질 기준은 [Visual Direction:11](PUTDUK-VISUAL-DIRECTION.md#L11),
[Canonical Visual Benchmark:23](visual-lab/CANONICAL-VISUAL-BENCHMARK.md#L23),
[Responsive Spec:3](visual-lab/RESPONSIVE-SPEC.md#L3),
[Interaction / Motion:18](visual-lab/INTERACTION-MOTION-SPEC.md#L18),
[Motion System:25](PUTDUK-MOTION-EXPERIENCE.md#L25)와
[Theme System:69](PUTDUK-THEME-SYSTEM.md#L69)를 따른다.
Visual Lab `visual-lab-2026.09.27-v1`의 구성·품질을 사용하되 mockup 숫자,
production copy, 경제 규칙 또는 prototype 실행을 제품 진실로 사용하지 않는다.

canonical brand/rank master와 새 V3 clean master 후보를 직접 시각 검토했다.
V3 후보에는 중앙 HBM, 왼쪽 wafer, 오른쪽 assembly, 전경 extraction ring,
깊은 fab, 금속 재질과 gold/blue 반사가 있다. 이 공간감은 유지해야 한다.
HUD를 중앙 HBM과 ring 위에 겹쳐 장면의 핵심을 가리는 구성은 피한다.
canonical 이미지의 글자·등급·혜택은 복사하지 않는다. 정확한 브랜드 표기는
`퍼뜩`이고 production 문구는 HTML/CSS 또는 검토된 SVG로 렌더한다.

앱 shell은 clean premium, 채굴은 dark cinematic island로 구분한다.
홈·지갑·더보기·설정에 같은 금빛 배경/불빛을 반복하지 않는다. 금융
command panel은 명확한 금액·목적지·수수료·버튼·결과를 읽기 쉽게 둔다.
이는 전체 앱을 dark-only로 만들거나 금융 panel을 무조건 흰색으로
고정하라는 뜻이 아니다. 기존 System/Light/Dark를 보존하고 Light shell
안에서도 cinematic scene과 HTML HUD의 contrast·경계·초점이 의도적으로
보이게 한다. 실제 theme별 pixels를 각각 검토한다.

각 Scene family는 환경·기구·재질·조명·공간 구도가 다른 원형 master를
별도로 제작한다. 같은 반도체 배경의 색만 바꾸어 GPU/금/블록체인 family로
대체하지 않는다. 예시 기업명·기구는 상품 seed나 로고 사용 승인이 아니며
실제 승인 catalog/mapping을 따른다. family마다 자산은 고유하지만 공통
Stage·경제 engine·HUD를 복제하지 않는다.

한국어는 20대부터 70대까지 읽기 쉬운 존중하는 말투를 사용한다. 한
화면에 한 메시지, 한 문단에 한 생각, 한 버튼에 한 행동을 담고 긴
복문·넓게 늘어진 설명·내부 개발 용어를 피한다. 사용자 표기는 `채굴 원금`,
`현재 등급`, `오늘 채굴`, `이번 채굴 용량`, `채굴 속도`처럼 짧게 검토한다.
phone은 가입 가능/이미 사용된 번호의 의미이고 소유 인증으로 표현하지
않는다. USDT 입금은 수동 입금, 출금은 KRW 잔액을 이용하는 출금이며
사용자 USDT 잔액이라고 부르지 않는다. 실제 상태별 copy는 backend
조건과 일치하는지 후속 화면 목업·접근성 검토를 거친다.

## 2. 실제 사용자 앱 Inventory

아래는 2026-10-03 현재 workspace의 직접 읽기 근거다. `rg --files`로
`app`, `components`, `lib`의 관련 파일을 찾고 아래 파일을 읽었다.
실행 browser나 원격 환경을 조사한 결과는 아니다. 경로 존재는 기능 또는
`PRODUCT COMPLETE`의 증거가 아니다.

| ID | 관찰한 현재 상태 | 실제 파일·줄 근거 |
| --- | --- | --- |
| `UX-E01` | 실제 공통 navigation은 홈 `/home`, 채굴 `/mining`, 자산 `/wallet`, 이벤트 `/events`, 메뉴 `/menu`; pathname으로 활성 항목 결정 | [product-navigation.tsx:11](../../components/navigation/product-navigation.tsx#L11), [활성 판정:29](../../components/navigation/product-navigation.tsx#L29) |
| `UX-E02` | ProductShell이 같은 navigation을 sidebar와 workspace 하단에 배치; 알림 센터와 테마 제어도 header에 있음 | [product-shell.tsx:20](../../components/layout/product-shell.tsx#L20), [header:42](../../components/layout/product-shell.tsx#L42), [하단:63](../../components/layout/product-shell.tsx#L63) |
| `UX-E03` | 하단 nav는 fixed/safe-area CSS, desktop은 sidebar; breakpoint에서 workspace nav를 숨기는 구조 | [globals.css:1374](../../app/globals.css#L1374), [desktop:3158](../../app/globals.css#L3158), [숨김:3259](../../app/globals.css#L3259) |
| `UX-E04` | `MobileNavigation`은 “디자인 예시” nav, route 없는 button과 첫 항목 고정 active; 실사용 nav와 동일한 역할로 붙이면 안 됨 | [mobile-navigation.tsx:16](../../components/navigation/mobile-navigation.tsx#L16) |
| `UX-E05` | product layout은 현재 사용자 확인 뒤 ProductShell로 보호됨 | [product layout:11](../../app/(product)/layout.tsx#L11) |
| `UX-E06` | Home은 trial, KRW wallet, mining session, 알림을 읽음; 현재 핵심 요약은 사용 가능 KRW와 START이며 `MiningCore` 사용 | [home/page.tsx:26](../../app/(product)/home/page.tsx#L26), [요약:123](../../app/(product)/home/page.tsx#L123), [MiningCore:204](../../app/(product)/home/page.tsx#L204) |
| `UX-E07` | `/mining`은 active session의 상태·경과·장비와 world 목록을 읽고 orbital Earth hero/세션 목록을 렌더; funding Tier/capacity/speed 조회가 이 select에 없음 | [mining/page.tsx:39](../../app/(product)/mining/page.tsx#L39), [hero:86](../../app/(product)/mining/page.tsx#L86), [상태/경과:125](../../app/(product)/mining/page.tsx#L125) |
| `UX-E08` | wallet은 KRW projection과 trial을 분리하고 원장/영수증을 WalletReadView로 전달; `/wallet/deposit`, `/wallet/withdraw` 존재 | [wallet/page.tsx:18](../../app/(product)/wallet/page.tsx#L18), [원장:49](../../app/(product)/wallet/page.tsx#L49), [read view:113](../../app/(product)/wallet/page.tsx#L113), [deposit:215](../../app/(product)/wallet/deposit/page.tsx#L215), [withdraw:288](../../app/(product)/wallet/withdraw/page.tsx#L288) |
| `UX-E09` | 메뉴에는 계정, 알림 센터, 알림 설정, AI, 신뢰 센터, 상담 링크; 이벤트/공지/통합 설정을 갖춘 새 더보기 IA와 같지 않음 | [menu-items.ts:13](../../app/(product)/menu/menu-items.ts#L13), [menu/page.tsx:36](../../app/(product)/menu/page.tsx#L36) |
| `UX-E10` | `/menu/account`는 마스킹된 개인정보와 이 기기/모든 기기 logout; 오류 때도 logout 경로를 보존 | [account/page.tsx:24](../../app/(product)/menu/account/page.tsx#L24), [오류:57](../../app/(product)/menu/account/page.tsx#L57), [logout:112](../../app/(product)/menu/account/page.tsx#L112) |
| `UX-E11` | `/notifications`는 받은 알림, `/menu/notifications`는 PushControl·선호 설정; 둘은 서로 다른 역할 | [notifications/page.tsx:15](../../app/(product)/notifications/page.tsx#L15), [설정 링크:46](../../app/(product)/notifications/page.tsx#L46), [menu/notifications:17](../../app/(product)/menu/notifications/page.tsx#L17), [선호 form:57](../../app/(product)/menu/notifications/page.tsx#L57) |
| `UX-E12` | 이벤트 list/detail route 존재; 상담 `/support`는 별도 안내이고 상담에서 잔액/출금을 바꾸지 않는다고 명시 | [events/page.tsx:155](../../app/(product)/events/page.tsx#L155), [support/page.tsx:64](../../app/support/page.tsx#L64), [돈 경계:104](../../app/support/page.tsx#L104) |
| `UX-E13` | `/ai`가 `/menu/ai` 페이지를 재사용하고 그 페이지가 PutdukAiChat을 렌더; 현재 공통 shell의 floating AI 구현은 조사 범위에서 발견되지 않음 | [ai/page.tsx:1](../../app/(product)/ai/page.tsx#L1), [menu/ai:69](../../app/(product)/menu/ai/page.tsx#L69), `UX-E02` |
| `UX-E14` | screen context는 current route와 allowlist의 상품/world/event/transaction hint만; 채팅은 기존 POST API를 사용 | [screen-context.ts:53](../../components/product/putduk-ai-screen-context.ts#L53), [chat.tsx:131](../../components/product/putduk-ai-chat.tsx#L131), [POST:140](../../components/product/putduk-ai-chat.tsx#L140) |
| `UX-E15` | AI API는 verified identity와 read-only tool boundary를 검증; 현재 대화는 session memory이며 durable 복원을 주장할 수 없음 | [AI route:83](../../app/api/v1/ai/chat/route.ts#L83), [tool boundary:150](../../app/api/v1/ai/chat/route.ts#L150), [tools.ts:95](../../lib/ai/tools.ts#L95), [continuity.ts:6](../../domain/ai/continuity.ts#L6) |
| `UX-E16` | root layout의 SupportRuntime이 상담 launcher를 배치; member nav 위로 올리는 별도 처리 존재. AI 버튼과 collision 검토 필요 | [app/layout.tsx:129](../../app/layout.tsx#L129), [support-runtime.tsx:78](../../components/support/support-runtime.tsx#L78), [launcher:95](../../components/support/support-runtime.tsx#L95), [support CSS:3520](../../app/globals.css#L3520) |
| `UX-E17` | MiningLiveStage는 approved master/productionAssetActive가 있어야 master 표시; running과 reduced motion 조건으로 decoration만 허용 | [mining-live-stage.tsx:51](../../components/mining-live/mining-live-stage.tsx#L51), [master:72](../../components/mining-live/mining-live-stage.tsx#L72) |
| `UX-E18` | 공통 stage 입력은 경제 필드를 배제. 현재 Scene registry 행은 master null/미승인이며 SceneDecoration은 effect에서 한 번 그리는 bounded 정적 점; 미래 event renderer 완료 증거가 아님 | [stage-input.ts:58](../../lib/mining-scene/stage-input.ts#L58), [scene-registry.ts:56](../../lib/mining-scene/scene-registry.ts#L56), [scene-decoration.tsx:26](../../components/mining-live/scene-decoration.tsx#L26) |
| `UX-E19` | V3 clean master는 생성 후보이며 production 승인·runtime manifest/derivative·상품 mapping 게시 대기 | [V3 REVIEW:3](generated-masters/semiconductor-memory-v3-clean-2026-10-03/REVIEW.md#L3), [게시 경계:36](generated-masters/semiconductor-memory-v3-clean-2026-10-03/REVIEW.md#L36) |

추가로 `rg --files app/(product)`에서 상품 전용 product page는 발견되지
않았다. `PutdukAiChat`, `MiningLiveStage`, `MobileNavigation`의 `.tsx` 사용을
`app/components/lib`에서 검색한 결과, 채팅 caller는 `/menu/ai`였고 Stage와
MobileNavigation은 정의 외 application caller가 발견되지 않았다. 이것은
해당 source 조사 범위의 gap이며 다른 환경의 실행 성공/실패 판정은 아니다.

따라서 새 IA의 상품 route, 공통 floating AI, V3 Stage의 사용자 route 연결,
authoritative entitlement HUD는 아직 구현 과제다. 새 `/settings` 또는
`/products`가 이미 존재한다고 기록하지 않는다. Visual Lab 표의
`/settings/notifications` 표기보다 실제 `/menu/notifications` 경로를 우선하며,
경로 통합·redirect·deep link는 후속 검토 대상이다.

## 3. 확정 정보 구조와 기능 역할

모바일과 PC의 항목 이름·순서는 같은 승인된 IA를 따른다. 현재 path를
불필요하게 바꾸거나 이름이 다른 화면·writer를 복제하지 않는다.

| 승인 항목 | 사용자 역할 | 현재 경로와 후속 연결 |
| --- | --- | --- |
| 홈 | 오늘 채굴·원금·현재 Tier·알림 요약; 지금 필요한 한 가지 다음 행동 | `/home` 재사용. 현재 KRW/START 요약과 새 entitlement 요약의 의미를 분리하고 실제 서버 snapshot 연결 |
| 채굴 | 큰 V3 Scene과 단순 핵심 오버레이; 자세한 설명은 필요할 때 열기 | `/mining` 재사용. 공통 MiningLiveStage와 entitlement/cue 연결 필요 |
| 상품 | 승인 catalog의 탐색·선택·조건 비교 | 전용 route 미발견. 기존 catalog/presentation을 소비하는 route·선택 명령 계약을 먼저 검토; 이 문서는 URL을 확정하거나 새 상품을 seed하지 않음 |
| 지갑 | KRW 입금·출금·수익·사용 가능/예약·원장 영수증 | `/wallet`, `/wallet/deposit`, `/wallet/withdraw` 재사용. 원금과 채굴 수익/보너스·trial 분리 유지 |
| 더보기 | 이벤트·공지·알림·지원·설정의 찾기 쉬운 허브 | `/menu` 재사용. `/events`, `/notifications`, `/support`, `/menu/account`, `/menu/notifications` 연결; 공지/통합 설정의 실제 route와 내용은 구현 gap |

알림 센터는 **받은 소식**, 알림 설정은 **받을 소식과 기기 권한**이다.
header bell과 더보기의 알림 링크는 같은 센터에 도달하는 접근 경로다.
읽지 않은 badge는 실제 서버 count만 사용한다. 알림이 없다는 이유로
red dot이나 긴급 문구를 만들지 않는다.

설정에는 계정·기기 logout, 화면 테마, 알림 선호와 접근성 제어를 알아보기
쉽게 묶는 것을 추천한다. 현재 테마는 [theme-control.tsx:20](../../components/system/theme-control.tsx#L20)의
System/Light/Dark 제어를 재사용한다. reduced-motion 사용자 제어 등 아직
없는 항목은 구현 과제로 기록한다. 보안·로그아웃은 긴 accordion 끝에
숨기지 않고 직접 도달 가능해야 한다. 오류 때도 logout·지원은 유지한다.

이벤트는 참여 조건·실제 진행·지급 영수증이고, 공지는 운영자가 게시한
공식 안내다. 신뢰/규칙은 versioned 공식 사실, 지원은 사람의 상담·복구
접점, AI는 확인된 사실의 설명과 탐색 도움이다. 이 역할을 이름이 다른
같은 카드로 반복하지 않는다. AI는 다섯 탭을 차지하지 않는다.

## 4. Scene과 오버레이 구성 추천안

승인된 3~5개 오버레이 구조 안에서 **세 개의 작은 정보 그룹으로 다섯
값을 전달하는 구도**를 첫 이미지 목업 추천안으로 제시한다. 위치·크기·
crop은 사용자 검토 대기이며 이 문서에서 최종 pixels로 승인하지 않는다.

| 정보 그룹 | 내용과 의미 | 장면과 읽기 원칙 |
| --- | --- | --- |
| 원금·등급 | 현재 Eligible Funding Principal + 서버가 결정한 현재 Tier | 상단의 조용한 읽기 영역; available wallet 잔액·누적 입금과 혼동 금지 |
| 오늘 채굴·속도 | 서버가 반환한 오늘의 earned 결과 + 승인 단위의 현재 speed | 숫자는 tabular; 기간 단위 명시; verified-only 통계와 섞지 않음 |
| 이번 용량 | used / effective capacity, remaining과 진행 meter | 주기 의미와 텍스트 대안; raw used가 capacity를 넘는 downgrade 사실은 상세에서 보존 |

중앙 HBM·wafer/assembly 연결·전경 ring을 주인공으로 유지한다. text
plate는 실제 명도·재질 분리와 충분한 contrast를 제공하되 모든 정보에
두꺼운 glass card를 붙이지 않는다. 내역 전체와 Tier 표를 scene 옆 상시
대시보드로 펼치지 않는다. 한 번에 한 primary action을 명확히 한다.

모바일은 desktop canvas를 축소하지 않는다. 승인 master의 focal point와
기구 관계를 보존하는 전용 crop을 검토한다. HUD, safe area, bottom nav와
AI 버튼의 비겹침을 실제 pixels로 확인한다. 320px·200% 확대에서 텍스트를
줄이거나 금액을 잘라 맞추지 않는다. 필요하면 같은 정보 그룹이 장면
아래 읽기 영역으로 자연스럽게 이어지되 핵심 정보와 조작은 모두 유지한다.

PC는 안정적인 왼쪽 IA 옆에 큰 Scene을 배치한다. 상세는 선택된 drawer로
열고 장면의 공간감을 계속 볼 수 있게 한다. `장면 크게` focus mode는
추천 interaction이다. 사용자가 직접 켜고 끄며 현재 위치, 더보기/설정,
뒤로가기와 AI 접근은 유지한다. 자동 fullscreen·숨겨진 종료·route 이동
또는 금융 확인 중 focus mode 전환은 허용하지 않는다. focus mode의 최종
chrome/전환은 이미지 목업 검토와 keyboard 검증 후 결정한다.

## 5. 상세 Drawer와 Accordion

기본 첫 화면에는 요약만 있고 상세는 이름이 있는 `자세히` 버튼으로 연다.
추천 구조는 하나의 채굴 상세 drawer 안에서 서로 다른 의미의 section을
accordion으로 여는 것이다. drawer를 중첩해 길을 잃게 하지 않는다.

- 채굴 결과: 미확정/확정, 원본 reward·정산 시각·영수증. 지갑 원장으로
  이동할 수 있고 scene에서 별도 잔액이나 ledger writer를 만들지 않는다.
- 이번 주기: 서버 시작·종료·다음 reset, used/capacity/remaining, 변경
  이유와 적용 시점. 추가입금은 새 주기나 과거 reward 재계산이 아니다.
- 등급: 승인된 Tier 표와 다음 Tier preview. 미승인 band/rate/혜택을
  표로 만들거나 예시 이름·14단계를 production 설정처럼 보이지 않는다.
- 적용 조건: 상품, loyalty, campaign, override의 허용된 설명과 실제
  적용 기간. 비공개 공식·risk/KYC logic을 상세 기능으로 노출하지 않는다.
- 규칙/기록: versioned 공식 설명과 필요한 영수증을 읽기 좋은 폭으로 표시.
  설정은 더보기의 명확한 경로로 이동하며 숨겨진 gesture만 사용하지 않는다.

modal drawer는 제목·닫기·Escape, 적절한 focus trap/복귀와 background
inert를 갖춘다. 비modal PC panel은 같은 focus trap을 강제하지 않는다.
accordion은 semantic button, expanded 상태, 키보드 접근과 명확한 section
제목을 가진다. 열고 닫을 때 scroll 위치와 현재 선택을 보존한다.
세부금액/조건은 사용자 이해를 돕지만 금융 confirmation의 필수 금액·
수수료·목적지는 접힌 section에만 두지 않는다.

## 6. 사실에 맞는 상태와 회복

| 상태 | 표시와 다음 행동 |
| --- | --- |
| loading | 최종 구도를 유지하는 skeleton과 “불러오는 중”; 임의 금액·진행률 없음 |
| 신규 회원/채굴 전 | 적격 START 또는 실제 가능한 다음 행동 하나; trial 값과 real KRW 분리, 입금 강요 없음 |
| 정상 채굴 | 현재 snapshot의 핵심 오버레이와 running 상태; monetary delta는 별도 reward 영수증에서만 |
| capacity 소진 | used/capacity/remaining과 원래 cycle end 표시; money flow 정지, 기존 보상 유지, ambient는 비금전 장식으로만 |
| capacity 증가·재개 | 같은 주기 `new capacity > used`이면 서버 revision 뒤 `ACTIVE`와 남은 권리 표시; 과거 소진 시간 reward 소급·anchor reset 없음 |
| downgrade | `used >= new capacity`면 remaining 0/소진; 기존 pending/verified와 used 보존; clawback 연출 없음 |
| 관리자 중지/safe mode/KYC·적격성 제한 | capacity가 있어도 제한의 사실·허용된 회복 경로 표시; 재개 animation으로 중지를 해제한 것처럼 보이지 않음 |
| 정책/출처 확인 불가 | 확인할 수 없는 항목은 0 대신 명확히 표시; 임의 Tier·속도·수익·full meter 없음 |
| partial/error | 읽힌 사실과 확인 불가를 구분; draft·영수증 위치 보존, 안전한 재조회와 지원 경로 |
| offline/stale/reconnect | 마지막 확인 시각·읽기 상태 표시, 금융 mutation 차단; refresh 뒤 최신 revision 수락, 과거 cue 재생 없음 |
| unauthorized/session 만료 | 다른 회원 데이터/장면 상태 노출 금지; 안전한 로그인 복귀 경로, claim 없이 회복 |
| 성공/처리 중 | 서버의 discrete 단계·정확한 반환 금액과 원본 영수증; unknown duration을 fake percent로 표현하지 않음 |

경제 상태는 [Mining Entitlement Contract](../architecture/MINING-ENTITLEMENT-CYCLE-CONTRACT.md)의
2026-10-03 후속 승인과 같은 결과를 소비한다. Speed Boost만으로는
capacity를 늘리거나 remaining 0 상태를 재개하지 못한다. capacity 증가도
관리자 pause·safe mode·KYC·eligibility stop을 우회하지 못한다.
새 권리의 효과는 `effective_at` 이후 남은 주기/실제 event 기간의
proration이며 이미 earned된 보상·used는 capacity 변경 자체로 바뀌지 않는다.

## 7. Micro / Monetary / Settlement / Tier / Capacity Cue

| Cue | 실제 trigger | 시각 의미와 금지 |
| --- | --- | --- |
| micro | hover/press/focus, disclosure 등 사용자의 조작 | 즉시 짧은 피드백 가능; 서버 성공·보상·승인처럼 표현하지 않음 |
| ambient | 서버가 확인한 상태와 승인 profile, capability budget | 기구의 공간감·작동감만; random 금액, timer accrual, 가짜 돈 입자 금지 |
| monetary reward | 대상 회원의 실제 신규 earned reward receipt와 snapshot delta | 기구→extraction→정확한 HTML 금액의 짧은 cue; 원본 한 번, client 계산 없음 |
| settlement | 같은 reward의 실제 pending→verified 정산 영수증 | 이동/확정 cue; pending 감소와 verified 증가를 새 수익으로 두 번 보여주지 않음 |
| Tier 상승 | 실제 principal/entitlement revision에서 Tier가 상승 | 승인 profile/path/badge 전환; 예측 preview나 입금 신청만으로 재생 금지 |
| capacity 확장/재개 | 새 server snapshot revision의 실제 cap/used/remaining/Tier/profile/state | meter 범위·Scene profile 변경, 같은 anchor의 재개 사실; 새 reward 지급 연출과 분리 |
| 정상 cycle reset | 서버가 원래 cycle end 경계를 수락한 새 주기 | 짧은 새 주기 전환; 추가입금·재입금·preview를 reset으로 연출하지 않음 |

replay·reconnect·늦은 snapshot은 event/receipt/revision을 대조하고 cue를
중복 재생하지 않는다. capacity/Tier 변화와 reward가 동시에 와도 서로
다른 원본을 연결하며 발표를 겹쳐 복잡하게 만들지 않는다. 빠른 서버
event 묶음은 bounded cue로 합칠 수 있지만 정확한 결과·영수증은 읽을 수
있어야 한다. 정지 기간의 reward backfill이나 가짜 긴급 countdown,
꾸며낸 사용자 활동·수익·missed reward로 재방문을 유도하지 않는다.

결과는 HTML text/status로도 전달한다. 매 frame 금액을 `aria-live`로 읽지
않는다. 중요한 완료만 짧게 알리고 지속적으로 변하는 설명은 조용히
업데이트한다. 시각 cue가 취소되거나 생략되어도 accepted domain 결과는
그대로다. view가 아닌 시간에 발생한 결과는 최신 summary/영수증으로
확인하며 화면 복귀 시 연출의 밀린 재생을 하지 않는다.

## 8. 공통 AI 버튼과 충돌 규칙

사용자가 승인한 floating AI 접근은 같은 shell 위치와 일관된 이름
`퍼뜩 AI`를 사용한다. 현재 `/ai`와 `/menu/ai` 페이지/POST API를 재사용할
연결 seam이며 새 AI provider writer나 money endpoint를 만들지 않는다.
현재 별도 페이지 두 개는 같은 component 재사용이다. 향후 panel/전용
page fallback의 deep link를 정리하고 기존 접근을 깨뜨리지 않아야 한다.

모바일 기본 anchor는 **하단 navigation와 bottom safe-area 위의 일정한
오른쪽 영역**을 추천한다. PC도 content의 같은 상대 위치에 둔다. “같은
위치”는 비가림 검증을 포함하며 모든 화면에 같은 고정 pixel offset을
억지로 적용한다는 뜻이 아니다.

1. 실제 nav 높이, safe-area, viewport, sticky CTA, 돈 요약의 reserved
   영역으로 배치한다. 큰 글자·가로모드·installed PWA를 포함해 겹침을 확인한다.
2. 입출금 form이나 keyboard가 열리면 AI 접근은 잃지 않되 keyboard/submit/
   error 위치를 가리지 않는 안전한 슬롯으로 이동하거나 조용히 접는다.
   접힌 경우 focus 가능한 같은 이름의 접근을 유지한다.
3. 금융 confirmation, drawer 또는 dialog 위에 다른 floating button을
   띄우지 않는다. modal이 우선하고 launcher는 background/inert가 된다.
   AI 닫기는 trigger로 focus를 반환하며 원래 form/scroll/draft를 보존한다.
4. root SupportRuntime의 별도 상담 launcher와 AI 버튼을 겹쳐 쌓지 않는다
   (`UX-E16`). 상담은 더보기→지원의 직접 경로를 유지하고, 공통 shell의
   launcher 우선순위/배치·외부 상담 widget 충돌은 목업과 실제 환경 검증
   후 조정한다. AI를 사람의 상담으로 이름만 바꾸거나 지원을 삭제하지 않는다.
5. 버튼은 keyboard로 도달하고 보이는 focus, 명확한 이름과 expanded 상태를
   갖춘다. tab 이동·money 정보·오류 focus를 가로막거나 자동으로 panel을
   열어 주의를 빼앗지 않는다.

각 route의 최소 context는 기존 allowlist hint만 보낸다(`UX-E14`). URL
전체, 입력 form, 계좌/지갑 주소·KYC 파일·비밀번호, DOM 전체를 AI에게
보내지 않는다. event/transaction hint는 identity와 ownership을 서버에서
다시 검증한다. 공개·로그인 필요 화면에서는 기존 인증 경계를 유지하고
공개 안내/로그인 경로만 제공한다. account context를 만들거나 privileged
AI 요청으로 우회하지 않는다.

AI는 상태·규칙을 설명하고 적합한 화면을 찾는 도움이다. 잔액·원장·Tier·
보상을 변경하거나 입출금을 승인하지 않는다. 승인된 read-only tool
boundary를 유지한다(`UX-E15`). provider 없음·연결 실패·tool 실패·stream
중지·retry는 실제 사실로 표시하고 fake thinking/streaming을 만들지 않는다.
현재 session memory와 refresh 시 대화 소실 안내를 보존한다. 새 durable
history가 있는 것처럼 launcher에서 대화 복원을 약속하지 않는다.

현재 AI의 `mining.today_reward`는 “오늘 확정 기록된 보상”을 읽는다
([tools.ts:52](../../lib/ai/tools.ts#L52)). 새 HUD의 “오늘 채굴”이 earned/pending을
포함한다면 서로 다른 숫자의 이유와 기간·상태를 명시해야 한다. 합산으로
맞추거나 UI 값으로 AI의 실제 조회 결과를 덮어쓰지 않는다.

## 9. Motion·정적 품질·Adaptive Budget

Scene은 승인 master raster, transparent bounded motion layer, 접근 가능한
HTML HUD/controls를 분리한다. stage의 경제 필드 배제 seam(`UX-E18`)을
보존하고 HUD가 서버의 표시값을 읽는다. 금액·한글·버튼을 generated
raster에 굽거나 canvas 전용으로 만들지 않는다. 단순한 SVG/평면 도형을
V3의 cinematic master 대신 최종 배경으로 제출하지 않는다.

효과가 필요한 Stage당 transparent canvas는 한 개만 사용하고 RAF owner는
Stage animation scheduler 하나다. particle·beam·pulse 등 effect module은
공통 scheduler/budget을 소비하며 component마다 RAF를 만들지 않는다.
정적/reduced-motion 상태에서는 loop가 필요 없다. canvas/CSS/DOM의 효과
배치는 같은 lifecycle 아래 정리하며 별도 scheduler를 추가해 제한을
우회하지 않는다. 실제 loop·canvas 수와 teardown은 browser에서 검증한다.

`prefers-reduced-motion` 및 사용자 설정에서는 parallax·orbit·particle·
camera travel·shimmer/celebration을 멈추고 짧은 opacity 또는 즉시 상태
변경을 사용한다. 정적에서도 같은 고품질 재질·구도·money 정보·조작을
유지한다. reduced motion을 빈 화면이나 저품질 placeholder로 대체하지 않는다.

future renderer는 hidden, out of view, route 이탈, modal로 가려짐에서
loop를 멈추고 observer/listener/buffer를 정리한다. viewport 복귀는 최신
서버 state를 먼저 읽는다. 기구 움직임과 돈 흐름은 별개이며 paused/
maintenance/권한 제한 상태를 running처럼 연출하지 않는다. ordinary
home/menu/wallet/settings/AI 화면에는 background RAF를 추가하지 않는다.

capability별 effect 수·DPR/해상도·frame·memory/bundle budget을 두고 실제
측정으로 확정한다. 저성능 기기에서는 고품질 static/raster fallback과
제한된 효과를 사용한다. 기기 성능 profile과 사용자의 Funding Tier는
서로 다른 축이며 성능 저하로 reward/speed/capacity를 바꾸지 않는다.
무한 RAF·부족한 기기의 constant bloom/입자·전체 master PNG 전송을 피하고
responsive derivative, intrinsic size, measured LCP preload를 적용한다.
현재 정적 SceneDecoration은 future renderer의 in-view pause/adaptive
event/performance 완료 증거가 아니다.

measurements는 FPS/frame time, long task, memory/teardown, route bundle,
LCP/CLS/INP와 네트워크/image bytes를 포함한다. agreed device/browser와
normal/reduced motion, 최초 진입/반복 route/장시간/keyboard/modal/hidden
조건을 기록한다. 측정 없는 “렉 없음”이나 “성능 완료” 주장은 하지 않는다.
60fps는 지향 목표이며 달성 사실이나 모든 기기 보증이 아니다. 제한된
기기의 canonical fallback은 실제 frame-time·memory·입력 반응 측정에
따라 선택한다. 낮은 adaptive quality에서도 고품질 static master·HUD·
조작은 유지하고 경제 결과는 그대로다. 예시 DPR 2를 모든 기기의 cap으로
고정하지 않는다. 성능이 부족하면 effect/해상도를 줄이고 master 품질을
값싼 flat scene으로 대체하지 않는다.
Motion tokens의 실제 시간은 canonical motion 문서를 재사용하며 새 효과의
양적 budget은 evidence와 review로 정한다.

추가 프롬프트의 200~500ms는 bounded 전환을 설명하는 예시 가이드이며
모든 UI나 돈 처리에 강제하는 승인 timeout이 아니다. press/disclosure,
Tier/profile/capacity 전환은 짧고 중단 가능하며 사용자의 다음 조작을
기다리게 하지 않는다. 금액 roll/전환은 서버가 반환한 직전·현재 표시값
사이의 연출일 뿐 새로운 reward나 balance 계산이 아니다. 정확한 반환
금액과 영수증은 즉시 읽을 수 있어야 한다. reduced motion은 즉시 또는
최소 전환으로 결과를 보여 주며 금융 confirmation·검증·완료·복구에
불필요한 animation delay를 넣지 않는다.

## 10. 목업·통합·제품 Acceptance Gate

이미 생성한 [V3 clean master 후보](generated-masters/semiconductor-memory-v3-clean-2026-10-03/semiconductor-memory-v3-clean-master-v1.png)는
lossless design master다. 현재 SHA-256을 직접 확인했다:
`5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd`.
이것은 전체 사용자 UI 목업도 runtime 게시도 아니다. production approval은
pending이고 [REVIEW:36](generated-masters/semiconductor-memory-v3-clean-2026-10-03/REVIEW.md#L36)의
asset/anchor/profile/revision/performance gate가 남아 있다.

새 Scene family의 제작 표준은 다음 순서다.

```text
고유 Scene Master 생성
→ 사용자 master 검토·승인
→ approved immutable hash/version
→ responsive derivatives + asset manifest
→ anchor mapping + 승인된 visual profiles
→ 한 canvas/한 scheduler의 bounded effects + authoritative HTML HUD
→ 자동 screenshot/visual regression + 직접 pixels 검토
→ 실제 screenshots 사용자 공유 + 기능·접근성·성능 출시 gate
```

generated 후보는 승인된 master가 아니다. 후보의 hash를 미리 기록할 수는
있지만 사용자 master 승인 전에 production derivative/profile/mapping을
활성화하지 않는다. 승인 원형의 변경은 새 version·hash·검토를 요구한다.
dynamic money·텍스트·HUD·버튼은 master에 포함하지 않는다. 자동 diff
threshold 통과만으로 구도·crop·anchor·깊이·재질·readability·겹침·효과
품질을 승인하지 않는다. 실제 rendered pixels를 직접 검토하고 사용자에게
보여 준다. 이미지 생성 도구와 구현 도구가 달라도 이 gate와 서버 권위는 같다.

후속 구현 전 순서는 다음과 같다.

1. 같은 master를 기준으로 모바일/PC 전체 화면 이미지 목업을 만든다.
   세 정보 그룹·다섯 값, 확정 5탭/PC IA, AI 위치와 열린 상세 상태를
   비교 가능한 추천안으로 보여 준다. 숫자는 설명용 가정으로 명확히
   구분하고 production band/rate/cap seed로 쓰지 않는다.
2. 사용자 의견으로 최종 crop·overlay·focus mode·drawer·AI 충돌안을
   정한다. 이미 확정한 5탭과 AI 역할을 다시 미정으로 돌리지 않는다.
3. 기존 route/shell/registry/Stage/command를 재사용하는 연결을 구현한다.
   새로운 catalog route, entitlement snapshot, cue receipt, source coverage,
   AI launcher는 각각 실제 domain/authorization 경계를 검증한다.
4. 별도 승인된 asset version·derivative·manifest와 상품 mapping을 연결한다.
   canonical reference/원본 prototype/PNG master를 runtime으로 직접 게시하지 않는다.
5. 실제 backend와 browser 결과를 동일 후보에서 검증하고 제품 gate를 닫는다.
   theme/route 변화, drawer/AI/금융 dialog, 정상·오류·재연결 상태에서
   hydration error, unhandled runtime exception과 console을 기록한다.
   오류를 숨기거나 screenshot이 찍혔다는 이유로 hydration/runtime gate를
   통과한 것으로 처리하지 않는다.

| Acceptance | 필요한 실제 증거 |
| --- | --- |
| IA/route parity | 모바일 5탭과 PC 같은 순서/기능; nested route active, back/deep link/scroll 복원; 상품 route의 실제 존재·권한·선택 연결 |
| Scene 중심 품질 | 실제 rendered mobile/PC가 V3 공간감·재질·빛을 유지; scene이 카드/큰 설명에 밀리지 않음; canonical과 목업 비교 |
| 핵심 다섯 값 | 같은 서버 revision/as-of의 원금·Tier·오늘 채굴·capacity·speed; wallet/누적입금/trial/verified 통계와 의미 분리 |
| 상세와 설정 | pending/verified/원장 영수증, Tier/next Tier/loyalty/상품/규칙, account/theme/notifications/support를 직접 찾고 keyboard로 열고 닫을 수 있음 |
| 돈과 cue | reward/settlement/Tier/capacity 원본 구분; duplicate/reconnect/late event 한 번만 표현; no fake/backdated reward; 소진·재개·운영 중지 결과 일치 |
| floating AI | 모든 해당 화면에서 일관된 접근; nav/safe-area/CTA/money/keyboard/focus/modal/상담 widget 비겹침; 최소 context·money denial·현재 continuity 유지 |
| 상태 | loading/empty/partial/error/recovery/success/disabled/unauthorized/offline/stale/reconnect, capacity 소진/증가/정상 reset과 관리 중지 |
| responsive/theme/a11y | 320/390/834/1440, System/Light/Dark, 200% 확대, 긴 한국어·큰 금액, contrast/focus/keyboard/screen reader/target size/forced colors |
| motion/성능 | normal/reduced motion recordings, hidden/in-view teardown, adaptive fallback, FPS/long-task/memory/bundle/LCP/CLS/INP 측정과 승인 budget |
| renderer 소유권 | Stage당 canvas 한 개와 RAF owner 한 개; effect/module별 추가 loop 없음; hidden/route 이탈/reduced motion에서 loop 정지·정리 |
| master pipeline | family별 고유 원형, 사용자 master 승인·immutable hash/version, derivatives/anchors/profiles, effects/HTML HUD, 자동+직접 pixels QA의 순서와 영수증 |
| hydration/runtime | 실제 browser console·hydration·unhandled exception 점검; theme/route/dialog/AI/금융 상태 전이에서 오류·중복 mount/loop·복구 기록 |
| 경제·완료 경계 | 미승인 정책을 fixture/UI값으로 활성화하지 않음; 실제 원장/worker/source/정산 연결과 해당 환경 증거; 문서/이미지/green CI를 제품 완료로 대체하지 않음 |

영구 evidence에는 exact candidate SHA, 정책/snapshot/asset/profile version과
digest, 원본 영수증, 실제 browser/device, screenshots·recordings·성능
측정, 실패·복구와 미결을 남긴다. 현재 UI inventory·새 master 후보·이
설계 문서는 `PRODUCT COMPLETE` 또는 출시 준비 완료가 아니다.
Tier band/rate/cap/rounding 등 실제 경제 수치는 아직 승인되지 않았다.
원격 변경·배포·release는 이 문서로 허용되지 않는다.
