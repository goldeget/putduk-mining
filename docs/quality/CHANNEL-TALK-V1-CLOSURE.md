# Channel Talk V1 closure

Status: `CHANNEL TALK CODE V1` **CLOSED**

이 문서는 develop merge SHA의 CI 결과만 근거로 한다.
실제 Channel Talk 계정 credential은 연결하지 않았다.
`PRODUCT COMPLETE`가 아니고 `NOT LAUNCH READY`다.

## Identity

| 항목 | 값 |
| --- | --- |
| PR | [#11](https://github.com/goldeget/putduk-mining/pull/11) `feat(support): Channel Talk 상담 경계와 회원 해시를 추가한다` |
| base | `develop` `cd9fa3aa1bedf1e31bfbe72bfc0630438f11667d` |
| PR head SHA | `84f45399d047c472a842e31876c8730881f68d9f` |
| merge SHA | `d3e5949eb86a7c82dcf8def33896f1b9a30d362c` |
| develop HEAD | `d3e5949eb86a7c82dcf8def33896f1b9a30d362c` |
| merge parents | `cd9fa3aa1bedf1e31bfbe72bfc0630438f11667d` + `84f45399d047c472a842e31876c8730881f68d9f` |
| merged_at | `2026-09-28T08:14:13Z` |
| PR state | `MERGED` |
| PR branch CI | [run 36393090079](https://github.com/goldeget/putduk-mining/actions/runs/36393090079) on `84f45399d047c472a842e31876c8730881f68d9f` |
| develop merge CI | [run 36396160426](https://github.com/goldeget/putduk-mining/actions/runs/36396160426) attempt 2 on `d3e5949eb86a7c82dcf8def33896f1b9a30d362c` |
| main | `fbea85eebf1084bfc02bf1c452392b20f2f497ce` (변경 없음) |

PR head `84f45399d047c472a842e31876c8730881f68d9f`는 merge commit의 두 번째 부모이며 develop history에 포함된다.

develop merge CI attempt 1의 Authenticated product gates는 테스트 실패가 아니다.
`pnpm db:reset` 중 Docker Hub `toomanyrequests: Rate exceeded` 이후 container `exit 1`로 끝났다.
같은 SHA의 Database security gates와 Worker runtime gates는 migration rebuild에 성공했다.
실패한 job만 attempt 2로 다시 실행했고, 그 결과가 아래 숫자다.

## Architecture

- Channel Talk = Communication
- PUTDUK Admin = Operation
- Ledger = Authoritative Money Truth

Channel Talk에서 ledger, balance, 출금 승인, 외부 송금을 직접 바꾸지 않는다.
돈 문의는 상담 기록으로 끝내지 않고 PUTDUK Admin의 기존 domain command로 넘긴다.

## Code CLOSED

SDK: `@channel.io/channel-web-sdk-loader` `2.0.2`. 공개/회원 앱에만 있고 `apps/admin` 번들에는 없다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| anonymous boot | CLOSED | plugin key만으로 boot. memberId와 memberHash를 함께 넣지 않음 |
| authenticated member boot | CLOSED | 로그인 세션에서만 member boot |
| stable memberId | CLOSED | auth UUID. email/phone을 memberId로 쓰지 않음 |
| Member Hash | CLOSED | 서버에서 hex secret을 디코드한 뒤 HMAC-SHA256. 공식 PHP `pack("H*")` 예와 같은 방식 |
| server-only secret | CLOSED | `CHANNEL_TALK_MEMBER_HASH_SECRET`. `NEXT_PUBLIC` 아님 |
| `/support` | CLOSED | FAQ, 보안 안내, 돈 문의 경계. SDK가 없어도 화면은 남음 |
| SPA tracking | CLOSED | `trackDefaultEvent: false`. pathname이 바뀔 때만 `setPage` 후 `PageView` |
| sensitive URL redaction | CLOSED | token, secret, password, otp, session 등 path segment를 `:redacted`로 바꿈 |
| identity transition | CLOSED | 회원 A → logout → 회원 B에서 shutdown 후 reboot. 브라우저 테스트가 격리 확인 |
| mobile launcher | CLOSED | `hideChannelButtonOnBoot`와 `customLauncherSelector`. 하단 메뉴와 겹침 테스트 |
| light/dark | CLOSED | boot `appearance`와 `setAppearance` |
| CSP | PARTIAL | 공개 앱에만 Channel Talk 호스트를 추가함. 2026-09-28 공식 CSP 페이지에는 `wss://*.desk-ws.channel.io`가 없음. 구현 allowlist에는 있음. `img-src`의 `blob:`와 `script-src`의 `'unsafe-inline'`은 공개 앱 CSP 헤더에 있음 |
| failure-safe | CLOSED | SDK를 불러오지 못해도 상담 화면과 앱 핵심 경로는 남음 |
| privacy allowlist | CLOSED | opaque memberId, 선택 display name, language, 가입일. 잔액, 계좌, USDT 주소, tx, 출금 금액, KYC 원문, 비밀번호, OTP, 토큰은 프로필에 넣지 않음 |
| admin bundle isolation | CLOSED | admin 소스와 CSP에 Channel Talk SDK를 넣지 않음 |
| browser tests | CLOSED | 익명 fallback, 회원 해시, 신원 전환 |
| production builds | CLOSED | develop merge CI Application gates의 production build 성공 |

Member Hash secret은 소스, 테스트 fixture 값, 이 문서에 실제 계정 secret으로 기록하지 않는다.
E2E plugin key `putduk-e2e-plugin-key`는 로컬 테스트 식별자이며 운영 키가 아니다.

## Evidence Counts

develop merge CI run `36396160426`, SHA `d3e5949eb86a7c82dcf8def33896f1b9a30d362c`, attempt 2. 8 jobs 모두 `success`.

| Gate | 결과 |
| --- | --- |
| Application gates | success |
| Database security gates | success. `All tests successful.` |
| Browser foundation | success. **40 passed** |
| WebServer lifecycle probe | success |
| Authenticated product gates | success. **39 passed** (attempt 2) |
| Worker runtime gates | success. **17 passed** (1 file) |
| Korean typography public gates | success. **70 passed**, screenshots 70, hydration 0, unexpected 0 |
| Korean typography protected gates | success. **128 passed**, screenshots 126, hydration 0, unexpected 0 |

PR branch CI run `36393090079`도 같은 8 jobs가 `success`였다. closure 숫자는 develop merge SHA 기준이다.
Authenticated 39는 PR head CI와 같고, Channel Talk 이전 develop CI 37보다 줄지 않았다.

## Hydration

분류: `PRE-EXISTING PRODUCT COMPLETE DEBT`

Authenticated WebServer 로그의 React `hydration-mismatch`는 `/wallet/withdraw` 응답 직후에만 나온다.
컴포넌트 후보는 `WithdrawalPage` (`app/(product)/wallet/withdraw/page.tsx`)다.
CI 로그는 “some attributes”가 다르다는 일반 문구만 남기고, 실제 attribute 이름과 DOM diff는 찍지 않는다.
테스트는 통과하므로 이번 게이트의 functional failure는 없다.

| 기록 | run | SHA | `/wallet/withdraw` 직후 warning |
| --- | --- | --- | --- |
| Channel Talk 이전 develop | `36389614755` | `cd9fa3aa1bedf1e31bfbe72bfc0630438f11667d` | 4 |
| PR #11 | `36393090079` | `84f45399d047c472a842e31876c8730881f68d9f` | 3 |
| develop merge attempt 2 | `36396160426` | `d3e5949eb86a7c82dcf8def33896f1b9a30d362c` | 5 |

발생 횟수는 출금 화면을 여는 테스트 수에 따라 달라진다.
`/support`나 Channel Talk boot 로그 옆에서는 나오지 않았다.
타이포그래피 게이트 hydration 0은 그 스위트의 console annotation이며, Authenticated 로그의 이 경고를 지운 증거가 아니다.
이번 closure commit에서 출금 화면 hydration을 고치지 않는다.

## NOT YET LIVE

CHANNEL TALK LIVE ACCOUNT: **USER_ACTION_REQUIRED**

이 세션에서 확인한 사실:

- 프로세스 환경과 `.env`, `.env.local`, `apps/admin/.env.local`에 plugin key와 Member Hash secret이 없다.
- 값을 만들지 않았고 Git에 넣지 않았다.
- live smoke, 대시보드 FAQ, Workflow, Tag, Macro, 부재 안내, 운영시간은 하지 않았다.
- 유료 plan 결제나 채널 삭제는 하지 않았다.

공식 문서 (2026-09-28, `developers.channel.io` / `docs.channel.io`):

- plugin key: 채널 설정 > 일반 설정 > 버튼 설치 및 설정 > 채널톡 버튼 설치
- Member Hash secret: 채널 설정 > 보안 및 개발 > 보안 > 고객 정보 암호화. 조회하기 또는 신규 발급하기
- member boot는 `memberId`와 `memberHash`를 함께 보낸다. 익명 boot는 둘 다 보내지 않는다.
- SPA는 URL 변경 시 `setPage` 다음 `PageView`다.

live 연결 전에 CSP의 `wss://*.desk-ws.channel.io`를 현재 공식 목록과 맞춘다.
그 전에는 production 값을 넣지 않는다.

환경 계약:

- `NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY`는 public plugin key
- `CHANNEL_TALK_MEMBER_HASH_SECRET`은 서버 전용. `NEXT_PUBLIC`로 옮기지 않는다
- `.env.example`은 빈 placeholder만 둔다

## Overall

CHANNEL TALK CODE V1: **CLOSED**

CHANNEL TALK LIVE ACCOUNT: **USER_ACTION_REQUIRED**

CSP 공식 목록 일치: **PARTIAL**

PRODUCT COMPLETE: 아님

LAUNCH READY: 아님

WS-06 PRODUCTION MONEY OPERATIONS P0는 이 문서의 범위 밖이며 기존 closure 기준으로 CLOSED다.
main은 변경하지 않았다.
remote Supabase, Cloudflare, DNS는 변경하지 않았다.
