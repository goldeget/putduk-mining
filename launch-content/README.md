# PUTDUK 출시 운영 콘텐츠 패키지

`parallel/launch-ops-content`의 독립 콘텐츠 lane입니다. 구현 기준은 `origin/develop`의 `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`입니다. 기존 Admin 브랜치 `parallel/admin-release`와 `f9b454a7c1b86dde1099b6e5a264092118258ead`는 freeze 상태로 보존합니다.

이 패키지는 검토 가능한 원고·템플릿이며 실제 서비스 등록·게시·발송·경제 정책 승인이나 출시 완료가 아닙니다. production에는 등록하지 않습니다. 신규 콘텐츠는 **이 경로 안에서만** 작성합니다. Member/Admin/UI/domain/lib/migration/lockfile/workflow는 수정하지 않습니다.

| 콘텐츠 | 개수 | 기계 판독 원본 | 전체 한국어 문서 |
| --- | ---: | --- | --- |
| 이벤트 | 30 | events.json | docs/events.md |
| 공지 | 26 | notices.json | docs/notices.md |
| FAQ | 68 | faq.json | docs/faq.md |
| 고객지원 답변 | 28 | support-macros.json | docs/support-macros.md |
| Push/In-app 알림 | 32 | notifications.json | docs/notifications.md |
| 장애 안내 | 8 | incident-templates.json | docs/incident-templates.md |
| 1인 출시 운영 절차 | 1 | runbook.json | LAUNCH-DAY-RUNBOOK.md |

7개 콘텐츠 JSON은 record 배열입니다. manifest·등록 계획·증거는 별도 보조 구조입니다. `slug`는 패키지 전체에서 고유한 내부 키입니다. `storage`는 기존 테이블의 확인된 열에 대응하는 **미완성 초안 매핑**입니다. `metadata`는 현재 DB 계약에 없는 CTA·대상·카드/전체 이벤트 본문·시각·KPI·배너·위험·승인·전달 조건입니다. metadata를 임의 JSON 열이나 `event_rules.rule_payload`에 넣지 않습니다. FAQ/지원/장애·운영 절차는 승인된 저장 계약이 없어 `storage`가 비어 있습니다.

이벤트 28개는 보상 없는 이용 안내 캠페인입니다. START 전환·용량/속도 설명 2개는 `POLICY_VALUE_REQUIRED`이며 정책 버전과 실제 runtime 확인 전 게시 금지입니다. 참여 클릭·미션 진행률·상품·보상·추적 코드를 만들지 않았습니다. 경제 수치는 전부 미지정입니다. 임의 bonus·수익률·속도·용량·KPI 목표값을 넣지 않습니다.

모든 이벤트는 일정 미확정입니다. 일정은 승인 후 KST로 안내하고 UTC offset이 있는 timestamp로 저장합니다. 날짜를 null로 둔 초안은 유효하지만 실제 등록용 완성 행은 아닙니다. 이벤트 테이블의 NOT NULL 시작·종료 조건을 우회하지 않습니다.

`{{variable}}`은 실제 확인한 내용으로 채울 템플릿 자리입니다. 변수·대상·CTA·승인 gate 확인 전 회원에게 보내지 않습니다. 푸시에 이름·잔액·계좌·주소·거래 식별자·내부 위험 판단을 넣지 않습니다. 알림은 source event·대상 회원·중복 키·전달 조건을 승인된 command가 확정해야 합니다. package의 notification `storage`는 회원 ID 없이 DB에 insert할 수 있는 행이 아닙니다.

```sh
# 고정 Node 24.21.0에서 실행. 독립 검증기는 외부 서비스/패키지를 호출하지 않습니다.
node launch-content/validate.mjs
node --test launch-content/validate.test.mjs
node launch-content/generate-docs.mjs
# 게시 준비 검사는 현재 exit 2 / BLOCKED가 올바른 결과입니다.
node launch-content/validate.mjs --publication-ready
# Member 파일은 읽고 결과만 이 패키지에 씁니다.
node launch-content/audit-member-copy.mjs
```

`PASS_DRAFT_ONLY`는 slug·문구·날짜 형식·CTA·대상·경제값·필수 안전 문구 등 정적 검증 통과입니다. 의미/법률/실제 기능·날짜·금전 정책·권한·게시 command·browser 제품 증거를 대신하지 않습니다. `BLOCKED`와 `UNKNOWN`을 PASS로 바꾸지 않습니다.

등록 계약과 정확한 Primary 요구는 `CONTRACT-MAPPING.md`, 오픈 절차는 `LAUNCH-DAY-RUNBOOK.md`, 회원 문구 발견 위치는 `evidence/MEMBER-COPY-AUDIT.md`와 전체 JSON을 사용하세요. Primary UI 변경 후 감사 결과의 파일 SHA-256과 위치를 다시 확인해야 합니다.
