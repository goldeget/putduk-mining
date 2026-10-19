# 기존 QA Worker 자동 배포

이 파이프라인은 `goldeget/putduk-mining`의 검증된 소스 커밋을 기존 QA Worker 두 개에 배포한다. 운영 배포, DB 변경, 신규 리소스 생성, Access 정책 변경은 포함하지 않는다. 로컬 구현과 단위 테스트 통과는 실제 GitHub 실행 또는 배포 성공 증거가 아니다.

| 고정 대상 | 값 |
| --- | --- |
| Cloudflare 계정 | `9dc502d4ef06b3b5374591de6e6933ca` |
| 회원 QA | `https://putduk-mining-member-staging-ab1de38.putduk-landing.workers.dev` |
| 관리자 QA | `https://putduk-mining-admin-staging-ab1de38.putduk-landing.workers.dev` |
| Supabase preview | `mhchzipznxbwbocdihlg` |
| 허용 push | `codex/qa-handoff-diagnostics-20261019`, `develop` |
| 도구 | Node `24.21.0`, pnpm `12.6.0`, cf `1.0.0-beta.18`, vinext `1.2.0` |

기존 `cloudflare.config.ts`의 **qa 이외 모드**는 기존 `putduk-mining-web-staging` / `putduk-mining-admin-staging` 이름을 유지한다. 이 대상들은 격리 QA가 아니며 이 workflow로 배포하지 않는다. `deploy:vinext`를 이 파이프라인 대신 실행하면 안 된다.

## 실행과 CI 관계

`.github/workflows/qa-cloudflare-deploy.yml`은 위 두 branch의 push에서 실행한다. 수동 실행도 같은 branch allowlist를 적용하며 기본 branch에 workflow가 등록되지 않은 동안 GitHub 수동 실행 기능을 사용할 수 없을 수 있다. PR/fork 이벤트로 비밀값을 전달하지 않는다.

1. `CI`의 `.github/workflows/ci.yml` 실행을 최대 25분 기다린다. 기존 CI 설정은 바꾸지 않는다. Feature branch는 같은 저장소의 `develop` 대상 PR이 있어야 기존 CI가 시작된다. PR을 아직 만들지 않았다면 배포 대기는 실패하며, PR CI가 끝난 후 같은 SHA의 QA 실행을 다시 실행할 수 있다.
2. 정확한 source SHA, repository, branch, 최신 run/attempt, 현재 10개 quality job과 budget job, 필수 6개 artifact의 ID/digest/생성 시각, 전체 1,200초 이내 완료를 확인한다. Artifact에는 현재 attempt의 `backend-successor201-RUN-ATTEMPT`가 포함된다. PR은 현재 develop base가 candidate의 조상이어야 한다. 이에 따라 PR merge checkout이 source candidate와 다른 내용을 포함하는 경우를 차단한다. 변경된 base나 partial rerun artifact로 통과시키지 않는다.
3. Frozen lockfile로 설치하고 각 앱을 `vite build --mode qa`로 한 번씩 빌드한다. 계정·Worker·preview DB·app URL·binding·trigger·mode와 파일 hash를 검사한 뒤 `cf deploy --prebuilt --mode qa --dry-run --no-provision`으로 검증한다. 이 단계에는 배포/Access/server 자격 증명을 전달하지 않는다.
4. 같은 output을 immutable GitHub artifact로 보존한다. 배포 단계는 artifact ID/digest와 로컬 파일 hash를 연결한다. 배포 시 재빌드하지 않는다.
5. 배포 자격 증명이 모두 있어야 원격 검증을 시작한다. 정확한 Worker ID/이름, 기존 secret binding, preview 공개 설정, Access의 machine-only service-token 정책, 공개 override 부재, preview URL 비활성, 연결 리소스·cron과 직전 deployment/version을 읽는다. 지정 `putduk.com` zone `c9e6c93451c3c2e107a1eca511bedaba`의 소유 계정 확인 후 `/zones/ZONE_ID/workers/routes`를 읽어 QA Worker를 가리키는 공개 route가 없어야 한다. 이 API는 현재 비페이지 endpoint이며, 응답에 pagination 정보가 추가되면 완결된 첫 페이지임을 모두 확인한다. 불완전 목록·권한 거절은 중단한다. zone 검색·route 변경은 하지 않는다. route hash/count는 최초, 매 배포 직전, 배포 직후 receipt에 포함한다.
6. preview 공개 키는 해당 preview의 `/auth/v1/settings`, 전용 서버 키는 `/rest/v1/`의 읽기 응답으로 확인한다. 응답 본문, 서버 키, 쿠키를 기록하지 않는다. 서버 키는 빌드 환경에 들어가지 않고 임시 파일의 `--secrets-file`로 기존 `SUPABASE_SECRET_KEY` binding에 전달된다. 설치된 cf의 `keepSecrets: true` 동작으로 기존 다른 secret을 보존하며, 전후 secret 이름 목록이 같아야 한다. 허용된 기존 secret은 `SUPABASE_SECRET_KEY`, 선택적 `WITHDRAWAL_DATA_KEY`뿐이다.
7. 두 Worker를 한 concurrency group에서 차례로 배포한다. 취소로 중간 상태를 만들지 않도록 `cancel-in-progress: false`다. 매 배포 직전 branch SHA, CI, build hash, 원격 상태를 다시 확인한다. 외부 수동 배포까지 GitHub concurrency로 잠글 수는 없으므로 상태가 바뀌면 중단한다.
8. **어느 Worker도 변경하기 전에 두 역할 모두** 익명 로그인·asset 접근 거절과 기존 Access credential로 최대 64 KiB의 32×32 PNG를 읽는 검증을 통과해야 한다. 기존 이미지가 후보와 동일하다는 가정은 하지 않으며 PNG content 검증만 수행한다. 유효하지 않은 비어 있지 않은 token도 403이면 배포 callback에 도달하지 않는다. 배포 후에는 새 version의 SHA tag, Access 유지, 실제 로그인 화면, 후보 PNG byte hash와 브라우저 decode, 앱 세션이 없을 때의 로그인 이동을 검사한다. 이 smoke는 사용자 인증·지급·AI·DB 쓰기 테스트가 아니다.

