# ADDENDUM — PUTDUK GLOBAL KOREAN TYPOGRAPHY / COPY LAYOUT CONTRACT
# APPLY NOW TO THE CURRENT ACTIVE UI/UX WORK
# DO NOT RESTART OR DISCARD CURRENT WORK

현재 진행 중인 UI/UX / mockup reconstruction / visual QA 작업을 그대로 계속한다.

이 지시는 새 작업을 시작하라는 뜻이 아니다.
현재 작업을 중단하거나 처음부터 다시 하지 마라.
현재 local commits / modified files / visual progress를 보존한다.

다만 지금부터 모든 화면 구현과 이미 수정한 화면의 최종 QA에
아래 Korean Typography / Korean Copy Layout 기준을 함께 적용한다.

이 요구사항은 visual fidelity의 일부다.

==================================================
1. 핵심 문제
==================================================

PUTDUK 전체에서 한국어가:

"문자열은 들어가 있지만 브라우저가 대충 렌더한 화면"

처럼 보여서는 안 된다.

목표는:

"한국 대형 서비스처럼 의도적으로 조판된 한국어"

다.

예:

WRONG:

안녕하세요.저는 퍼뜩채굴의 운영자 입니다.

CORRECT COPY:

안녕하세요. 저는 퍼뜩채굴의 운영자입니다.

디자인상 두 줄이 더 적절하다면:

안녕하세요.
저는 퍼뜩채굴의 운영자입니다.

이 줄바꿈은 우연히 viewport 때문에 생긴 것이 아니라
copy/layout contract에 의해 의도적으로 만들어져야 한다.

==================================================
2. 지금 작업 중인 화면부터 바로 적용
==================================================

지금부터 새로 만지는 모든 UI에서 먼저 적용한다.

그리고 현재 visual reconstruction 작업으로 이미 수정한 화면들도
각 화면을 "완료" 처리하기 전에 다시 검사한다.

즉:

IMPLEMENT
→ KOREAN COPY CHECK
→ KOREAN WRAP CHECK
→ SCREENSHOT
→ VISUAL DIFF
→ FIX

순서에 포함한다.

전체 visual 작업이 다 끝난 후 한꺼번에 다시 고치는 방식으로 미루지 마라.

==================================================
3. 반드시 찾아야 하는 오류
==================================================

전체 Member/Public/Admin UI에서 최소 다음을 찾는다.

A. 문장 공백 누락

예:

안녕하세요.저는
완료되었습니다.다음
확인해 주세요.현재

금지.

문장 종료부호 뒤에 다음 문장이 같은 줄로 계속되면
적절한 공백이 있어야 한다.

B. 잘못된 한국어 띄어쓰기

예:

운영자 입니다
회원 입니다
상태 입니다

등 명백한 형태.

예:

운영자입니다.
회원입니다.

처럼 자연스러운 한국어 문법을 사용한다.

단 regex로 모든 한국어 문법을 무조건 자동수정하지 마라.
안전하고 확정적인 패턴만 자동화한다.

C. JSX node 사이 공백 소실

예:

<span>안녕하세요.</span>
<span>저는 운영자입니다.</span>

가 실제 렌더에서:

안녕하세요.저는 운영자입니다.

가 되지 않는지 확인한다.

D. 문자열 concatenation

예:

greeting + introduction

i18n/interpolation/helper 조합 때문에
문장 사이 공백이 사라지지 않는지 확인한다.

E. 어절 중간 줄바꿈

예:

퍼뜩채굴 서비
스

운영
자입니다.

같은 부자연스러운 한글 분리가 핵심 Member UI에서 발생하지 않게 한다.

F. 한 글자 orphan

제목이나 핵심 문구 마지막 줄에
한 글자/짧은 조사만 덩그러니 떨어지지 않게 한다.

G. 버튼/배지/탭

가능하면 한 줄 유지.
좁은 화면에서 무작정 두 줄이 되어 버튼 높이가 깨지지 않게 한다.

H. 금융 숫자/단위

₩
18,420

또는

18,420
원

처럼 핵심 금액과 단위가 부자연스럽게 분리되지 않게 한다.

==================================================
4. 한국어 기본 wrapping contract
==================================================

현재 Design System / global CSS / typography primitive를 먼저 읽는다.

이미 중앙 typography system이 있으면 그것을 확장한다.
새로운 중복 시스템을 만들지 마라.

한국어 일반 member copy는 기본적으로 다음 성격을 만족해야 한다.

