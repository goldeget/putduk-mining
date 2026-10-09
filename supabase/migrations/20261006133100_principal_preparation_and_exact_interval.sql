begin;

create function app_private.read_principal_prefinance_old_inputs(p_admission uuid,p_state uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 intent app_private.funding_principal_recovery_intent_originals%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 transition app_private.funding_portion_transitions%rowtype; inputs jsonb; allocation_id uuid;
begin
 perform app_private.assert_principal_admission_before_finance(p_admission);
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=p_state;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 if intent.user_id is distinct from admission.user_id or state.user_id is distinct from admission.user_id
  or state.id is distinct from(select s.id from app_private.funding_engine_state s where s.user_id=admission.user_id)
  or state.cycle_closed or condition.user_id is distinct from admission.user_id then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREFINANCE_STATE_STALE'; end if;
 allocation_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 if admission.phase='HOLD' then
  if intent.previous_state_id is distinct from state.id or intent.journal_request_id is distinct from admission.journal_request_id
   or intent.amount_atomic is distinct from admission.amount_atomic or intent.prepared_at>admission.effective_at
   or intent.previous_condition_id is distinct from condition.id
   or intent.current_allocation_original_id is distinct from allocation_id
   or intent.source_inputs is distinct from condition.inputs
   or intent.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(intent)) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_TYPED_PREDECESSOR_MISMATCH'; end if;
  perform app_private.assert_funding_engine_seal(intent.id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED',intent.user_id,
   intent.input_digest,intent.audit_id,intent.source_event_id,app_private.funding_principal_recovery_intent_snapshot(intent));
  inputs:=app_private.read_principal_boundary_current_inputs(admission.user_id,allocation_id,admission.effective_at,admission.withdrawal_id,admission.id);
  for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=admission.user_id order by t.revision loop
   perform app_private.verify_principal_boundary_prefinance_portion_fact(transition,admission.withdrawal_id,admission.id);
  end loop;
 else
  perform app_private.assert_principal_recovery_intent_completion(intent.id);
  if condition.inputs->>'input_contract_version' is distinct from '3'
   or condition.cause_principal_boundary_id is null then
   -- A historical authority-only HOLD must not gain retrospective earning.
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_HISTORY_BOUNDARY_UNRESOLVED'; end if;
  inputs:=app_private.read_principal_portion_funding_inputs(admission.user_id,allocation_id,admission.effective_at);
 end if;
 if inputs is distinct from condition.inputs
  or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_OLD_CONDITION_CHANGED'; end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
  condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 return inputs;
end;
$$;

create function app_private.guard_principal_boundary_preparation() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 inputs jsonb; calculation jsonb;
begin
 perform app_private.assert_principal_input_executor(new.user_id);
 perform app_private.assert_principal_admission_before_finance(new.clock_admission_id);
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=new.clock_admission_id;
 select s.* into state from app_private.funding_engine_state s where s.user_id=new.user_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 if admission.user_id is distinct from new.user_id or admission.phase is distinct from new.phase
  or new.intent_id is distinct from(select i.id from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id)
  or new.previous_state_id is distinct from state.id or new.cycle_id is distinct from state.cycle_id
  or new.current_allocation_original_id is distinct from coalesce(condition.current_allocation_original_id,condition.allocation_original_id)
  or new.effective_at is distinct from admission.effective_at or new.recorded_at is distinct from admission.effective_at
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_preparation_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREPARATION_ORIGINAL_MISMATCH'; end if;
 if new.settlement_expected then
  inputs:=app_private.read_principal_prefinance_old_inputs(admission.id,state.id);
  calculation:=app_private.calculate_credit_boundary_interval(state.id,admission.effective_at);
  if new.old_input_original is distinct from inputs or new.old_interval_calculation is distinct from calculation then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREPARATION_CALCULATION_MISMATCH'; end if;
 else
  if new.phase<>'RELEASE' or new.old_input_original is distinct from condition.inputs
   or new.old_interval_calculation is distinct from '{}'::jsonb then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_UNRESOLVED_PREPARATION_INVALID'; end if;
  -- Independently reproduce only the precise unsupported old input/cycle
  -- reason. Permission, corruption and unsupported economics are not hidden.
  begin
   inputs:=app_private.read_principal_prefinance_old_inputs(admission.id,state.id);
   calculation:=app_private.calculate_credit_boundary_interval(state.id,admission.effective_at);
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_FALSE_UNRESOLVED';
  exception when sqlstate '55000' then
   if sqlerrm is distinct from new.unresolved_reason_code
    or new.unresolved_reason_code not in('FUNDING_PRINCIPAL_HISTORY_BOUNDARY_UNRESOLVED','FUNDING_CREDIT_CYCLE_BOUNDARY_UNSUPPORTED','FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED','FUNDING_PRINCIPAL_OLD_CONDITION_CHANGED','FUNDING_POLICY_ORIGINAL_REQUIRED','FUNDING_DEFAULT_POLICY_REQUIRED') then
    raise; end if;
  end;
 end if;
 return new;
end;
$$;
create trigger principal_boundary_preparation_validate before insert on app_private.funding_principal_boundary_preparations
 for each row execute function app_private.guard_principal_boundary_preparation();