기존 상태와 배포 후 상태는 다르게 검증한다. 기존의 `WORKER_SELF_REFERENCE`는 정확한 자기 QA Worker와 `environment=production`인 경우에만 배포 전 허용한다. Worker API의 `references.workers`도 정확한 자기 ID·이름 한 쌍만 배포 전 허용하며 다른 네 reference 종류는 비어 있어야 한다. 회원의 기존 `ADMIN_APP_URL` 부재만 허용하고, 관리자 `NEXT_PUBLIC_APP_URL`은 관리자 QA origin으로 유지한다. 새 설정은 역할별 `qaValues`의 모든 공개 binding, off인 AI switch, 기존 허용 secret만 있어야 하며 이전 self-service/ASSETS/legacy 공개 binding은 남을 수 없다. 다른 Worker나 DB에 대한 binding으로 예외를 확대하지 않는다.

브라우저에 Access secret을 `route.continue` header override로 전달하지 않는다. 탐색은 `maxRedirects: 0` 요청으로 각 Location을 정확한 QA origin과 비교한 뒤 최종 허용 URL을 실제 브라우저에 로드한다. 브라우저 자체의 예기치 않은 redirect는 `route.fetch(maxRedirects: 0)` 단계에서 중단하며 credential 포함 요청을 자동으로 따라가지 않는다. 외부 origin fixture에 요청·헤더가 전혀 도달하지 않는 테스트와 허용된 내부 redirect의 실제 최종 URL 테스트를 함께 둔다.

`ci-full-e2e.yml`의 exact release SHA 검증과 제품/운영 전환 기준은 별도다. QA 배포 성공으로 제품 완료나 운영 출시 가능을 선언하지 않는다.

## 필요한 기존 자격 증명 연결

Repository variable `PUTDUK_QA_SUPABASE_PUBLISHABLE_KEY`는 정확한 preview 공개 키만 담는다. 기존 일반 staging variable로 fallback하지 않는다. 2026-10-19 coordinator는 preview gateway 응답을 확인하고 전용 QA variable 저장/readback을 확인했다. 키 값은 이 문서에 남기지 않는다.

다음 repository secrets가 있어야 배포가 진행된다.

- `PUTDUK_QA_CLOUDFLARE_API_TOKEN`: 지정 계정의 기존 회원·관리자 QA Worker 두 개에만 `Individual Workers Editor`를 부여한 account-owned API token. Worker 리소스는 account 아래 `com.cloudflare.edge.worker.script.<WORKER_ID>` 두 개로 제한한다. 같은 계정의 `Access: Apps and Policies Read`와 정확한 `putduk.com` zone의 `Workers Routes Read`를 별도 정책으로 부여한다. Access 읽기 권한은 계정 범위이며 실제 요청은 코드 allowlist의 QA app 두 개로 제한한다. 별도 계정·zone 검색, 다른 Worker 배포, DNS·Access·route 수정이나 token 발급 권한을 추가하지 않는다. 전체 계정 Workers 편집 권한으로 대체하지 않는다.
- `PUTDUK_QA_MEMBER_ACCESS_CLIENT_ID`, `PUTDUK_QA_MEMBER_ACCESS_CLIENT_SECRET`: 기존 회원 QA Access 서비스 토큰.
- `PUTDUK_QA_ADMIN_ACCESS_CLIENT_ID`, `PUTDUK_QA_ADMIN_ACCESS_CLIENT_SECRET`: 기존 관리자 QA Access 서비스 토큰.
- `PUTDUK_QA_SUPABASE_SECRET_KEY`: 정확한 preview의 전용 `sb_secret_` 서버 키. 운영 키 또는 임의 placeholder는 사용할 수 없다.

