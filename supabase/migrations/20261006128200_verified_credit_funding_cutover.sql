begin;

-- Canonical credit boundary producer. Only actual reviewed financial command
-- originals are accepted; no caller amount, timestamp, policy or mining reward.
-- New tables have no service INSERT grant. These two closed owner executors are
-- the service canonical deposit commands' only private entry points.
create function app_private.assert_credit_boundary_executor() returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_CREDIT_CANONICAL_EXECUTOR_REQUIRED'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
end;
$$;

create function app_private.write_credit_boundary_seal(
 p_id uuid,p_kind text,p_user uuid,p_digest text,p_audit uuid,p_event uuid,p_snapshot jsonb,p_at timestamptz
) returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare request_id uuid:=gen_random_uuid();
begin
 perform app_private.assert_credit_boundary_executor();
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(p_audit,p_user,p_kind,'FUNDING_ENGINE_V1',p_id::text,'verified canonical principal credit boundary',request_id,
 p_snapshot,jsonb_build_object('input_digest',p_digest,'engine_contract',2,'executor','canonical_credit_writer'),p_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
 correlation_id,request_id,idempotency_key,available_at,last_error_code,occurred_at,created_at)
 values(p_event,p_kind||'.v1',1,'funding_engine_v1',p_id,p_user,
 jsonb_build_object('user_id',p_user,'audit_id',p_audit,'input_digest',p_digest),request_id,request_id,
 'funding:'||p_id::text||':seal','infinity','FUNDING_AUTOMATIC_RUNTIME_NOT_ENABLED',p_at,p_at);
end;
$$;

create function app_private.funding_state_effective_capacities(p_state uuid) returns numeric[]
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare receipt app_private.funding_effective_capacity_receipts%rowtype; inputs jsonb; base numeric[]; retention numeric[];
begin
 select * into receipt from app_private.funding_effective_capacity_receipts where state_id=p_state;
 if receipt.state_id is not null then
  return array[receipt.base_capacity_num,receipt.base_capacity_den,receipt.retention_capacity_num,receipt.retention_capacity_den]; end if;
 select c.inputs into inputs from app_private.funding_engine_state_receipts s join app_private.funding_condition_originals c
 on c.id=s.condition_id where s.id=p_state;
 if inputs is null or inputs->>'input_contract_version'='2' then
  raise exception using errcode='55000',message='FUNDING_EFFECTIVE_CAPACITY_ORIGINAL_REQUIRED'; end if;
 base:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
 retention:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000);
 return array[base[1],base[2],retention[1],retention[2]];
end;
$$;

