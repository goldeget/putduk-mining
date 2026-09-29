# Support `/support` route product evidence

Status: route product evidence **PARTIAL CLOSED** without live Channel Talk credentials.

이 문서는 Channel Talk CODE V1 / CSP CLOSED를 다시 쓰지 않는다.
`PRODUCT COMPLETE`가 아니고 `NOT LAUNCH READY`다.

## Identity

| 항목 | 값 |
| --- | --- |
| branch | `parallel/support-product` |
| base | `82de2c83ffa59d94b9782cb83162f83fcba42d46` |
| ownership | `app/support/**`, support-specific tests, support runtime UX |
| Channel Talk CODE V1 | CLOSED — 재작성 없음 |
| Channel Talk CSP | CLOSED — 약화/재작성 없음 |

## Closed without live credentials

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| unauthenticated `/support` | CLOSED | FAQ·보안 안내·로그인 링크가 credential 없이 유지 |
| unavailable recovery copy | CLOSED | plugin key 없을 때 `지금은 아래 안내를 먼저 확인해 주세요.` |
| loading / ready UI state | CLOSED | plugin key 있으면 `loading` → `ready`. live 계정 불필요(mock port) |
| Korean copy gate | CLOSED | 짧은 한국어, 금지 문구 없음 |
| responsive 390/834/1440 | CLOSED | `tests/e2e/support.spec.ts` |
| light / dark / system | CLOSED | 공개·회원 브라우저 |
| keyboard / focus | CLOSED | 상담 시작·로그인 focus, Enter로 안내 이동 |
| hydration | CLOSED | `/support` console hydration 0 (공개·회원 케이스) |
| public typography `/support` | CLOSED | `tests/typography/korean-line-break.spec.ts`에 route 추가 |
| protected typography `/support` | CLOSED | `tests/typography/protected-user-korean-line-break.spec.ts`에 route 추가 |
| identity isolation | CLOSED | 기존 `support-channel-talk.spec.ts` (재작성 없음, ready 케이스만 추가) |

## Still open / external

| 항목 | 상태 |
| --- | --- |
| CHANNEL TALK LIVE ACCOUNT | **USER_ACTION_REQUIRED** |
| CHANNEL TALK DASHBOARD SETTINGS (FAQ/Workflow/Tag/Macro/부재/운영시간) | follow-up — invent 금지 |
| Visual Lab 차이 수용 | OPEN |
| performance acceptance | OPEN |
| PRODUCT COMPLETE | 선언하지 않음 |

## SHARED_FILE_REQUEST

제품 완료 행렬 갱신은 공유 파일이라 이 레인에서 수정하지 않았다.

- `docs/quality/PRODUCT-COMPLETE-MATRIX.md` — Support 행의 있는 증거/OPEN 갱신 요청
- `docs/quality/RELEASE-READINESS-MATRIX.md` — 해당 시 갱신 요청

CSS는 `app/globals.css`를 건드리지 않고 `components/support/support-runtime.module.css`만 사용했다.

## Money / GRANT / RLS / outbox

변경 없음. migration 없음. remote Supabase 없음.

## Local focused evidence (this lane)

| Gate | 결과 |
| --- | --- |
| `playwright.support-product.config.ts` (port 3424) | **3 passed** — anonymous unavailable, viewport/theme/keyboard/recovery, admin alias 404 |
| `vitest tests/unit/channel-talk.test.ts` | **16 passed** (slow FS에서 CLI `--testTimeout=60000`) |
| Authenticated `support-channel-talk` ready case | 코드 추가. 로컬 DB 없이 이 레인에서 실행하지 않음 → CI |
| Typography `/support` public + protected | route 등록. 전체 typography suite는 CI |
| Visual Lab / performance | OPEN |
| CHANNEL TALK LIVE ACCOUNT | USER_ACTION_REQUIRED |

PRODUCT COMPLETE: 선언하지 않음
LAUNCH READY: 아님