2026-10-20 연결 receipt에서 기존 서비스 토큰의 secret만 교체했고 token ID·Access 정책·전체 만료는 유지했다. 회원 만료는 `2026-10-23T09:57:08Z`, 관리자 만료는 `2026-10-23T09:57:47Z`다. 이전 secret의 유예 종료 요청도 각 token 만료와 같으며, 이전 secret의 실제 동작은 값 부재로 검증하지 않았다. QA 배포 API token 만료는 `2026-11-19T14:59:59Z`로 확인했다. 이 값들은 관측 시점 receipt이며 실행 전 현재 상태를 다시 확인해야 한다. 만료되거나 자격 증명이 연결되지 않았으면 pipeline은 실패한다. 이 workflow는 키 발급·token 갱신·Access 완화를 자동으로 하지 않는다. 자격 증명 없는 빌드/산출물 검증과 실제 hosted 배포 성공은 별도로 기록한다.

## 실패와 복구

`qa-deployment-receipts-RUN-ATTEMPT` artifact의 `deployment.json`에는 exact SHA, CI와 build artifact, 각 Worker의 prior/current deployment/version, Access digest, secret 이름, smoke 상태가 기록된다. 상태가 `FAILED_OR_PARTIAL_REQUIRES_REVIEW`이면 한 Worker만 반영됐을 수 있다. `DEPLOYING` 후 응답을 잃었을 때에도 실패를 성공으로 바꾸지 않는다. 실제 Worker API를 재조회해 상태를 확정한다.

복구는 기록된 **같은 계정·Worker**에 대해 `POST /accounts/9dc502d4ef06b3b5374591de6e6933ca/workers/scripts/WORKER/deployments`로 `{"strategy":"percentage","versions":[{"version_id":"PRIOR_VERSION_ID","percentage":100}]}`를 적용하는 별도 검토 작업이다. `PRIOR_VERSION_ID`는 해당 역할의 receipt에서 가져와 기존 version 조회로 재확인한다. 두 Worker의 직전 버전과 Access/preview 설정을 함께 확인하고 다시 smoke한다. DB rollback, DNS 변경 또는 다른 Worker 변경으로 확대하지 않는다. 이 workflow는 자동 rollback을 실행하지 않는다.

## 로컬 검증

```sh
node --test scripts/qa-cloudflare-policy.test.mjs
node --test scripts/qa-cloudflare-run.test.mjs
node --test scripts/framework-generated-types.test.mjs
node --test scripts/qa-cloudflare-network.test.mjs
pnpm exec vitest run tests/unit/supabase-browser-runtime.test.ts
pnpm --dir apps/admin exec vitest run tests/admin-browser-public-key.test.ts
```

순차 배포 회귀는 CLI가 호출하는 같은 `deploy` 함수를 사용하고, 외부 I/O 경계 전체를 합성 fixture로 교체한다. 첫 Worker 이후 실패·응답 유실·smoke 실패·원격 경합·임시 secret 파일 처리 실패에서 실제 루프가 남긴 prior/current와 부분 실패 receipt를 확인한다. 테스트용 I/O 일부가 빠져도 실서비스 I/O로 보완하지 않는다. 이 로컬 검사는 원격 배포 성공 증거가 아니다. Workflow는 자격 증명 주입 전에 이 검사를 실행한다.

Next와 Vinext는 각 앱의 `next-env.d.ts`를 서로 다른 형식으로 재생성한다. [Next 공식 지침](https://nextjs.org/docs/app/api-reference/config/typescript#next-envdts)에 따라 정확히 두 앱의 생성 파일만 Git 추적에서 제외하고 실제 로컬 파일은 유지한다. 독립 타입 검사는 `next typegen && tsc --noEmit`으로 생성과 검사를 모두 수행한다. QA workflow는 의존성 설치 후와 build/dry-run 후에 tracked source가 HEAD와 같은지 검사하며 변경 경로만 출력한다. 실제 앱 소스·설정·타입 검사에 대한 예외나 자동 복원은 없다. 생성기 회귀는 격리 Git 저장소의 빈 status와 HEAD diff를 확인하고, 실제 페이지 소스 변경을 계속 검출한다.

Network 테스트는 설치된 Chromium과 ephemeral loopback HTTP fixture 두 개를 사용한다. 원격 Worker, 실제 credential, DB를 호출하지 않는다. Workflow에서는 browser 설치 후 deployment secret 주입 전에 실행한다.

정책 테스트는 외부 repository/branch, stale SHA, 운영 Worker/DB, wrong mode/account, 신규 binding/trigger, 잘못된 CI attempt/artifact, Access bypass, rollback 정보 부재를 거절하는 실행 가능한 검증이다. 런타임 테스트는 exact preview tuple을 허용하되 서버에서 `APP_ENV=staging`과 정확한 QA app origin을 함께 요구한다. 기존 parent DB 및 로컬 loopback 규칙과 브라우저에 secret을 전달하지 않는 규칙을 유지한다.

공식 근거: [cf CI와 사전 빌드 배포](https://developers.cloudflare.com/cf/ci/), [모드와 Build Output](https://developers.cloudflare.com/cf/projects/). 실제 옵션과 secret 보존은 설치된 cf `1.0.0-beta.18`의 `deploy-input`, `shared`, `containers` 구현과 config/build-output 타입을 확인했다. 이 beta 버전이나 lockfile을 변경하면 산출물 형식과 안전 조건을 다시 검증해야 한다.