create function app_private.assert_credit_condition_inputs(p_condition uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare condition app_private.funding_condition_originals%rowtype; inputs jsonb; original jsonb;
begin
 select * into condition from app_private.funding_condition_originals where id=p_condition;
 inputs:=app_private.read_verified_credit_funding_inputs(condition.user_id,
 coalesce(condition.current_allocation_original_id,condition.allocation_original_id),p_at);
 if condition.inputs->>'input_contract_version'='2' then
  if condition.inputs is distinct from inputs then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 else
  original:=inputs->'credit_originals'->0;
  if jsonb_array_length(inputs->'credit_originals')<>1
   or inputs->>'principal_atomic' is distinct from condition.inputs->>'principal_atomic'
   or inputs->>'allocation_id' is distinct from condition.inputs->>'allocation_id'
   or inputs->>'allocation_bps' is distinct from condition.inputs->>'allocation_bps'
   or inputs->>'policy_publication_id' is distinct from condition.inputs->>'policy_publication_id'
   or inputs->>'policy_config_digest' is distinct from condition.inputs->>'policy_config_digest'
   or inputs->>'cycle_days' is distinct from condition.inputs->>'cycle_days'
   or inputs->>'base_bps' is distinct from condition.inputs->>'base_bps'
   or inputs->>'retention_bps' is distinct from condition.inputs->>'retention_bps'
   or original->>'credit_id' is distinct from condition.inputs->>'credit_id'
   or original->>'principal_revision_id' is distinct from condition.inputs->>'principal_revision_id' then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
 condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 return inputs;
end;
$$;

create function app_private.calculate_credit_boundary_interval(p_state uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare state app_private.funding_engine_state_receipts%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 condition app_private.funding_condition_originals%rowtype; caps numeric[]; speed numeric[];
begin
 select * into state from app_private.funding_engine_state_receipts where id=p_state;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if state.id is null or state.cycle_closed or p_at<state.cursor_at or p_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_CREDIT_CYCLE_BOUNDARY_UNSUPPORTED'; end if;
 caps:=app_private.funding_state_effective_capacities(p_state);
 speed:=app_private.funding_exact_ratio((condition.inputs->>'allocation_bps')::numeric,10000);
 return app_private.funding_exact_forward_interval((condition.inputs->>'principal_atomic')::bigint,
 (condition.inputs->>'base_bps')::integer,(condition.inputs->>'retention_bps')::integer,
 (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
 (extract(epoch from p_at-state.cursor_at)*1000000)::bigint,speed[1],speed[2],caps[1],caps[2],caps[3],caps[4],
 state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,0,1);
end;
$$;

create function app_private.guard_credit_boundary_preparation() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare owner_id uuid; state app_private.funding_engine_state_receipts%rowtype; command_status text;
begin
 perform app_private.assert_credit_boundary_executor();
 if new.origin_code='KRW_DEPOSIT' then select user_id,status::text into owner_id,command_status from public.deposit_requests where id=new.command_original_id;
 else select user_id,status::text into owner_id,command_status from public.usdt_manual_deposits where id=new.command_original_id; end if;
 select * into state from app_private.funding_engine_state where user_id=owner_id;
 if new.user_id is distinct from owner_id or command_status not in('REQUESTED','AWAITING_TRANSFER','REVIEWING','SUBMITTED')
  or new.effective_at>clock_timestamp() or new.recorded_at is distinct from new.effective_at
  or new.previous_state_id is distinct from state.id
  or new.current_allocation_original_id is distinct from(select coalesce(current_allocation_original_id,allocation_original_id)
    from app_private.funding_condition_originals where id=state.condition_id)
  or (new.settlement_expected and(new.previous_state_id is null or new.unresolved_reason_code is not null))
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_preparation_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_PREPARATION_ORIGINAL_MISMATCH'; end if;
 if new.settlement_expected then
  perform app_private.assert_credit_condition_inputs(state.condition_id,new.effective_at);
  perform app_private.calculate_credit_boundary_interval(state.id,new.effective_at);
 end if;
 return new;
end;
$$;
create trigger funding_credit_preparation_validate before insert on app_private.funding_credit_boundary_preparations
 for each row execute function app_private.guard_credit_boundary_preparation();

create function app_private.validate_credit_boundary_earned(p_earned app_private.funding_earned_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 activation app_private.funding_engine_activations%rowtype; calculation jsonb;
begin
 perform app_private.assert_credit_boundary_executor();
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_earned.cause_credit_boundary_id;
 select * into state from app_private.funding_engine_state_receipts where id=preparation.previous_state_id;
 select * into activation from app_private.funding_engine_activations where id=state.activation_id;
 if preparation.id is null or not preparation.settlement_expected or p_earned.runtime_version<>2 or p_earned.job_id is not null
  or p_earned.cause_allocation_id is not null or p_earned.user_id is distinct from preparation.user_id
  or p_earned.previous_state_id is distinct from state.id or state.id is distinct from(select id from app_private.funding_engine_state where user_id=p_earned.user_id)
  or p_earned.activation_id is distinct from activation.id or activation.runtime_version<>2
  or p_earned.cycle_id is distinct from state.cycle_id or p_earned.condition_id is distinct from state.condition_id
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to is distinct from preparation.effective_at then
  raise exception using errcode='55000',message='FUNDING_CREDIT_EARNED_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_credit_condition_inputs(state.condition_id,p_earned.settled_to);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,p_earned.settled_to);
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create function app_private.post_credit_boundary_earned(p_earned uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare earned app_private.funding_earned_receipts%rowtype; preparation app_private.funding_credit_boundary_preparations%rowtype;
 wallet_id uuid; posting_key text; journal uuid:=gen_random_uuid(); projection uuid:=gen_random_uuid(); source_event uuid:=gen_random_uuid();
 request_id uuid:=gen_random_uuid(); correlation_id uuid:=gen_random_uuid();
begin
 perform app_private.assert_credit_boundary_executor();
 select * into earned from app_private.funding_earned_receipts where id=p_earned;
 select * into preparation from app_private.funding_credit_boundary_preparations where id=earned.cause_credit_boundary_id;
 if earned.id is null or preparation.id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_EARNED_ORIGINAL_REQUIRED'; end if;
 if earned.amount_atomic=0 then return; end if;
 select id into wallet_id from public.wallet_accounts where user_id=earned.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 posting_key:='funding:credit:'||preparation.origin_code||':'||preparation.command_original_id::text;
 insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,
 member_user_id,request_id,correlation_id,description,posted_at,metadata)
 values(journal,'MINING_REWARD','KRW',posting_key||':ledger','mining_reward_credit',earned.credit_id,
 earned.user_id,request_id,correlation_id,'verified funded mining at principal credit boundary',earned.settled_to,
 jsonb_build_object('funding_earned_receipt_id',earned.id,'fee_atomic','0'));
 insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic) values
 (journal,(select id from public.ledger_accounts where code='PUTDUK:MINING_REWARD_EXPENSE:KRW'),0,'DEBIT',earned.amount_atomic),
 (journal,(select id from public.ledger_accounts where code='USER:'||upper(earned.user_id::text)||':KRW:LIABILITY'),1,'CREDIT',earned.amount_atomic);
 insert into public.wallet_ledger(id,wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
 values(projection,wallet_id,earned.user_id,'CREDIT','MINING_REWARD',earned.amount_atomic,posting_key||':wallet','mining_reward_credit',earned.credit_id);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
 correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(source_event,'MINING_REWARD_CREDITED.v1',1,'mining_reward_credit',earned.credit_id,earned.user_id,
 jsonb_build_object('user_id',earned.user_id,'amount_atomic',earned.amount_atomic,'currency','KRW',
 'ledger_transaction_id',journal,'wallet_ledger_id',projection),correlation_id,request_id,posting_key||':event',
 'infinity','FUNDING_AUTOMATIC_RUNTIME_NOT_ENABLED');
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

create function app_private.begin_funding_credit_boundary(p_original uuid,p_origin text) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 activation app_private.funding_engine_activations%rowtype; earned app_private.funding_earned_receipts%rowtype;
 wallet_id uuid; calculation jsonb; message text; locked_owner uuid;
begin
 perform app_private.assert_credit_boundary_executor();
 if p_origin='KRW_DEPOSIT' then select user_id into preparation.user_id from public.deposit_requests where id=p_original;
 elsif p_origin='USDT_KRW_DEPOSIT' then select user_id into preparation.user_id from public.usdt_manual_deposits where id=p_original;
 else raise exception using errcode='22023',message='FUNDING_CREDIT_ORIGIN_INVALID'; end if;
 if preparation.user_id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_COMMAND_ORIGINAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 if p_origin='KRW_DEPOSIT' then select user_id into locked_owner from public.deposit_requests where id=p_original for update;
 else select user_id into locked_owner from public.usdt_manual_deposits where id=p_original for update; end if;
 if locked_owner is distinct from preparation.user_id then raise exception using errcode='40001',message='FUNDING_CREDIT_COMMAND_OWNER_CHANGED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||preparation.user_id::text,0));
 select id into wallet_id from public.wallet_accounts where user_id=preparation.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 select * into state from app_private.funding_engine_state where user_id=preparation.user_id;
 select * into activation from app_private.funding_engine_activations where user_id=preparation.user_id;
 preparation.id:=gen_random_uuid(); preparation.origin_code:=p_origin; preparation.command_original_id:=p_original;
 preparation.previous_state_id:=state.id; preparation.settlement_expected:=false;
 select coalesce(current_allocation_original_id,allocation_original_id) into preparation.current_allocation_original_id
 from app_private.funding_condition_originals where id=state.condition_id;
 preparation.effective_at:=clock_timestamp(); preparation.recorded_at:=preparation.effective_at;
 if activation.id is not null then
  if activation.runtime_version<>2 or state.id is null then preparation.unresolved_reason_code:='FUNDING_EXISTING_RUNTIME_UNSUPPORTED';
  else
   begin
    perform app_private.assert_credit_condition_inputs(state.condition_id,preparation.effective_at);
    calculation:=app_private.calculate_credit_boundary_interval(state.id,preparation.effective_at);
    preparation.settlement_expected:=true;
   exception when sqlstate '55000' or sqlstate '42501' then
    get stacked diagnostics message=message_text;
    preparation.unresolved_reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
   end;
  end if;
 end if;
 preparation.audit_id:=gen_random_uuid(); preparation.source_event_id:=gen_random_uuid();
 preparation.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_preparation_snapshot(preparation));
 insert into app_private.funding_credit_boundary_preparations select preparation.*;
 perform app_private.write_credit_boundary_seal(preparation.id,'FUNDING_CREDIT_BOUNDARY_PREPARED',preparation.user_id,
 preparation.input_digest,preparation.audit_id,preparation.source_event_id,app_private.funding_credit_preparation_snapshot(preparation),preparation.effective_at);
 if preparation.settlement_expected then
  earned.id:=gen_random_uuid(); earned.user_id:=preparation.user_id; earned.activation_id:=activation.id; earned.cycle_id:=state.cycle_id;
  earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.settled_from:=state.cursor_at;
  earned.settled_to:=preparation.effective_at; earned.calculation:=calculation; earned.amount_atomic:=(calculation->>'amountAtomic')::bigint;
  earned.runtime_version:=2; earned.condition_id:=state.condition_id; earned.cause_credit_boundary_id:=preparation.id;
  if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
  earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
  earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
  insert into app_private.funding_earned_receipts select earned.*;
  perform app_private.post_credit_boundary_earned(earned.id);
  perform app_private.write_credit_boundary_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,earned.input_digest,
  earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned),preparation.effective_at);
 end if;
 return preparation.id;
end;
$$;

-- The source is discovered through its genuine canonical event/reference tuple.
-- A matching immutable source is mandatory even for an UNRESOLVED engine result.
create function app_private.read_credit_boundary_source(p_boundary uuid) returns public.money_source_movements
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; movement public.money_source_movements%rowtype;
 journal uuid; projection uuid; confirmed_at timestamptz; operator_id uuid; received bigint;
 event_kind text; reference_kind text; scope_name text;
begin
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_boundary;
 if preparation.origin_code='KRW_DEPOSIT' then
  select ledger_transaction_id,wallet_ledger_id,reviewed_at,reviewed_by,approved_amount_atomic
   into journal,projection,confirmed_at,operator_id,received from public.deposit_requests
   where id=preparation.command_original_id and user_id=preparation.user_id and status='APPROVED';
  event_kind:='DEPOSIT_CONFIRMED.v1'; reference_kind:='deposit_request'; scope_name:='deposit.approve';
 else
  select d.ledger_transaction_id,d.wallet_ledger_id,d.confirmed_at,d.confirmed_by,d.credited_krw
   into journal,projection,confirmed_at,operator_id,received from public.usdt_manual_deposits d
   where id=preparation.command_original_id and user_id=preparation.user_id and status='CONFIRMED';
  event_kind:='USDT_MANUAL_DEPOSIT_CONFIRMED.v1'; reference_kind:='usdt_manual_deposit'; scope_name:='usdt_manual_deposit.confirm';
 end if;
 select m.* into movement from public.money_source_movements m join public.outbox_events e on e.id=m.source_event_id
  where m.user_id=preparation.user_id and m.source_bucket='PRINCIPAL' and m.movement_kind='CREDIT'
   and m.origin_code=preparation.origin_code and m.ledger_transaction_id=journal and m.wallet_ledger_id=projection
   and e.event_type=event_kind and e.aggregate_type=reference_kind and e.aggregate_id=preparation.command_original_id;
 if movement.id is null or movement.effective_at is distinct from preparation.effective_at
  or confirmed_at is distinct from preparation.effective_at or movement.amount_atomic is distinct from received
  or not exists(select 1 from public.ledger_transactions where id=journal and posted_at=preparation.effective_at
   and member_user_id=preparation.user_id and reference_type=reference_kind and reference_id=preparation.command_original_id)
  or not exists(select 1 from public.audit_logs where target_type=reference_kind and target_id=preparation.command_original_id::text
   and actor_user_id=operator_id and created_at=preparation.effective_at and
    ((preparation.origin_code='KRW_DEPOSIT' and action='deposit.approve')
     or(preparation.origin_code='USDT_KRW_DEPOSIT' and action='usdt_manual_deposit.confirm')))
  or not exists(select 1 from app_private.idempotency_keys where scope=scope_name and status='COMPLETED' and response_status=200
   and completed_at=preparation.effective_at and response_payload->>'ledger_transaction_id'=journal::text
   and((preparation.origin_code='KRW_DEPOSIT' and actor_id=operator_id and response_payload->>'wallet_ledger_id'=projection::text)
    or(preparation.origin_code='USDT_KRW_DEPOSIT' and actor_id is null and response_payload->>'credited_krw'=received::text))) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_COMMAND_COMPLETION_MISSING'; end if;
 perform app_private.assert_money_source_credit(movement);
 return movement;
end;
$$;

create function app_private.finish_funding_credit_boundary(p_boundary uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; completion app_private.funding_credit_boundary_completions%rowtype;
 source public.money_source_movements%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; message text; caps numeric[]; old_base numeric[]; old_retention numeric[]; next_base numeric[]; next_retention numeric[];
 next_state uuid; lot_id uuid; span bigint; remaining bigint;
begin
 perform app_private.assert_credit_boundary_executor();
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_boundary;
 if preparation.id is null then raise exception using errcode='55000',message='FUNDING_CREDIT_PREPARATION_MISSING'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 if exists(select 1 from app_private.funding_credit_boundary_completions where boundary_id=p_boundary) then
  perform app_private.assert_credit_boundary_complete(p_boundary); return; end if;
 source:=app_private.read_credit_boundary_source(p_boundary);
 completion.id:=gen_random_uuid(); completion.boundary_id:=preparation.id; completion.user_id:=preparation.user_id;
 completion.credit_movement_id:=source.id; completion.reason_code:=preparation.unresolved_reason_code;
 if completion.reason_code is null then
  begin inputs:=app_private.read_verified_credit_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,preparation.effective_at);
  exception when sqlstate '55000' or sqlstate '42501' then
   get stacked diagnostics message=message_text;
   completion.reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
  end;
 end if;
 completion.input_original:=coalesce(inputs,jsonb_build_object('input_contract_version',2,'user_id',preparation.user_id,
 'credit_id',source.id,'runtime_input_unresolved',true));
 select * into activation from app_private.funding_engine_activations where user_id=preparation.user_id;
 select * into state from app_private.funding_engine_state_receipts where id=preparation.previous_state_id;
 select * into earned from app_private.funding_earned_receipts where cause_credit_boundary_id=preparation.id;
 if preparation.settlement_expected then
  -- The accepted old interval must remain committed exactly even if the new
  -- policy/input becomes unsupported. No pre-boundary earning is discarded.
  completion.activation_id:=activation.id;
  if completion.reason_code is null then
   select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
   select * into condition from app_private.funding_condition_originals where id=state.condition_id;
   span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
   remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
   caps:=app_private.funding_state_effective_capacities(state.id);
   old_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
   old_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
   next_base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000,remaining,span);
   next_retention:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_retention[1],old_retention[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000,remaining,span);
   condition.id:=gen_random_uuid(); condition.revision:=condition.revision+1; condition.previous_condition_id:=state.condition_id;
   condition.allocation_original_id:=null; condition.cause_credit_boundary_id:=preparation.id;
   condition.current_allocation_original_id:=preparation.current_allocation_original_id;
   condition.effective_at:=preparation.effective_at; condition.inputs:=inputs;
   condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid(); condition.recorded_at:=clock_timestamp();
   condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
   insert into app_private.funding_condition_originals select condition.*;
   perform app_private.write_credit_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
    condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),preparation.effective_at);
   completion.condition_id:=condition.id; completion.runtime_outcome:='ACCEPTED';
  else
   completion.condition_id:=state.condition_id; completion.runtime_outcome:='UNRESOLVED';
   caps:=app_private.funding_state_effective_capacities(state.id);
   next_base:=array[caps[1],caps[2]]; next_retention:=array[caps[3],caps[4]];
  end if;
  next_state:=earned.next_state_id; completion.accepted_state_id:=next_state;
  -- Exact capacities are inserted first with a deferred same-owner state link.
  insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
  values(next_state,preparation.user_id,next_base[1],next_base[2],next_retention[1],next_retention[2]);
  insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
   earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
  values(next_state,preparation.user_id,activation.id,state.cycle_id,state.revision+1,state.id,earned.id,preparation.effective_at,
   (earned.calculation->>'baseUsedNum')::numeric,(earned.calculation->>'baseUsedDen')::numeric,
   (earned.calculation->>'retentionUsedNum')::numeric,(earned.calculation->>'retentionUsedDen')::numeric,
   (earned.calculation->>'carryNum')::numeric,(earned.calculation->>'carryDen')::numeric,completion.condition_id);
 elsif activation.id is not null or completion.reason_code is not null then
  completion.runtime_outcome:='UNRESOLVED';
  completion.reason_code:=coalesce(completion.reason_code,'FUNDING_EXISTING_RUNTIME_UNSUPPORTED');
 elsif inputs->>'tier_activated' is distinct from 'true' then
  completion.runtime_outcome:='INACTIVE'; completion.reason_code:='FUNDING_BELOW_MINIMUM';
 elsif exists(select 1 from app_private.funding_cycle_windows where user_id=preparation.user_id)
  or preparation.current_allocation_original_id is not null then
  completion.runtime_outcome:='UNRESOLVED'; completion.reason_code:='FUNDING_EXISTING_ANCHOR_UNSUPPORTED';
 else
  -- First actual receipt-bound activation is prospective at this credit clock.
  -- No earlier source receives pre-activation catch-up or a fabricated product.
  cycle.id:=gen_random_uuid(); cycle.user_id:=preparation.user_id; cycle.cycle_ordinal:=0;
  cycle.cycle_days:=(inputs->>'cycle_days')::integer; cycle.cycle_started_at:=preparation.effective_at;
  cycle.cycle_end:=preparation.effective_at+cycle.cycle_days*interval '24 hours';
  insert into app_private.funding_cycle_windows(id,user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end)
  values(cycle.id,cycle.user_id,cycle.cycle_ordinal,cycle.cycle_days,cycle.cycle_started_at,cycle.cycle_end);
  activation.id:=gen_random_uuid(); activation.user_id:=preparation.user_id; activation.trigger_credit_movement_id:=source.id;
  select id into activation.trigger_principal_revision_id from public.funding_principal_revisions where money_source_movement_id=source.id;
  activation.policy_publication_id:=(inputs->>'policy_publication_id')::uuid; activation.first_cycle_id:=cycle.id;
  activation.principal_atomic:=(inputs->>'principal_atomic')::bigint; activation.effective_at:=preparation.effective_at;
  activation.runtime_version:=2; activation.input_original:=inputs; activation.input_digest:=app_private.funding_engine_digest(inputs);
  activation.audit_id:=gen_random_uuid(); activation.source_event_id:=gen_random_uuid(); activation.recorded_at:=clock_timestamp();
  insert into public.ledger_accounts(code,currency,account_class,normal_side)
  values('PUTDUK:MINING_REWARD_EXPENSE:KRW','KRW','EXPENSE','DEBIT') on conflict(code) do nothing;
  insert into app_private.funding_engine_activations select activation.*;
  perform app_private.write_credit_boundary_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
   activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation),preparation.effective_at);
  condition.id:=gen_random_uuid(); condition.user_id:=preparation.user_id; condition.activation_id:=activation.id;
  condition.revision:=0; condition.effective_at:=preparation.effective_at; condition.inputs:=inputs;
  condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid(); condition.recorded_at:=clock_timestamp();
  condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
  insert into app_private.funding_condition_originals select condition.*;
  perform app_private.write_credit_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
   condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),preparation.effective_at);
  -- The activation AFTER hook initialized only the verified input manifest,
  -- in immutable source order, before any initial accepted cursor existed.
  next_state:=gen_random_uuid();
  next_base:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
  next_retention:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000);
  insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
  values(next_state,preparation.user_id,next_base[1],next_base[2],next_retention[1],next_retention[2]);
  insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,cursor_at,
   base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
  values(next_state,preparation.user_id,activation.id,cycle.id,0,preparation.effective_at,0,1,0,1,0,1,condition.id);
  completion.runtime_outcome:='ACCEPTED'; completion.activation_id:=activation.id;
  completion.condition_id:=condition.id; completion.accepted_state_id:=next_state;
 end if;
 if completion.runtime_outcome='ACCEPTED' and preparation.settlement_expected then
  for lot_id in select id from public.funding_principal_lots where user_id=preparation.user_id
   order by effective_at,recorded_at,id loop
   perform app_private.initialize_funding_portion_clock(lot_id);
  end loop;
 end if;
 completion.audit_id:=gen_random_uuid(); completion.source_event_id:=gen_random_uuid(); completion.recorded_at:=clock_timestamp();
 completion.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(completion));
 insert into app_private.funding_credit_boundary_completions select completion.*;
 perform app_private.write_credit_boundary_seal(completion.id,'FUNDING_CREDIT_BOUNDARY_COMPLETED',completion.user_id,
 completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_credit_completion_snapshot(completion),preparation.effective_at);
end;
$$;

-- The existing AFTER activation hook must initialize a verified multi-credit
-- manifest in source-time order before the first state cursor is inserted.
-- Seeding the trigger credit first would make an older below-minimum credit
-- violate the unchanged member transition's monotone-time guard. The older
-- input contract retains its exact single-trigger-credit behavior below.
create or replace function app_private.initialize_activated_funding_portion() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot_id uuid; manifest jsonb; matched_count integer; distinct_count integer;
begin
 if new.runtime_version=2 and new.input_original->>'input_contract_version'='2' then
  perform app_private.assert_credit_boundary_executor();
  manifest:=new.input_original->'credit_originals';
  if jsonb_typeof(manifest) is distinct from 'array' then
   raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  if jsonb_array_length(manifest)=0 then
   raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  select count(*),count(distinct l.id) into matched_count,distinct_count
  from jsonb_array_elements(manifest) original(value)
  join public.funding_principal_lots l on l.id=(original.value->>'lot_id')::uuid
  join public.money_source_movements m on m.id=l.money_source_movement_id
  join public.funding_principal_revisions r on r.id=(original.value->>'principal_revision_id')::uuid
  where l.user_id=new.user_id and m.user_id=new.user_id and r.user_id=new.user_id
   and m.id=(original.value->>'credit_id')::uuid and r.lot_id=l.id and r.money_source_movement_id=m.id
   and m.movement_kind='CREDIT' and m.source_bucket='PRINCIPAL' and m.origin_code in('KRW_DEPOSIT','USDT_KRW_DEPOSIT')
   and r.direction='INCREASE' and r.delta_micro_krw=l.amount_micro_krw
   and m.amount_atomic=l.amount_atomic and original.value->>'amount_atomic'=m.amount_atomic::text
   and m.effective_at=l.effective_at and r.effective_at=m.effective_at
   and original.value->>'effective_at_microseconds'=((extract(epoch from m.effective_at)*1000000)::bigint)::text;
  if matched_count<>jsonb_array_length(manifest) or distinct_count<>matched_count
   or not exists(select 1 from jsonb_array_elements(manifest) original(value)
    where(original.value->>'credit_id')::uuid=new.trigger_credit_movement_id) then
   raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  for lot_id in select l.id from jsonb_array_elements(manifest) original(value)
   join public.funding_principal_lots l on l.id=(original.value->>'lot_id')::uuid
   where l.user_id=new.user_id order by l.effective_at,l.recorded_at,l.id loop
   perform app_private.initialize_funding_portion_clock(lot_id);
  end loop;
  return new;
 end if;
 if new.runtime_version=2 then
  select id into lot_id from public.funding_principal_lots where money_source_movement_id=new.trigger_credit_movement_id;
  if lot_id is null then raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  perform app_private.initialize_funding_portion_clock(lot_id);
 end if;
 return new;
