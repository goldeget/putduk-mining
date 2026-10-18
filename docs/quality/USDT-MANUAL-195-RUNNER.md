# USDT 수동 처리 native·동시성 테스트 실행기195

상태: AUTHORED_NOT_TESTED. 실행 보류 유지. 이번 작업에서 runner/guard/parser/adapter/SQL/Python/Docker/API/CI를 호출하지 않았습니다.

이 도구는 격리 합성 데이터로 운영자의 수동 입금 확인·송금 기록·중복 승인·원장 일치를 검사합니다. 실제 체인 감지·자동 입금·자동 송금·거래소 API·provider가 없습니다. 수수료0과 운영자 직접 송금 후 완료 처리 계약을 보존합니다.

## 범위와 연결

신규 scripts/usdt-manual-195-runner.mjs가 기존 동결 adapter를 통해 KRW rollback80 → principal COMMIT388 → Python concurrency local39/canonical41을 차례로 호출하도록 작성했습니다. 각 숫자는 원본 소스에서 도출한 기대치이며 아직 실행 결과가 아닙니다.

기존195 candidate map/guard/config/CI/native fixture 및191/193 원본을 수정하지 않습니다. 신규 runner-source overlay가 기존195 map·guard 및 신규 실행기 파일을 고정합니다. guard/자기 manifest 해시 순환은 외부 독립 작성 보고서 SHA로 분리합니다. 기존 CI의 두 placeholder를 자동 교체하지 않았으며 전체 CI·HTTP/Auth 연결은 별도 후속 범위입니다.

## 미래 실행의 닫힌 조건

사람이 실행 보류를 명시적으로 해제하고 새 격리 DB의 합성 쓰기를 허용한 뒤에만 실행합니다. CLI flag나 인증키의 존재는 사용자 승인을 대신하지 않습니다.

- 정확한 기존195 소스/config/profile 및 별도 실행기 source-map hash.
- APP_ENV=test. Windows는 정확한 assigned clone/LOCAL_QA, Linux는 실제 goldeget/putduk-mining GitHub database job/canonical config. CI 환경을 위조하는 fallback 없음.
- host Python3.11 이상, Windows python/Linux python3. Python -I -B. Linux 컨테이너 Python을 Windows host 대신 쓰지 않음.
- Docker Windows desktop-linux의 local named-pipe 또는 Linux default local Unix socket만. remote DOCKER_HOST/TLS 거부. 원본 Python에도 검증한 DOCKER_CONTEXT만 전달.
- 명명된 프로젝트 DB 컨테이너의 caller-confirmed full64 ID/label/DB port/healthy 상태, 정확한 named data volume. 컨테이너·volume 모두60분 이내 생성이고 volume은 container보다60초 이상 오래되지 않아야 함. 기존volume 재사용/바인드 마운트 거부.
- 정확195 installed versions와 postgres owner/primary. auth.users 및 사용자 금융·원장·출금·입금 테이블이 모두 비어 있어야 함. 기존 합성 fixture도 있으면 거부.
- 기존자원 inventory/start/stop/reset/repair/remove/cleanup 안 함. 필요한 새 DB 및 migration 준비는 별도 승인된 bootstrap 작업이며 runner가 수행하지 않음.
- output은 Windows D:/PUTDUK-MINING-QA(ESD-USB) 또는 실제 CI RUNNER_TEMP의 새 putduk-mining-usdt195-UUID 디렉터리만. 프로젝트·기존출력 덮어쓰기 금지.
- 같은containerID의 실행 lease를 exclusive생성하고 영구 보존. 동시 실행/재시도·부분 실패 뒤 같은DB 재실행 금지. 자동 reset/cleanup 없음.

미래 invocation의 형식만 명시합니다. 이번에는 실행하지 않습니다:

`node scripts/usdt-manual-195-runner.mjs --execute --allow-synthetic-db-writes --confirmed-full-payout --fresh-container-id=<새 컨테이너 full64 ID> --output=<허용된 외부 부모>/putduk-mining-usdt195-<UUID>`

기존 현재 Docker 상태의 건강함·새volume·emptyDB를 이번에 조회하지 않았습니다. 새195 source guard 또는 실행기가 현재 PC에서 통과한다는 주장도 없습니다.

## 결과 판정과 실패

psql은 고정 containerID+local socket+postgres DB, -X/-q/-A/-t/-w/ON_ERROR_STOP=1로 호출하고 SQL statement/lock 및 프로세스 시간을 제한합니다. exit0만으로 통과하지 않습니다. TAP는 정확 연속1..80/388, 단일 마지막plan, SKIP/TODO/notok/Bailout/추가/누락/중복/비정상 종료 거부. principal은 plan 뒤 owner proof·서비스 역할·deferred integrity·COMMIT까지 프로세스 종료 성공 필요.

Python은 원본 이름/__file__로 compile하여 ROOT·Git·job·config·DB guard를 보존합니다. launcher가 원본 전체SHA와 독립 정확2치환으로 재구성한 파생문자열을 검증합니다. 호출자가 임의코드 SHA를 준다고 실행할 수 없습니다. 실제 파생SHA는 sealed reward preludeSHA와 별도로 기록합니다. 원본 JSON6keys/정확39·41 names·order·passed===true·4 advisory wait·한 run16hex·preludeSHA를 확인합니다.

실제 child exit/time/stdoutSHA/stderrSHA는 parser 판정 전에 기록합니다. SQL 원문/error/context·토큰·키·사용자 데이터 raw출력은 보고하지 않습니다. 결과 파일과 파생 SQL/Python은 승인된 합성 source만 포함합니다.

timeout/비정상 종료/판정 실패는 FAILED, DB outcome UNKNOWN, partial commits possible입니다. Docker client 종료가 DB rollback을 보장하지 않습니다. 자동재시도나cleanup 하지 않으며 별도 관측·새DB 준비가 필요합니다. lease 역시 남깁니다.

execution.json 및 artifact-manifest.json에 source/runner manifest·targetID·phase provenance·결과·해시를 남깁니다. 성공해도 NATIVE_AND_CONCURRENCY_ONLY, release NOT_VERIFIED이며 HTTP/Auth·UI·전체CI·출시 검증을 대신하지 않습니다.

## 남은 검증

정적 독립 리뷰와 원본 byte 보존만 이번에 확인합니다. 타입·린트·unit·Python syntax·sourceguard·fixture 변환/역치환·SQL80/388·동시성39/41·Docker mount metadata 및 프로세스 회수·실제API는 전부 NOT_TESTED입니다. 특히 Docker image data mount 경로/volume 생성시각/환경 조건의 실제 호환성은 future preflight에서 확인하고 실패 시 보안 경계를 완화하지 않습니다.

관련 공식 계약: [psql 옵션/ON_ERROR_STOP](https://www.postgresql.org/docs/current/app-psql.html), [pgTAP 계획·finish](https://pgtap.org/documentation.html), [Docker context inspect](https://docs.docker.com/reference/cli/docker/context/inspect/).

Host Python3.11+/tomllib의 존재를 DB fixture 쓰기 전에 실제 preflight에서 확인하도록 작성했습니다. 원본 KRW SQL은 pgTAP 생성문이 없어, fresh DB 확인 후 로컬 pgtap extension을 IF NOT EXISTS로 준비합니다. 테스트 DB의 pgTAP 준비만 수행하며 migration 적용/패키지 설치/운영 설정 변경은 하지 않습니다. 이 preflight와 준비 역시 이번에는 미실행입니다.
