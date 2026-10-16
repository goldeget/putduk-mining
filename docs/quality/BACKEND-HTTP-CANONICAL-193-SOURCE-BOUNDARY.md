# Backend HTTP canonical 193 source boundary

## 구현 상태와 승인 범위

현재193 후보를 canonical 설정으로 검증하는 코드와 합성 파일 fixture 테스트를
추가했다. 담당자는 DB·HTTP·테스트를 실행하지 않았지만 coordinator의 실제
단위 테스트 결과를 확인했다. 현재 상태는 PARTIAL / FAILED_TIMEOUT이다:
완료된4파일 실행은94개 중90 PASS·4 timeout이며, 그중 canonical은28개 중
26 PASS·2 timeout이다. 이후 직렬6파일 실행은 전체 결과가 아직 미완료다.
이 변경만으로 전체 hosted CI 연결 또는 백엔드·출시 완료를 주장하지 않는다.

기존 `scripts/principal-review-r2-source.mjs` 및 회원·관리자 UI를 이 담당자가
변경하지 않았다. 시작48개 baseline도 이 담당자의 변경 범위가 아니다.
후속 소비자 담당자는 변경 대상의 정확한 기존 bytes를 별도 snapshot으로 보존했다.
원격 Push·PR·Merge·workflow_dispatch·DB 적용·
배포·실제 지급은 이 변경에 포함되지 않는다.

## 진입점과 공유 검증

- `scripts/backend-http-canonical-source.mjs`의
  `assertBackendHttpCanonicalSources(root?)`는 canonical 전용 export만 호출한다.
- 이번 작업에서 추가된 `scripts/backend-http-local-source.mjs`에 private
  `assertCandidateSources(root, scope)` core를 둔다. 두 public export는 각각
  고정 literal `LOCAL_QA`, `CANONICAL_CI`만 전달한다. caller는 mode·hash·profile을
  전달할 수 없다. 기존 LOCAL_QA public export 이름과 오류 코드는 보존했다.
- runtime에서 Git·환경변수·다른 설정으로 fallback하지 않는다. 허용 root 인자는
  검증 대상의 재배치만 지원하며 승인 hash 또는 허용 source 목록을 바꾸지 않는다.
- 이전183/187/188/191 layer와193 successor를 같은 검증 core에서 독립 pin으로
  검증한다. source guard 전체를 복제하지 않는다.

## 서로 수락할 수 없는 실행 설정

| 항목 | CANONICAL_CI | LOCAL_QA |
| --- | --- | --- |
| project_id | putduk-mining-ci-r2-20261009 | putduk-mining-backend-patch-20261011 |
| API port | 63421 | 65421 |
| DB port | 63422 | 65422 |
| config SHA256 | 942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac | 10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7 |
| executionProfileSha256 반환 | null | 5767adadaf2e4f96e8db557ea61de4de53a4eae7a3f635c8c972a3ee13f62046 |

canonical 모드는 원래183 baseline의 config hash가 독립 canonical pin과 같음을
확인하고 그 bytes를 직접 요구한다. QA profile은 canonical 모드에서 읽거나
설정으로 채택하지 않는다. LOCAL_QA에서는 기존 profile·hash·실제 project/ports를
동일하게 검증한다. 실제 task config는 DO_NOT_COMMIT이며 canonical 진입점의
허용값에 포함되지 않는다. 파일만 canonical 경로로 이름을 바꿔도 통과하지 않는다.

## source successor의 정확한 경계

`tests/e2e/fixtures/backend-http-local-193-source.json`의 이름에는 local이 있으나
내용은193개 SQL 및30개 runtime의 소스 계보다. task config replacement는 이
manifest 안에 없고 별도 QA profile에만 있다. 따라서 두 모드는 환경중립 source
successor SHA256
`8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922`를
같이 고정한다. 기존 manifest bytes와 pin은 변경하지 않았으며 신규 canonical
manifest가 생성됐다고 주장하지 않는다.

이전191 SHA256은
`899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb`다.
193 successor는 다음 delta만 허용한다.

| 변경 | 경로 | 허용 SHA256 |
| --- | --- | --- |
| SQL 추가 | supabase/migrations/20261011110300_backend_referral_nonmoney_bridge.sql | 3389a828e745afd23c13fbb4f80e449c2f4f0d976bd4ed5208f5827ffb5a4cd6 |
| SQL 추가 | supabase/migrations/20261011112058_nonmoney_award_outbox_ack.sql | 96d977e238c2f40fcc244ab4c0e615cc878e348b01393e55f5d2a66069db647c |
| runtime 교체 | workers/runner.mjs | 4c5153a182955f7a22f1363e410353f4a948b939bb92cbe0269dd3096f6c5f2b |
| runtime 추가 | app/api/v1/wallet/summary/route.ts | 00c5e5dc02e1e8578062a8a717d8008764d9e1397a18569050024975ee2f9a0c |

runner 이전 hash는
`ec34f3e6c1d411d7922bc19fe3534cc2990868be54b0665e3fcd46195d3797a9`로
봉인되어 있다. 기존191 event runtime override 두 개도 그대로 적용한다.
183 baseline runtime29 자체를 늘리지 않고 successor wallet1개를 더한 runtime30을
확인한다. 실제 SQL 파일 집합이 정확193개와 일치해야 하며 최소 count 검사는 없다.
소스 경로 중복·경로 이탈·현재 파일 hash 불일치는 계속 거절한다.

## 합성 단위 테스트와 설정 도출

신규 `tests/unit/backend-http-canonical-source.test.ts`는 소유한 임시 디렉터리에만
fixture를 만든다. 실행할 DB·HTTP·Worker·UI·Git 변경은 없다. 각 임시 root는 삭제
전에 절대 경로를 확인하여 OS temp 바로 아래 고유 prefix의 소유 경로만 허용한다.