end;
$$;

-- Validators/dispatch below are part of this atomic writer batch; the producer
-- cannot be installed independently or granted as a generic financial writer.
create function app_private.validate_credit_activation(p_activation app_private.funding_engine_activations) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare source public.money_source_movements%rowtype; preparation app_private.funding_credit_boundary_preparations%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; inputs jsonb;
begin
 perform app_private.assert_credit_boundary_executor();
 select * into source from public.money_source_movements where id=p_activation.trigger_credit_movement_id;
 select b.* into preparation from app_private.funding_credit_boundary_preparations b join public.outbox_events e
 on e.id=source.source_event_id where b.command_original_id=e.aggregate_id and b.origin_code=source.origin_code;
 inputs:=app_private.read_verified_credit_funding_inputs(p_activation.user_id,null,p_activation.effective_at);
 select * into cycle from app_private.funding_cycle_windows where id=p_activation.first_cycle_id;
 if preparation.id is null or preparation.previous_state_id is not null or preparation.settlement_expected
  or preparation.unresolved_reason_code is not null or preparation.user_id is distinct from p_activation.user_id
  or p_activation.runtime_version<>2 or p_activation.input_original is distinct from inputs
  or inputs->>'tier_activated' is distinct from 'true' or inputs->>'allocation_bps' is distinct from '0'
  or p_activation.principal_atomic::text is distinct from inputs->>'principal_atomic'
  or p_activation.policy_publication_id::text is distinct from inputs->>'policy_publication_id'
  or p_activation.trigger_principal_revision_id is distinct from(select id from public.funding_principal_revisions where money_source_movement_id=source.id)
  or p_activation.effective_at is distinct from preparation.effective_at or source.effective_at is distinct from preparation.effective_at
  or p_activation.input_digest is distinct from app_private.funding_engine_digest(inputs)
  or cycle.user_id is distinct from p_activation.user_id or cycle.cycle_ordinal<>0
  or cycle.cycle_started_at is distinct from preparation.effective_at
  or cycle.cycle_days is distinct from(inputs->>'cycle_days')::integer then
  raise exception using errcode='55000',message='FUNDING_CREDIT_ACTIVATION_ORIGINAL_MISMATCH'; end if;
end;
$$;

create function app_private.validate_credit_condition(p_condition app_private.funding_condition_originals) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; previous app_private.funding_condition_originals%rowtype;
 preparation app_private.funding_credit_boundary_preparations%rowtype; original app_private.funding_allocation_originals%rowtype; inputs jsonb;
begin
 if p_condition.cause_credit_boundary_id is not null or p_condition.revision=0 then perform app_private.assert_credit_boundary_executor();
 else perform app_private.assert_funding_member_writer(p_condition.user_id); end if;
 select * into activation from app_private.funding_engine_activations where id=p_condition.activation_id;
 inputs:=app_private.read_verified_credit_funding_inputs(p_condition.user_id,p_condition.current_allocation_original_id,p_condition.effective_at);
 if activation.user_id is distinct from p_condition.user_id or activation.runtime_version<>2
  or p_condition.inputs is distinct from inputs or inputs->>'tier_activated' is distinct from 'true'
  or p_condition.inputs->>'policy_publication_id' is distinct from activation.policy_publication_id::text
  or p_condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(p_condition)) then
  raise exception using errcode='55000',message='FUNDING_CONDITION_ORIGINAL_MISMATCH'; end if;
 if p_condition.revision=0 then
  if p_condition.effective_at is distinct from activation.effective_at or p_condition.inputs is distinct from activation.input_original
   or p_condition.cause_credit_boundary_id is not null or p_condition.current_allocation_original_id is not null then
   raise exception using errcode='55000',message='FUNDING_ZERO_CONDITION_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_condition_originals where id=p_condition.previous_condition_id;
  if previous.user_id is distinct from p_condition.user_id or previous.activation_id is distinct from p_condition.activation_id
   or p_condition.revision is distinct from previous.revision+1 or p_condition.effective_at<previous.effective_at
   or previous.id is distinct from(select id from app_private.funding_condition_originals where user_id=p_condition.user_id order by revision desc limit 1) then
   raise exception using errcode='55000',message='FUNDING_CONDITION_SUCCESSOR_MISMATCH'; end if;
  if p_condition.cause_credit_boundary_id is not null then
   select * into preparation from app_private.funding_credit_boundary_preparations where id=p_condition.cause_credit_boundary_id;
   if preparation.user_id is distinct from p_condition.user_id or not preparation.settlement_expected
    or preparation.previous_state_id is distinct from(select id from app_private.funding_engine_state where user_id=p_condition.user_id)
    or p_condition.effective_at is distinct from preparation.effective_at or p_condition.allocation_original_id is not null
    or p_condition.current_allocation_original_id is distinct from preparation.current_allocation_original_id then
    raise exception using errcode='55000',message='FUNDING_CREDIT_CONDITION_CAUSE_MISMATCH'; end if;
  else
   select * into original from app_private.funding_allocation_originals where id=p_condition.allocation_original_id;
   if original.user_id is distinct from p_condition.user_id or p_condition.current_allocation_original_id is distinct from original.id
    or original.effective_at is distinct from p_condition.effective_at then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_CONDITION_CAUSE_MISMATCH'; end if;
  end if;
 end if;
end;
$$;

