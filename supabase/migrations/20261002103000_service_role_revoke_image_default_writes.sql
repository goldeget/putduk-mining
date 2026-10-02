-- 로컬 이미지 public.ecr.aws/supabase/postgres:17.6.1.158 (server_version 17.6).
-- 테이블을 만들 때 붙은 service_role 기본 권한 중, 호출 경로가 없는 쓰기를 거둔다.
-- 조회한 결과 DELETE/TRUNCATE/REFERENCES/TRIGGER 는 제품 GRANT 가 아니고,
-- MAINTAIN(m) 만 거의 모든 public 관계에 남아 있었다.
-- service_role 은 RLS 를 우회한다. VACUUM/LOCK/REINDEX 호출은 없다.
--
-- 새 객체와 기존 객체를 구분한다.
-- 20261001152950 이 postgres 의 public 테이블 기본 권한에서 service_role 을 이미 거뒀다.
-- 이 파일은 postgres 가 만드는 함수 EXECUTE 와 시퀀스 권한의 기본값만 추가로 거둔다.
-- 기존 함수 EXECUTE 는 제품 GRANT 를 유지한다.
-- supabase_admin 의 기본 ACL 과 auth/storage 등 관리 스키마는 바꾸지 않는다.
-- public 테이블 소유자는 postgres 다. 앱 migration 생성 경로는 postgres 다.
-- supabase_admin 이 public 객체를 만들면 이미지 기본 권한이 다시 붙는다.
-- 그 경로는 이 저장소 migration 이 아니므로 여기서 역할을 고치지 않는다.

alter default privileges for role postgres in schema public
  revoke execute on functions from service_role;

-- 함수의 내장 기본값은 PUBLIC EXECUTE 다. proacl 이 null 이면 PUBLIC 으로 실행된다.
-- 스키마 기본 ACL 에서 service_role 만 거두면 그 내장 권한이 남고,
-- service_role 도 PUBLIC 을 통해 새 함수를 실행할 수 있다.
-- postgres 역할의 전역 기본값에서 PUBLIC EXECUTE 를 거둔다.
-- 그러면 새 함수의 proacl 은 postgres 만 남는다.
-- 기존 함수의 GRANT 와 supabase_admin 기본 ACL 은 바꾸지 않는다.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke all on sequences from service_role;

revoke all privileges on all sequences in schema public from service_role;

do $revoke_image_writes$
declare
  relation record;
begin
  for relation in
    select c.relname
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v')
  loop
    execute format(
      'revoke delete, truncate, references, trigger, maintain on table public.%I from service_role',
      relation.relname
    );
  end loop;
end
$revoke_image_writes$;

revoke maintain, delete, truncate, references, trigger on table
  app_private.command_rate_limits,
  app_private.idempotency_keys
from service_role;

-- 이미지에만 있던 INSERT. 제품 GRANT 와 SECURITY INVOKER 쓰기에는 없다.
revoke insert on table
  public.ai_knowledge,
  public.ai_reports,
  public.asset_reference_rates,
  public.asset_worlds,
  public.bank_deposits,
  public.block_history,
  public.block_rules,
  public.crypto_deposits,
  public.crypto_transactions,
  public.crypto_withdrawals,
  public.event_consumer_deliveries,
  public.event_participants,
  public.event_reward_claims,
  public.event_rewards,
  public.event_rules,
  public.events,
  public.experiment_assignments,
  public.feature_flags,
  public.mining_products,
  public.mining_settlement_segments,
  public.mining_settlements,
  public.mining_status_history,
  public.notices,
  public.notification_deliveries,
  public.notifications,
  public.product_availability,
  public.product_catalog_versions,
  public.product_rule_versions,
  public.product_visuals,
  public.promotion_campaigns,
  public.promotion_reward_claims,
  public.promotion_rule_versions,
  public.push_subscriptions,
  public.rank_definitions,
  public.referral_attributions,
  public.referral_program_versions,
  public.referral_qualifications,
  public.referral_reward_claims,
  public.risk_flags,
  public.system_status,
  public.trial_account_snapshots,
  public.trust_documents,
  public.trust_facts,
  public.trust_sources,
  public.trust_versions,
  public.user_rank_progress,
  public.wallet_balance_snapshots,
  public.world_instruments
