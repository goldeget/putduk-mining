# 출시 운영 lane 환경 조사

이 파일은 실제 tool 실행 관찰의 요약입니다. 완전한 startup raw 로그를 재구성한 파일이 아닙니다. 실제 post-cleanup pull 원문과 독립 preflight JSON을 별도로 보존했습니다.

검증 도구는 Node 24.21.0, pnpm 12.6.0, Supabase CLI 2.113.0입니다. local project_id=putduk-mining, API 58421, DB 65432를 읽고 검증했습니다. remote/production에는 연결하거나 변경하지 않았습니다.

workspace free 약 30GB에서 기존 redacted startup script를 한 번 실행했습니다. official image pull에서 Forbidden과 registry fallback이 관측됐고, 내려받은 PostgreSQL layer 등록에서 `failed to register layer: no space left on device`가 발생했습니다. 무의미한 반복을 중지했습니다.

자체 생성한 npm/pnpm metadata cache만 287,971,915 bytes 제거했습니다. 경로와 파일 byte 수는 cache-cleanup.json에 있습니다. 이는 file logical size 합계이며 Docker daemon free space가 그만큼 늘었다는 증거가 아닙니다. workspace df는 이후에도 약 29GB free였습니다. Docker driver=vfs, root=/var/lib/docker만 확인했으며 전역 이미지·컨테이너·볼륨 목록이나 관련 없는 상태는 읽지 않았습니다.

정리 후 정확히 필요한 공식 PostgreSQL 이미지만 90초 상한으로 retry했습니다. 이미지 configuration download가 Forbidden으로 실패했습니다. postgres-pull-after-cleanup.txt에 실제 원문을 남겼습니다. 실제 차단된 새 redirect hostname은 관측되지 않아 네트워크 범위를 늘리지 않았습니다. layer 공간/quota/inode 원인은 여전히 UNKNOWN이며 플랫폼 확인이 필요합니다.

Chromium153 공식 다운로드도 재시도했으나 cdn.playwright.dev에서 HTTP 403 Domain forbidden으로 실패했습니다. 시스템 Chromium151 launch는 별도로 PASS입니다. local DB binding은 얻지 못했습니다. preflight는 key 값을 출력하거나 저장하지 않습니다.

admin-environment-preflight.json은 보존된 Admin SHA와 요청된 8개 spec의 존재를 확인하고 각각 BLOCKED/executed=false를 기록합니다. 테스트 listing이나 browser launch를 실제 E2E로 표시하지 않습니다. 오래된 98 component checks를 새 DB/auth 결과로 재사용하지 않습니다.

저장된 Cloud 시작 지침을 콘텐츠 역할·freeze 기준으로 바꿨습니다. cloud-role-save.json의 saved는 draft 저장입니다. 설치/네트워크/비밀 아닌 변수는 유지했고 secrets를 추가하지 않았습니다. **Publish 전에는 새 지침/네트워크가 적용됐다고 주장하지 않습니다.**

필요한 다음 환경 조치는 draft Publish와 플랫폼의 Docker layer 저장공간·공식 registry/download 정책 확인입니다. 사용자 승인 없는 production 변경이나 무관한 자원 삭제로 우회하지 않습니다. 복구 뒤 frozen SHA의 실제 실행 순서는 ADMIN-E2E-PREPARATION.md에 있습니다.