create function app_private.validate_credit_state(p_state app_private.funding_engine_state_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 preparation app_private.funding_credit_boundary_preparations%rowtype; cycle app_private.funding_cycle_windows%rowtype;
begin
 select * into activation from app_private.funding_engine_activations where id=p_state.activation_id;
 select * into condition from app_private.funding_condition_originals where id=p_state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_state.cycle_id;
 if activation.runtime_version<>2 or activation.user_id is distinct from p_state.user_id or condition.user_id is distinct from p_state.user_id
  or condition.activation_id is distinct from activation.id or p_state.cycle_id is distinct from activation.first_cycle_id
  or p_state.cursor_at<cycle.cycle_started_at or p_state.cursor_at>=cycle.cycle_end or p_state.cycle_closed
  or condition.effective_at>p_state.cursor_at
  or app_private.funding_exact_ratio(p_state.base_used_num,p_state.base_used_den) is distinct from array[p_state.base_used_num,p_state.base_used_den]
  or app_private.funding_exact_ratio(p_state.retention_used_num,p_state.retention_used_den) is distinct from array[p_state.retention_used_num,p_state.retention_used_den]
  or app_private.funding_exact_ratio(p_state.carry_num,p_state.carry_den) is distinct from array[p_state.carry_num,p_state.carry_den] then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_STATE_MISMATCH'; end if;
 if p_state.revision=0 then
  if condition.revision<>0 or p_state.cursor_at<>activation.effective_at or p_state.base_used_num<>0 or p_state.base_used_den<>1
   or p_state.retention_used_num<>0 or p_state.retention_used_den<>1 or p_state.carry_num<>0 or p_state.carry_den<>1 then
   raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_engine_state_receipts where id=p_state.previous_state_id;
  select * into earned from app_private.funding_earned_receipts where id=p_state.earned_receipt_id;
  if previous.user_id is distinct from p_state.user_id or previous.activation_id is distinct from p_state.activation_id
   or previous.id is distinct from(select id from app_private.funding_engine_state where user_id=p_state.user_id)
   or p_state.revision is distinct from previous.revision+1 or previous.cycle_closed or earned.runtime_version<>2
   or earned.next_state_id is distinct from p_state.id or earned.previous_state_id is distinct from previous.id
   or p_state.cursor_at is distinct from earned.settled_to
   or p_state.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
   or p_state.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
   or p_state.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
   or p_state.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
   or p_state.carry_num::text is distinct from earned.calculation->>'carryNum'
   or p_state.carry_den::text is distinct from earned.calculation->>'carryDen' then
   raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
  if earned.cause_credit_boundary_id is not null then
   select * into preparation from app_private.funding_credit_boundary_preparations where id=earned.cause_credit_boundary_id;
   if preparation.previous_state_id is distinct from previous.id or preparation.effective_at is distinct from p_state.cursor_at
    or (condition.id is distinct from previous.condition_id and condition.cause_credit_boundary_id is distinct from preparation.id) then
    raise exception using errcode='55000',message='FUNDING_CREDIT_STATE_CAUSE_MISMATCH'; end if;
  elsif earned.cause_allocation_id is not null then
   if condition.allocation_original_id is distinct from earned.cause_allocation_id then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_STATE_CAUSE_MISMATCH'; end if;
  elsif earned.job_id is not null then
   if condition.id is distinct from previous.condition_id then
    raise exception using errcode='55000',message='FUNDING_JOB_STATE_CAUSE_MISMATCH'; end if;
  else raise exception using errcode='55000',message='FUNDING_STATE_CAUSE_REQUIRED'; end if;
 end if;
end;
$$;

create function app_private.assert_credit_boundary_complete(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; completion app_private.funding_credit_boundary_completions%rowtype;
 source public.money_source_movements%rowtype; earned app_private.funding_earned_receipts%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 activation app_private.funding_engine_activations%rowtype; caps numeric[]; old_caps numeric[]; expected_base numeric[]; expected_retention numeric[];
 cycle app_private.funding_cycle_windows%rowtype; previous_condition app_private.funding_condition_originals%rowtype; previous app_private.funding_engine_state_receipts%rowtype;
 span bigint; remaining bigint;
begin
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_boundary;
 select * into completion from app_private.funding_credit_boundary_completions where boundary_id=p_boundary;
 source:=app_private.read_credit_boundary_source(p_boundary);
 if completion.boundary_id is null or completion.user_id is distinct from preparation.user_id
  or completion.credit_movement_id is distinct from source.id
  or completion.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(completion))
  or preparation.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_preparation_snapshot(preparation)) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_BOUNDARY_COMPLETION_MISSING'; end if;
 perform app_private.assert_funding_engine_seal(preparation.id,'FUNDING_CREDIT_BOUNDARY_PREPARED',preparation.user_id,preparation.input_digest,
 preparation.audit_id,preparation.source_event_id,app_private.funding_credit_preparation_snapshot(preparation));
 perform app_private.assert_funding_engine_seal(completion.id,'FUNDING_CREDIT_BOUNDARY_COMPLETED',completion.user_id,completion.input_digest,
 completion.audit_id,completion.source_event_id,app_private.funding_credit_completion_snapshot(completion));
 select * into earned from app_private.funding_earned_receipts where cause_credit_boundary_id=p_boundary;
 select * into previous from app_private.funding_engine_state_receipts where id=preparation.previous_state_id;
 if preparation.settlement_expected is distinct from(earned.id is not null) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_OLD_INTERVAL_ACCEPTANCE_MISSING'; end if;
 if completion.runtime_outcome='ACCEPTED' then
  select * into activation from app_private.funding_engine_activations where id=completion.activation_id;
  select * into state from app_private.funding_engine_state_receipts where id=completion.accepted_state_id;
  select * into condition from app_private.funding_condition_originals where id=completion.condition_id;
  select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
  if activation.user_id is distinct from preparation.user_id or activation.runtime_version<>2
   or state.user_id is distinct from preparation.user_id or state.activation_id is distinct from activation.id
   or state.condition_id is distinct from condition.id or state.cursor_at is distinct from preparation.effective_at
   or condition.user_id is distinct from preparation.user_id or condition.effective_at is distinct from preparation.effective_at
   or condition.inputs is distinct from completion.input_original then
   raise exception using errcode='55000',message='FUNDING_CREDIT_ACCEPTED_STATE_MISSING'; end if;
  if preparation.settlement_expected then
   if state.earned_receipt_id is distinct from earned.id or state.id is distinct from earned.next_state_id
    or condition.cause_credit_boundary_id is distinct from preparation.id or condition.previous_condition_id is distinct from previous.condition_id then
    raise exception using errcode='55000',message='FUNDING_CREDIT_ACCEPTED_CAUSE_MISMATCH'; end if;
   select * into previous_condition from app_private.funding_condition_originals where id=previous.condition_id;
   old_caps:=app_private.funding_state_effective_capacities(previous.id);
   span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
   remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
   expected_base:=app_private.funding_exact_forward_capacity(old_caps[1],old_caps[2],
    (previous_condition.inputs->>'principal_atomic')::numeric*(previous_condition.inputs->>'base_bps')::numeric,10000,
    (condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000,remaining,span);
   expected_retention:=app_private.funding_exact_forward_capacity(old_caps[3],old_caps[4],
    (previous_condition.inputs->>'principal_atomic')::numeric*(previous_condition.inputs->>'retention_bps')::numeric,10000,
    (condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000,remaining,span);
  else
   if previous.id is not null or state.revision<>0 or condition.revision<>0
    or activation.trigger_credit_movement_id is distinct from source.id or activation.effective_at is distinct from preparation.effective_at then
    raise exception using errcode='55000',message='FUNDING_CREDIT_INITIAL_STATE_MISSING'; end if;
   expected_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
   expected_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
  end if;
  caps:=app_private.funding_state_effective_capacities(state.id);
  if caps is distinct from array[expected_base[1],expected_base[2],expected_retention[1],expected_retention[2]] then
   raise exception using errcode='55000',message='FUNDING_FORWARD_CAPACITY_RECEIPT_MISMATCH'; end if;
  if not exists(select 1 from app_private.funding_portion_clock_state s join app_private.funding_principal_portions p on p.id=s.portion_id
    join public.funding_principal_lots l on l.id=p.lot_id where l.money_source_movement_id=source.id and s.user_id=preparation.user_id
    and s.status='AVAILABLE' and p.parent_portion_id is null and p.amount_micro_krw=l.amount_micro_krw
    and s.accumulated_eligible_microseconds=0 and s.resumed_at=l.effective_at) then
   raise exception using errcode='55000',message='FUNDING_CREDIT_PORTION_CLOCK_MISSING'; end if;
 elsif completion.runtime_outcome='INACTIVE' then
  if preparation.settlement_expected or preparation.previous_state_id is not null
   or completion.reason_code is distinct from 'FUNDING_BELOW_MINIMUM' or completion.input_original->>'tier_activated' is distinct from 'false' then
   raise exception using errcode='55000',message='FUNDING_INACTIVE_CREDIT_ORIGINAL_MISMATCH'; end if;
 elsif completion.runtime_outcome='UNRESOLVED' then
  if preparation.settlement_expected then
   select * into state from app_private.funding_engine_state_receipts where id=earned.next_state_id;
   if completion.accepted_state_id is distinct from state.id or completion.condition_id is distinct from previous.condition_id
    or state.condition_id is distinct from previous.condition_id or state.earned_receipt_id is distinct from earned.id then
    raise exception using errcode='55000',message='FUNDING_UNRESOLVED_CREDIT_OLD_STATE_MISSING'; end if;
  elsif completion.accepted_state_id is not null or completion.condition_id is not null or completion.activation_id is not null then
   raise exception using errcode='55000',message='FUNDING_UNRESOLVED_CREDIT_STATE_FORBIDDEN'; end if;
 end if;
end;
$$;

create function app_private.verify_credit_boundary_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare role_name text; boundary uuid;
begin
 if tg_table_schema<>'app_private' or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW'
  or tg_table_name not in('funding_credit_boundary_preparations','funding_credit_boundary_completions','funding_effective_capacity_receipts') then
  raise exception using errcode='55000',message='FUNDING_CREDIT_COMMIT_CONTEXT_INVALID'; end if;
 role_name:=current_setting('role',true);
 if (role_name='service_role' or(role_name in('none','postgres') and session_user='postgres')) is not true then
  -- Capacity propagation during an actual canonical member allocation is safe
  -- only when the same owner/new state/allocation receipt is independently proven.
  if tg_table_name<>'funding_effective_capacity_receipts' or role_name is distinct from 'authenticated'
   or auth.role() is distinct from 'authenticated' or auth.uid() is distinct from new.user_id then
   raise exception using errcode='42501',message='FUNDING_CREDIT_COMMIT_SUBJECT_FORBIDDEN'; end if;
 end if;
 if tg_table_name='funding_credit_boundary_preparations' then boundary:=new.id;
 elsif tg_table_name='funding_credit_boundary_completions' then boundary:=new.boundary_id;
 else
  select e.cause_credit_boundary_id into boundary from app_private.funding_engine_state_receipts s
   join app_private.funding_earned_receipts e on e.id=s.earned_receipt_id where s.id=new.state_id;
  if boundary is null then
   select b.boundary_id into boundary from app_private.funding_credit_boundary_completions b
    where b.accepted_state_id=new.state_id;
  end if;
  if boundary is null then perform app_private.assert_funding_capacity_state_complete(new.state_id); return null; end if;
 end if;
 perform app_private.assert_credit_boundary_complete(boundary);
 return null;
end;
$$;

create constraint trigger funding_credit_preparation_complete after insert on app_private.funding_credit_boundary_preparations
 deferrable initially deferred for each row execute function app_private.verify_credit_boundary_commit();
create constraint trigger funding_credit_completion_complete after insert on app_private.funding_credit_boundary_completions
 deferrable initially deferred for each row execute function app_private.verify_credit_boundary_commit();
create constraint trigger funding_capacity_receipt_complete after insert on app_private.funding_effective_capacity_receipts
 deferrable initially deferred for each row execute function app_private.verify_credit_boundary_commit();
create function app_private.verify_credit_boundary_earned(p_earned app_private.funding_earned_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare movement public.money_source_movements%rowtype; preparation app_private.funding_credit_boundary_preparations%rowtype;
 successor app_private.funding_engine_state_receipts%rowtype; posting_key text;
begin
 select * into preparation from app_private.funding_credit_boundary_preparations where id=p_earned.cause_credit_boundary_id;
 select * into successor from app_private.funding_engine_state_receipts where id=p_earned.next_state_id;
 perform app_private.assert_credit_boundary_complete(preparation.id);
 if successor.earned_receipt_id is distinct from p_earned.id or successor.user_id is distinct from p_earned.user_id
  or successor.cursor_at is distinct from p_earned.settled_to or p_earned.calculation->>'qualifiedRetentionNum' is distinct from '0' then
  raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
 posting_key:='funding:credit:'||preparation.origin_code||':'||preparation.command_original_id::text;
 if p_earned.amount_atomic>0 then
  select m.* into movement from public.money_source_movements m join public.mining_reward_credits c
  on c.ledger_transaction_id=m.ledger_transaction_id where c.id=p_earned.credit_id and c.funding_earned_receipt_id=p_earned.id;
  if movement.user_id is distinct from p_earned.user_id or movement.amount_atomic is distinct from p_earned.amount_atomic
   or movement.source_bucket is distinct from 'MINING_REWARD' or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at is distinct from p_earned.settled_to
   or not exists(select 1 from public.mining_settlements where id=p_earned.settlement_id and funding_earned_receipt_id=p_earned.id
    and idempotency_key=posting_key||':settlement')
   or(select count(*) from public.mining_settlement_segments where funding_earned_receipt_id=p_earned.id)<>1 then
   raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
  perform app_private.assert_money_source_credit(movement);
 end if;
 perform app_private.assert_funding_engine_seal(p_earned.id,'FUNDING_EARNED_ACCEPTED',p_earned.user_id,p_earned.input_digest,
 p_earned.audit_id,p_earned.source_event_id,app_private.funding_earned_snapshot(p_earned));
end;
$$;

create function app_private.assert_funding_capacity_state_complete(p_state uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare state app_private.funding_engine_state_receipts%rowtype; previous app_private.funding_engine_state_receipts%rowtype;
 earned app_private.funding_earned_receipts%rowtype; caps numeric[]; old_caps numeric[];
begin
 select * into state from app_private.funding_engine_state_receipts where id=p_state;
 select * into previous from app_private.funding_engine_state_receipts where id=state.previous_state_id;
 select * into earned from app_private.funding_earned_receipts where id=state.earned_receipt_id;
 if state.id is null or previous.id is null or earned.id is null or earned.cause_credit_boundary_id is not null
  or state.user_id is distinct from previous.user_id then
  raise exception using errcode='55000',message='FUNDING_CAPACITY_STATE_ORIGINAL_REQUIRED'; end if;
 caps:=app_private.funding_state_effective_capacities(state.id);
 old_caps:=app_private.funding_state_effective_capacities(previous.id);
 if caps is distinct from old_caps then raise exception using errcode='55000',message='FUNDING_FORWARD_CAPACITY_RECEIPT_MISMATCH'; end if;
 if earned.cause_allocation_id is not null then
  perform app_private.assert_allocation_boundary_complete(earned.cause_allocation_id,state.condition_id);
 elsif earned.job_id is not null then perform app_private.verify_neutral_funding_job_earned(earned);
 else raise exception using errcode='55000',message='FUNDING_CAPACITY_STATE_CAUSE_REQUIRED'; end if;
end;
$$;

create function app_private.guard_credit_boundary_completion() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype; source public.money_source_movements%rowtype; inputs jsonb;
begin
 perform app_private.assert_credit_boundary_executor();
 select * into preparation from app_private.funding_credit_boundary_preparations where id=new.boundary_id;
 source:=app_private.read_credit_boundary_source(new.boundary_id);
 if preparation.user_id is distinct from new.user_id or new.credit_movement_id is distinct from source.id
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_COMPLETION_ORIGINAL_MISMATCH'; end if;
 if new.runtime_outcome in('ACCEPTED','INACTIVE') then
  inputs:=app_private.read_verified_credit_funding_inputs(new.user_id,preparation.current_allocation_original_id,preparation.effective_at);
  if inputs is distinct from new.input_original or(preparation.unresolved_reason_code is not null)
   or(new.runtime_outcome='ACCEPTED' and inputs->>'tier_activated' is distinct from 'true')
   or(new.runtime_outcome='INACTIVE' and inputs->>'tier_activated' is distinct from 'false') then
   raise exception using errcode='55000',message='FUNDING_CREDIT_COMPLETION_INPUT_MISMATCH'; end if;
 elsif new.reason_code is null then raise exception using errcode='55000',message='FUNDING_CREDIT_UNRESOLVED_REASON_REQUIRED';
 end if;
 return new;
end;
$$;
create trigger funding_credit_completion_validate before insert on app_private.funding_credit_boundary_completions
 for each row execute function app_private.guard_credit_boundary_completion();

create function app_private.validate_forward_allocation_earned(p_earned app_private.funding_earned_receipts) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare state app_private.funding_engine_state_receipts%rowtype; successor app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; calculation jsonb;
begin
 perform app_private.assert_funding_member_writer(p_earned.user_id);
 select * into state from app_private.funding_engine_state_receipts where id=p_earned.previous_state_id;
 select * into original from app_private.funding_allocation_originals where id=p_earned.cause_allocation_id;
 select * into successor from app_private.funding_condition_originals where allocation_original_id=original.id;
 if p_earned.runtime_version<>2 or p_earned.job_id is not null or p_earned.cause_credit_boundary_id is not null
  or state.user_id is distinct from p_earned.user_id or state.id is distinct from(select id from app_private.funding_engine_state where user_id=p_earned.user_id)
  or state.activation_id is distinct from p_earned.activation_id or state.cycle_id is distinct from p_earned.cycle_id
  or p_earned.condition_id is distinct from state.condition_id or p_earned.settled_from is distinct from state.cursor_at
  or p_earned.settled_to is distinct from original.effective_at or original.user_id is distinct from p_earned.user_id
  or successor.previous_condition_id is distinct from state.condition_id then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_EARNED_MISMATCH'; end if;
 perform app_private.assert_credit_condition_inputs(state.condition_id,p_earned.settled_to);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,p_earned.settled_to);
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create function app_private.apply_forward_allocation_boundary(p_allocation uuid) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 earned app_private.funding_earned_receipts%rowtype; wallet_id uuid; inputs jsonb; calculation jsonb; caps numeric[]; transition uuid;
begin
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 perform app_private.assert_funding_member_writer(original.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 select id into transition from app_private.funding_condition_originals where allocation_original_id=p_allocation;
 if transition is not null then perform app_private.assert_allocation_boundary_complete(p_allocation,transition); return transition; end if;
 select id into wallet_id from public.wallet_accounts where user_id=original.user_id and currency='KRW' and closed_at is null for update;
 select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 select * into state from app_private.funding_engine_state where user_id=original.user_id;
 if wallet_id is null or activation.runtime_version<>2 or state.id is null
  or exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
   on b.id=c.boundary_id where c.user_id=original.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 perform app_private.assert_credit_condition_inputs(condition.id,original.effective_at);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,original.effective_at);
 caps:=app_private.funding_state_effective_capacities(state.id);
 inputs:=app_private.read_verified_credit_funding_inputs(original.user_id,p_allocation,original.effective_at);
 condition.id:=gen_random_uuid(); condition.revision:=condition.revision+1; condition.previous_condition_id:=state.condition_id;
 condition.allocation_original_id:=p_allocation; condition.cause_credit_boundary_id:=null; condition.current_allocation_original_id:=p_allocation;
 condition.effective_at:=original.effective_at; condition.inputs:=inputs; condition.recorded_at:=clock_timestamp();
 condition.audit_id:=gen_random_uuid(); condition.source_event_id:=gen_random_uuid();
 condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
 insert into app_private.funding_condition_originals select condition.*;
 perform app_private.write_prospective_funding_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
 condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 earned.id:=gen_random_uuid(); earned.user_id:=original.user_id; earned.activation_id:=activation.id; earned.cycle_id:=state.cycle_id;
 earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.condition_id:=state.condition_id;
 earned.settled_from:=state.cursor_at; earned.settled_to:=original.effective_at; earned.calculation:=calculation;
 earned.amount_atomic:=(calculation->>'amountAtomic')::bigint; earned.runtime_version:=2; earned.cause_allocation_id:=p_allocation;
 if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
 earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
 earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select earned.*;
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(earned.next_state_id,original.user_id,caps[1],caps[2],caps[3],caps[4]);
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
 earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,original.user_id,activation.id,state.cycle_id,state.revision+1,state.id,earned.id,original.effective_at,
 (calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric,(calculation->>'retentionUsedNum')::numeric,
 (calculation->>'retentionUsedDen')::numeric,(calculation->>'carryNum')::numeric,(calculation->>'carryDen')::numeric,condition.id);
 perform app_private.post_prospective_funding_earned(earned.id);
 perform app_private.write_prospective_funding_seal(earned.id,'FUNDING_EARNED_ACCEPTED',earned.user_id,
 earned.input_digest,earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned));
 return condition.id;
end;
$$;
create function app_private.carry_forward_funding_capacity(p_next uuid,p_previous uuid,p_earned uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare earned app_private.funding_earned_receipts%rowtype; caps numeric[]; role_name text;
begin
 select * into earned from app_private.funding_earned_receipts where id=p_earned;
 role_name:=current_setting('role',true);
 if ((role_name='service_role' and auth.role()='service_role')
  or(role_name='authenticated' and auth.role()='authenticated' and auth.uid()=earned.user_id)) is not true then
  raise exception using errcode='42501',message='FUNDING_CAPACITY_EXECUTOR_FORBIDDEN'; end if;
 if earned.id is null or earned.cause_credit_boundary_id is not null or earned.previous_state_id is distinct from p_previous
  or earned.next_state_id is distinct from p_next or p_previous is distinct from(select id from app_private.funding_engine_state where user_id=earned.user_id) then
  raise exception using errcode='55000',message='FUNDING_CAPACITY_EARNED_ORIGINAL_REQUIRED'; end if;
 caps:=app_private.funding_state_effective_capacities(p_previous);
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(p_next,earned.user_id,caps[1],caps[2],caps[3],caps[4]);
end;
$$;

-- Existing V1 and neutral foreground/job branches are preserved below.
create or replace function app_private.validate_prospective_activation(p_activation app_private.funding_engine_activations)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare inputs jsonb; cycle app_private.funding_cycle_windows%rowtype;
begin
 if p_activation.input_original->>'input_contract_version'='2' then
  perform app_private.validate_credit_activation(p_activation); return; end if;
 perform app_private.assert_funding_member_writer(p_activation.user_id);
 inputs:=app_private.read_prospective_funding_inputs(p_activation.trigger_credit_movement_id,null,p_activation.effective_at);
 select * into cycle from app_private.funding_cycle_windows where id=p_activation.first_cycle_id;
 if p_activation.input_original is distinct from inputs
  or p_activation.user_id::text is distinct from inputs->>'user_id'
  or p_activation.trigger_principal_revision_id::text is distinct from inputs->>'principal_revision_id'
  or p_activation.policy_publication_id::text is distinct from inputs->>'policy_publication_id'
  or p_activation.principal_atomic::text is distinct from inputs->>'principal_atomic'
  or ((extract(epoch from p_activation.effective_at)*1000000)::bigint)::text is distinct from inputs->>'credit_at_microseconds'
  or p_activation.input_digest is distinct from app_private.funding_engine_digest(inputs)
  or cycle.user_id is distinct from p_activation.user_id or cycle.cycle_ordinal is distinct from 0
  or cycle.cycle_started_at is distinct from p_activation.effective_at
  or cycle.cycle_days is distinct from(inputs->>'cycle_days')::integer then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_ACTIVATION_MISMATCH'; end if;
end;
$$;

create or replace function app_private.guard_funding_condition() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; previous app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; inputs jsonb;
begin
 if new.inputs->>'input_contract_version'='2' then perform app_private.validate_credit_condition(new); return new; end if;
 perform app_private.assert_funding_member_writer(new.user_id);
 select * into activation from app_private.funding_engine_activations where id=new.activation_id;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,new.allocation_original_id,new.effective_at);
 if activation.user_id is distinct from new.user_id or activation.runtime_version<>2
  or new.inputs is distinct from inputs
  or new.inputs->>'policy_publication_id' is distinct from activation.policy_publication_id::text
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_CONDITION_ORIGINAL_MISMATCH'; end if;
 if new.revision=0 then
  if new.effective_at is distinct from activation.effective_at or new.inputs is distinct from activation.input_original then
   raise exception using errcode='55000',message='FUNDING_ZERO_CONDITION_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_condition_originals where id=new.previous_condition_id;
  select * into original from app_private.funding_allocation_originals where id=new.allocation_original_id;
  if previous.user_id is distinct from new.user_id or previous.activation_id is distinct from new.activation_id
   or new.revision is distinct from previous.revision+1 or new.revision is distinct from original.revision
   or new.effective_at is distinct from original.effective_at or new.effective_at<previous.effective_at
   or new.previous_condition_id is distinct from(select id from app_private.funding_condition_originals
     where user_id=new.user_id order by revision desc limit 1) then
   raise exception using errcode='55000',message='FUNDING_CONDITION_SUCCESSOR_MISMATCH'; end if;
 end if;
 return new;
end;
$$;

create or replace function app_private.validate_prospective_state(p_state app_private.funding_engine_state_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;
begin
 if(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=p_state.condition_id)='2'
  or exists(select 1 from app_private.funding_earned_receipts where id=p_state.earned_receipt_id and cause_credit_boundary_id is not null) then
  perform app_private.validate_credit_state(p_state); return; end if;
 select * into activation from app_private.funding_engine_activations where id=p_state.activation_id;
 select * into condition from app_private.funding_condition_originals where id=p_state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_state.cycle_id;
 if p_state.user_id is distinct from activation.user_id or condition.user_id is distinct from p_state.user_id
  or condition.activation_id is distinct from activation.id or p_state.cycle_id is distinct from activation.first_cycle_id
  or p_state.cursor_at<cycle.cycle_started_at or p_state.cursor_at>cycle.cycle_end or p_state.cycle_closed is distinct from(p_state.cursor_at=cycle.cycle_end)
  or condition.effective_at>p_state.cursor_at
  or app_private.funding_exact_ratio(p_state.base_used_num,p_state.base_used_den) is distinct from array[p_state.base_used_num,p_state.base_used_den]
  or app_private.funding_exact_ratio(p_state.retention_used_num,p_state.retention_used_den) is distinct from array[p_state.retention_used_num,p_state.retention_used_den]
  or app_private.funding_exact_ratio(p_state.carry_num,p_state.carry_den) is distinct from array[p_state.carry_num,p_state.carry_den] then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_STATE_MISMATCH'; end if;
 if p_state.revision=0 then
  if condition.revision<>0 or p_state.cursor_at<>activation.effective_at
   or p_state.base_used_num<>0 or p_state.base_used_den<>1 or p_state.retention_used_num<>0 or p_state.retention_used_den<>1
   or p_state.carry_num<>0 or p_state.carry_den<>1 then
   raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_engine_state_receipts where id=p_state.previous_state_id;
  select * into earned from app_private.funding_earned_receipts where id=p_state.earned_receipt_id;
  if previous.user_id is distinct from p_state.user_id or previous.activation_id is distinct from p_state.activation_id
   or previous.id is distinct from(select id from app_private.funding_engine_state where user_id=p_state.user_id)
   or p_state.revision is distinct from previous.revision+1 or previous.cycle_closed or earned.runtime_version<>2
   or earned.next_state_id is distinct from p_state.id or earned.previous_state_id is distinct from previous.id
   or p_state.cursor_at is distinct from earned.settled_to
   or (earned.cause_allocation_id is not null and (condition.allocation_original_id is distinct from earned.cause_allocation_id or p_state.cycle_closed))
   or (earned.job_id is not null and p_state.condition_id is distinct from previous.condition_id)
   or p_state.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
   or p_state.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
   or p_state.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
   or p_state.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
   or p_state.carry_num::text is distinct from earned.calculation->>'carryNum'
   or p_state.carry_den::text is distinct from earned.calculation->>'carryDen' then
   raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
 end if;
end;
$$;

create or replace function app_private.validate_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; successor app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; calculation jsonb;
begin
 if p_earned.cause_credit_boundary_id is not null then perform app_private.validate_credit_boundary_earned(p_earned); return; end if;
 if p_earned.cause_allocation_id is not null and(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=p_earned.condition_id)='2' then
  perform app_private.validate_forward_allocation_earned(p_earned); return; end if;
 if p_earned.job_id is not null then perform app_private.validate_neutral_funding_job_earned(p_earned); return; end if;
 -- Jobs cannot use the foreground branch or gain a fake successful lease.
 if p_earned.job_id is not null then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_JOB_ADAPTER_REQUIRED'; end if;
 perform app_private.assert_funding_member_writer(p_earned.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_earned.user_id::text,0));
 select * into activation from app_private.funding_engine_activations where id=p_earned.activation_id;
 select * into state from app_private.funding_engine_state_receipts where id=p_earned.previous_state_id;
 select * into condition from app_private.funding_condition_originals where id=p_earned.condition_id;
 select * into original from app_private.funding_allocation_originals where id=p_earned.cause_allocation_id;
 select * into successor from app_private.funding_condition_originals where allocation_original_id=original.id;
 select * into cycle from app_private.funding_cycle_windows where id=p_earned.cycle_id;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,p_earned.settled_to);
 if activation.runtime_version<>2 or activation.user_id is distinct from p_earned.user_id
  or state.user_id is distinct from p_earned.user_id or state.activation_id is distinct from activation.id
  or state.id is distinct from(select id from app_private.funding_engine_state where user_id=p_earned.user_id)
  or p_earned.condition_id is distinct from state.condition_id or inputs is distinct from condition.inputs
  or original.user_id is distinct from p_earned.user_id or successor.previous_condition_id is distinct from condition.id
  or successor.effective_at is distinct from original.effective_at
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to is distinct from original.effective_at
  or p_earned.settled_to>clock_timestamp() or p_earned.settled_to>=cycle.cycle_end
  or p_earned.cycle_id is distinct from activation.first_cycle_id then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_EARNED_MISMATCH'; end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from p_earned.settled_to-p_earned.settled_from)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create or replace function app_private.verify_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare successor app_private.funding_engine_state_receipts%rowtype; transition app_private.funding_condition_originals%rowtype;
 movement public.money_source_movements%rowtype;
begin
 if p_earned.cause_credit_boundary_id is not null then perform app_private.verify_credit_boundary_earned(p_earned); return; end if;
 if p_earned.job_id is not null then perform app_private.verify_neutral_funding_job_earned(p_earned); return; end if;
 select * into successor from app_private.funding_engine_state_receipts where id=p_earned.next_state_id;
 select * into transition from app_private.funding_condition_originals where id=successor.condition_id;
 if successor.earned_receipt_id is distinct from p_earned.id or successor.user_id is distinct from p_earned.user_id
  or transition.allocation_original_id is distinct from p_earned.cause_allocation_id or p_earned.job_id is not null then
  raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
 perform app_private.assert_allocation_boundary_complete(p_earned.cause_allocation_id,transition.id);
 if p_earned.amount_atomic>0 then
  select m.* into movement from public.money_source_movements m join public.mining_reward_credits c
   on c.ledger_transaction_id=m.ledger_transaction_id where c.id=p_earned.credit_id and c.funding_earned_receipt_id=p_earned.id;
  if movement.user_id is distinct from p_earned.user_id or movement.amount_atomic is distinct from p_earned.amount_atomic
   or movement.source_bucket is distinct from 'MINING_REWARD' or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at is distinct from p_earned.settled_to
   or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=p_earned.id)
   or not exists(select 1 from public.mining_settlements where id=p_earned.settlement_id and funding_earned_receipt_id=p_earned.id) then
   raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
  perform app_private.assert_money_source_credit(movement);
 end if;
 if p_earned.calculation->>'qualifiedRetentionNum' is distinct from '0' then
  raise exception using errcode='55000',message='FUNDING_RETENTION_BOUNDARY_ADAPTER_REQUIRED'; end if;
 perform app_private.assert_funding_engine_seal(p_earned.id,'FUNDING_EARNED_ACCEPTED',p_earned.user_id,p_earned.input_digest,
  p_earned.audit_id,p_earned.source_event_id,app_private.funding_earned_snapshot(p_earned));
