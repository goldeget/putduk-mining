-- 로컬 Postgres 17.11 이미지가 public 테이블 기본 권한으로 service_role에 모든 권한을 준다.
-- 제품이 명시한 grant만 남기고, 테스트가 금지한 쓰기·조회는 다시 거둔다.

alter default privileges for role postgres in schema public
  revoke all on tables from service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.mining_sessions
  from service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.mining_farms
  from service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.mining_equipment
  from service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.world_rules
  from service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.world_rule_versions
  from service_role;

revoke update on table public.asset_worlds from service_role;

revoke select, insert, update, delete, truncate, references, trigger
  on table public.mining_active_session_snapshots
  from service_role;

revoke delete, truncate
  on table public.withdrawal_logical_requests
  from service_role;
