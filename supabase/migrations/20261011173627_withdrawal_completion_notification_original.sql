begin;
-- Successor-only notification adapter. Native139/coverage129 financial writers,
-- strict principal mission originals, policies and historical rows are unchanged.
create function app_private.read_nonprincipal_withdrawal_notification_original(p_source uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare
 e public.outbox_events%rowtype; r public.withdrawal_requests%rowtype;
 t public.ledger_transactions%rowtype; h public.ledger_transactions%rowtype;
 s public.withdrawal_external_sends%rowtype; destination_original public.withdrawal_destination_history%rowtype;
 receipt public.transaction_receipts%rowtype; audit public.audit_logs%rowtype;
 wallet public.wallet_ledger%rowtype; original jsonb; source_originals jsonb;
 effective_at timestamptz; base_key text;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
  or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';
 end if;
 select * into e from public.outbox_events where id=p_source;
 select * into r from public.withdrawal_requests where id=e.aggregate_id;
 if e.id is null or e.event_type is distinct from 'WITHDRAWAL_COMPLETED.v1'
  or e.schema_version is distinct from 1 or e.aggregate_type is distinct from 'withdrawal_request'
  or r.id is null or r.status is distinct from 'COMPLETED'::public.withdrawal_status
  or r.currency is distinct from 'KRW'::public.currency_code or r.fee_atomic is distinct from 0
  or r.amount_atomic is null or r.amount_atomic<=0 or r.user_id is null
  or r.finalize_ledger_transaction_id is null or r.ledger_finalized_at is null
  or r.release_ledger_transaction_id is not null then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_ORIGINAL_REQUIRED';
 end if;
 -- A missing typed principal clock must fail through the original strict reader.
 -- It is never reclassified as an ordinary reward/START completion.
 if exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=r.id)
  or exists(select 1 from public.funding_principal_recovery_allocations a where a.hold_ledger_transaction_id=r.hold_ledger_transaction_id)
  or exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=r.id and a.phase='FINALIZE') then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_SOURCE_REQUIRED';
 end if;
 -- The existing immutable source validator checks exact source qualification,
 -- balanced entries/account identities, wallet debit, audit and terminal receipts.
 if app_private.non_principal_withdrawal_coverage_verified(r) is not true then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_SOURCE_REQUIRED';
 end if;
 select * into t from public.ledger_transactions where id=r.finalize_ledger_transaction_id;
 select * into h from public.ledger_transactions where id=r.hold_ledger_transaction_id;
 effective_at:=t.posted_at;
 base_key:=left(t.idempotency_key,length(t.idempotency_key)-9);
 if t.id is null or h.id is null or effective_at is null or not isfinite(effective_at)
  or effective_at>clock_timestamp() or r.ledger_finalized_at is distinct from effective_at
  or e.occurred_at is distinct from effective_at or e.created_at is distinct from effective_at
  or e.request_id is distinct from t.request_id or e.actor_user_id is distinct from t.created_by
  or e.idempotency_key is distinct from base_key||':event'
  or e.payload is distinct from jsonb_build_object('finalize_ledger_transaction_id',t.id,'amount_atomic',r.amount_atomic::text) then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_CLOCK_OR_ENVELOPE_MISMATCH';
 end if;
 if (select count(*) from public.withdrawal_external_sends x where x.withdrawal_id=r.id)<>1 then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_SEND_REQUIRED';
 end if;
 select * into s from public.withdrawal_external_sends where withdrawal_id=r.id;
 if s.method is distinct from r.destination_type then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_SEND_REQUIRED';
 end if;
 if s.method='KRW_BANK' then
  if s.actual_krw_amount is distinct from r.amount_atomic then
   raise exception using errcode='55000',message='WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH';
  end if;
 elsif s.method='USDT_ADDRESS' then
  if (select count(*) from public.withdrawal_destination_history d
   where d.destination_id=r.withdrawal_destination_id and d.action='REGISTERED')<>1 then
   raise exception using errcode='55000',message='USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED';
  end if;
  select * into destination_original from public.withdrawal_destination_history
   where destination_id=r.withdrawal_destination_id and action='REGISTERED';
  if destination_original.user_id is distinct from r.user_id
   or destination_original.destination_type is distinct from 'USDT_ADDRESS'
   or jsonb_typeof(destination_original.metadata->'network') is distinct from 'string'
   or coalesce(destination_original.metadata->>'network','') not in('TRC20','ERC20','BEP20')
   or s.network is distinct from destination_original.metadata->>'network' then
   raise exception using errcode='55000',message='USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED';
  end if;
  perform app_private.assert_usdt_manual_full_payout(r.id,r.amount_atomic,r.fee_atomic,s.network,s.actual_usdt_amount,s.conversion_evidence);
 else
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_SEND_REQUIRED';
 end if;
 if (select count(*) from public.transaction_receipts x where x.source_type='withdrawal_request' and x.source_id=r.id)<>1 then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_RECEIPT_REQUIRED';
 end if;
 select * into receipt from public.transaction_receipts where source_type='withdrawal_request' and source_id=r.id;
 if receipt.user_id is distinct from r.user_id or receipt.currency is distinct from 'KRW'::public.currency_code
  or receipt.amount_atomic is distinct from r.amount_atomic or receipt.status is distinct from 'COMPLETED'
  or receipt.ledger_transaction_id is distinct from t.id or receipt.completed_at is distinct from effective_at then
  raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_RECEIPT_REQUIRED';
 end if;
  -- Reject ambiguous audit originals before selecting a snapshot row. Coverage
  -- already requires one fully qualified audit; extra partial matches cannot be borrowed.
  if (select count(*) from public.audit_logs x where x.action='finalize_withdrawal_ledger'
   and x.target_type='withdrawal_request' and x.target_id=r.id::text and x.actor_user_id=t.created_by
   and x.metadata->>'operation'='finalize_withdrawal_ledger' and x.metadata->>'result_id'=t.id::text
   and x.metadata->>'idempotency_key'=base_key)<>1 then
   raise exception using errcode='55000',message='NONPRINCIPAL_WITHDRAWAL_NOTIFICATION_AUDIT_REQUIRED';
  end if;
 select * into audit from public.audit_logs x where x.action='finalize_withdrawal_ledger'
  and x.target_type='withdrawal_request' and x.target_id=r.id::text and x.actor_user_id=t.created_by
  and x.metadata->>'operation'='finalize_withdrawal_ledger' and x.metadata->>'result_id'=t.id::text
  and x.metadata->>'idempotency_key'=base_key;
 select * into wallet from public.wallet_ledger x where x.reference_type='withdrawal_request' and x.reference_id=r.id;
 if r.welcome_reward_conversion_id is null then
  select jsonb_build_object('kind','MINING_REWARD','reservations',
   (select jsonb_agg(to_jsonb(x) order by x.id) from public.mining_reward_withdrawal_reservations x where x.hold_ledger_transaction_id=h.id),
   'credits',(select jsonb_agg(to_jsonb(c) order by c.id) from public.money_source_movements c
    where c.id in(select x.credit_movement_id from public.mining_reward_withdrawal_reservations x where x.hold_ledger_transaction_id=h.id)),
   'terminal_movements',(select jsonb_agg(to_jsonb(x) order by x.id) from public.money_source_movements x where x.ledger_transaction_id=t.id)) into source_originals;
 else
  select jsonb_build_object('kind','WELCOME_REWARD','conversion',to_jsonb(c),
   'qualification_snapshots',(select jsonb_agg(to_jsonb(x) order by x.id) from public.trial_qualification_snapshots x where x.conversion_id=c.id),
   'credits',(select jsonb_agg(to_jsonb(x) order by x.id) from public.money_source_movements x where x.ledger_transaction_id=c.ledger_transaction_id))
  into source_originals from public.trial_reward_conversions c where c.id=r.welcome_reward_conversion_id;
 end if;
 original:=jsonb_build_object('domain_id',r.id,'domain_kind','withdrawal_request','member_id',r.user_id,
  'effective_at',effective_at,'notification_contract','NONPRINCIPAL_COMPLETED_V1',
  'withdrawal_original',jsonb_build_object('id',r.id,'user_id',r.user_id,'wallet_account_id',r.wallet_account_id,
   'currency',r.currency,'amount_atomic',r.amount_atomic::text,'fee_atomic',r.fee_atomic::text,
   'destination_type',r.destination_type,'withdrawal_destination_id',r.withdrawal_destination_id,
   'hold_ledger_transaction_id',h.id,'finalize_ledger_transaction_id',t.id,'ledger_finalized_at',r.ledger_finalized_at,
   'welcome_reward_conversion_id',r.welcome_reward_conversion_id,'status',r.status),
  'ledger_original',to_jsonb(t),'hold_original',to_jsonb(h),
  'hold_entries',(select jsonb_agg(to_jsonb(x) order by x.sequence) from public.ledger_entries x where x.transaction_id=h.id),
  'finalize_entries',(select jsonb_agg(to_jsonb(x) order by x.sequence) from public.ledger_entries x where x.transaction_id=t.id),
  'send_original',to_jsonb(s),'destination_registered_original',case when s.method='USDT_ADDRESS' then to_jsonb(destination_original) else null end,
  'receipt_original',to_jsonb(receipt)-'updated_at','audit_original',to_jsonb(audit),'wallet_original',to_jsonb(wallet),
  'source_originals',source_originals,'source_event_id',e.id,'source_type',e.event_type,'schema_version',e.schema_version,
  'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',r.user_id,'effective_at',effective_at,'source_event_id',e.id,'source_type',e.event_type,
  'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;
alter function app_private.read_nonprincipal_withdrawal_notification_original(uuid) owner to postgres;
revoke all on function app_private.read_nonprincipal_withdrawal_notification_original(uuid) from public,anon,authenticated,service_role;

create or replace function app_private.read_domain_notification_original(p_source uuid)returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;t public.ledger_transactions%rowtype;
 original jsonb;cash app_private.local_cash_originals%rowtype;pending app_private.local_cash_pending%rowtype;
begin
 perform app_private.assert_push_worker_context();
 select * into e from public.outbox_events where id=p_source;
 if e.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')then
  select * into cash from app_private.local_cash_originals where source_event_id=e.id;
  perform app_private.assert_local_cash_posting(cash.id,true);
  select * into pending from app_private.local_cash_pending where id=cash.pending_id;
  return jsonb_build_object('member_id',pending.beneficiary_user_id,'effective_at',cash.effective_at,
   'source_event_id',e.id,'source_type',e.event_type,'source_digest',cash.digest,'original',cash.snapshot);
 end if;
 -- Notification acceptance is separate from typed principal mission eligibility.
 if e.event_type='WITHDRAWAL_COMPLETED.v1' and not exists(
  select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=e.aggregate_id)
  and not exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=e.aggregate_id and a.phase='FINALIZE') then
  return app_private.read_nonprincipal_withdrawal_notification_original(p_source);
 end if;
 if e.event_type is distinct from 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then
  return app_private.read_nonmoney_mission_original(p_source);
 end if;
 if e.schema_version<>1 or e.aggregate_type<>'usdt_manual_deposit'
  or(select count(*)from public.money_source_movements where source_event_id=e.id
   and movement_kind='CREDIT'and origin_code='USDT_KRW_DEPOSIT')<>1 then
  raise exception using errcode='55000',message='DOMAIN_USDT_SOURCE_ORIGINAL_REQUIRED';end if;
 select * into m from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT'and origin_code='USDT_KRW_DEPOSIT';
 -- Existing immutable domain/credit/journal/wallet/audit/completed-idempotency validator.
 perform app_private.assert_money_source_credit_complete(m);
 select * into t from public.ledger_transactions where id=m.ledger_transaction_id;
 if m.user_id is null or m.effective_at is null or m.effective_at>clock_timestamp()
  or m.effective_at is distinct from t.posted_at then
  raise exception using errcode='55000',message='DOMAIN_USDT_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=jsonb_build_object('credit_movement_id',m.id,'ledger_transaction_id',t.id,'wallet_ledger_id',m.wallet_ledger_id,
  'domain_id',e.aggregate_id,'domain_kind',e.aggregate_type,'member_id',m.user_id,'effective_at',m.effective_at,
  'credit_movement',to_jsonb(m),'ledger_original',to_jsonb(t),'source_event_id',e.id,'source_type',e.event_type,
  'schema_version',e.schema_version,'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',m.user_id,'effective_at',m.effective_at,'source_event_id',e.id,
  'source_type',e.event_type,'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;


