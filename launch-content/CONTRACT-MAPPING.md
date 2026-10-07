# 기존 계약 대응과 실제 등록 준비

검토 SHA: `0a7e95ba8bf55539fe32fd6f4654ee49a0be226d`. 테이블 존재는 승인된 게시 command·실행 권한·발송·화면 렌더의 증거가 아닙니다. 계약과 schema는 읽기만 했습니다.

| 패키지 | 실제 계약 | storage 대응 | metadata 또는 후속 계약 |
| --- | --- | --- | --- |
| events.json | public.events | slug/title_ko/summary_ko/status/starts_at/ends_at/published_at | 카드 제목·전체 본문·대상·CTA·참여/제외·KPI·배너·위험·승인·취소는 현재 events 열이 아님 |
| notices.json | public.notices | slug/title_ko/summary_ko/body_markdown/status/is_pinned/published_at/expires_at | 대상·CTA·변수·승인·fanout·정책 검토는 별도 계약 |
| notifications.json | public.notifications | category/title_ko/body_ko/route/expires_at | 실제 user_id/source_event_id/deduplication_key/priority/scheduled_at는 실제 domain command가 확정. channel은 notification_deliveries의 IN_APP/WEB_PUSH |
| faq.json | 승인된 FAQ CMS command 미확인 | 없음 | question/title/body/category/CTA·공개 도움말 매핑 필요 |
| support-macros.json | Channel Talk 세션 연동은 있음. macro CMS/inbox 저장 command 없음 | 없음 | 실제 접수·답변 저장·전달 영수증 필요 |
| incident-templates.json | 별도 incident CMS command 없음 | 없음 | 운영 책임자 확인 후 승인된 공지 경로에 매핑 |

근거: `supabase/migrations/20260926094147_liveops_notifications_and_ranks.sql`의 events(60), notices(135), notifications(160), deliveries(179); `20260926192203_ws02_foundation_schema.sql:1120`의 알림 source/dedup/priority/schedule 추가. 강제 RLS와 실제 grants/role은 DB에서 별도 검증해야 합니다.

events는 시작/종료 NOT NULL, 종료 > 시작, title 1–100, summary 1–500 조건입니다. 일정 null은 승인 전 콘텐츠 슬롯이며 **insert 가능한 DB 행이 아닙니다**. DRAFT는 published_at null이어야 합니다. notices title 한도는 120이며 만료는 게시 이후여야 합니다. 알림에는 실제 대상 회원이 필수입니다. 패키지 내부 slug는 notification DB 열이 아닙니다.

`event_rules.rule_payload`는 승인된 versioned mission/economy 계약을 담는 곳입니다. 운영 metadata나 전체 본문을 임의로 넣지 않습니다. `event_rewards`는 승인된 양수 금액·통화·rule·budget·qualification이 필요합니다. 보상 없는 교육 캠페인을 0원 reward로 등록하지 않습니다. 28개 안내 캠페인의 목록/본문/CTA 제공 방식을 Primary가 확정해야 합니다. 정책 설명 2개는 `POLICY_VALUE_REQUIRED`로 차단했습니다.

## 실제 회원 렌더 계약

- `app/(product)/events/page.tsx`: 공개 이벤트와 최대 8개 공지의 summary를 읽습니다. 현재 공지 목록은 body_markdown 전체를 select하지 않습니다. 전체 원고를 저장해도 전체 본문 렌더 완료가 아닙니다.
- `app/(product)/events/[slug]/page.tsx`: slug 기반 상세와 본인 참가 상태를 읽습니다. 현재 select에는 전체 본문·CTA metadata가 없습니다. 이 lane은 새 route/참가 버튼을 만들지 않습니다.
- `domain/notifications/member-inbox.ts`와 `lib/auth/return-path.ts`: 알림은 보호된 내부 route allowlist를 사용합니다. `/support`, `/status` 같은 공개 route는 그 목록 밖입니다. 따라서 지원/보안은 `/notifications`, 점검/장애는 `/events`로 연결합니다. allowlist를 넓히지 않았습니다.
- `lib/trust/public-content.ts`: `/about`, `/faq`, `/status`, `/changelog`는 versioned 정적 문서입니다. route 존재가 실시간 health나 새 원고 등록 증거는 아닙니다. 개인정보 문서 route는 임의로 만들지 않고 `approved_privacy_route`로 남겼습니다.