end;
$$;

create or replace function app_private.apply_funding_allocation_boundary(p_allocation uuid)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; earned app_private.funding_earned_receipts%rowtype;
 transition uuid; credit uuid; calculation jsonb; inputs jsonb; wallet_id uuid;
begin
 if(select c.inputs->>'input_contract_version' from app_private.funding_engine_state s
  join app_private.funding_condition_originals c on c.id=s.condition_id
  join app_private.funding_allocation_originals a on a.user_id=s.user_id where a.id=p_allocation)='2' then
  return app_private.apply_forward_allocation_boundary(p_allocation); end if;
 if exists(select 1 from app_private.funding_credit_boundary_completions b join app_private.funding_allocation_originals a
   on a.user_id=b.user_id where a.id=p_allocation) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 perform app_private.assert_funding_member_writer(original.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||original.user_id::text,0));
 select id into transition from app_private.funding_condition_originals where allocation_original_id=p_allocation;
 if transition is not null then
  perform app_private.assert_allocation_boundary_complete(p_allocation,transition);
  return transition;
 end if;
 -- Member lock precedes wallet serialization. All source facts are read again
 -- after the wallet lock; a simultaneous unsupported credit cannot be ignored.
 select id into wallet_id from public.wallet_accounts where user_id=original.user_id and currency='KRW' and closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 if activation.id is null then
  if original.revision<>1 or (select count(*) from app_private.funding_allocation_originals where user_id=original.user_id)<>1 then
   raise exception using errcode='55000',message='FUNDING_INITIAL_ALLOCATION_HISTORY_UNSUPPORTED'; end if;
  select id into credit from public.money_source_movements where user_id=original.user_id and source_bucket='PRINCIPAL' and movement_kind='CREDIT';
  if credit is null then raise exception using errcode='55000',message='FUNDING_FRESH_PRINCIPAL_REQUIRED'; end if;
  perform app_private.activate_zero_funding_allocation(credit);
  select * into activation from app_private.funding_engine_activations where user_id=original.user_id;
 end if;
 if activation.runtime_version<>2 then raise exception using errcode='55000',message='FUNDING_EXISTING_RUNTIME_UNSUPPORTED'; end if;
 select * into state from app_private.funding_engine_state where user_id=original.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if original.revision is distinct from condition.revision+1 or state.activation_id is distinct from activation.id
  or original.effective_at<state.cursor_at or original.effective_at>=cycle.cycle_end or state.cycle_closed then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_BOUNDARY_UNSUPPORTED'; end if;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,original.effective_at);
 if inputs is distinct from condition.inputs then raise exception using errcode='55000',message='FUNDING_CONDITION_BOUNDARY_ADAPTER_REQUIRED'; end if;
 transition:=app_private.create_prospective_funding_condition(activation.id,p_allocation,condition.id);
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from original.effective_at-state.cursor_at)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 earned.id:=gen_random_uuid(); earned.user_id:=original.user_id; earned.activation_id:=activation.id; earned.cycle_id:=cycle.id;
 earned.previous_state_id:=state.id; earned.next_state_id:=gen_random_uuid(); earned.settled_from:=state.cursor_at;
 earned.settled_to:=original.effective_at; earned.calculation:=calculation; earned.amount_atomic:=(calculation->>'amountAtomic')::bigint;
 earned.runtime_version:=2; earned.condition_id:=condition.id; earned.cause_allocation_id:=p_allocation;
 if earned.amount_atomic>0 then earned.credit_id:=gen_random_uuid(); earned.settlement_id:=gen_random_uuid(); end if;
 earned.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(earned));
 earned.audit_id:=gen_random_uuid(); earned.source_event_id:=gen_random_uuid(); earned.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select earned.*;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
  earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,original.user_id,activation.id,cycle.id,state.revision+1,state.id,earned.id,original.effective_at,
  (calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric,
  (calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric,
  (calculation->>'carryNum')::numeric,(calculation->>'carryDen')::numeric,transition);
 perform app_private.post_prospective_funding_earned(earned.id);
 perform app_private.write_prospective_funding_seal(earned.id,'FUNDING_EARNED_ACCEPTED',original.user_id,earned.input_digest,
  earned.audit_id,earned.source_event_id,app_private.funding_earned_snapshot(earned));
 return transition;
end;
$$;

create or replace function app_private.guard_funded_canonical_insert() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_e app_private.funding_earned_receipts%rowtype; v_settlement public.mining_settlements%rowtype;
begin
 if new.funding_earned_receipt_id is null then
   if current_user='service_role' then raise exception using errcode='42501',message='FUNDING_EARNED_ORIGINAL_REQUIRED'; end if;
   return new; -- Preserve immutable owner-only legacy fixtures/history.
 end if;
 select * into v_e from app_private.funding_earned_receipts where id=new.funding_earned_receipt_id;
 if v_e.id is null or new.user_id is distinct from v_e.user_id or new.amount_atomic is distinct from v_e.amount_atomic or v_e.amount_atomic<=0 then
   raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 if tg_table_name='mining_reward_credits' then
   if new.id is distinct from v_e.credit_id or new.effective_at is distinct from v_e.settled_to then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 elsif tg_table_name='mining_settlements' then
   if new.id is distinct from v_e.settlement_id or new.settled_from is distinct from v_e.settled_from
     or new.settled_to is distinct from v_e.settled_to or new.currency<>'KRW' or new.segment_count<>1
     or new.idempotency_key is distinct from (case when v_e.cause_credit_boundary_id is not null then
       (select 'funding:credit:'||b.origin_code||':'||b.command_original_id::text||':settlement'
        from app_private.funding_credit_boundary_preparations b where b.id=v_e.cause_credit_boundary_id)
      when v_e.cause_allocation_id is not null then 'funding:allocation:'||v_e.cause_allocation_id::text||':settlement' else 'funding:job:'||v_e.job_id::text||':settlement' end) then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 else
   select * into v_settlement from public.mining_settlements where id=new.mining_settlement_id;
   if v_settlement.funding_earned_receipt_id is distinct from v_e.id or new.sequence<>0
     or new.settled_from is distinct from v_e.settled_from or new.settled_to is distinct from v_e.settled_to
     or new.equipment_efficiency_bps<>10000 or new.world_multiplier_bps<>10000
     or new.event_multiplier_bps<>10000 or new.status_multiplier_bps<>10000 then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 end if;
 return new;
end;
$$;

create or replace function app_private.assert_funding_portion_executor(p_user uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user='service_role' then
  null;
 elsif current_user='postgres' and current_setting('role',true)='service_role' and auth.role()='service_role' then
  null; -- Closed canonical credit owner executor inherits the proven service caller.
 elsif current_user='postgres' then
  -- Explicit member-writer validation is NULL-safe; an owner fixture without
  -- authenticated owner claims must not silently acquire producer authority.
  perform app_private.assert_funding_member_writer(p_user);
 else
  raise exception using errcode='42501',message='FUNDING_PORTION_EXECUTOR_REQUIRED'; end if;
 if p_user is null or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_PORTION_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
end;
$$;

create or replace function app_private.verify_funding_integrity_at_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_snapshot jsonb; v_kind text; v_user uuid; v_id uuid; v_digest text; v_audit uuid; v_event uuid;
 v_e app_private.funding_earned_receipts%rowtype; v_move public.money_source_movements%rowtype;
 v_role text;
begin
 if tg_table_schema<>'app_private' or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW'
  or tg_table_name not in('funding_engine_activations','funding_engine_jobs','funding_earned_receipts','funding_condition_originals') then
  raise exception using errcode='55000',message='FUNDING_COMMIT_TRIGGER_CONTEXT_INVALID'; end if;
 v_role:=current_setting('role',true);
 if v_role='authenticated' then
  if auth.role() is distinct from 'authenticated' or auth.uid() is distinct from new.user_id
   or tg_table_name='funding_engine_jobs' then
   raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN'; end if;
  if tg_table_name in('funding_engine_activations','funding_earned_receipts') then
   if new.runtime_version is distinct from 2 then
    raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN'; end if;
  end if;
  if tg_table_name='funding_earned_receipts' then
   if new.job_id is not null then
    raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN'; end if;
  end if;
 elsif v_role='service_role' then
  -- Exact inherited SQL role preserves the existing trusted service boundary;
  -- the definer's current_user must never replace this caller-context proof.
  null;
 elsif not(v_role in('none','postgres') and session_user='postgres') or v_role is null then
  raise exception using errcode='42501',message='FUNDING_COMMIT_SUBJECT_FORBIDDEN';
 end if;
 if tg_table_name='funding_condition_originals' then
  if new.cause_credit_boundary_id is not null then
   perform app_private.assert_credit_boundary_complete(new.cause_credit_boundary_id);
   perform app_private.assert_funding_engine_seal(new.id,'FUNDING_CONDITION_CHANGED',new.user_id,new.input_digest,
    new.audit_id,new.source_event_id,app_private.funding_condition_snapshot(new));
   return null; end if;
  perform app_private.assert_funding_engine_seal(new.id,'FUNDING_CONDITION_CHANGED',new.user_id,new.input_digest,
   new.audit_id,new.source_event_id,app_private.funding_condition_snapshot(new));
  if new.revision=0 then
   if not exists(select 1 from app_private.funding_engine_state_receipts where condition_id=new.id and revision=0) then
    raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
  else
   perform app_private.assert_allocation_boundary_complete(new.allocation_original_id,new.id);
   if not exists(select 1 from app_private.funding_engine_state_receipts s join app_private.funding_earned_receipts e
    on e.id=s.earned_receipt_id where s.condition_id=new.id and e.cause_allocation_id=new.allocation_original_id
     and e.condition_id=new.previous_condition_id) then
    raise exception using errcode='55000',message='FUNDING_ALLOCATION_ACCEPTANCE_MISSING'; end if;
  end if;
  return null;
 end if;
 if tg_table_name='funding_engine_activations' then
  if new.runtime_version=2 then
   if new.input_original->>'input_contract_version'='2' then
    perform app_private.assert_credit_boundary_complete((select boundary_id from app_private.funding_credit_boundary_completions
     where activation_id=new.id and accepted_state_id in(select id from app_private.funding_engine_state_receipts where activation_id=new.id and revision=0)));
   end if;
   perform app_private.verify_prospective_activation(new); return null; end if;
 end if;
 if tg_table_name='funding_earned_receipts' then
  if new.runtime_version=2 then perform app_private.verify_prospective_earned(new); return null; end if;
 end if;
 if tg_table_name='funding_engine_activations' then
   v_id:=new.id;
   v_snapshot:=app_private.funding_activation_snapshot(new); v_kind:='FUNDING_ACTIVATED';
   if not exists(select 1 from app_private.funding_engine_state_receipts where activation_id=new.id and revision=0) then
     raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
 elsif tg_table_name='funding_engine_jobs' then
   v_id:=new.job_id;
   v_snapshot:=app_private.funding_job_snapshot(new); v_kind:='FUNDING_JOB_PREPARED';
 else
   v_id:=new.id;
   v_e:=new; v_snapshot:=app_private.funding_earned_snapshot(v_e); v_kind:='FUNDING_EARNED_ACCEPTED';
   if not exists(select 1 from public.system_jobs job join public.system_job_attempts attempt
       on attempt.job_id=job.id and attempt.attempt_number=job.attempts
     where job.id=v_e.job_id and job.status='SUCCEEDED' and job.attempts=v_e.attempt_number
       and attempt.worker_id=v_e.worker_id and attempt.status='SUCCEEDED'
       and job.completed_at=attempt.completed_at and job.completed_at>=v_e.recorded_at
       and job.completed_at<v_e.fence_expires_at and job.completed_at<=clock_timestamp()) then
     raise exception using errcode='55000',message='FUNDING_ACCEPTED_JOB_COMPLETION_MISSING'; end if;
   if not exists(select 1 from app_private.funding_engine_state_receipts where id=v_e.next_state_id
       and earned_receipt_id=v_e.id and user_id=v_e.user_id) then
     raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
   if v_e.amount_atomic>0 then
     select movement.* into v_move from public.money_source_movements movement
     join public.mining_reward_credits credit on credit.ledger_transaction_id=movement.ledger_transaction_id
     where credit.id=v_e.credit_id and credit.funding_earned_receipt_id=v_e.id;
     if v_move.user_id is distinct from v_e.user_id or v_move.amount_atomic is distinct from v_e.amount_atomic
       or v_move.source_bucket is distinct from 'MINING_REWARD' or v_move.movement_kind is distinct from 'CREDIT'
       or v_move.effective_at is distinct from v_e.settled_to
       or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=v_e.id) then
       raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
     perform app_private.assert_money_source_credit(v_move);
   end if;
   if (v_e.calculation->>'qualifiedRetentionNum')::numeric>0
     and not exists(select 1 from app_private.funding_retention_qualifications where earned_receipt_id=v_e.id) then
     raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 end if;
 v_user:=new.user_id; v_digest:=new.input_digest; v_audit:=new.audit_id; v_event:=new.source_event_id;
 perform app_private.assert_funding_engine_seal(v_id,v_kind,v_user,v_digest,v_audit,v_event,v_snapshot);
 return null;
end;
$$;
create function app_private.read_forward_neutral_job_inputs(p_activation uuid,p_state uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype; inputs jsonb; item jsonb;
begin
 select * into activation from app_private.funding_engine_activations where id=p_activation;
 select * into state from app_private.funding_engine_state where user_id=activation.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if activation.runtime_version<>2 or state.id is distinct from p_state or state.activation_id is distinct from activation.id
  or p_at is null or not isfinite(p_at) or p_at<state.cursor_at or p_at>=cycle.cycle_end or state.cycle_closed then
  raise exception using errcode='55000',message='FUNDING_FORWARD_CYCLE_QUALIFICATION_ADAPTER_REQUIRED'; end if;
 if exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
 on b.id=c.boundary_id where c.user_id=activation.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
 activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 inputs:=app_private.assert_credit_condition_inputs(condition.id,p_at);
 if(select count(*) from app_private.funding_portion_clock_state where user_id=activation.user_id)
  <>jsonb_array_length(inputs->'credit_originals') then
  raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 for item in select value from jsonb_array_elements(inputs->'credit_originals') loop
  if not exists(select 1 from app_private.funding_portion_clock_state c
   join app_private.funding_principal_portions p on p.id=c.portion_id join public.funding_principal_lots l on l.id=p.lot_id
   where c.user_id=activation.user_id and p.lot_id=(item->>'lot_id')::uuid and p.parent_portion_id is null
    and c.status='AVAILABLE' and p.amount_micro_krw=l.amount_micro_krw and c.accumulated_eligible_microseconds=0
    and c.resumed_at=l.effective_at) then
   raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 end loop;
 return inputs;
end;
$$;

create function app_private.read_forward_funding_runtime_display(p_user uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; condition app_private.funding_condition_originals%rowtype;
 inputs jsonb; calculation jsonb; capacities numeric[]; capacity numeric[]; used numeric[]; remaining numeric[];
 maintenance numeric[]; pending numeric[]; speed numeric[]; committed numeric; runtime_status text; stop_reason text;
begin
 select * into activation from app_private.funding_engine_activations where user_id=p_user;
 select * into state from app_private.funding_engine_state where user_id=p_user;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 inputs:=app_private.read_forward_neutral_job_inputs(activation.id,state.id,p_at);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,p_at);
 capacities:=app_private.funding_state_effective_capacities(state.id);
 capacity:=app_private.funding_exact_sum(array[capacities[1],capacities[2]],array[capacities[3],capacities[4]]);
 used:=app_private.funding_exact_sum(array[(calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric],
 array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric]);
 remaining:=app_private.funding_exact_ratio(greatest(0,capacity[1]*used[2]-used[1]*capacity[2]),capacity[2]*used[2]);
 maintenance:=array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric];
 pending:=app_private.funding_exact_sum(array[state.carry_num,state.carry_den],array[(calculation->>'baseNum')::numeric,(calculation->>'baseDen')::numeric]);
 speed:=app_private.funding_exact_ratio((inputs->>'allocation_bps')::numeric,10000);
 if (inputs->>'allocation_bps')::integer=0 then runtime_status:='STOPPED'; stop_reason:='NO_ACTIVE_ALLOCATION';
 elsif (calculation->>'baseUsedNum')::numeric*capacities[2]>=capacities[1]*(calculation->>'baseUsedDen')::numeric then
  runtime_status:='STOPPED'; stop_reason:='CAPACITY_USED';
 else runtime_status:='ACTIVE'; end if;
 select coalesce(sum(amount_atomic),0) into committed from app_private.funding_earned_receipts where activation_id=activation.id;
 return jsonb_build_object('available',true,'eligible_principal_micro_krw',((inputs->>'principal_atomic')::numeric*1000000)::text,
 'tier_code',inputs->>'tier_code','tier_activated',true,
 'cycle_started_at',to_char(cycle.cycle_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'cycle_end',to_char(cycle.cycle_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'effective_capacity_micro_krw',div(capacity[1]*1000000,capacity[2])::text,
 'remaining_capacity_micro_krw',div(remaining[1]*1000000,remaining[2])::text,
 'used_capacity_micro_krw',div(used[1]*1000000,used[2])::text,'speed_multiplier_bps','10000',
 'pending_micro_krw',div(pending[1]*1000000,pending[2])::text,
 'retention_unconfirmed_micro_krw',div(maintenance[1]*1000000,maintenance[2])::text,
 'funded_runtime',jsonb_build_object('schema_version',2,'runtime_version',2,'state_revision',state.revision::text,
 'condition_revision',condition.revision::text,
 'accepted_cursor_at',to_char(state.cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'evaluated_at',to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'allocation_bps',inputs->>'allocation_bps','status',runtime_status,'stop_reason',stop_reason,
 'speed',jsonb_build_object('product_multiplier_bps','10000','user_multiplier_bps','10000',
 'common_multiplier',jsonb_build_object('numerator','1','denominator','1'),
 'effective_global_multiplier',jsonb_build_object('numerator',speed[1]::text,'denominator',speed[2]::text)),
 'committed_reward_total_atomic',committed::text,
 'reward_carry',jsonb_build_object('numerator',state.carry_num::text,'denominator',state.carry_den::text,'unit','KRW'),
 'conditional_maintenance',jsonb_build_object('numerator',maintenance[1]::text,'denominator',maintenance[2]::text,'unit','KRW','qualification','UNCONFIRMED')));
end;
$$;
create or replace function app_private.read_neutral_funding_job_inputs(p_activation uuid,p_state uuid,p_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 portion record; inputs jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 select * into activation from app_private.funding_engine_activations where id=p_activation;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||activation.user_id::text,0));
 select * into state from app_private.funding_engine_state where user_id=activation.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if p_at is null or not isfinite(p_at) or activation.runtime_version is distinct from 2 or state.id is distinct from p_state
  or state.activation_id is distinct from activation.id or state.cycle_closed
  or condition.activation_id is distinct from activation.id or condition.user_id is distinct from activation.user_id
  or cycle.id is distinct from activation.first_cycle_id or p_at<state.cursor_at or p_at>cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',activation.user_id,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 if condition.inputs->>'input_contract_version'='2' then
  return app_private.read_forward_neutral_job_inputs(p_activation,p_state,p_at); end if;
 if condition.allocation_original_id is not null then
  perform app_private.assert_allocation_boundary_complete(condition.allocation_original_id,condition.id);
 end if;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,p_at);
 if inputs is distinct from condition.inputs then
  raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 select c.*,p.lot_id,p.parent_portion_id,p.amount_micro_krw into portion
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 where c.user_id=activation.user_id;
 if(select count(*) from app_private.funding_portion_clock_state where user_id=activation.user_id)<>1
  or portion.status is distinct from 'AVAILABLE' or portion.parent_portion_id is not null
  or portion.accumulated_eligible_microseconds is distinct from 0::bigint
  or portion.resumed_at is distinct from activation.effective_at
  or portion.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(activation.principal_atomic)
  or portion.lot_id is distinct from(select id from public.funding_principal_lots where money_source_movement_id=activation.trigger_credit_movement_id) then
  raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 if p_at=cycle.cycle_end and app_private.funding_portion_eligible_age(portion.accumulated_eligible_microseconds,
  portion.resumed_at,p_at,true) is distinct from(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint then
  raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 return inputs;
end;
$$;

create or replace function app_private.validate_neutral_funding_job_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 original app_private.funding_engine_jobs%rowtype; cycle app_private.funding_cycle_windows%rowtype; inputs jsonb; calculation jsonb;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_earned.user_id::text,0));
 select * into activation from app_private.funding_engine_activations where id=p_earned.activation_id;
 select * into original from app_private.funding_engine_jobs where job_id=p_earned.job_id;
 select * into state from app_private.funding_engine_state_receipts where id=p_earned.previous_state_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_earned.cycle_id;
 perform app_private.assert_funding_job_fence(p_earned.job_id,p_earned.worker_id,p_earned.attempt_number);
 inputs:=app_private.read_neutral_funding_job_inputs(activation.id,state.id,p_earned.settled_to);
 if p_earned.runtime_version<>2 or p_earned.cause_allocation_id is not null
  or activation.user_id is distinct from p_earned.user_id or original.user_id is distinct from p_earned.user_id
  or original.activation_id is distinct from activation.id or original.expected_state_id is distinct from state.id
  or p_earned.condition_id is distinct from state.condition_id or p_earned.cycle_id is distinct from cycle.id
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to>clock_timestamp()
  or p_earned.fence_expires_at is distinct from(select lease_expires_at from public.system_jobs where id=p_earned.job_id) then
  raise exception using errcode='55000',message='FUNDING_EARNED_INPUT_MISMATCH'; end if;
 if inputs->>'input_contract_version'='2' then
  calculation:=app_private.calculate_credit_boundary_interval(state.id,p_earned.settled_to);
 else
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from p_earned.settled_to-p_earned.settled_from)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,
  p_earned.settled_to=cycle.cycle_end);
 end if;
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create or replace function app_private.process_neutral_funding_condition_job(p_job uuid,p_worker text,p_attempt integer)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_j app_private.funding_engine_jobs%rowtype; v_job public.system_jobs%rowtype;
 v_a app_private.funding_engine_activations%rowtype; v_state app_private.funding_engine_state_receipts%rowtype;
 v_cycle app_private.funding_cycle_windows%rowtype; v_e app_private.funding_earned_receipts%rowtype;
 v_input jsonb; v_calc jsonb; v_wallet uuid; v_until timestamptz; v_now timestamptz; v_target timestamptz;
 v_key text; v_journal uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_credit_event uuid:=gen_random_uuid();
 v_request uuid:=gen_random_uuid(); v_correlation uuid:=gen_random_uuid(); v_count integer;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 select * into v_j from app_private.funding_engine_jobs where job_id=p_job;
 if v_j.job_id is null then raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||v_j.user_id::text,0));
 select * into v_job from public.system_jobs where id=p_job for update;
 select * into v_e from app_private.funding_earned_receipts where job_id=p_job;
 if v_e.id is not null then
   if v_e.worker_id is distinct from p_worker or v_e.attempt_number is distinct from p_attempt
     or v_job.status is distinct from 'SUCCEEDED'
     or not exists(select 1 from public.system_job_attempts where job_id=p_job and attempt_number=p_attempt
       and worker_id=p_worker and status='SUCCEEDED') then
     raise exception using errcode='22023',message='FUNDING_ACCEPTED_JOB_CONFLICT'; end if;
   perform app_private.assert_funding_engine_seal(v_e.id,'FUNDING_EARNED_ACCEPTED',v_e.user_id,v_e.input_digest,
     v_e.audit_id,v_e.source_event_id,app_private.funding_earned_snapshot(v_e));
   return v_e.id;
 end if;
 perform app_private.assert_funding_job_fence(p_job,p_worker,p_attempt);
 if v_job.payload is distinct from app_private.funding_job_snapshot(v_j)
   or v_job.job_type is distinct from 'FUNDING_MINING_TICK_V1' or v_job.payload_version<>1
   or v_job.idempotency_key is distinct from 'funding:state:'||v_j.expected_state_id::text then
   raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(p_job,'FUNDING_JOB_PREPARED',v_j.user_id,v_j.input_digest,
   v_j.audit_id,v_j.source_event_id,app_private.funding_job_snapshot(v_j));
 select * into v_a from app_private.funding_engine_activations where id=v_j.activation_id;
 perform app_private.assert_funding_engine_seal(v_a.id,'FUNDING_ACTIVATED',v_a.user_id,v_a.input_digest,
   v_a.audit_id,v_a.source_event_id,app_private.funding_activation_snapshot(v_a));
 select * into v_state from app_private.funding_engine_state where user_id=v_j.user_id;
 if v_state.id is distinct from v_j.expected_state_id or v_state.activation_id is distinct from v_a.id
   or v_state.cycle_closed then raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 select id into v_wallet from public.wallet_accounts where user_id=v_j.user_id and currency='KRW' and closed_at is null for update;
 if v_wallet is null then raise exception using errcode='55000',message='FUNDING_OPEN_WALLET_REQUIRED'; end if;
 -- READ COMMITTED source read after wallet serialization rejects any concurrent
 -- deposit/source transition; no late AFTER-credit advisory lock is introduced.
 v_now:=clock_timestamp();
 select * into v_cycle from app_private.funding_cycle_windows where id=v_state.cycle_id;
 select effective_until into v_until from app_private.economy_policy_published where publication_id=v_a.policy_publication_id;
 v_target:=least(v_now,v_cycle.cycle_end,coalesce(v_until,'infinity'::timestamptz));
 v_input:=app_private.read_neutral_funding_job_inputs(v_a.id,v_state.id,v_target);
 if v_target<=v_state.cursor_at then raise exception using errcode='55000',message='FUNDING_BOUNDARY_ADAPTER_REQUIRED'; end if;
 if v_input->>'input_contract_version'='2' then
  v_calc:=app_private.calculate_credit_boundary_interval(v_state.id,v_target);
 else
 v_calc:=app_private.funding_exact_condition_interval(v_a.principal_atomic,
   (v_input->>'base_bps')::integer,(v_input->>'retention_bps')::integer,(v_input->>'allocation_bps')::integer,
   (extract(epoch from v_cycle.cycle_end-v_cycle.cycle_started_at)*1000000)::bigint,
   (extract(epoch from v_target-v_state.cursor_at)*1000000)::bigint,
   v_state.base_used_num,v_state.base_used_den,v_state.retention_used_num,v_state.retention_used_den,
   v_state.carry_num,v_state.carry_den,v_target=v_cycle.cycle_end);
 end if;
 v_e.id:=gen_random_uuid(); v_e.user_id:=v_j.user_id; v_e.activation_id:=v_a.id; v_e.cycle_id:=v_cycle.id;
 v_e.job_id:=p_job; v_e.attempt_number:=p_attempt; v_e.worker_id:=p_worker;
 v_e.fence_expires_at:=v_job.lease_expires_at;
 v_e.previous_state_id:=v_state.id; v_e.next_state_id:=gen_random_uuid();
 v_e.settled_from:=v_state.cursor_at; v_e.settled_to:=v_target; v_e.calculation:=v_calc;
 v_e.amount_atomic:=(v_calc->>'amountAtomic')::bigint;
 if v_e.amount_atomic>0 then v_e.credit_id:=gen_random_uuid(); v_e.settlement_id:=gen_random_uuid(); end if;
 v_e.runtime_version:=2; v_e.condition_id:=v_state.condition_id;
 v_e.input_digest:=app_private.funding_engine_digest(app_private.funding_earned_snapshot(v_e));
 v_e.audit_id:=gen_random_uuid(); v_e.source_event_id:=gen_random_uuid(); v_e.recorded_at:=clock_timestamp();
 insert into app_private.funding_earned_receipts select v_e.*;
 if v_input->>'input_contract_version'='2' then
  perform app_private.carry_forward_funding_capacity(v_e.next_state_id,v_state.id,v_e.id); end if;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
   earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,cycle_closed,condition_id)
 values(v_e.next_state_id,v_e.user_id,v_a.id,v_cycle.id,v_state.revision+1,v_state.id,v_e.id,v_target,
   (v_calc->>'baseUsedNum')::numeric,(v_calc->>'baseUsedDen')::numeric,
   (v_calc->>'retentionUsedNum')::numeric,(v_calc->>'retentionUsedDen')::numeric,
   (v_calc->>'carryNum')::numeric,(v_calc->>'carryDen')::numeric,v_target=v_cycle.cycle_end,v_state.condition_id);
 if (v_calc->>'qualifiedRetentionNum')::numeric>0 then
   insert into app_private.funding_retention_qualifications(user_id,cycle_id,earned_receipt_id,qualified_num,qualified_den,
     principal_input_digest,qualified_at)
   values(v_e.user_id,v_cycle.id,v_e.id,(v_calc->>'qualifiedRetentionNum')::numeric,
     (v_calc->>'qualifiedRetentionDen')::numeric,v_a.input_digest,v_cycle.cycle_end);
 end if;
 if v_e.amount_atomic>0 then
   -- Stable sealed logical-job identity, not a freshly generated posting key.
   -- Job/previous-state uniqueness plus input/interval digest owns acceptance.
   v_key:='funding:job:'||p_job::text;
   insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,
     member_user_id,request_id,correlation_id,description,posted_at,metadata)
   values(v_journal,'MINING_REWARD','KRW',v_key||':ledger','mining_reward_credit',v_e.credit_id,
     v_e.user_id,v_request,v_correlation,'verified funded mining reward',v_target,
     jsonb_build_object('funding_earned_receipt_id',v_e.id,'fee_atomic','0'));
   insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic) values
    (v_journal,(select id from public.ledger_accounts where code='PUTDUK:MINING_REWARD_EXPENSE:KRW'),0,'DEBIT',v_e.amount_atomic),
    (v_journal,(select id from public.ledger_accounts where code='USER:'||upper(v_e.user_id::text)||':KRW:LIABILITY'),1,'CREDIT',v_e.amount_atomic);
   insert into public.wallet_ledger(id,wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
   values(v_projection,v_wallet,v_e.user_id,'CREDIT','MINING_REWARD',v_e.amount_atomic,v_key||':wallet','mining_reward_credit',v_e.credit_id);
   insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
     correlation_id,request_id,idempotency_key,available_at,last_error_code)
   values(v_credit_event,'MINING_REWARD_CREDITED.v1',1,'mining_reward_credit',v_e.credit_id,v_e.user_id,
     jsonb_build_object('user_id',v_e.user_id,'amount_atomic',v_e.amount_atomic,'currency','KRW',
       'ledger_transaction_id',v_journal,'wallet_ledger_id',v_projection),v_correlation,v_request,v_key||':event',
     'infinity','FUNDING_ENGINE_CONSUMER_NOT_ENABLED');
   insert into public.mining_reward_credits(id,user_id,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at,funding_earned_receipt_id)
   values(v_e.credit_id,v_e.user_id,v_e.amount_atomic,v_journal,v_projection,v_credit_event,v_target,v_e.id);
   insert into public.money_source_movements(user_id,source_bucket,movement_kind,origin_code,amount_atomic,
     ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at)
   values(v_e.user_id,'MINING_REWARD','CREDIT','MINING_REWARD',v_e.amount_atomic,v_journal,v_projection,v_credit_event,v_target);
   insert into public.mining_settlements(id,user_id,settled_from,settled_to,amount_atomic,currency,segment_count,idempotency_key,funding_earned_receipt_id)
   values(v_e.settlement_id,v_e.user_id,v_e.settled_from,v_target,v_e.amount_atomic,'KRW',1,v_key||':settlement',v_e.id);
   insert into public.mining_settlement_segments(mining_settlement_id,user_id,sequence,settled_from,settled_to,
     amount_atomic,equipment_efficiency_bps,world_multiplier_bps,event_multiplier_bps,status_multiplier_bps,funding_earned_receipt_id)
   values(v_e.settlement_id,v_e.user_id,0,v_e.settled_from,v_target,v_e.amount_atomic,10000,10000,10000,10000,v_e.id);
 end if;
 perform app_private.write_funding_engine_seal(v_e.id,'FUNDING_EARNED_ACCEPTED',v_e.user_id,v_e.input_digest,
   v_e.audit_id,v_e.source_event_id,app_private.funding_earned_snapshot(v_e));
 -- Fence at actual completion clock; a lease lost during calculation/posting
 -- rolls back earned/state/ledger/source/outbox/audit together.
 perform app_private.assert_funding_job_fence(p_job,p_worker,p_attempt);
 v_now:=clock_timestamp();
 update public.system_jobs set status='SUCCEEDED',completed_at=v_now,lease_owner=null,lease_expires_at=null,last_error_code=null
 where id=p_job and status='RUNNING' and lease_owner=p_worker and attempts=p_attempt and lease_expires_at>v_now;
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception using errcode='55000',message='FUNDING_JOB_FENCE_NOT_OWNED'; end if;
 update public.system_job_attempts set status='SUCCEEDED',completed_at=v_now
 where job_id=p_job and attempt_number=p_attempt and worker_id=p_worker and status='RUNNING';
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception using errcode='55000',message='FUNDING_JOB_FENCE_NOT_OWNED'; end if;
 return v_e.id;
