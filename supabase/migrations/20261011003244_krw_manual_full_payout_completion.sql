begin;

-- Direct user contract: the operator manually transfers the requested amount,
-- then completes the admin command; the member observes its ledger result.
-- The platform never initiates a bank transfer. New platform fees remain zero.
create function app_private.enforce_krw_manual_payout_amount()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_send public.withdrawal_external_sends%rowtype;
begin
  if tg_table_name = 'withdrawal_external_sends' then
    if new.method = 'KRW_BANK' then
      select r.* into v_request from public.withdrawal_requests r
        where r.id = new.withdrawal_id;
      if v_request.id is null or new.actual_krw_amount is distinct from v_request.amount_atomic then
        raise exception using errcode = '22023', message = 'KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST';
      end if;
    end if;
  elsif tg_table_name = 'withdrawal_requests' then
    if new.status is distinct from old.status
      and new.status::text in ('LEDGER_FINALIZED', 'COMPLETED') then
      select s.* into v_send from public.withdrawal_external_sends s
        where s.withdrawal_id = new.id;
      if new.destination_type = 'KRW_BANK' or v_send.method = 'KRW_BANK' then
        if v_send.id is null or v_send.method is distinct from 'KRW_BANK'
          or v_send.actual_krw_amount is distinct from new.amount_atomic then
          raise exception using errcode = '55000', message = 'WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH';
        end if;
      end if;
    end if;
  else
    raise exception using errcode = '55000', message = 'KRW_PAYOUT_TRIGGER_TARGET_INVALID';
  end if;
  return new;
end;
$$;
revoke all on function app_private.enforce_krw_manual_payout_amount()
  from public, anon, authenticated, service_role;
create trigger withdrawal_external_sends_requested_amount_match
  before insert on public.withdrawal_external_sends
  for each row execute function app_private.enforce_krw_manual_payout_amount();
create trigger withdrawal_requests_recorded_amount_completion
  before update of status on public.withdrawal_requests
  for each row execute function app_private.enforce_krw_manual_payout_amount();

-- Existing immutable sends are not rewritten. A historical mismatch remains
-- evidence requiring reconciliation; it cannot cause a new completion/debit.
-- Completed historical same-key reads remain reads and do not run this trigger.
commit;
