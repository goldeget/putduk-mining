# Frozen Admin 실제 DB/auth E2E 준비

대상은 `parallel/admin-release`의 **f9b454a7c1b86dde1099b6e5a264092118258ead**입니다. 새 Admin 기능이나 test assertion 변경은 금지합니다. 콘텐츠 브랜치를 Admin 검증 대상으로 착각하지 않습니다.

## 이번 실행의 실제 결과

- Node 24.21.0 / pnpm 12.6.0 / Supabase CLI 2.113.0 / frozen ref 확인 PASS.
- Docker driver는 vfs입니다. workspace가 약 30GB free로 보인 상태에서도 공식 PostgreSQL layer 등록이 `no space left on device`로 실패했습니다. workspace df는 Docker daemon의 실제 layer 공간·quota·inode 정상 증거가 아닙니다. 원인은 추가 확인 필요입니다.
- 이 작업이 만든 npm/pnpm metadata cache 287,971,915 bytes만 삭제했습니다. repo/worktree/commit/stash, 설치된 도구, dependency store, 기존 테스트 증거는 보존했습니다. Docker global inventory/prune이나 unrelated resource 접근은 하지 않았습니다.
- 정리 후 필요한 이미지 `public.ecr.aws/supabase/postgres:17.6.1.158`를 한 번 bounded retry했습니다. 결과는 이미지 configuration download `Forbidden`입니다. raw 로그는 `evidence/postgres-pull-after-cleanup.txt`입니다. 성공한 layer 등록이나 DB 시작으로 해석하지 않습니다.
- 공식 Playwright 1.63 Chromium153 다운로드는 `cdn.playwright.dev` HTTP 403 `Domain forbidden`로 실패했습니다. 실제 추가 redirect hostname이 관측되지 않아 도메인을 더 추가하지 않았습니다.
- 시스템 Chromium151은 실제 launch PASS입니다. bundled browser153와 같은 버전은 아니며 DB/auth E2E PASS가 아닙니다.
- actual local status에서 테스트용 DB/auth binding을 얻지 못했습니다. key를 만들거나 production/remote DB로 대체하지 않았습니다.

환경 상태: **BLOCKED**. 실제 실행하지 않은 8종은 `evidence/admin-environment-preflight.json`에 각각 executed=false로 남겼습니다. Admin의 이전 합성 컴포넌트 98 checks는 실제 인증/금전 E2E를 대신하지 않습니다.

## 환경 복구 후 실행 순서

현재 실행한 command가 아닙니다. 아래는 실제 prereq가 복구된 뒤의 재현 절차입니다. 저장된 network draft가 Publish되어 적용되는지, 플랫폼이 Docker daemon layer 공간/quota/inode를 확보했는지 확인해야 합니다. 저장 성공과 네트워크 적용은 다릅니다. 무관한 Docker 데이터 삭제로 해결하지 않습니다.

1. 콘텐츠 변경을 commit하고 작업 트리가 clean인지 확인합니다. 현재 콘텐츠 SHA를 기록하고, 이 안내와 새 결과 출력 위치를 이 checkout 밖의 **이 작업 전용** 임시 경로로 복사합니다. branch switch 시 tracked launch-content 파일이 사라지는 점을 고려합니다. 저장소/commit/stash를 삭제하지 않습니다.
2. `git switch parallel/admin-release` 후 `git rev-parse HEAD`가 위 frozen SHA와 정확히 같은지 확인합니다. 불일치하면 중단합니다. 새 develop 변경이나 이전 .next 빌드를 이 SHA의 증거로 사용하지 않습니다.
3. `supabase/config.toml`의 project_id=putduk-mining, API 58421, DB 65432를 확인하고 `CI_SUPABASE_START_ATTEMPTS=1 bash scripts/ci-supabase-start.sh`를 사용합니다. stdout key는 기존 redactor로 가립니다.
4. 실제 local startup·schema/권한 검증이 성공해야 합니다. 기존 dataset을 조사 없이 reset하지 않습니다. 새 disposable QA 데이터임을 확인한 때에만 repository 문서의 local reset 절차를 사용합니다. remote project osrmyjgmpdspdcwqjwuv는 QA 대체 대상이 아닙니다.
5. frozen SHA에서 `node scripts/run-local-authenticated-e2e.mjs --build-only`로 실제 isolated env를 이용해 member/admin을 한 번 빌드합니다. 기존 runner는 local 키를 메모리에만 전달하고 ephemeral withdrawal key를 만듭니다. Actions를 위조하거나 .env에 secret을 저장하지 않습니다.
6. 공식 Chromium이 설치됐다면 아래 최소 focused suites를 실행합니다. worker/전체 repository CI는 반복 실행하지 않습니다.

```sh
E2E_NEXT_START=1 E2E_WITH_ADMIN_SERVER=1 \
node scripts/run-local-authenticated-e2e.mjs --project=chromium \
  tests/e2e/authenticated/admin-today.spec.ts \
  tests/e2e/authenticated/admin-members-product.spec.ts \
  tests/e2e/authenticated/admin-exceptions-product.spec.ts \
  tests/e2e/authenticated/admin-assistant-read-draft.spec.ts \
  tests/e2e/authenticated/admin-session-totp.spec.ts \
  tests/e2e/authenticated/deposit-product.spec.ts \
  tests/e2e/authenticated/admin-krw-browser-money.spec.ts \
  tests/e2e/authenticated/admin-usdt-browser-money.spec.ts
```

관련 mobile 프로젝트는 필요한 Admin spec만 별도로 확인합니다. deposit-product 자체의 viewport matrix와 반복하지 않습니다. 실제 screenshot·동작·오류·수취/금액·권한·보류·중복·rollback 증거를 보존합니다. 실패·timeout·취소를 PASS로 바꾸거나 재시도로 숨기지 않습니다.

시스템 Chromium 대안은 product/config 파일을 고쳐 강제하지 않습니다. 실제 local DB가 준비되고 대안 실행이 필요한 경우에만 작업 전용 외부 Playwright adapter에서 기존 config를 가져와 executablePath를 정확히 지정하고 browser version을 기록해야 합니다. 이 대안은 이번에 실행하지 않았습니다. bundled 요구를 충족했다고 주장하지 않습니다.

7. own server만 종료하고 생성된 next-env.d.ts 변경이 있으면 **자기 실행이 생성한 변경만** 복구합니다. 코드와 tests는 수정하지 않습니다. frozen branch HEAD가 그대로인지 다시 확인합니다.
8. 콘텐츠 브랜치로 돌아가 새 run의 exact SHA·DB/schema/browser 버전·test 이름·PASS/FAIL/BLOCKED·실제 screenshots·금전/audit 결과를 launch-content/evidence에 기록합니다. 결과에 key·개인정보·원격 credentials를 넣지 않습니다.

Primary는 최종 통합/full CI를 소유합니다. PR 생성으로 전체 CI를 자동 시작하지 않습니다.