end;
$$;

create or replace function app_private.read_funding_runtime_server_display(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; policy app_private.economy_policy_published%rowtype;
 instant timestamptz; inputs jsonb; calculation jsonb; tier jsonb; pending numeric[]; maintenance numeric[];
 used numeric[]; capacity numeric[]; remaining numeric[]; committed numeric;
 speed numeric[]; runtime_status text; stop_reason text; base_capacity numeric[];
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role'
  or p_user is null or(auth.uid() is not null and auth.uid() is distinct from p_user) then
  raise exception using errcode='42501',message='MINING_DISPLAY_SUBJECT_FORBIDDEN'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 select * into activation from app_private.funding_engine_activations where user_id=p_user;
 select * into state from app_private.funding_engine_state where user_id=p_user;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 instant:=clock_timestamp();
 if activation.runtime_version is distinct from 2 or state.activation_id is distinct from activation.id
  or state.user_id is distinct from p_user or condition.user_id is distinct from p_user
  or condition.activation_id is distinct from activation.id or cycle.id is distinct from activation.first_cycle_id
  or state.cycle_closed or instant>=cycle.cycle_end or instant<state.cursor_at then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_DISPLAY_BOUNDARY_UNSUPPORTED'; end if;
 if exists(select 1 from app_private.funding_credit_boundary_completions c join app_private.funding_credit_boundary_preparations b
  on b.id=c.boundary_id where c.user_id=p_user and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
  raise exception using errcode='55000',message='FUNDING_CREDIT_INPUT_UNRESOLVED'; end if;
 if condition.inputs->>'input_contract_version'='2' then
  return app_private.read_forward_funding_runtime_display(p_user,instant); end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',p_user,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',p_user,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,instant);
 if inputs is distinct from condition.inputs
  or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition))
  or not exists(select 1 from app_private.funding_portion_clock_state c
    join app_private.funding_principal_portions p on p.id=c.portion_id
    join public.funding_principal_lots l on l.id=p.lot_id
    where c.user_id=p_user and c.status='AVAILABLE' and p.parent_portion_id is null
     and p.amount_micro_krw=l.amount_micro_krw and l.money_source_movement_id=activation.trigger_credit_movement_id)
  or(select count(*) from app_private.funding_portion_clock_state where user_id=p_user)<>1 then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_DISPLAY_ORIGINAL_MISMATCH'; end if;
 if condition.allocation_original_id is not null then
  perform app_private.assert_allocation_boundary_complete(condition.allocation_original_id,condition.id);
 end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from instant-state.cursor_at)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 pending:=app_private.funding_exact_sum(array[state.carry_num,state.carry_den],
  array[(calculation->>'baseNum')::numeric,(calculation->>'baseDen')::numeric]);
 maintenance:=array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric];
 used:=app_private.funding_exact_sum(array[(calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric],maintenance);
 capacity:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*
  ((inputs->>'base_bps')::numeric+(inputs->>'retention_bps')::numeric),10000);
 remaining:=app_private.funding_exact_ratio(greatest(0,capacity[1]*used[2]-used[1]*capacity[2]),capacity[2]*used[2]);
 select * into policy from app_private.economy_policy_published where publication_id=activation.policy_publication_id;
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::bigint<=(inputs->>'principal_atomic')::bigint
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::bigint>=(inputs->>'principal_atomic')::bigint);
 speed:=app_private.funding_exact_ratio((inputs->>'allocation_bps')::numeric,10000);
 base_capacity:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
 if (inputs->>'allocation_bps')::integer=0 then
  runtime_status:='STOPPED'; stop_reason:='NO_ACTIVE_ALLOCATION';
 elsif (calculation->>'baseUsedNum')::numeric*base_capacity[2]>=base_capacity[1]*(calculation->>'baseUsedDen')::numeric then
  runtime_status:='STOPPED'; stop_reason:='CAPACITY_USED';
 else runtime_status:='ACTIVE'; end if;
 select coalesce(sum(amount_atomic),0) into committed from app_private.funding_earned_receipts where activation_id=activation.id;
 return jsonb_build_object('available',true,'eligible_principal_micro_krw',
  ((inputs->>'principal_atomic')::numeric*1000000)::text,'tier_code',tier->>'code','tier_activated',true,
  'cycle_started_at',to_char(cycle.cycle_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cycle_end',to_char(cycle.cycle_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'effective_capacity_micro_krw',div(capacity[1]*1000000,capacity[2])::text,
  'remaining_capacity_micro_krw',div(remaining[1]*1000000,remaining[2])::text,
  'used_capacity_micro_krw',div(used[1]*1000000,used[2])::text,'speed_multiplier_bps','10000',
  'pending_micro_krw',div(pending[1]*1000000,pending[2])::text,
  'retention_unconfirmed_micro_krw',div(maintenance[1]*1000000,maintenance[2])::text,
  'funded_runtime',jsonb_build_object('schema_version',2,'runtime_version',2,'state_revision',state.revision::text,
   'condition_revision',condition.revision::text,
   'accepted_cursor_at',to_char(state.cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'evaluated_at',to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'allocation_bps',inputs->>'allocation_bps','status',runtime_status,'stop_reason',stop_reason,
   'speed',jsonb_build_object('product_multiplier_bps','10000','user_multiplier_bps','10000',
    'common_multiplier',jsonb_build_object('numerator','1','denominator','1'),
    'effective_global_multiplier',jsonb_build_object('numerator',speed[1]::text,'denominator',speed[2]::text)),
   'committed_reward_total_atomic',committed::text,
   'reward_carry',jsonb_build_object('numerator',state.carry_num::text,'denominator',state.carry_den::text,'unit','KRW'),
   'conditional_maintenance',jsonb_build_object('numerator',maintenance[1]::text,'denominator',maintenance[2]::text,
    'unit','KRW','qualification','UNCONFIRMED')));
end;
$$;

create function app_private.guard_funding_credit_command_completion() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if old.status='COMPLETED' and old.scope in('deposit.approve','usdt_manual_deposit.confirm')
  and exists(select 1 from app_private.funding_credit_boundary_completions c
   join public.money_source_movements m on m.id=c.credit_movement_id
   where m.ledger_transaction_id::text=old.response_payload->>'ledger_transaction_id') then
  raise exception using errcode='55000',message='FUNDING_CREDIT_COMMAND_COMPLETION_IMMUTABLE'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_credit_command_completion_immutable before update or delete on app_private.idempotency_keys
 for each row when(old.status='COMPLETED' and old.scope in('deposit.approve','usdt_manual_deposit.confirm'))
 execute function app_private.guard_funding_credit_command_completion();

-- Close every new internal helper by exact signature. No public/member schema
-- usage, table write grant or financial alias is added. Existing trigger ACLs
-- remain as published; service can only invoke the two ID-only cutovers and the
-- narrow exact-capacity copier needed by the existing canonical job consumer.
revoke all on function
 app_private.assert_credit_boundary_executor(),
 app_private.write_credit_boundary_seal(uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz),
 app_private.funding_state_effective_capacities(uuid),
 app_private.assert_credit_condition_inputs(uuid,timestamptz),
 app_private.calculate_credit_boundary_interval(uuid,timestamptz),
 app_private.guard_credit_boundary_preparation(),
 app_private.validate_credit_boundary_earned(app_private.funding_earned_receipts),
 app_private.post_credit_boundary_earned(uuid),
 app_private.begin_funding_credit_boundary(uuid,text),
 app_private.read_credit_boundary_source(uuid),
 app_private.finish_funding_credit_boundary(uuid),
 app_private.validate_credit_activation(app_private.funding_engine_activations),
 app_private.validate_credit_condition(app_private.funding_condition_originals),
 app_private.validate_credit_state(app_private.funding_engine_state_receipts),
 app_private.assert_credit_boundary_complete(uuid),
 app_private.verify_credit_boundary_commit(),
 app_private.verify_credit_boundary_earned(app_private.funding_earned_receipts),
 app_private.assert_funding_capacity_state_complete(uuid),
 app_private.guard_credit_boundary_completion(),
 app_private.validate_forward_allocation_earned(app_private.funding_earned_receipts),
 app_private.apply_forward_allocation_boundary(uuid),
 app_private.carry_forward_funding_capacity(uuid,uuid,uuid),
 app_private.read_forward_neutral_job_inputs(uuid,uuid,timestamptz),
 app_private.read_forward_funding_runtime_display(uuid,timestamptz),
 app_private.guard_funding_credit_command_completion()
 from public,anon,authenticated,service_role;
grant execute on function app_private.begin_funding_credit_boundary(uuid,text),
 app_private.finish_funding_credit_boundary(uuid),
 app_private.carry_forward_funding_capacity(uuid,uuid,uuid),
 app_private.calculate_credit_boundary_interval(uuid,timestamptz),
 app_private.funding_state_effective_capacities(uuid),
 app_private.validate_credit_state(app_private.funding_engine_state_receipts)
 to service_role;
alter function app_private.begin_funding_credit_boundary(uuid,text) owner to postgres;
alter function app_private.finish_funding_credit_boundary(uuid) owner to postgres;
alter function app_private.carry_forward_funding_capacity(uuid,uuid,uuid) owner to postgres;
alter function app_private.verify_credit_boundary_commit() owner to postgres;
comment on function app_private.begin_funding_credit_boundary(uuid,text) is
 'Closed actual-service canonical deposit original preparation; member-first lock and DB clock, exact old-condition acceptance or audited unresolved outcome. Not a caller-amount mining producer.';
comment on function app_private.finish_funding_credit_boundary(uuid) is
 'Closed actual-service canonical deposit completion; genuine principal/source/command proof, prospective ZERO activation or credit condition/capacity boundary. Missing approved inputs preserve financial deposit and record unknown engine truth.';
commit;
