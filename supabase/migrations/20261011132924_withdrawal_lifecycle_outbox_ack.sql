begin;

-- These events acknowledge financial work already committed by the command.
-- They never release a hold, send money, finalize a withdrawal, or notify a device.
create function app_private.ack_withdrawal_lifecycle_outbox(p_event uuid,p_worker text)
returns void language plpgsql volatile security definer set search_path=pg_catalog as $$
declare
  e public.outbox_events%rowtype;
  r public.withdrawal_requests%rowtype;
  s public.withdrawal_external_sends%rowtype;
  h public.ledger_transactions%rowtype;
  t public.ledger_transactions%rowtype;
  d public.event_consumer_deliveries%rowtype;
  original jsonb;
  expected_key text;
  total numeric;
begin
  -- Narrow closed executor: table INSERT remains revoked from service_role.
  -- Definer elevation is limited to reading originals and appending this receipt.
  if current_user<>'postgres'
    or current_setting('role',true) is distinct from 'service_role'
    or auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='WITHDRAWAL_ACK_CLOSED_EXECUTOR_REQUIRED';
  end if;
  if char_length(btrim(coalesce(p_worker,''))) not between 1 and 120 then
    raise exception using errcode='22023',message='INVALID_OUTBOX_CLAIM_CONTEXT';
  end if;
  select * into e from public.outbox_events where id=p_event for update;
  if e.id is null or e.status is distinct from 'PROCESSING'::public.outbox_status
    or e.lease_owner is distinct from p_worker
    or e.lease_expires_at is null or e.lease_expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';
  end if;
  if e.schema_version is distinct from 1 or e.aggregate_type is distinct from 'withdrawal_request'
    or e.event_type not in ('WITHDRAWAL_REQUESTED.v1','WITHDRAWAL_EXTERNAL_SENT.v1','WITHDRAWAL_HOLD_RELEASED.v1') then
    raise exception using errcode='55000',message='WITHDRAWAL_LIFECYCLE_EVENT_REQUIRED';
  end if;
  select * into r from public.withdrawal_requests where id=e.aggregate_id;
  select * into h from public.ledger_transactions where id=r.hold_ledger_transaction_id;
  total:=r.amount_atomic::numeric+r.fee_atomic::numeric;
  -- Account identity and journals are immutable under the existing triggers.
  -- Do not require a current HELD status: late delivery after completion is valid.
  if r.id is null or r.currency is distinct from 'KRW'::public.currency_code
    or r.amount_atomic<=0 or r.fee_atomic<0
    or h.id is null or h.category is distinct from 'WITHDRAWAL'::public.ledger_transaction_category
    or h.currency is distinct from r.currency or h.member_user_id is distinct from r.user_id
    or h.reference_type is distinct from 'withdrawal_request' or h.reference_id is distinct from r.id
    or h.metadata->>'phase' is distinct from 'HOLD'
    or h.metadata->>'amount_atomic' is distinct from total::text
    or h.idempotency_key is distinct from r.idempotency_key||':hold'
    or h.posted_at is null
    or not exists(select 1 from public.wallet_accounts w
      where w.id=r.wallet_account_id and w.user_id=r.user_id and w.currency='KRW')
    or (select count(*) from public.ledger_entries where transaction_id=h.id)<>2
    or (select count(*) from public.ledger_entries le join public.ledger_accounts a on a.id=le.account_id
      where le.transaction_id=h.id and le.amount_atomic=total and a.currency='KRW'
        and ((le.sequence=0 and le.side='DEBIT' and a.owner_user_id=r.user_id
          and a.code='USER:'||upper(r.user_id::text)||':KRW:LIABILITY'
          and a.account_class='LIABILITY' and a.normal_side='CREDIT')
        or (le.sequence=1 and le.side='CREDIT' and a.owner_user_id is null
          and a.code='PUTDUK:WITHDRAWAL_HOLD:KRW'
          and a.account_class='CLEARING' and a.normal_side='CREDIT')))<>2 then
    raise exception using errcode='55000',message='WITHDRAWAL_HOLD_ORIGINAL_REQUIRED';
  end if;

  if e.event_type='WITHDRAWAL_REQUESTED.v1' then
    original:=jsonb_build_object('user_id',r.user_id,'amount_atomic',r.amount_atomic::text,
      'fee_atomic',r.fee_atomic::text,'currency','KRW','destination_type',r.destination_type,
      'hold_ledger_transaction_id',h.id,'welcome_reward',r.welcome_reward_conversion_id is not null);
    expected_key:=r.idempotency_key||':event';
    if e.actor_user_id is distinct from r.user_id or e.request_id is distinct from h.request_id
      or e.occurred_at is distinct from h.posted_at
      or not exists(select 1 from public.transaction_receipts tr
        where tr.source_type='withdrawal_request' and tr.source_id=r.id and tr.user_id=r.user_id
          and tr.currency='KRW' and tr.amount_atomic=r.amount_atomic) then
      raise exception using errcode='55000',message='WITHDRAWAL_REQUEST_ORIGINAL_REQUIRED';
    end if;
  elsif e.event_type='WITHDRAWAL_EXTERNAL_SENT.v1' then
    select * into s from public.withdrawal_external_sends where withdrawal_id=r.id;
    if s.id is null or s.method is distinct from r.destination_type
      or e.actor_user_id is distinct from s.operator_user_id
      or not exists(select 1 from public.audit_logs a
        where a.action=case s.method when 'KRW_BANK' then 'record_krw_external_send' else 'record_usdt_external_send' end
          and a.actor_user_id=s.operator_user_id and a.target_type='withdrawal_external_send'
          and a.target_id=s.id::text and a.metadata->>'result_id'=s.id::text
          and a.metadata->>'idempotency_key'=s.idempotency_key
          and a.metadata->>'withdrawal_id'=r.id::text) then
      raise exception using errcode='55000',message='WITHDRAWAL_EXTERNAL_SEND_ORIGINAL_REQUIRED';
    end if;
    expected_key:=s.idempotency_key||':event';
    if s.method='KRW_BANK' then
      if s.bank_reference is null or s.bank_reference is distinct from btrim(s.bank_reference)
        or char_length(s.bank_reference)<4 then
        raise exception using errcode='55000',message='WITHDRAWAL_EXTERNAL_SEND_ORIGINAL_REQUIRED';
      end if;
      original:=jsonb_build_object('method','KRW_BANK','bank_reference',s.bank_reference,
        'actual_krw_amount',s.actual_krw_amount::text);
      if s.actual_krw_amount is distinct from r.amount_atomic then
        raise exception using errcode='55000',message='WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH';
      end if;
    elsif s.method='USDT_ADDRESS' then
      if s.network is null or s.network not in ('TRC20','ERC20','BEP20')
        or s.tx_hash is null or s.tx_hash is distinct from lower(btrim(s.tx_hash))
        or char_length(s.tx_hash) not between 8 and 128
        or s.actual_usdt_amount is null or s.actual_usdt_amount::text in ('NaN','Infinity','-Infinity')
        or s.actual_usdt_amount<=0 then
        raise exception using errcode='55000',message='WITHDRAWAL_EXTERNAL_SEND_ORIGINAL_REQUIRED';
      end if;
      -- Preserve numeric input text (4.25) versus stored numeric(38,6) (4.250000).
      if jsonb_typeof(e.payload->'actual_usdt_amount') is distinct from 'string'
        or coalesce(e.payload->>'actual_usdt_amount','') !~ '^(0|[1-9][0-9]{0,31})([.][0-9]{1,6})?$' then
        raise exception using errcode='55000',message='WITHDRAWAL_EXTERNAL_SEND_ORIGINAL_REQUIRED';
      end if;
      if (e.payload->>'actual_usdt_amount')::numeric is distinct from s.actual_usdt_amount then
        raise exception using errcode='55000',message='WITHDRAWAL_EXTERNAL_SEND_ORIGINAL_REQUIRED';
      end if;
      original:=jsonb_build_object('method','USDT_ADDRESS','network',s.network,'tx_hash',s.tx_hash,
        'actual_usdt_amount',e.payload->>'actual_usdt_amount',
        'conversion_evidence_present',s.conversion_evidence is not null);
      -- Historical receipts remain immutable evidence. This ACK is not a
      -- payout completion and must not invent or backfill a conversion policy.
    else
      raise exception using errcode='55000',message='WITHDRAWAL_EXTERNAL_SEND_ORIGINAL_REQUIRED';
    end if;
  else
    select * into t from public.ledger_transactions where id=r.release_ledger_transaction_id;
    if t.id is null or t.category is distinct from 'REVERSAL'::public.ledger_transaction_category
      or t.currency is distinct from r.currency or t.member_user_id is distinct from r.user_id
      or t.reference_type is distinct from 'withdrawal_request' or t.reference_id is distinct from r.id
      or t.reversal_of_transaction_id is distinct from h.id
      or t.metadata->>'phase' is distinct from 'RELEASE'
      or r.status::text not in ('CANCELLED','REJECTED')
      or t.metadata->>'disposition' is distinct from r.status::text
      or t.metadata->>'reason' is distinct from r.rejection_reason
      or t.created_by is distinct from r.reviewed_by or e.actor_user_id is distinct from t.created_by
      or e.request_id is distinct from t.request_id or e.occurred_at is distinct from t.posted_at
      or char_length(btrim(coalesce(t.metadata->>'reason','')))<4
      or t.idempotency_key not like '%:release'
      or exists(select 1 from public.withdrawal_external_sends where withdrawal_id=r.id)
      or (select count(*) from public.ledger_entries where transaction_id=t.id)<>2
      or (select count(*) from public.ledger_entries le join public.ledger_accounts a on a.id=le.account_id
        where le.transaction_id=t.id and le.amount_atomic=total and a.currency='KRW'
          and ((le.sequence=0 and le.side='DEBIT' and a.code='PUTDUK:WITHDRAWAL_HOLD:KRW'
            and a.owner_user_id is null and a.account_class='CLEARING' and a.normal_side='CREDIT')
          or (le.sequence=1 and le.side='CREDIT' and a.owner_user_id=r.user_id
            and a.code='USER:'||upper(r.user_id::text)||':KRW:LIABILITY'
            and a.account_class='LIABILITY' and a.normal_side='CREDIT')))<>2
      or not exists(select 1 from public.audit_logs a where a.action='release_withdrawal_hold'
        and a.target_type='withdrawal_request' and a.target_id=r.id::text
        and a.actor_user_id=t.created_by and a.metadata->>'result_id'=t.id::text
        and a.metadata->>'disposition'=r.status::text
        and a.metadata->>'idempotency_key'=left(t.idempotency_key,length(t.idempotency_key)-length(':release'))) then
      raise exception using errcode='55000',message='WITHDRAWAL_RELEASE_ORIGINAL_REQUIRED';
    end if;
    expected_key:=left(t.idempotency_key,length(t.idempotency_key)-length(':release'))||':event';
    original:=jsonb_build_object('release_ledger_transaction_id',t.id,
      'reason',t.metadata->>'reason','disposition',t.metadata->>'disposition');
  end if;
  if e.payload is distinct from original or e.idempotency_key is distinct from expected_key
    or char_length(btrim(left(expected_key,length(expected_key)-length(':event')))) not between 8 and 200
    or (select count(*) from public.outbox_events where event_type=e.event_type
      and aggregate_type=e.aggregate_type and aggregate_id=e.aggregate_id)<>1 then
    raise exception using errcode='55000',message='WITHDRAWAL_EVENT_ORIGINAL_MISMATCH';
  end if;
  insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
    values(e.id,'withdrawal_lifecycle_ack.v1','SUCCEEDED',1,clock_timestamp())
    on conflict(event_id,consumer_name) do nothing;
  select * into d from public.event_consumer_deliveries
    where event_id=e.id and consumer_name='withdrawal_lifecycle_ack.v1';
  if d.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status
    or d.attempt_count is distinct from 1 or d.processed_at is null
    or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then
    raise exception using errcode='55000',message='WITHDRAWAL_ACK_RECEIPT_INVALID';
  end if;
  update public.outbox_events set status='PROCESSED',processed_at=clock_timestamp(),
    lease_owner=null,lease_expires_at=null,last_error_code=null
    where id=e.id and status='PROCESSING' and lease_owner=p_worker
      and lease_expires_at>clock_timestamp();
  if not found then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED'; end if;