from service_role;

-- 이미지에만 있던 UPDATE. 아래 GRANT 로 호출 경로가 있는 것만 되돌린다.
revoke update on table
  public.ai_knowledge,
  public.ai_reports,
  public.analytics_events,
  public.asset_reference_rates,
  public.audit_logs,
  public.bank_deposits,
  public.block_history,
  public.block_rules,
  public.crypto_deposits,
  public.crypto_transactions,
  public.crypto_withdrawals,
  public.deposit_requests,
  public.event_consumer_deliveries,
  public.event_participants,
  public.event_reward_claims,
  public.event_rewards,
  public.event_rules,
  public.events,
  public.experiment_assignments,
  public.feature_flags,
  public.kyc_document_view_audit,
  public.kyc_status_history,
  public.kyc_submissions,
  public.ledger_entries,
  public.member_timeline_events,
  public.mining_products,
  public.mining_settlement_segments,
  public.mining_settlements,
  public.mining_status_history,
  public.notices,
  public.notification_deliveries,
  public.notifications,
  public.product_availability,
  public.product_catalog_versions,
  public.product_rule_versions,
  public.product_visuals,
  public.promotion_campaigns,
  public.promotion_reward_claims,
  public.promotion_rule_versions,
  public.push_subscriptions,
  public.rank_definitions,
  public.referral_attributions,
  public.referral_program_versions,
  public.referral_qualifications,
  public.referral_reward_claims,
  public.risk_flags,
  public.security_events,
  public.signup_phone_history,
  public.system_status,
  public.trial_account_snapshots,
  public.trial_completions,
  public.trial_ledger,
  public.trial_qualification_snapshots,
  public.trial_reward_curve_points,
  public.trial_reward_curves,
  public.trust_documents,
  public.trust_facts,
  public.trust_sources,
  public.trust_versions,
  public.usdt_deposit_instruction_events,
  public.user_rank_progress,
  public.wallet_balance_snapshots,
  public.wallet_ledger,
  public.withdrawal_destination_history,
  public.withdrawal_external_sends,
  public.world_instruments
from service_role;

-- approve_deposit_request 는 SECURITY INVOKER 이고 deposit_requests 를 UPDATE 한다.
-- 호출: apps/admin/app/api/v1/admin/deposits/approve/route.ts
grant update on table public.deposit_requests to service_role;

-- upsert_push_subscription / revoke_push_subscription 는 SECURITY INVOKER 다.
-- INSERT, UPDATE, 그리고 revoke 함수의 SELECT 가 필요하다.
-- 호출: app/api/v1/notifications/subscriptions/route.ts
-- 기존 public 시퀀스는 없다. identity/serial 컬럼도 없다. 번호 발급 GRANT 는 두지 않는다.
grant select, insert, update on table public.push_subscriptions to service_role;

-- 관리자 서비스 클라이언트의 실제 SELECT. 쓰기 권한은 붙이지 않는다.
-- block_rules: apps/admin/app/(control)/restrictions/page.tsx
-- event_participants, notifications: apps/admin/app/(control)/members/page.tsx
grant select on table
  public.block_rules,
  public.event_participants,
  public.notifications
to service_role;

-- record_mining_settlement 는 SECURITY INVOKER 이지만 앱과 worker 호출이 없다.
-- 20261001152950 과 mining_read_model_least_privilege 테스트가
-- mining_sessions INSERT 를 금지한다. 그 쓰기는 복구하지 않는다.
-- ai_requests / ai_usage / ai_cache / withdrawal_destination_step_ups 의
-- 컬럼 단위 GRANT 는 테이블 단위 INSERT/UPDATE 가 아니므로 여기서 거두지 않는다.