- word-break: keep-all
- 적절한 overflow fallback
- Korean line breaking에 적절한 line-break
- 제목/hero는 balance 가능한 환경에서 균형 잡힌 줄바꿈
- body는 자연스러운 문단 wrapping
- 숫자는 tabular numerals가 적절한 곳에서 사용

구현 예시는 현재 stack/browser support/design system과 맞춰 선택한다.

무조건 전역에 위험한 CSS 하나를 덮어씌우지 말고
기존 컴포넌트에 미치는 영향까지 확인한다.

==================================================
5. explicit line break가 필요한 곳
==================================================

모든 문장에 <br>을 넣는 것은 금지한다.

텍스트 역할별로 처리한다.

HERO / INTRO / ONBOARDING:
디자인상 문장별 줄이 확정되어야 할 경우
structured lines 또는 semantic <br> 사용 가능.

예:

안녕하세요.
저는 퍼뜩채굴의 운영자입니다.

BODY / FAQ / NOTICE:
반응형 자연 wrapping을 사용한다.
presentation-only <br> 남발 금지.

BUTTON / BADGE / LABEL:
가능하면 한 줄.

FINANCIAL VALUE:
금액과 단위의 시각적 결합을 보호한다.

==================================================
6. MOCKUP FIDELITY와 typography를 따로 보지 마라
==================================================

한국어 조판은 visual fidelity의 일부다.

Mockup과 비교할 때:

- 줄 수
- 줄바꿈 위치
- 글자 폭
- line-height
- letter-spacing
- font weight
- 카드 안의 텍스트 높이
- 버튼과 텍스트 사이 거리
- 제목의 마지막 줄 길이

까지 비교한다.

문구를 교정해서 줄 길이가 바뀌면
카드/layout도 다시 visual diff한다.

==================================================
7. MEMBER COPY는 내부 개발 언어를 제거
==================================================

기존 member-facing copy audit 원칙도 동시에 적용한다.

Member UI에서는 가능하면 피한다:

- 서버에서 확인된...
- DB
- authoritative
- snapshot
- service_role
- raw enum
- UUID
- hash
- internal error code
- implementation wording

회원에게 필요한 것은 기술적 출처가 아니라
"지금 어떤 상태인가"다.

예:

"서버에서 확인된 배수예요"
보다

"현재 적용 배수"
"1.20×"
"채굴 속도에 적용 중입니다."

형태를 우선한다.

==================================================
8. 상태별 문구를 정확히 구분
==================================================

다음을 하나의:

"확인할 수 없어요"

로 뭉개지 마라.

AVAILABLE
→ 실제 값

PENDING / PROCESSING
→ 확인 중입니다 / 처리 중입니다

INSUFFICIENT_DATA
→ 아직 계산에 필요한 데이터가 부족합니다

EMPTY
→ 아직 기록이 없습니다

LOAD_FAILED
→ 정보를 불러오지 못했습니다 + 다시 시도

PERMISSION_DENIED
→ 현재 계정에서는 이 정보를 볼 수 없습니다

DELAYED
→ 처리가 지연되고 있습니다

REVIEW_REQUIRED
→ 추가 확인이 필요합니다 / 검토 중입니다

UNKNOWN
→ 현재 상태를 확인할 수 없습니다

UNKNOWN은 최종 fallback만 사용한다.

==================================================
9. Korean typography tokens
==================================================

현재 design system에서 중앙 관리가 가능하다면 최소:

- font family
- font size
- font weight
- line-height
- letter-spacing
- word-break
- wrap behavior
- max-lines
- truncation
- numeric style

를 의미 있는 text role로 관리한다.

예:

display
hero
page-title
section-title
card-title
body
caption
button
badge
financial-value
financial-label
status
helper/error

현재 시스템 이름이 이미 있으면 기존 이름을 사용한다.

==================================================
10. COPY LINT / STATIC AUDIT
==================================================

현재 테스트/스크립트 구조를 해치지 않는 범위에서
한국어 copy audit를 추가하거나 기존 typography gate를 확장한다.

최소 탐지 후보:

- sentence ending punctuation immediately followed by Hangul/Latin without whitespace/newline
- obvious " 입니다"류 오류
- repeated accidental spaces
- suspicious adjacent JSX text nodes
- suspicious string concatenation
- member-facing raw technical vocabulary
- inappropriate break-all on Korean surfaces

하지만:

한국어 전체 문법을 regex로 자동교정하지 마라.

