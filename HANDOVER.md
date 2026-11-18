# WORKROOM 인계문서 (2026-11-18)

## 프로젝트 정보
- **경로**: `f:\_putduk-audit`
- **DB**: awrubjiqkggaxcvtckbr (ap-southeast-2 Sydney)
- **웹사이트**: workroom.putduk.com (putduk-mining-web-staging)
- **어드민**: admin.workroom.putduk.com (putduk-mining-admin-staging)
- **Cloudflare 계정**: 9dc502d4ef06b3b5374591de6e6933ca
- **브랜치**: codex/workroom-monitoring-platform (PR #110)
- **F: 드라이브**: FAT32 포맷 (NTFS 아님 — 이것이 중요함)

## 배포 명령어
```cmd
cd /d f:\_putduk-audit && set CLOUDFLARE_ACCOUNT_ID=9dc502d4ef06b3b5374591de6e6933ca&& npx vinext-cloudflare deploy
```
어드민:
```cmd
cd /d f:\_putduk-audit\apps\admin && set CLOUDFLARE_ACCOUNT_ID=9dc502d4ef06b3b5374591de6e6933ca&& npx vinext-cloudflare deploy
```

---

## 완료된 작업

### 1. CSP 수정 (완료, 배포됨, 커밋됨)
- `lib/support/csp.ts`: script-src에 `https://static.cloudflareinsights.com` 추가
- `apps/admin/lib/content-security-policy.ts`: 동일 추가
- 커밋: CSP fix 커밋 (git push 완료)

### 2. Server Action → API Route 변환 (완료, 배포됨, 커밋됨)
vinext/Cloudflare Workers에서 Next.js Server Action이 런타임에 등록되지 않는 버그 (`UnrecognizedActionError`) 해결.

**변환된 폼들 (유저 사이트):**
| 폼 | API Route | 폼 컴포넌트 |
|----|-----------|------------|
| 로그인 | `app/api/auth/login/route.ts` | `app/login/auth-form.tsx` |
| 회원가입 | `app/api/auth/signup/route.ts` | `app/signup/signup-form.tsx` |
| 휴대전화 중복확인 | `app/api/auth/signup/phone-availability/route.ts` | signup-form.tsx 내 |
| 아이디 찾기 | `app/api/auth/find-id/route.ts` | `app/find-id/find-id-form.tsx` |
| 비밀번호 재설정 | `app/api/auth/recover/route.ts` | `app/recover/recovery-form.tsx` |
| 비밀번호 변경 | `app/api/auth/update-password/route.ts` | `app/auth/update-password/update-password-form.tsx` |

**변환된 폼 (어드민 사이트):**
| 폼 | API Route | 폼 컴포넌트 |
|----|-----------|------------|
| 관리자 로그인 | `apps/admin/app/api/auth/login/route.ts` | `apps/admin/components/login-form.tsx` |

**패턴:**
- `useActionState` → `useState` + `fetch('/api/auth/...')` + `router.push(redirectUrl)`
- `AuthSubmitButton` 컴포넌트에 `pending?: boolean` prop 추가 (`components/auth/auth-form-feedback.tsx`)
- Server Action 파일(actions.ts)은 타입 export용으로 유지
- 커밋: 8ea6a05 (git push 완료)

### 3. TypeScript 검증 (완료)
- `tsc --noEmit` 0 에러 확인
- 테스트 파일 3개 수정:
  - `tests/unit/ai-page-facts.test.ts`: `VerifiedIdentity` 타입 import 추가
  - `tests/unit/workroom-domains.test.ts`: `@/proxy` → `@/middleware` import 변경
  - `tests/unit/workroom-participation-route.test.ts`: non-null assertion (`!`) 추가

---

## 미완료 작업 (새 AI가 해야 할 일)

### 4. ERR_TOO_MANY_REDIRECTS 수정 (진행 중, 미배포)

**문제:** `workroom.putduk.com/workroom` 접속 시 307 리다이렉트가 `/workroom` → `/workroom` 으로 무한 루프 발생.

**근본 원인:**
1. vinext에서 `redirect()` (from `next/navigation`)가 Server Component에서 정상 동작하지 않음 — 지정된 URL이 아닌 **현재 페이지 URL**로 307 리다이렉트를 보냄
2. `proxy.ts` (Next.js middleware)가 vinext 빌드에 **포함되지 않음** — `updateSupabaseSession`, `canonicalWorkroomRedirect` 등이 서버 번들에 없음 (확인 완료)
3. `middleware.ts`로 이름을 바꿔도 빌드에 포함되지 않음 (확인 완료)
4. `(product)/layout.tsx`의 `requirePageUser()` → `redirect("/login?next=%2Fworkroom")` 호출이 `/workroom`으로 리다이렉트됨

**시도한 해결책 (코드는 작성됨, 미배포):**

#### 4-1. `lib/auth/session.ts` 수정 (완료)
- `requirePageUser()`가 `redirect()` 대신 `null` 반환하도록 변경
- 반환 타입: `Promise<VerifiedIdentity | null>`
- 새 함수 `requirePageUserOrRedirect()` 추가 — `AuthGateResult` 반환 (redirect URL 포함)

#### 4-2. `components/auth/client-redirect.tsx` 생성 (완료)
- 클라이언트 사이드 리다이렉트 컴포넌트
- `useRouter().replace(to)` 사용

#### 4-3. `app/(product)/layout.tsx` 수정 (완료)
- `requirePageUserOrRedirect()` 사용
- 인증 안 됨 → `<ClientRedirect to={gate.redirectUrl} />` 렌더링

#### 4-4. `components/workroom/workroom-page.tsx` 수정 (완료)
- `requirePageUserOrRedirect()` 사용

#### 4-5. 모든 (product) 페이지 컴포넌트에 null 체크 추가 (완료)
- 20개 페이지 파일에 `if (!identity) return null;` 추가
- 파일 목록:
  - `events/[slug]/page.tsx`, `events/notices/[slug]/page.tsx`, `events/page.tsx`
  - `home/page.tsx`, `notifications/page.tsx`
  - `menu/account/page.tsx`, `menu/ai/page.tsx`, `menu/notifications/page.tsx`, `menu/page.tsx`
  - `wallet/deposit/page.tsx`, `wallet/withdraw/page.tsx`, `wallet/page.tsx`
  - `workroom/cash/deposit/page.tsx`, `workroom/cash/page.tsx`, `workroom/cash/withdraw/page.tsx`
  - `workroom/history/page.tsx`, `workroom/records/legacy/page.tsx`, `workroom/records/page.tsx`
  - `workroom/records/withdraw/page.tsx`, `workroom/support/page.tsx`

#### 4-6. `proxy.ts` → `middleware.ts` 변경 (완료, 하지만 vinext가 미들웨어를 빌드에 포함하지 않음)
- `proxy.ts` 삭제, `middleware.ts` 생성
- vinext 경고: "The 'middleware' file convention is deprecated. Please use 'proxy' instead."
- **둘 다 작동하지 않음** — vinext가 proxy/middleware 코드를 서버 번들에 포함시키지 않음

### 5. 빌드 블로커: `.next/types` 디렉토리 삭제 불가 (해결 필요)

**문제:** `f:\_putduk-audit\.next\types` 디렉토리가 "Access Denied"로 삭제 불가.

**원인:** F: 드라이브가 FAT32 포맷. 어떤 프로세스가 디렉토리 핸들을 잡고 있거나, FAT32의 권한 문제. `icacls`, `takeown`, `attrib`, `rmdir`, PowerShell `[System.IO.Directory]::Delete` 모두 실패.

**해결 방법 (우선순위순):**
1. **컴퓨터 재부팅** 후 `rmdir /s /q .next` 실행 — 가장 확실함
2. **F: 드라이브를 NTFS로 포맷** (`convert f: /fs:ntfs` — 데이터 손실 없음, 하지만 위험)
3. **프로젝트를 C: 드라이브로 복사**해서 빌드
4. vinext가 `distDir` 설정을 무시하고 `.next`를 강제 사용함 — `PUTDUK_NEXT_DIST_DIR` 환경변수를 무시함

**재부팅 후 해야 할 일:**
```cmd
cd /d f:\_putduk-audit
rmdir /s /q .next
rmdir /s /q .cloudflare\output
set CLOUDFLARE_ACCOUNT_ID=9dc502d4ef06b3b5374591de6e6933ca
npx vinext-cloudflare deploy
```

### 6. git 커밋/푸시 (미완료)
위 4번 작업(redirect loop fix)이 코드는 완료되었지만 빌드 블로커 때문에 배포하지 못함. git 커밋도 아직 안 함.

재부팅 후 빌드 성공하면:
```cmd
cd /d f:\_putduk-audit
git add -A
git commit -m "fix(redirect): vinext redirect() 버그 회피 - 클라이언트 사이드 리다이렉트"
git push origin codex/workroom-monitoring-platform
```

---

## 어드민 사이트 미완료
- 어드민 로그인은 API Route로 변환 완료 (배포됨)
- 하지만 어드민 내부 폼 5개가 여전히 `useActionState` 사용:
  - exceptions, KYC, safe-mode, withdrawals 관련 폼들
  - `apps/admin` 디렉토리 내 `useActionState` 검색하면 9개 매치 발견
  - 이들도 동일한 Server Action 버그가 발생할 수 있음

---

## 핵심 파일 목록 (수정됨, 미배포)
```
lib/auth/session.ts                          — requirePageUser() null 반환, requirePageUserOrRedirect() 추가
components/auth/client-redirect.tsx          — 신규, 클라이언트 리다이렉트
app/(product)/layout.tsx                     — requirePageUserOrRedirect() 사용
components/workroom/workroom-page.tsx        — requirePageUserOrRedirect() 사용
middleware.ts                                — 신규 (proxy.ts 대체, 하지만 vinext가 인식 못함)
lib/supabase/proxy.ts                        — 디버그 헤더 추가 (X-Auth-Redirect 등)
scripts/resolve-next-dist-dir.mjs            — .vinext-output 디렉토리 패턴 허용
app/(product)/**/page.tsx (20개)             — if (!identity) return null; 추가
tests/unit/ai-page-facts.test.ts             — VerifiedIdentity import
tests/unit/workroom-domains.test.ts          — @/middleware import
tests/unit/workroom-participation-route.test.ts — non-null assertion
```

## 핵심 파일 목록 (수정됨, 배포됨)
```
lib/support/csp.ts                           — cloudflareinsights.com 추가
apps/admin/lib/content-security-policy.ts    — 동일
app/api/auth/login/route.ts                  — 신규, 로그인 API
app/api/auth/signup/route.ts                 — 신규, 회원가입 API
app/api/auth/signup/phone-availability/route.ts — 신규
app/api/auth/find-id/route.ts                — 신규, 아이디 찾기 API
app/api/auth/recover/route.ts                — 신규, 비밀번호 재설정 API
app/api/auth/update-password/route.ts        — 신규, 비밀번호 변경 API
app/login/auth-form.tsx                      — fetch 기반으로 변경
app/signup/signup-form.tsx                   — fetch 기반으로 변경
app/find-id/find-id-form.tsx                 — fetch 기반으로 변경
app/recover/recovery-form.tsx                — fetch 기반으로 변경
app/auth/update-password/update-password-form.tsx — fetch 기반으로 변경
components/auth/auth-form-feedback.tsx       — pending prop 추가
apps/admin/app/api/auth/login/route.ts       — 신규, 관리자 로그인 API
apps/admin/components/login-form.tsx         — fetch 기반으로 변경
```

---

## 요약: 새 AI가 가장 먼저 해야 할 일
1. **컴퓨터 재부팅** (또는 F: 드라이브의 `.next` 디렉토리 강제 삭제)
2. `rmdir /s /q .next` 실행
3. `npx vinext-cloudflare deploy` 배포
4. `https://workroom.putduk.com/workroom` 접속 테스트 — `/login?next=%2Fworkroom`으로 리다이렉트되어야 함
5. git 커밋 & 푸시
6. 어드민 내부 폼 5개 Server Action → API Route 변환 (필요시)
