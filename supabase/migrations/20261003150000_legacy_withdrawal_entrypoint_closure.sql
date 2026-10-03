begin;

-- Close the retired application/service entrypoint only. Its historical owner
-- fixture body and existing requests stay intact; no replacement writer, source
-- inference or data backfill is introduced. WS-04 request4 and START are unchanged.
revoke execute on function public.create_withdrawal_request(
  uuid, uuid, uuid, bigint, text, jsonb, text
) from public, anon, authenticated, service_role;

commit;