## 등록 command 조사 결과

Admin API routes/actions/assistant registry, migrations의 function·insert, domain/events, worker handlers를 조사했습니다. 실제 Admin command는 입금·출금·보안·economy·USDT prepare 등이며 **event/notice publisher와 support macro CMS 등록 command는 찾지 못했습니다**. economy PUBLISH는 콘텐츠 publisher로 재사용할 수 없습니다.

`apps/admin/lib/assistant/operations.ts`에는 USDT 읽기/초안만 등록되어 있고 실행기는 없습니다. `workers/runner.mjs`의 실제 handler는 FINANCIAL_RECONCILIATION과 SAFE_MODE_CHANGED.v1이며 member notification fanout은 missing으로 기록되어 있습니다. 게시 시 인앱·푸시가 자동 발송된다고 주장하지 않습니다.

`tests/e2e/authenticated/helpers/events-fixtures.ts`의 직접 SQL insert는 test-only 데이터 생성입니다. 운영자 게시 command가 아닙니다. 서비스 권한 insert로 안전 경계를 우회하거나 이 fixture를 운영 importer로 복사하지 않습니다.

현재: **BLOCKED / APPROVED_CONTENT_COMMAND_NOT_FOUND**. 생성 ID·readback·CMS 렌더·rollback은 **UNRUN**입니다. 가짜 ID·합성 readback·0건 성공을 만들지 않았습니다. LOCAL/STAGING이라도 승인된 command 없이는 등록하지 않습니다. PRODUCTION 등록·게시·발송은 하지 않았으며 별도 사용자 승인이 필요합니다.

## Primary에게 필요한 정확한 계약

1. draft 생성·수정·preview·approve·schedule/publish·cancel/archive의 기존 권위에 맞는 이름 있는 command. 현재 역할·세션·origin·필요한 step-up, revision 재검증, idempotency·audit가 필요합니다. 새 RPC 이름·테이블은 이 lane이 정하지 않습니다.
2. event full body/card/CTA/audience와 공지 전체 본문 저장·렌더 매핑. 미지원 metadata를 삭제하거나 임의 JSON 열에 숨기지 말고 검토 대상으로 반환해야 합니다.
3. 실제 domain event가 user_id/source_event_id/dedup key/category를 확정하는 fanout 계약과 delivery readback. 푸시 권한·선호·조용한 시간·cooldown/cap·승인된 critical override가 필요합니다.
4. FAQ·지원 macro·incident 저장/버전/승인/채널 매핑과 실제 답변 영수증. 고객지원 접수함과 실제 채널의 개인정보 최소화를 확인해야 합니다.
5. 정책 설명 2개에 실제 승인 policy/version/활성화·정산 증거. 예시·fixture·문서 수치를 기본 운영값으로 채우지 마세요.

## command 준비 후 LOCAL/STAGING 증거 순서

1. exact SHA와 격리 local project 또는 별도로 승인된 staging target을 기록합니다. staging을 현재 remote Supabase로 추정하지 않습니다. production URL/key는 거부합니다.
2. draft validator와 실제 승인 원고·일정·변수·대상을 확인합니다. 금융 혜택은 승인 policy/version/budget 없으면 제외합니다.
3. command preview에서 대상·기간·발송/경제 영향을 읽고 사람 승인을 받습니다. 미지원 metadata를 명시적으로 검토합니다.
4. local 대상에서만 실행하고 실제 생성 ID·request ID·revision·audit 영수증을 비밀 없이 기록합니다. dry-run과 실제 draft 저장을 구분합니다.
5. 권한 있는 readback과 해당 회원 browser에서 제목·전체 본문·CTA·대상 제한·미공개 숨김을 확인합니다. 생성 ID와 원고가 일치해야 합니다.
6. retry의 중복 행/발송과 제한 역할·권한 취소 거절을 확인합니다.
7. 승인된 cancel/archive로 노출·예약 fanout 중지 후 readback·회원 숨김·audit를 확인합니다. 원장·claims·기존 delivery는 삭제하지 않습니다. rollback command 없이는 게시 테스트를 시작하지 않습니다.
8. 실제 결과·스크린샷·rollback 영수증을 evidence에 남깁니다. 외부 provider는 승인 없으면 sandbox/local로 유지합니다.
