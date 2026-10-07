begin;

-- Existing signature/definer owner/grants are preserved; source2 stays exact.
create or replace function app_private.prepare_principal_recovery_intent(p_withdrawal uuid,p_journal_request uuid) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.funding_principal_recovery_intent_originals%rowtype;
 request public.withdrawal_requests%rowtype; owner_id uuid; wallet_id uuid;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; inputs jsonb; snapshot jsonb; transition app_private.funding_portion_transitions%rowtype;
begin
 -- This is a new private trusted server contract, not an old SQL-only money
 -- command. Both actual SQL and JWT service authority are required.
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_INTENT_SERVICE_ROLE_REQUIRED'; end if;
 if p_withdrawal is null or p_journal_request is null then
  raise exception using errcode='22023',message='PRINCIPAL_RECOVERY_INTENT_INVALID'; end if;
 select r.user_id into owner_id from public.withdrawal_requests r where r.id=p_withdrawal;
 if owner_id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 if auth.uid() is not null and auth.uid() is distinct from owner_id then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_INTENT_SUBJECT_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 select i.* into original from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=p_withdrawal;
 -- Durable replay is independent of current policy, allocation, controls and
 -- isolation. Never reinterpret a different trace as the original command.
 if original.id is not null then
  if original.journal_request_id is distinct from p_journal_request then
   raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REUSED'; end if;
  perform app_private.assert_principal_recovery_intent_completion(original.id);return original.id;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='PRINCIPAL_RECOVERY_INTENT_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=owner_id for update;
 if request.currency<>'KRW' or request.fee_atomic<>0 or request.welcome_reward_conversion_id is not null
  or request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null or request.release_ledger_transaction_id is not null
  or exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id)
  or exists(select 1 from public.ledger_transactions t where t.idempotency_key=request.idempotency_key||':hold'
    or(t.reference_type='withdrawal_request' and t.reference_id=request.id and t.metadata->>'phase'='HOLD'))
  or exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=request.id) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PREFINANCE_REQUEST_REQUIRED'; end if;
 select w.id into wallet_id from public.wallet_accounts w where w.id=request.wallet_account_id
  and w.user_id=owner_id and w.currency='KRW' and w.closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND'; end if;
 perform 1 from app_private.ensure_withdrawal_hold_accounts(owner_id);
 select s.* into state from app_private.funding_engine_state s where s.user_id=owner_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 select c.* into cycle from app_private.funding_cycle_windows c where c.id=state.cycle_id;
 if not exists(select 1 from app_private.funding_engine_activations a where a.id=state.activation_id
   and a.user_id=owner_id and a.runtime_version=2) or coalesce(condition.inputs->>'input_contract_version','') not in('2','3')
  or state.cycle_closed or cycle.id is null then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_CURRENT_RUNTIME_REQUIRED'; end if;
 -- These are shared reader admissions, not another economic effective time.
 -- They precede the preparation timestamp and verify exact existing originals.
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 original.prepared_at:=clock_timestamp();
 if exists(select 1 from public.safe_mode_controls c where c.component in('GLOBAL','WITHDRAWAL')
   and c.is_paused and c.starts_at<=original.prepared_at) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
 if state.cursor_at>original.prepared_at or original.prepared_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_FIRST_CYCLE_REQUIRED'; end if;
 original.current_allocation_original_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 if condition.inputs->>'input_contract_version'='3' then
  inputs:=app_private.read_principal_input3_prefinance_current_inputs(owner_id,original.current_allocation_original_id,
   original.prepared_at,request.id,null);
 else
  inputs:=app_private.read_principal_intent_current_inputs(owner_id,original.current_allocation_original_id,original.prepared_at,request.id);
 end if;
 if condition.inputs is distinct from inputs then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_CURRENT_INPUTS_REQUIRED'; end if;
 if request.amount_atomic>(inputs->>'principal_atomic')::bigint then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_INSUFFICIENT_PRINCIPAL'; end if;
 -- No roots or retrospective portion clock facts are fabricated here.
 if (select coalesce(sum(p.amount_micro_krw),0) from app_private.funding_principal_portions p
    join app_private.funding_portion_clock_state c on c.portion_id=p.id where p.user_id=owner_id and c.status='AVAILABLE')
   is distinct from (inputs->>'principal_atomic')::numeric*1000000 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_ORIGINAL_REQUIRED'; end if;
 for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=owner_id order by t.revision loop
  if condition.inputs->>'input_contract_version'='3' then
   perform app_private.verify_principal_history_portion_fact(transition,condition.cause_principal_boundary_id);
  else
   perform app_private.verify_principal_prefinance_portion_fact(transition,request.id);
  end if;
 end loop;
 select t.id into original.previous_portion_transition_id from app_private.funding_portion_transitions t
  where t.user_id=owner_id order by t.revision desc limit 1;
 if original.previous_portion_transition_id is null then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_ORIGINAL_REQUIRED'; end if;
 original.id:=gen_random_uuid();original.schema_version:=1;original.intent_kind:='SERVER_PRINCIPAL_RECOVERY';
 original.user_id:=owner_id;original.withdrawal_id:=request.id;original.journal_request_id:=p_journal_request;
 original.amount_atomic:=request.amount_atomic;original.previous_state_id:=state.id;original.previous_condition_id:=condition.id;
 original.source_inputs:=inputs;original.request_snapshot:=app_private.funding_withdrawal_request_snapshot(request);
 select introduced_at into original.source_epoch_at from app_private.money_source_epochs where version=1;
 select introduced_at into original.principal_epoch_at from app_private.funding_principal_epochs where version=1;
 select introduced_at into original.engine_epoch_at from app_private.funding_engine_epochs where version=1;
 original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 snapshot:=app_private.funding_principal_recovery_intent_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.funding_principal_recovery_intent_originals select original.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(original.audit_id,owner_id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED','FUNDING_ENGINE_V1',original.id::text,
  'private trusted server principal command type; member confirmation not proven',p_journal_request,snapshot,
  jsonb_build_object('input_digest',original.input_digest,'engine_contract',2),original.prepared_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at,available_at,last_error_code)
 values(original.source_event_id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED.v1',1,'funding_engine_v1',original.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',original.audit_id,'input_digest',original.input_digest),p_journal_request,p_journal_request,
  'funding:'||original.id::text||':seal',original.prepared_at,original.prepared_at,'infinity','FUNDING_PRINCIPAL_ACTIVE_ADAPTER_NOT_ENABLED');
 return original.id;
end;
$$;

alter function app_private.prepare_principal_recovery_intent(uuid,uuid) owner to postgres;
revoke all on function app_private.prepare_principal_recovery_intent(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.prepare_principal_recovery_intent(uuid,uuid) to service_role;

commit;