create or replace function app_private.consume_nonmoney_source(p_event_id uuid,p_worker_id text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;d public.event_consumer_deliveries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.status is distinct from 'PROCESSING'::public.outbox_status or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<clock_timestamp() then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 -- Validate the actual sealed business original even when no local reward policy is active.
 -- Local reward activation is separate from ordinary domain-event acknowledgement.
 perform app_private.read_domain_notification_original(e.id);
 perform app_private.persist_domain_original_notification(e.id);
 -- Ordinary completed reward/START withdrawals acknowledge and notify only.
 -- The frozen strict mission reader and approved predicates remain unchanged.
 if e.event_type<>'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'
  and (e.event_type<>'WITHDRAWAL_COMPLETED.v1' or exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=e.aggregate_id)) and exists(select 1 from app_private.nonmoney_executor_configuration
  where singleton and local_qa_enabled
   and project_identity='putduk-mining-local-recovery-20261009-fi') then
  perform app_private.evaluate_nonmoney_original(e.id);
 end if;
 insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 values(e.id,'nonmoney_mission_original.v1','SUCCEEDED',1,clock_timestamp()) on conflict(event_id,consumer_name)do nothing;
 select * into d from public.event_consumer_deliveries where event_id=e.id and consumer_name='nonmoney_mission_original.v1';
 if d.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status or d.attempt_count<>1 or d.processed_at is null or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then raise exception using errcode='55000',message='NONMONEY_DELIVERY_INVALID';end if;
end;$$;


commit;