create function app_private.validate_principal_boundary_earned(p_earned app_private.funding_earned_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_earned.cause_principal_boundary_id;
 perform app_private.assert_principal_input_executor(preparation.user_id);
 perform app_private.assert_principal_admission_before_finance(preparation.clock_admission_id);
 select s.* into state from app_private.funding_engine_state s where s.user_id=preparation.user_id;
 if preparation.id is null or not preparation.settlement_expected
  or preparation.previous_state_id is distinct from state.id
  or p_earned.user_id is distinct from preparation.user_id or p_earned.runtime_version<>2
  or p_earned.previous_state_id is distinct from state.id or p_earned.activation_id is distinct from state.activation_id
  or p_earned.cycle_id is distinct from state.cycle_id or p_earned.condition_id is distinct from state.condition_id
  or p_earned.job_id is not null or p_earned.cause_allocation_id is not null or p_earned.cause_credit_boundary_id is not null
  or p_earned.recorded_at is distinct from preparation.effective_at
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to is distinct from preparation.effective_at
  or p_earned.calculation is distinct from preparation.old_interval_calculation
  or p_earned.amount_atomic::text is distinct from preparation.old_interval_calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_EARNED_ORIGINAL_MISMATCH'; end if;
 perform app_private.read_principal_prefinance_old_inputs(preparation.clock_admission_id,state.id);
 if p_earned.calculation is distinct from app_private.calculate_credit_boundary_interval(state.id,preparation.effective_at) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create function app_private.post_principal_boundary_earned(p_earned uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare earned app_private.funding_earned_receipts%rowtype; preparation app_private.funding_principal_boundary_preparations%rowtype;
 wallet_id uuid; posting_key text; journal uuid:=gen_random_uuid(); projection uuid:=gen_random_uuid(); source_event uuid:=gen_random_uuid();
 request_id uuid:=gen_random_uuid(); correlation_id uuid:=gen_random_uuid();
begin
 
 select * into earned from app_private.funding_earned_receipts where id=p_earned;
 select * into preparation from app_private.funding_principal_boundary_preparations where id=earned.cause_principal_boundary_id;
 perform app_private.assert_principal_input_executor(preparation.user_id);
 perform app_private.validate_principal_boundary_earned(earned);
 if earned.id is null or preparation.id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_EARNED_ORIGINAL_REQUIRED'; end if;
 if earned.amount_atomic=0 then return; end if;
 select id into wallet_id from public.wallet_accounts where user_id=earned.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 posting_key:='funding:principal:'||(select a.withdrawal_id::text from app_private.funding_withdrawal_clock_admissions a where a.id=preparation.clock_admission_id)||':'||preparation.phase;
 insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,
 member_user_id,request_id,correlation_id,description,posted_at,created_at,metadata)
 values(journal,'MINING_REWARD','KRW',posting_key||':ledger','mining_reward_credit',earned.credit_id,
 earned.user_id,request_id,correlation_id,'verified funded mining before admitted principal finance',earned.settled_to,earned.settled_to,
 jsonb_build_object('funding_earned_receipt_id',earned.id,'fee_atomic','0'));
 insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic) values
 (journal,(select id from public.ledger_accounts where code='PUTDUK:MINING_REWARD_EXPENSE:KRW'),0,'DEBIT',earned.amount_atomic),
 (journal,(select id from public.ledger_accounts where code='USER:'||upper(earned.user_id::text)||':KRW:LIABILITY'),1,'CREDIT',earned.amount_atomic);
 insert into public.wallet_ledger(id,wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id,created_at)
 values(projection,wallet_id,earned.user_id,'CREDIT','MINING_REWARD',earned.amount_atomic,posting_key||':wallet','mining_reward_credit',earned.credit_id,earned.settled_to);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
 correlation_id,request_id,idempotency_key,available_at,last_error_code,occurred_at,created_at)
 values(source_event,'MINING_REWARD_CREDITED.v1',1,'mining_reward_credit',earned.credit_id,earned.user_id,
 jsonb_build_object('user_id',earned.user_id,'amount_atomic',earned.amount_atomic,'currency','KRW',
 'ledger_transaction_id',journal,'wallet_ledger_id',projection),correlation_id,request_id,posting_key||':event',
 'infinity','FUNDING_AUTOMATIC_RUNTIME_NOT_ENABLED',earned.settled_to,earned.settled_to);
 insert into public.mining_reward_credits(id,user_id,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at,funding_earned_receipt_id)
 values(earned.credit_id,earned.user_id,earned.amount_atomic,journal,projection,source_event,earned.settled_to,earned.id);
 insert into public.money_source_movements(user_id,source_bucket,movement_kind,origin_code,amount_atomic,
 ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at)
 values(earned.user_id,'MINING_REWARD','CREDIT','MINING_REWARD',earned.amount_atomic,journal,projection,source_event,earned.settled_to);
 insert into public.mining_settlements(id,user_id,settled_from,settled_to,amount_atomic,currency,segment_count,idempotency_key,funding_earned_receipt_id)
 values(earned.settlement_id,earned.user_id,earned.settled_from,earned.settled_to,earned.amount_atomic,'KRW',1,posting_key||':settlement',earned.id);
 insert into public.mining_settlement_segments(mining_settlement_id,user_id,sequence,settled_from,settled_to,
 amount_atomic,equipment_efficiency_bps,world_multiplier_bps,event_multiplier_bps,status_multiplier_bps,funding_earned_receipt_id)
 values(earned.settlement_id,earned.user_id,0,earned.settled_from,earned.settled_to,earned.amount_atomic,10000,10000,10000,10000,earned.id);
end;
$$;

revoke all on function app_private.post_principal_boundary_earned(uuid) from public,anon,authenticated,service_role;


revoke all on function app_private.read_principal_prefinance_old_inputs(uuid,uuid),
 app_private.guard_principal_boundary_preparation(),
 app_private.validate_principal_boundary_earned(app_private.funding_earned_receipts)
 from public,anon,authenticated,service_role;

commit;