end;
$$;
alter function app_private.ack_withdrawal_lifecycle_outbox(uuid,text) owner to postgres;
revoke all on function app_private.ack_withdrawal_lifecycle_outbox(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function app_private.ack_withdrawal_lifecycle_outbox(uuid,text) to service_role;

-- Preserve the existing dispatcher alias and the existing nonmoney award lane.
create or replace function public.complete_outbox_event(p_event_id uuid,p_worker_id text)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if exists(select 1 from public.outbox_events where id=p_event_id
    and event_type='EVENT_REWARD_GRANTED.v1') then
    perform app_private.ack_nonmoney_award_outbox(p_event_id,p_worker_id);
  elsif exists(select 1 from public.outbox_events where id=p_event_id
    and event_type in ('WITHDRAWAL_REQUESTED.v1','WITHDRAWAL_EXTERNAL_SENT.v1','WITHDRAWAL_HOLD_RELEASED.v1')) then
    perform app_private.ack_withdrawal_lifecycle_outbox(p_event_id,p_worker_id);
  else
    perform app_private.complete_system_outbox_original(p_event_id,p_worker_id);
  end if;
end;
$$;
alter function public.complete_outbox_event(uuid,text) owner to postgres;
revoke all on function public.complete_outbox_event(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_outbox_event(uuid,text) to service_role;
commit;
