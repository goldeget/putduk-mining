begin;

create function app_private.assert_member_principal_hold_completion(p_withdrawal uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare request public.withdrawal_requests%rowtype;logical public.withdrawal_logical_requests%rowtype;
 original app_private.withdrawal_principal_confirmation_originals%rowtype;
 typed app_private.funding_principal_recovery_intent_originals%rowtype;
begin
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal;
 select l.* into logical from public.withdrawal_logical_requests l where l.idempotency_key=request.idempotency_key;
 select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=logical.idempotency_key;
 if request.id is null or original.id is null or logical.schema_version is distinct from 3
  or logical.withdrawal_id is distinct from request.id
  or logical.state not in('OUTCOME_UNCERTAIN','CONFIRMED')
  or row(request.user_id,request.currency,request.amount_atomic,request.fee_atomic,request.destination_type,
    request.withdrawal_policy_id,request.withdrawal_destination_id,request.idempotency_key)
   is distinct from row(original.user_id,'KRW'::public.currency_code,original.amount_atomic,0::bigint,original.method,
    original.policy_id,original.destination_id,original.logical_key)
  or request.welcome_reward_conversion_id is not null then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_MEMBER_COMPLETION_REQUIRED';end if;
 perform app_private.assert_withdrawal_principal_confirmation(original.id);
 if request.hold_posted_at is null or request.hold_posted_at<original.confirmed_at
  or request.hold_posted_at>=logical.expires_at then
  raise exception using errcode='55000',message='WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED';end if;
 select i.* into typed from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=request.id;
 if typed.id is null or typed.user_id is distinct from original.user_id or typed.amount_atomic is distinct from original.amount_atomic
  or typed.prepared_at<original.confirmed_at then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_TYPED_COMPLETION_REQUIRED';end if;
 perform app_private.assert_principal_recovery_intent_completion(typed.id);
 -- Full native130/131 originals and the connected133 boundary remain required.
 -- UNRESOLVED derivative inputs do not authorize an ACTIVE state or omit finance.
 perform app_private.assert_principal_boundary_complete((select b.id from app_private.funding_principal_boundary_preparations b
  join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id
  where a.withdrawal_id=request.id and a.phase='HOLD'));
end;
$$;

create function app_private.verify_member_principal_confirmation_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.withdrawal_principal_confirmation_originals%rowtype;
begin
 if tg_when is distinct from 'AFTER' or tg_level is distinct from 'ROW' then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_COMMIT_CONTEXT_INVALID';end if;
 if tg_table_schema='app_private' and tg_table_name='withdrawal_principal_confirmation_originals' and tg_op='INSERT' then
  if current_setting('role',true) is distinct from 'authenticated' or auth.role() is distinct from 'authenticated'
   or auth.uid() is distinct from new.user_id then
   raise exception using errcode='42501',message='WITHDRAWAL_PRINCIPAL_MEMBER_COMMIT_SUBJECT_FORBIDDEN';end if;
  perform app_private.assert_withdrawal_principal_confirmation(new.id);
 elsif tg_table_schema='public' and tg_table_name='withdrawal_logical_requests' and tg_op in('INSERT','UPDATE') then
  if new.schema_version<>3 then return null;end if;
  select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=new.idempotency_key;
  if original.id is null then raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_ORIGINAL_REQUIRED';end if;
  perform app_private.assert_withdrawal_principal_confirmation(original.id);
  if new.withdrawal_id is not null then perform app_private.assert_member_principal_hold_completion(new.withdrawal_id);end if;
 elsif tg_table_schema='public' and tg_table_name='withdrawal_requests' and tg_op in('INSERT','UPDATE') then
  select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=new.idempotency_key;
  if original.id is null then return null;end if;
  if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role'
   or(auth.uid() is not null and auth.uid() is distinct from original.user_id) then
   raise exception using errcode='42501',message='WITHDRAWAL_PRINCIPAL_SERVICE_COMMIT_SUBJECT_FORBIDDEN';end if;
  perform app_private.assert_member_principal_hold_completion(new.id);
 else raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_COMMIT_CONTEXT_INVALID';end if;
 return null;
end;
$$;
create constraint trigger member_principal_confirmation_complete after insert on app_private.withdrawal_principal_confirmation_originals
 deferrable initially deferred for each row execute function app_private.verify_member_principal_confirmation_commit();
create constraint trigger member_principal_logical_complete after insert or update on public.withdrawal_logical_requests
 deferrable initially deferred for each row execute function app_private.verify_member_principal_confirmation_commit();
create constraint trigger member_principal_financial_complete after insert or update on public.withdrawal_requests
 deferrable initially deferred for each row execute function app_private.verify_member_principal_confirmation_commit();

create function app_private.guard_member_principal_confirmation_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if tg_table_schema is distinct from 'public' then raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_LINK_CONTEXT_INVALID';end if;
 if tg_table_name='withdrawal_logical_requests' then
  if exists(select 1 from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=old.idempotency_key)
   and(tg_op='DELETE' or row(new.schema_version,new.user_id,new.idempotency_key,new.method,new.amount_krw,
      new.policy_id,new.policy_version,new.destination_id,new.destination_fingerprint,new.created_at,new.expires_at)
    is distinct from row(old.schema_version,old.user_id,old.idempotency_key,old.method,old.amount_krw,
      old.policy_id,old.policy_version,old.destination_id,old.destination_fingerprint,old.created_at,old.expires_at)) then
   raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_IMMUTABLE';end if;
 elsif tg_table_name='outbox_events' then
  if exists(select 1 from app_private.withdrawal_principal_confirmation_originals o where o.source_event_id=old.id)
   and(tg_op='DELETE' or row(new.event_type,new.schema_version,new.aggregate_type,new.aggregate_id,new.actor_user_id,
     new.payload,new.request_id,new.correlation_id,new.idempotency_key,new.occurred_at,new.created_at)
    is distinct from row(old.event_type,old.schema_version,old.aggregate_type,old.aggregate_id,old.actor_user_id,
     old.payload,old.request_id,old.correlation_id,old.idempotency_key,old.occurred_at,old.created_at)) then
   raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_IMMUTABLE';end if;
 elsif tg_table_name='audit_logs' then
  if exists(select 1 from app_private.withdrawal_principal_confirmation_originals o where o.audit_id=old.id)
   and(tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_IMMUTABLE';end if;
 else raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_LINK_CONTEXT_INVALID';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;
$$;
create trigger member_principal_logical_immutable before update or delete on public.withdrawal_logical_requests
 for each row execute function app_private.guard_member_principal_confirmation_links();
create trigger member_principal_audit_immutable before update or delete on public.audit_logs
 for each row execute function app_private.guard_member_principal_confirmation_links();
create trigger member_principal_event_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_member_principal_confirmation_links();

-- Service-only INVOKER preserves actual service identity throughout130/native
-- finance. A definer financial kernel would incorrectly take the owner fixture
-- branch of post_withdrawal_hold and is deliberately not used here.
create function app_private.request_member_confirmed_principal_hold(p_key text) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.withdrawal_principal_confirmation_originals%rowtype;
 logical public.withdrawal_logical_requests%rowtype;request public.withdrawal_requests%rowtype;
 destination public.withdrawal_destinations%rowtype;policy public.withdrawal_policies%rowtype;
 wallet_id uuid;trace uuid:=gen_random_uuid();hold_id uuid;at_time timestamptz;check_at timestamptz;
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='WITHDRAWAL_PRINCIPAL_SERVICE_AUTH_REQUIRED';end if;
 select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=p_key;
 if original.id is null then raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_ORIGINAL_REQUIRED';end if;
 if auth.uid() is not null and auth.uid() is distinct from original.user_id then
  raise exception using errcode='42501',message='WITHDRAWAL_PRINCIPAL_SERVICE_SUBJECT_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 perform app_private.assert_withdrawal_principal_confirmation(original.id);
 select r.* into request from public.withdrawal_requests r where r.user_id=original.user_id and r.idempotency_key=p_key;
 if request.id is not null then perform app_private.assert_member_principal_hold_completion(request.id);return request.id;end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='WITHDRAWAL_PRINCIPAL_FRESH_SNAPSHOT_REQUIRED';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select l.* into logical from public.withdrawal_logical_requests l where l.idempotency_key=p_key for update;
 select d.* into destination from public.withdrawal_destinations d where d.id=original.destination_id
  and d.user_id=original.user_id and d.destination_type=original.method and d.verification_status='VERIFIED'
  and d.replaced_at is null for update;
 select w.id into wallet_id from public.wallet_accounts w where w.user_id=original.user_id
  and w.currency='KRW' and w.closed_at is null for update;
 check_at:=clock_timestamp();
 if exists(select 1 from public.safe_mode_controls c where c.component in('GLOBAL','WITHDRAWAL')
  and c.is_paused and c.starts_at<=check_at) then raise exception using errcode='55000',message='SAFE_MODE_ACTIVE';end if;
 if logical.state<>'DESTINATION_REGISTERED' or logical.expires_at<=check_at then
  raise exception using errcode='55000',message='WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED';end if;
 if destination.id is null or destination.value_fingerprint is distinct from original.destination_fingerprint
  or destination.protection_until>check_at then
  raise exception using errcode='55000',message='VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED';end if;
 select p.* into policy from public.withdrawal_policies p where p.currency='KRW' and p.destination_type=original.method
  and p.is_enabled and p.effective_at<=check_at and(p.expires_at is null or p.expires_at>check_at) order by p.version desc limit 1;
 if policy.id is distinct from original.policy_id or policy.version is distinct from original.policy_version then
  raise exception using errcode='55000',message='WITHDRAWAL_LOGICAL_POLICY_CHANGED';end if;
 if policy.fee_atomic<>0 then raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_FEE_POLICY_UNSUPPORTED';end if;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND';end if;
 if (select coverage from public.money_source_summaries where user_id=original.user_id) is distinct from 'COMPLETE' then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_SOURCE_REQUIRED';end if;
 if original.amount_atomic>(select eligible_principal_atomic::numeric from public.money_source_summaries where user_id=original.user_id)
  or original.amount_atomic>app_private.available_krw_balance(wallet_id) then
  raise exception using errcode='22003',message='INSUFFICIENT_AVAILABLE_BALANCE';end if;
 if (select s.condition_id from app_private.funding_engine_state s where s.user_id=original.user_id)
   is distinct from original.current_condition_id
  or (select coalesce(c.current_allocation_original_id,c.allocation_original_id)
   from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id
   where s.user_id=original.user_id) is distinct from original.current_allocation_original_id
  or (select t.id from app_private.funding_portion_transitions t where t.user_id=original.user_id order by t.revision desc limit 1)
   is distinct from original.portion_transition_id
  or (select eligible_principal_atomic::numeric from public.money_source_summaries where user_id=original.user_id)
   is distinct from original.principal_atomic::numeric then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONDITIONS_CHANGED';end if;
 insert into public.withdrawal_requests(wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,currency,
  amount_atomic,fee_atomic,destination_type,destination_snapshot,status,idempotency_key)
 values(wallet_id,original.policy_id,original.destination_id,original.user_id,'KRW',original.amount_atomic,0,original.method,
  jsonb_build_object('destination_id',destination.id,'display',destination.display_hint,'verified_at',destination.verified_at),
  'REQUESTED',p_key) returning * into request;
 -- First input2 -> genuine typed original. Input3 repetition is deliberately
 -- unsupported until its own reviewed adapter; no current-input repair.
 perform app_private.prepare_principal_recovery_intent(request.id,trace);
 hold_id:=app_private.post_withdrawal_hold(original.user_id,request.id,original.amount_atomic,p_key,trace);
 select t.posted_at into at_time from public.ledger_transactions t where t.id=hold_id;
 update public.withdrawal_requests set status='HELD',hold_ledger_transaction_id=hold_id,hold_posted_at=at_time where id=request.id;
 insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at)
 values('WITHDRAWAL_REQUESTED.v1',1,'withdrawal_request',request.id,original.user_id,
  jsonb_build_object('user_id',original.user_id,'amount_atomic',original.amount_atomic::text,'fee_atomic','0','currency','KRW',
   'destination_type',original.method,'hold_ledger_transaction_id',hold_id,'welcome_reward',false),
  trace,trace,p_key||':event',at_time,at_time);
 insert into public.transaction_receipts(receipt_number,user_id,transaction_type,source_type,source_id,amount_atomic,
  currency,status,requested_at,status_timeline)
 values('PDK-WD-'||upper(replace(request.id::text,'-','')),original.user_id,'WITHDRAWAL','withdrawal_request',request.id,
  original.amount_atomic,'KRW','HELD',at_time,jsonb_build_array(jsonb_build_object('status','REQUESTED','at',at_time),
   jsonb_build_object('status','HELD','at',at_time)));
 perform app_private.apply_principal_recovery_newest_first(original.user_id,hold_id);
 return request.id;
end;
$$;

alter function app_private.verify_member_principal_confirmation_commit() owner to postgres;
revoke all on function app_private.verify_member_principal_confirmation_commit(),
 app_private.assert_member_principal_hold_completion(uuid),app_private.guard_member_principal_confirmation_links(),
 app_private.request_member_confirmed_principal_hold(text) from public,anon,authenticated,service_role;
grant execute on function app_private.assert_member_principal_hold_completion(uuid),
 app_private.guard_member_principal_confirmation_links(),app_private.request_member_confirmed_principal_hold(text) to service_role;

commit;