canonical config는 로컬 불변 ref
`e220356be85a56e21e3469023b19b0c2fd4aebba:supabase/config.toml`에서 읽고
독립 SHA942e...를 먼저 확인한다. ref/hash가 다르면 실패한다. test-only QA config는
이 bytes에 정확1회 존재하는 literal8개만 치환하고 결과 SHA10d9...까지 확인한다.
실제 checkout config를 복사하거나 TOML을 재직렬화하지 않는다. 이 test-only 도출을
runtime guard로 import하지 않는다.

테스트는 canonical 수락, 파생 QA 수락, 양방향 설정 거절, 봉인 자료 변조,
runtime/SQL byte 변조, 동일 count 경로 교체, extra/missing SQL, caller rehash,
source 중복·탈출, 실제 junction/symlink 탈출, 환경 skip 및 caller mode/hash 무효를
검사한다. 작성 완료와 실행 PASS는 별개다.

## 이번 변경 이후에도 남는 CI 연결 작업

후속으로 root가 이번phase 신규 `tests/unit/backend-http-local-source.test.ts`의
소유권을 위임했다. 해당 fixture의 config 복사를 frozen canonical→8 literal→
독립 QA hash 도출로 교체하고, 첫 pin-positive 사례도 synthetic QA fixture를
사용하도록 보완했다. canonical 거절 사례는 축약한 가짜 설정 대신 실제 frozen
bytes를 사용한다. 따라서 현재 checkout이 QA 설정인지 canonical 설정인지에
의존하지 않는다. runtime guard fallback은 추가하지 않았다. 변경 전후 hash는
외부 QA의 `http-auth-20261011/LOCAL_SOURCE_FIXTURE_CONFIG_CHANGE.json`에 기록했다.
담당자의 실제 테스트 실행은0이며 coordinator가 실행한 결과를 아래에 구분했다.

기존191 source unit fixture의 불변 ref runner 도출은 후속 소비자 담당자가
구현했다. 기존191 guard의 허용 hash를193으로 바꾸거나 테스트를 제외하지 않는다.
해당 unit 파일의 기존 미커밋 bytes는 외부 snapshot에 보존되었고 이 문서 담당자는
그 파일을 변경하지 않았다. 새로운 역사 검증 fixture의 실제 실행은 별도 확인한다.

후속 소비자 구현은 `CI_193_CONSUMER_IMPLEMENTATION.json`과
`docs/quality/BACKEND-HTTP-193-CI-CONSUMER.md`에 기록되어 있다. shard 스크립트가
canonical guard를 호출하고 `playwright.backend-http-193.config.ts`를 사용하며,
principal beforeAll이 별도 canonical193 adapter를 사용하도록 연결되었다.
기존191 guard·review-r2 config·기존 product helper·봉인 manifest는 그대로다.
이전 gap은 코드 구현이 완료된 검증 대기 상태로 갱신되었다. 소비자 구현 완료는
전체 hosted CI 검증 완료가 아니며, 실제 current193 hosted 실행 결과는 NOT_TESTED다.

## coordinator 실제 실행 증거와 남은 검증

증거 위치는
`D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011`이다.
`unit-canonical-20261011122034571.log`·`.err.log`·`.json`은4파일94개 중
90 PASS·4 FAIL, exit1을 기록한다. LOCAL_QA31/33, canonical26/28,
nonmoney Worker29/29, wallet4/4다. stderr에서4실패 모두
`Error: Test timed out in 20000ms.`임을 확인했다. saved failure output에
assertion mismatch는 관측되지 않았다. timeout인 검사를 검증 완료로 바꾸거나
전체 source guard가 정상이라고 일반화하지 않는다.

`unit-serialized-20261011-1227.log`는 직렬6파일 재검증 중 canonical28개 중
24 PASS·4실패와 소요시간을 기록한다. coordinator는4실패를 timeout으로 보고했다.
검토 시 전체 종료 summary·최종 exit·직렬 stderr는 아직 확인되지 않았다.
앞선 완료 실행과 실패 사례도 달라졌다. fixture I/O·Windows 자원 경합의 영향은
SUSPECTED이며 확정 원인이 아니다. serial 전환만으로 해결됐다고 주장하지 않는다.

| 검사 | 이번 작성 시점 |
| --- | --- |
| canonical 신규 단위 테스트 | PARTIAL / FAILED_TIMEOUT — 완료 실행26/28 PASS,2 timeout; 이후 직렬24/28 PASS,4 reported timeout, 전체 실행 미완료 |
| LOCAL_QA 현재 단위 회귀 | PARTIAL / FAILED_TIMEOUT — 완료 실행31/33 PASS,2 timeout |
| nonmoney Worker / wallet 단위 | VERIFIED 해당 완료 실행29/29 및4/4 PASS; 실제 Worker/API 금융 연결 증거는 아님 |
| type/lint/format | NOT_TESTED |
| 실제 canonical193 native / HTTP / Worker | 이 변경으로 실행하지 않음 |
| canonical consumer 연결 | CODE_WRITTEN — snapshot/구현 문서 존재; 실제 소비자 검증 대기 |
| hosted CI current193 run | NOT_TESTED — 코드 연결 완료와 hosted 실행은 별개 |
| 기존191 runtime guard·봉인 파일 보호 | consumer 구현 manifest의 unchanged 검사 확인; 원래48 전체 최종 비교는 coordinator 책임 |

정적 file/hash 대조 또는 fixture 구현을 실제 금융·채굴 연결 검증으로 대체하지
않는다. UI_INTEGRATION_PENDING 및 UI 최종 승인 경계는 그대로 유지한다.
