# Cloud 원본 추적 및 Windows Local 복구

이 문서는 복구 작업의 범위와 증거 위치를 기록합니다. 전체 기능 검증이나 출시 완료를 선언하지 않습니다.

## 보호된 원본과 복구 기준

- 승인 저장소: `https://github.com/goldeget/putduk-mining.git`
- 원본 로컬: `C:/Users/PC/Desktop/putduk-mining`, branch `codex/product-ai-navigation`, HEAD `af14c2fb6ec9a40306613757b1f14625ce8d388f`.
- 새 복구 기준: 승인 원격 Cloud 후보 `0630b5a92817fac6e8d05cb2ddc3198317d76e5f`.
- 원본의 미커밋 파일, 기존 worktree와 stash는 그대로 보존합니다. 새 복구 작업은 AGENTS.md에 명시한 별도 worktree에서 진행합니다.
- 검증된 원본 소스 1,110개와 전체 Git 백업: `D:/PUTDUK-MINING-QA/local-redevelopment-20261009-033553`. `backup-verification.json`에 복사 해시, Git 무결성 및 복원 읽기 검사 결과가 있습니다.

## 사용자 지시의 출처

Cloud 원본 채팅은 `putduk-mining 설정` / `01a110f7-9d9d-76ac-8aae-e59be20c10b9`입니다. 기존 전수 감사는 `D:/PUTDUK-MINING-QA/cloud-history-audit-20261009-031452`에 있습니다.

새 작업 증거 폴더에는 `requirements-raw.json`, `requirements-traceability.json`, `requirements-traceability.md`, `attachment-unknowns.json`이 있습니다. 직접 사용자 메시지, 첨부 원문, 후속 정정 및 assistant 제안을 구분합니다. 현재 복구 명령은 Cloud 미완료 항목의 구현도 요구합니다. 이전 답변의 임의 우선순위나 미완료 표시는 범위 제외 권한이 아닙니다.

마지막 사용자 첨부 두 개는 원본 바이트 해시까지 확인했습니다.

| 자료 | 원본 SHA-256 | 증거 파일 |
| --- | --- | --- |
| 플랫폼 전체 지시 | `72841a833e18aefa74cdf786074906dabd5d74c8ac729eccb952b0f6dc9b9a83` | `cloud-platform-owner-directive-exact.txt` |
| 병렬 작업 지시 | `1f8cad3d5ec3139d2122e8d7ac12de30cf8b5c1318445900a977b9ac8db00cc9` | `cloud-parallel-owner-directive-exact.txt` |

목업 ZIP 두 개와 내부 원본 이미지 52개는 Cloud 인덱스 해시와 일치합니다. `verified-original-52-inventory.json`과 `verified-original-52/`에 있습니다. 상품 값이나 이전 문구는 이미지에서 추론하지 않고 이후 확정 지시를 따릅니다. 별도의 마지막 AI 화면 승인 이미지 등 확보하지 못한 픽셀은 동일하게 복원했다고 주장하지 않습니다.

## 병렬 소유권

| Lane | 소유 영역 |
| --- | --- |
| integration | 회원 AI 화면, 원본 추적 통합, 최종 브라우저 검증 |
| provider | AI 서버 제공자, 스트림, 회원 사용량 API 및 제공자 테스트 |
| finance-db | 금융·채굴·KYC·Worker 및 모든 Supabase schema 변경의 단일 소유권 |
| admin-content-pwa | 관리자 대화 조회, CMS·게시·알림·PWA 및 해당 UI/API |

다른 lane의 파일을 동시에 수정하지 않습니다. DB 계약은 finance-db와 합의하고 그 lane이 작성합니다. 역사적 쉘 명령을 그대로 실행하지 않습니다. 실제 소스/패치 및 확정 사용자 지시를 검토해 새 구현으로 반영하며, 원본 해시 일치와 기능 검증을 각각 기록합니다.

## 검증과 외부 경계

새 로컬 Supabase는 이 프로젝트에 새로 만든 격리 자원만 사용합니다. 로컬 API는 `http://127.0.0.1:61421`, DB 포트는 `61422`입니다. 비밀값은 무시된 `.env.local`에만 저장하고 원격 DB 키를 넣지 않습니다.

무료 AI 키의 존재는 확인했으며 값은 증거에 기록하지 않습니다. 유료 API key나 환경 flag로 유료 호출을 활성화하지 않습니다. $10 비용 예약·동시성 계약은 로컬 DB와 모의 제공자로 검증하고, 실제 유료 호출은 별도 승인 경계입니다.

진행 중 테스트 결과는 해당 작업의 범위만 증명합니다. 모든 lane을 통합한 정확한 최종 SHA에서 format, lint, typecheck, unit, build, DB native 검증, Worker, 인증 브라우저, 테마·크기·접근성·화면 비교를 다시 확인해야 합니다. `EXACT_RECOVERED`와 `FUNCTIONALLY_VERIFIED`는 서로 대체하지 않습니다. 필요한 외부/기기 증거가 없으면 구체적으로 기록합니다.

GitHub push/PR/원격 merge, Supabase 원격 변경, Cloudflare/DNS/배포, 실제 금전·보상 및 유료 AI 호출은 이 복구 작업으로 승인되지 않았습니다.