결정적인 오류:
STATIC CHECK

애매한 문법:
MANUAL / GPT REVIEW

실제 줄바꿈:
BROWSER VISUAL QA

로 나눈다.

==================================================
11. 실제 화면 QA
==================================================

현재 visual QA 흐름에 Korean typography를 포함한다.

최소 width:

320
360
390
430
834
1024
1440

현재 테스트 인프라와 mockup 기준에 맞게 조정 가능하다.

검사:

- mobile
- desktop
- Dark
- Light
- System where relevant
- reduced motion where relevant

그리고 가능한 범위에서:

100%
125%
150%
200%

텍스트 확대 시 핵심 흐름이 무너지지 않는지 확인한다.

==================================================
12. 실제로 확인할 화면
==================================================

최종적으로 최소:

- Login
- Signup
- Home
- START
- Mining
- Product list
- Product detail/runtime
- Wallet
- Deposit
- Withdrawal
- Events
- Notices
- Notifications
- More/Menu
- Member AI
- FAQ/Help
- Support
- Empty
- Loading
- Processing
- Error
- Session expired
- Admin

의 실제 한국어 rendering을 확인한다.

현재 $200 scope에서 아직 건드리지 않는 Admin 파일을
불필요하게 수정하지는 마라.

ownership 충돌이 있다면 report만 남겨라.

==================================================
13. 채굴화면에도 적용
==================================================

현재 새로 논의된 product-specific cinematic mining 화면에도
동일한 typography 기준을 적용한다.

예:

이번 세션 채굴액

₩18,420

실시간 계산 중 · 정산 전

현재 적용 배수

1.20×

정산 완료된 보상

처럼:

- 정보 계층이 명확하고
- 금액이 정갈하며
- 줄바꿈이 의도적이어야 한다.

Scene 이미지 안에 중요한 회원 문구를 baked text로 넣지 마라.

상품명/상태/금액/버튼은 real HTML이어야 한다.

==================================================
14. 현재 작업을 방해하지 않는 방식으로 진행
==================================================

중요:

- 현재 작업을 restart하지 마라.
- 현재 local commits를 버리지 마라.
- 현재 visual reconstruction을 중단하지 마라.
- 별도 경쟁 branch를 만들지 마라.
- 같은 화면을 완전히 다시 만드는 이유가 typography 하나뿐이면 먼저 최소 구조 변경으로 해결한다.

하지만:

현재 DOM/CSS 자체가 올바른 한글 조판을 불가능하게 한다면
presentation layer는 필요한 만큼 구조적으로 고쳐도 된다.

==================================================
15. 최종 checkpoint에 반드시 보고
==================================================

다음 checkpoint 보고에 아래 항목을 추가한다.

KOREAN TYPOGRAPHY STATUS:

COPY SOURCES AUDITED:
COPY SPACING ISSUES FOUND:
COPY SPACING ISSUES FIXED:

JSX CONCATENATION ISSUES:
FIXED:

MID-WORD WRAP ISSUES:
FIXED:

INTENTIONAL LINE BREAKS ADDED:
[important examples]

TYPOGRAPHY TOKENS:
[changed/reused]

KOREAN COPY LINT:
PASS / FAIL / NOT IMPLEMENTED

BROWSER TYPOGRAPHY QA:
[widths]

THEMES:
[Dark / Light / System]

FONT SCALE QA:
[coverage]

REMAINING TYPOGRAPHY BLOCKERS:
[...]

VISUAL DIFF RECHECK AFTER COPY FIX:
PASS / PARTIAL / BLOCKED

==================================================
16. 완료 기준
==================================================

아래 상태가 아니면 typography DONE이라고 하지 마라.

- 문장 사이 공백 오류 없음
- 명백한 한국어 띄어쓰기 오류 없음
- JSX 때문에 붙은 문장 없음
- 핵심 화면 어절 중간 깨짐 없음
- 제목 orphan 최소화
- 버튼/금액/단위 wrapping 정상
- 실제 screenshot 육안 확인
- mockup visual hierarchy 유지
- member-facing technical wording 감사 완료

최종 원칙:

KOREAN COPY MUST LOOK INTENTIONALLY TYPESET,
NOT MERELY RENDERED BY THE BROWSER.

CONTINUE THE CURRENT UI/UX TASK.
DO NOT RESTART.
APPLY THIS STANDARD NOW, WHILE THE SCREENS ARE BEING BUILT.