# UI·UX 제작자용 실제 백엔드 계약 인계 — 2026-10-12

현재 상태 CODE_AUTHORED / STATIC_REVIEW_ONLY / NOT_TESTED.
이 문서는 화면 디자인 승인이 아니며 UI 코드는 보호된다.

| 영역 | 실제 근거 | 현재 계약과 다음 화면의 제약 |
|---|---|---|
| KRW/USDT 수동 지급 | apps/admin/app/api/v1/admin/withdrawals/command/route.ts:166–257 | fee0·운영자 외부송금·receipt 기록과 ledger finalize 분리. USDT잔액을 새로 표시하지 않는다. |
| 추가 인증 | 같은 route:125–160, apps/admin/lib/auth/principal.ts:179–224 | 실제 role/AAL2·origin·owned session 이후 one-use WITHDRAWAL_OPERATOR proof. UI에 토큰을 저장하거나 재사용 성공으로 표시하지 않는다. |
| 결과 불명 | 같은 route:181–183/203–210/236–252 | 503 UNCONFIRMED는 rollback 증거가 아니다. 동일 payload/key를 보존하고 새 proof로 서버 원본을 조회한다. 운영자에게 다시 송금하도록 유도하지 않는다. |
| HOLD 해제 | 같은 route:260–279와 SQL20261006133350:241–248 | 기존 응답 상충이 있어 신규helper/외부patch 준비. 통합 전 정상수정 완료로 표시하지 않는다. 제안409에는 actualDisposition/requestedDisposition,503에는UNCONFIRMED. |
| Worker ACK | workers/runner.mjs:157–159, SQL20261011132924:20–179 | 요청/외부송금/해제의 원래 outbox ACK. 추가 송금·원장·알림을 재발행하는 명령이 아니다. 정상3원본/lease/response-loss DB 검증 대기. |
| 추천 미션2 | SQL20261011110300:64–79/217–218, SQL20261011112058:38–84 | 원래 REFERRAL_REWARD_PAID sealed source와 같은 트랜잭션의 비금전 BADGE/TITLE. production 활성화·보상20종 완료를 뜻하지 않는다. |
| 안내 이벤트 | domain/content/source-preview.ts:258–297/350–368, events participation handler:62–69 | 안내20은 GUIDE/NONE. 참여실적/금전 청구를 만들지 않는다. QA20/production20과 분리한다. |
| CMS | domain/content/contract.ts:66–170, apps/admin/lib/content/handler.ts:175–240 | EVENT/NOTICE/FAQ의 DRAFT→PREVIEWED→APPROVED→PUBLISHED와 revision/digest/readback. 원고 생성은 게시 완료가 아니다. |
| 공지 CTA | domain/content/member-notice.ts:4–17, SQL20261011033000:260–262 | private snapshot CTA와 member response가 아직 연결되지 않았다. 기존API가 CTA를 제공한다고 가정해 화면을 완성하지 않는다. |
| 콘텐츠 운영AI | apps/admin/lib/assistant/content-source-preparation.ts | 기존 preview endpoint를 재사용하는 원문 준비 catalog. 실제 AI provider/tool 실행·게시·지급권한 없음. |
| 상품6분류 | domain/products/catalog-server.ts:9–18/43–55 | KR_STOCK/US_STOCK/ETF/GOLD/SILVER/CRYPTO server category.11원본DRAFT 보존, ETF 승인 데이터와 기존5분류UI 통합 별도. |
| AI 감사 | app/api/v1/ai/chat/route.ts, lib/ai/usage.ts, tests/unit/ai-chat-audit-persistence-failure.test.ts |195에 audit failure 경로와 회귀 명세 있음. 실제 응답유실/cancel/provider/DB 검증 없이 전체AI 완료로 표현하지 않는다. |

정확한 정책: fee 영구0, 운영자 수동확인·직접송금 후 처리. provider/AI는
경제값·자격·승인·원장 완료를 대신 결정하지 않는다. 30일/HOLD/정산의 미정
경제값을 목업에서 추정하지 말고 승인된 서버 계약과 최신 원본을 대조한다.

UI 상태 계약에는 loading/success/error/UNCONFIRMED/unauthorized/empty/retry를
구분한다. 원장·actual server status를 권위로 사용하고 애니메이션·낙관적
화면 완료를 금전 지급 증거로 사용하지 않는다. UI_INTEGRATION_PENDING.

필수 후속 검증은 source-only validation matrix와 독립 HTTP/Auth 및
referral/content/catalog 보고서에 정리했다. 과거193 focused408PASS는 현재195
전체/native/HTTP/Worker PASS가 아니며 이 작업의 실행은0이다.
