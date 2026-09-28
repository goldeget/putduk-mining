-- 서버 수집(/api/v1/analytics)은 service_role INSERT다.
-- PostgREST RETURNING에는 SELECT가 필요하다.
-- authenticated의 직접 INSERT는 허용하지 않는다.

grant select, insert on table public.analytics_events to service_role;
