# WS-06 closure

Status: `WS-06 PRODUCTION MONEY OPERATIONS P0` **CLOSED**

이 문서는 develop merge SHA의 CI 결과만 근거로 한다.
`PRODUCT COMPLETE`가 아니고 `NOT LAUNCH READY`다.

## Identity

| 항목 | 값 |
| --- | --- |
| PR | [#9](https://github.com/goldeget/putduk-mining/pull/9) `fix(ws06): 관리자 출금 브라우저와 lease 연장을 닫는다` |
| base | `develop` |
| PR head SHA | `10d47a914ba8394304897b149a519b9349926872` |
| merge SHA | `b3be4593b7720dc779a0bd315256720bbbd3aea6` |
| final develop SHA | `b3be4593b7720dc779a0bd315256720bbbd3aea6` |
| merge parents | `ef5e5c322a83febad460a4a17bbffaa7c3bf50c2` + `10d47a914ba8394304897b149a519b9349926872` |
| merged_at | `2026-09-28T06:08:27Z` |
| PR branch CI | [run 36382613658](https://github.com/goldeget/putduk-mining/actions/runs/36382613658) on `10d47a914ba8394304897b149a519b9349926872` |
| develop merge CI | [run 36384987826](https://github.com/goldeget/putduk-mining/actions/runs/36384987826) on `b3be4593b7720dc779a0bd315256720bbbd3aea6` |
| main | `fbea85eebf1084bfc02bf1c452392b20f2f497ce` (변경 없음) |

PR head `10d47a914ba8394304897b149a519b9349926872`는 merge commit의 두 번째 부모이며 develop history에 포함된다.

## CLOSED

- KRW admin browser withdrawal
- USDT admin browser withdrawal
- WITHDRAWAL_OPERATOR step-up
- operator binding
- admin-session binding
- wrong-family rejection
- expiry
- single-use
- replay rejection
- mismatch rejection does not consume the token
- external send exactly-once
- no re-send after `EXTERNAL_SENT_RECORDED`
- finalize retry safety
- reject/cancel reopen blocked after external send
- long-handler periodic worker lease
- competing worker claim prevention
- lease timer cleanup
- process handle leak regression protection

세션 바인딩 migration: `supabase/migrations/20260928051514_ws06_bind_step_up_admin_session.sql`

소비 시그니처:

`consume_admin_step_up(p_user_id uuid, p_token text, p_command_family text, p_request_id uuid, p_admin_session_id uuid)`

기존 4-argument public/private consume 함수는 이 migration에서 제거된다.

## Evidence Counts

develop merge CI run `36384987826`, SHA `b3be4593b7720dc779a0bd315256720bbbd3aea6`. 8 jobs 모두 `success`.

| Gate | 결과 |
| --- | --- |
| Application gates | success |
| Database security gates | success. `All tests successful.` |
| Browser foundation | success |
| WebServer lifecycle probe | success |
| Authenticated product gates | success. **37 passed** |
| Worker runtime gates | success. **17 passed** (1 file) |
| Korean typography public gates | success. **70 passed**, screenshots 70, hydration 0, unexpected 0 |
| Korean typography protected gates | success. **128 passed**, screenshots 126, hydration 0, unexpected 0 |

PR branch CI run `36382613658`도 같은 8 jobs가 `success`였다. closure 숫자는 develop merge SHA 기준이다.

## Remaining

다음은 WS-06 money P0와 별개로 남아 있다.

- Product Complete matrix
- Channel Talk Support V1
- Mining, Deposit, Events, Notifications, AI, Menu
- Admin Members, KYC, Deposits, Exceptions, Restrictions
- loading/empty/error/recovery/success/disabled
- focus/keyboard, reduced motion
- Visual Lab comparison, visual regression, performance
- economy/catalog/rank human decisions
- remote Supabase
- Cloudflare
- DNS
- PITR
- rollback
- monitoring
- immutable deployment artifact
- production-like authenticated E2E
- production smoke

## Verdict

WS-06 PRODUCTION MONEY OPERATIONS P0: **CLOSED**

Overall:

- PRODUCT COMPLETE: 아님
- LAUNCH READY: 아님
