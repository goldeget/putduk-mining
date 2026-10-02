-- 운영 화면은 서비스 연결로 송금 기록을 읽는다.
-- SELECT가 없으면 조회 오류로 보여 출금 작업이 항상 잠긴다.

grant select on table public.crypto_withdrawals to service_role;
