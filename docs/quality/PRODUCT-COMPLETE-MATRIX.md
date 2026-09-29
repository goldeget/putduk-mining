# Product Complete matrix

Status date: `2026-09-29`

기준 develop: `d3e5949eb86a7c82dcf8def33896f1b9a30d362c`

hydration evidence develop: `87e567244297e30de05ca674dcacbd3498caf696`

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

Authenticated product gates의 이전 39 passed는 출금·관리자 세션·상담 신원 시나리오다.
Home, Deposit, Events, Notifications, AI, Menu의 domain 완료 증거는 아니다.
Mining `/mining` 증거는 아래 행과 develop `a708965fe6ed99007f78f4ef7d0eef60d4dc21da` CI에 있다.

## Member

| Route | 판정 | 있는 증거 | 아직 OPEN |
| --- | --- | --- | --- |
| Home `/`, `/home` | PARTIAL | 공개 `/`와 회원 `/home` 타이포그래피 | 상태 매트릭스, Visual Lab, 성능, domain E2E |
| START `/start` | PARTIAL | 타이포그래피. 출금 여정이 START를 거쳐 감 | START 단독 상태·시각 수용 |
| Mining `/mining` | PARTIAL | 타이포그래피. develop `a708965fe6ed99007f78f4ef7d0eef60d4dc21da` CI [run 36518852696](https://github.com/goldeget/putduk-mining/actions/runs/36518852696) Authenticated 45 passed, hydration-mismatch 0: 비로그인 return path, 세션 없음, NORMAL, MAINTENANCE, 세션 여러 개, 월드 목록, 빈 목록 복구, 390/834/1440, light/dark/system, keyboard/focus, reduced motion, 가로 overflow, 스크린샷 | 세션 조회 실패 브라우저, 월드 조회 실패 브라우저, 라우트 오류 경계 브라우저, REDUCED/PARTIAL_STOP/STOPPED 개별 브라우저, 성능 수용 기준, Visual Lab 차이, PRODUCT COMPLETE |
| Wallet `/wallet` | PARTIAL | 타이포그래피 | 원장 읽기 상태, 빈 화면, 오류 |
| Deposit `/wallet/deposit` | PARTIAL | 타이포그래피. develop `f8770a34773f1a61165a8de067f229da8c0332c4` CI [run 36528111698](https://github.com/goldeget/putduk-mining/actions/runs/36528111698) Authenticated 52 passed, hydration-mismatch 0: 비로그인 return path, KRW 빈 화면·검증·요청·이력·멱등·오류 복구, KRW 상태 매트릭스, USDT 안내 없음, 네트워크와 입금 주소 결합, 서버 제출, 본인 이력, 다른 회원 격리, 390/834/1440, light/dark/system, keyboard/focus, reduced motion, 가로 overflow | 실제 은행 계좌 안내, USDT 반려 명령, 라우트 오류의 브라우저 fault, 조회 실패의 브라우저 fault, 성능 수용 기준, Visual Lab 390/834/light, PRODUCT COMPLETE |
| Withdrawal `/wallet/withdraw` | PARTIAL | 타이포그래피, 첫 KRW/USDT 브라우저, negative guard, hydration evidence CLOSED | 상태, Visual Lab, 성능 |
| Events `/events` | PARTIAL | 타이포그래피 | 게시·만료·빈 화면 |
| Notifications `/notifications` | PARTIAL | 타이포그래피 | 알림 동작, 빈 화면, 오류 |
| AI `/ai` | PARTIAL | 타이포그래피 | 대화 연속성, 도구 호출 브라우저 |
| Menu `/menu` | PARTIAL | 타이포그래피 | 계정·설정 상태 |
| Support `/support` | PARTIAL | 익명 fallback, 회원 해시, 신원 전환 테스트 | 타이포그래피, live 계정, 대시보드 FAQ |

Deposit `/wallet/deposit` 판정은 PARTIAL이다.
회원 입금 증거는 develop `f8770a34773f1a61165a8de067f229da8c0332c4`의 merge CI [run 36528111698](https://github.com/goldeget/putduk-mining/actions/runs/36528111698)이다.
Authenticated는 52 passed다.
그 잡 로그의 `hydration-mismatch`는 0이다.
Browser foundation은 40, Worker는 17, 공개 타이포그래피는 70, 보호 타이포그래피는 128이다.
Database security gates는 성공이다.
실제 은행 계좌 안내 원천은 없고, 성능 수용 기준도 없다.
USDT 확인용 1,000원은 로컬 화면 증거 값이며 운영 환율이 아니다.
관리자 입금 화면은 이 증거로 닫지 않는다.

Mining `/mining` 판정은 PARTIAL이다.
채굴 fixture는 로컬 데이터베이스 admin 연결만 쓰고, 운영 service_role 쓰기 권한은 넓히지 않았다.
관리자 회원 화면의 채굴 건수 SELECT는 `ADMIN_MEMBER_MINING_COUNT_READ`로 남긴다.

`/wallet/withdraw` hydration evidence는 CLOSED다.
분류는 제품 hydration 결함이 아니다.
Playwright screenshot의 기본 caret 숨김이 입력 칸에 `caret-color: transparent`를 넣는 계측 경쟁이었다.
증거는 develop `87e567244297e30de05ca674dcacbd3498caf696`의 merge CI [run 36490394913](https://github.com/goldeget/putduk-mining/actions/runs/36490394913)이다.
Authenticated는 41 passed다.
그 WebServer 로그의 `hydration-mismatch`는 0이다.
출금 route 자체는 PARTIAL이다.

## Admin

| Route | 판정 | 있는 증거 | 아직 OPEN |
| --- | --- | --- | --- |
| Today `/` | PARTIAL | 타이포그래피 | 오늘 운영 상태, 빈 큐, 오류 |
| Members `/members` | PARTIAL | 타이포그래피 | 조회·권한·빈 결과 |
| KYC `/kyc` | PARTIAL | 타이포그래피 | 심사 동작, 거절·승인 화면 |
| Deposits `/deposits/usdt` | PARTIAL | 타이포그래피 | 수동 입금 처리 브라우저, 상태. 회원 입금 증거로 닫지 않음. 화면은 `crypto_deposits`와 `deposit_requests`를 읽고 canonical `usdt_manual_deposits`가 아니다. FOLLOW_UP_REQUIRED |
| KRW withdrawals `/withdrawals/krw-bank` | PARTIAL | WS-06 브라우저 송금·원장 확정, 타이포그래피 | 나머지 상태, Visual Lab, 성능 |
| USDT withdrawals `/withdrawals/usdt` | PARTIAL | WS-06 브라우저 송금·원장 확정, 타이포그래피 | 나머지 상태, Visual Lab, 성능 |
| Exceptions `/exceptions` | PARTIAL | 타이포그래피 | 예외 처리 동작 |
| Restrictions `/restrictions` | PARTIAL | 타이포그래피 | 제한 동작 |

KRW 관리자 입금 route는 이 목록에 없다.
있는 관리자 입금 화면은 USDT다.

## 공통 OPEN

다음 순서로 다룬다. 한 번에 모든 화면을 고치지 않는다.

1. Mining
2. Deposit
3. Events
4. Notifications
5. AI
6. Menu
7. Admin Members
8. KYC
9. Admin Deposits
10. Exceptions
11. Restrictions
12. loading, error, recovery
13. keyboard, focus
14. reduced motion을 타이포그래피 밖으로
15. Visual Lab 비교
16. visual regression
17. performance acceptance

WS-06 출금 돈 경로는 다시 작성하지 않는다.
economy, catalog, rank 실값은 사람이 정한다.
remote Supabase, Cloudflare, DNS는 이 단계가 아니다.

## Verdict

PRODUCT COMPLETE: **NOT COMPLETE**

LAUNCH READY: **NOT LAUNCH READY**
