begin;

-- Operator-attested full manual payout only. This is not an exchange-rate quote,
-- chain verification, automatic transfer, or a fee calculation.
create function app_private.assert_usdt_manual_full_payout(
  p_withdrawal uuid, p_requested_krw bigint, p_fee_krw bigint,
  p_network text, p_actual_usdt numeric, p_evidence jsonb
) returns void language plpgsql immutable security invoker
set search_path=pg_catalog as $$
begin
  if p_evidence is null then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_EVIDENCE_REQUIRED';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'object'
    or p_evidence - array['version','basis','withdrawalId','requestedKrwAmount',
      'actualUsdtAmount','network','feeKrw','fullPayoutConfirmed'] <> '{}'::jsonb
    or p_evidence->'version' is distinct from '1'::jsonb
    or p_evidence->'basis' is distinct from '"OPERATOR_MANUAL_FULL_PAYOUT"'::jsonb
    or p_evidence->'fullPayoutConfirmed' is distinct from 'true'::jsonb
    or p_evidence->'feeKrw' is distinct from '"0"'::jsonb
    or jsonb_typeof(p_evidence->'requestedKrwAmount') is distinct from 'string'
    or coalesce(p_evidence->>'requestedKrwAmount','') !~ '^[1-9][0-9]{0,18}$'
    or jsonb_typeof(p_evidence->'actualUsdtAmount') is distinct from 'string'
    or coalesce(p_evidence->>'actualUsdtAmount','') !~ '^(0|[1-9][0-9]{0,31})([.][0-9]{0,5}[1-9])?$'
    or p_evidence->'withdrawalId' is distinct from to_jsonb(p_withdrawal::text)
    or p_evidence->'network' is distinct from to_jsonb(p_network) then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID';
  end if;
  if p_withdrawal is null or p_requested_krw is null or p_requested_krw<=0
    or p_fee_krw is distinct from 0
    or p_evidence->>'requestedKrwAmount' is distinct from p_requested_krw::text then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH';
  end if;
  if p_network is null or p_network not in ('TRC20','ERC20','BEP20')
    or p_actual_usdt is null or p_actual_usdt::text in ('NaN','Infinity','-Infinity')
    or p_actual_usdt<=0 or scale(p_actual_usdt)>6
    or (p_evidence->>'actualUsdtAmount')::numeric is distinct from p_actual_usdt then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_AMOUNT_MISMATCH';
  end if;
end;
$$;
revoke all on function app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)
  to service_role;

create function app_private.enforce_usdt_manual_full_payout()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
  r public.withdrawal_requests%rowtype;
  s public.withdrawal_external_sends%rowtype;
  h public.withdrawal_destination_history%rowtype;
begin
  if tg_table_name='withdrawal_external_sends' then
    s:=new;
    select * into r from public.withdrawal_requests where id=s.withdrawal_id;
    if r.destination_type is distinct from 'USDT_ADDRESS'
      and s.method is distinct from 'USDT_ADDRESS' then return new; end if;
  elsif tg_table_name='withdrawal_requests' then
    if new.status is not distinct from old.status
      or new.status::text not in ('LEDGER_FINALIZED','COMPLETED') then return new; end if;
    r:=new;
    select * into s from public.withdrawal_external_sends where withdrawal_id=r.id;
    if r.destination_type is distinct from 'USDT_ADDRESS'
      and s.method is distinct from 'USDT_ADDRESS' then return new; end if;
  else
    raise exception using errcode='55000',message='USDT_PAYOUT_TRIGGER_TARGET_INVALID';
  end if;
  if r.id is null or r.currency is distinct from 'KRW'::public.currency_code
    or r.destination_type is distinct from 'USDT_ADDRESS'
    or s.method is distinct from 'USDT_ADDRESS' or s.withdrawal_id is distinct from r.id then
    raise exception using errcode='55000',message='WITHDRAWAL_METHOD_MISMATCH';
  end if;
  -- REGISTERED is append-only. REPLACED metadata describes the replacement,
  -- so it must never be used as the original network of this request.
  if (select count(*) from public.withdrawal_destination_history
    where destination_id=r.withdrawal_destination_id and action='REGISTERED')<>1 then
    raise exception using errcode='55000',message='USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED';
  end if;
  select * into h from public.withdrawal_destination_history
    where destination_id=r.withdrawal_destination_id and action='REGISTERED';
  if h.user_id is distinct from r.user_id or h.destination_type is distinct from 'USDT_ADDRESS'
    or jsonb_typeof(h.metadata->'network') is distinct from 'string'
    or coalesce(h.metadata->>'network','') not in ('TRC20','ERC20','BEP20') then
    raise exception using errcode='55000',message='USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED';
  end if;
  if s.network is distinct from h.metadata->>'network' then
    raise exception using errcode='22023',message='USDT_SEND_NETWORK_MISMATCH';
  end if;
  perform app_private.assert_usdt_manual_full_payout(
    r.id,r.amount_atomic,r.fee_atomic,s.network,s.actual_usdt_amount,s.conversion_evidence);
  return new;
end;
$$;
revoke all on function app_private.enforce_usdt_manual_full_payout()
  from public,anon,authenticated,service_role;
create trigger withdrawal_external_sends_usdt_manual_contract
  before insert on public.withdrawal_external_sends
  for each row execute function app_private.enforce_usdt_manual_full_payout();
create trigger withdrawal_requests_usdt_manual_completion
  before update of status on public.withdrawal_requests
  for each row execute function app_private.enforce_usdt_manual_full_payout();

-- No existing receipts or rows are rewritten. Exact historical send retries
-- still return before INSERT; historical completed reads do not UPDATE status.
-- An uncompleted historical send without full evidence fails closed and needs
-- separately approved reconciliation, never an automatic evidence backfill.
commit;
