# D드라이브 로컬 QA 실행

소스와 Git은 `C:\Users\PC\Desktop\putduk-mining`에 유지한다. QA 결과는 실행마다 새로운 `D:\PUTDUK-MINING-QA\codex-...` 폴더에 기록한다.

## 실행

```powershell
node scripts/run-qa-on-d.mjs prepare
node scripts/run-qa-on-d.mjs unit tests/unit/wallet/krw-deposit-journal.test.ts
node scripts/run-qa-on-d.mjs unit
node scripts/run-qa-on-d.mjs admin-unit
node scripts/run-qa-on-d.mjs typecheck
node scripts/run-qa-on-d.mjs lint
node scripts/run-qa-on-d.mjs assets
node scripts/run-qa-on-d.mjs format
```

`unit`은 회원 앱 단위 검사, `admin-unit`은 관리자 앱 단위 검사다. 검사 파일을 지정하면 저장소 안의 해당 단위 검사 파일만 허용한다. `typecheck`은 두 앱을 순차 검사하며 incremental cache를 새로 쓰지 않는다.

로컬 단위 검사는 동시에 두 worker까지만 실행한다. 실행 프로세스 과다로 생기는 메모리·임시 공간 부담을 줄이며 검사 항목과 제한 시간은 바꾸지 않는다.

`lint`와 `format`은 현재 저장소의 Git 추적 파일과 `.gitignore`를 따르는 미추적 파일 목록에서 지원되는 확장자만 검사한다. 폴더 전체 순회로 중첩 worktree나 과거 임시 출력을 읽지 않는다. 실제 경로가 저장소를 벗어나면 중단한다. Windows 명령줄 길이를 지키도록 100개씩 나누되 모든 대상은 검사하고 `run.json.checkedFiles`에 남긴다. 기존 미커밋 파일도 포함되므로 실패 원인과 실제 PR diff 검증은 구분한다. CI workflow의 전체 gate는 변경하지 않는다.

기본 ESLint/Prettier 설정에서도 중첩 `.worktrees`를 제외한다. ESLint의 `--no-warn-ignored`는 Next.js가 원래 제외하는 생성 파일을 명시적 목록으로 전달할 때의 알림만 없앤다. 실제 코드 경고는 여전히 `--max-warnings=0`으로 실패한다.

실행기는 저장소 위치·origin과 D드라이브의 `ESD-USB`/Healthy 상태를 확인한다. 드라이브의 기존 파일을 조사하지 않고 새 폴더만 생성한다. 현재 HEAD, 실행 결과, 로그, JSON 결과, 기존 수정 파일의 실행 전후 hash를 기록한다.

자식 프로세스의 TEMP/TMP/TMPDIR은 새 QA 폴더로 설정한다. 부모 환경이나 Windows 전역 설정은 바꾸지 않는다. 실제 외부 서비스와 금융 쓰기 자격 증명은 검사 환경에서 제거한다. 로그와 결과는 기존 secret masking 함수를 사용한다.

## 저장 구조

- `run.json`: 기준 HEAD, 볼륨, 명령 결과, 기존 수정 파일 보존 확인
- `tmp/`: 해당 실행의 임시 파일
- `logs/`: 마스킹된 실행 로그
- `reports/`: Vitest JSON 결과
- `screenshots/`: PUTDUK_UI_EVIDENCE_DIR를 지원하는 스크립트의 저장 위치
- `playwright/`: 향후 브라우저 검사 reporter 저장 위치

Playwright의 reporter 환경 변수는 출력 reporter를 사용할 때만 적용된다. 실제 browser trace/video의 outputDir와 테스트에 하드코딩된 별도 screenshot 경로는 이 실행기만으로 자동 이동하지 않는다. 해당 브라우저 실행을 연결할 때 명시적으로 설정·검증한다.

## 용량과 경계

D드라이브는 FAT32이므로 단일 파일 약 4GiB 제한이 있다. Docker DB 이미지나 대형 단일 archive 저장 경로로 사용하지 않는다. 드라이브 포맷이나 Docker 전역 저장 위치를 변경하지 않는다.

Next.js의 빌드 디렉터리는 기존 `.next`를 유지한다. 설치된 Next.js 문서는 distDir이 project directory를 벗어나면 안 된다고 명시한다. 따라서 D드라이브를 사용했다는 이유로 빌드·DB 저장 공간 문제가 모두 해결됐다고 판단하지 않는다. 무거운 로컬 작업 전에 C드라이브의 실제 여유와 해당 작업의 예상 소모를 다시 확인한다.

실행기는 기존 파일 삭제, 소스 이동, DB reset, Docker 변경, GitHub push/merge, 원격 Supabase/Cloudflare 변경을 수행하지 않는다. 해당 기능을 추가하는 경우에도 별도 권한·격리·검증 경계를 유지해야 한다.
