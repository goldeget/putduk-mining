-- 인증 브라우저 증거가 읽기 전용 채굴 상태를 준비할 때 쓰는 서비스 롤 권한이다.
-- 회원용 시작·중지·장비 구매 명령은 없다. 운영 채굴 단가도 넣지 않는다.

grant select, insert on table public.world_rules to service_role;
grant select, insert on table public.world_rule_versions to service_role;

grant select, insert on table public.mining_farms to service_role;
grant select, insert on table public.mining_equipment to service_role;
grant select, insert on table public.mining_sessions to service_role;

grant update (is_active) on table public.asset_worlds to service_role;

grant select on table public.mining_active_session_snapshots to service_role;
