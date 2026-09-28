# Product Complete matrix

Status date: `2026-09-28`

기준 develop: `d3e5949eb86a7c82dcf8def33896f1b9a30d362c`

이 문서는 출시 판정이 아니다.
`PRODUCT COMPLETE`인 route는 없다.
`LAUNCH READY`가 아니다.

증거는 이 SHA의 develop merge CI [run 36396160426](https://github.com/goldeget/putduk-mining/actions/runs/36396160426) attempt 2와 그 안에 들어 있는 테스트 파일이다.
없는 상태는 `OPEN`이다.

## 이미 있는 증거

타이포그래피 게이트:

- 폭 390, 834, 1440
- light, dark
- reduced motion
- 한글 토큰이 음절로 쪼개지지 않음
- 가로 overflow 없음
- 그 스위트의 console hydration annotation 0

이 증거는 아래 route의 타이포그래피만 덮는다.
system theme, loading, skeleton, empty, validation, error, recovery, success, disabled, unauthorized, focus, keyboard, Visual Lab, visual regression, performance는 이 게이트로 닫히지 않는다.

Authenticated product gates 39 passed는 출금·관리자 세션·상담 신원 시나리오다.
Home, Mining, Deposit, Events, Notifications, AI, Menu의 domain 완료 증거가 아니다.

## Member

| Route | 판정 | 있는 증거 | 아직 OPEN |
| --- | --- | --- | --- |
| Home `/`, `/home` | PARTIAL | 공개 `/`와 회원 `/home` 타이포그래피 | 상태 매트릭스, Visual Lab, 성능, domain E2E |
| START `/start` | PARTIAL | 타이포그래피. 출금 여정이 START를 거쳐 감 | START 단독 상태·시각 수용 |
| Mining `/mining` | PARTIAL | 타이포그래피 | 채굴 동작, 상태, Visual Lab, 성능 |
| Wallet `/wallet` | PARTIAL | 타이포그래피 | 원장 읽기 상태, 빈 화면, 오류 |
| Deposit `/wallet/deposit` | PARTIAL | 타이포그래피 | 수동 입금 브라우저 여정, 상태 |
| Withdrawal `/wallet/withdraw` | PARTIAL | 타이포그래피, 첫 KRW/USDT 브라우저, negative guard | hydration 경고, 상태, Visual Lab, 성능 |
| Events `/events` | PARTIAL | 타이포그래피 | 게시·만료·빈 화면 |
| Notifications `/notifications` | PARTIAL | 타이포그래피 | 알림 동작, 빈 화면, 오류 |
| AI `/ai` | PARTIAL | 타이포그래피 | 대화 연속성, 도구 호출 브라우저 |
| Menu `/menu` | PARTIAL | 타이포그래피 | 계정·설정 상태 |
| Support `/support` | PARTIAL | 익명 fallback, 회원 해시, 신원 전환 테스트 | 타이포그래피, live 계정, 대시보드 FAQ |

`/wallet/withdraw` hydration은 Channel Talk 이전 develop CI에도 있었다.
분류는 `PRE-EXISTING PRODUCT COMPLETE DEBT`다.
수정은 이 문서의 SHA에 포함되지 않는다.

## Admin

| Route | 판정 | 있는 증거 | 아직 OPEN |
| --- | --- | --- | --- |
| Today `/` | PARTIAL | 타이포그래피 | 오늘 운영 상태, 빈 큐, 오류 |
| Members `/members` | PARTIAL | 타이포그래피 | 조회·권한·빈 결과 |
| KYC `/kyc` | PARTIAL | 타이포그래피 | 심사 동작, 거절·승인 화면 |
| Deposits `/deposits/usdt` | PARTIAL | 타이포그래피 | 수동 입금 처리 브라우저, 상태 |
| KRW withdrawals `/withdrawals/krw-bank` | PARTIAL | WS-06 브라우저 송금·원장 확정, 타이포그래피 | 나머지 상태, Visual Lab, 성능 |
| USDT withdrawals `/withdrawals/usdt` | PARTIAL | WS-06 브라우저 송금·원장 확정, 타이포그래피 | 나머지 상태, Visual Lab, 성능 |
| Exceptions `/exceptions` | PARTIAL | 타이포그래피 | 예외 처리 동작 |
| Restrictions `/restrictions` | PARTIAL | 타이포그래피 | 제한 동작 |

KRW 관리자 입금 route는 이 목록에 없다.
있는 관리자 입금 화면은 USDT다.

## 공통 OPEN

다음 순서로 다룬다. 한 번에 모든 화면을 고치지 않는다.

1. `/wallet/withdraw` hydration
2. Mining
3. Deposit
4. Events
5. Notifications
6. AI
7. Menu
8. Admin Members
9. KYC
10. Admin Deposits
11. Exceptions
12. Restrictions
13. loading, error, recovery
14. keyboard, focus
15. reduced motion을 타이포그래피 밖으로
16. Visual Lab 비교
17. visual regression
18. performance acceptance

WS-06 출금 돈 경로는 다시 작성하지 않는다.
economy, catalog, rank 실값은 사람이 정한다.
remote Supabase, Cloudflare, DNS는 이 단계가 아니다.

## Verdict

PRODUCT COMPLETE: **NOT COMPLETE**

LAUNCH READY: **NOT LAUNCH READY**
