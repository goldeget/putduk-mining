begin;
-- Primary integrates this corrective proposal as an append-only CLI migration.
-- Existing closed executor/ACL roster is reused; no new helper grants/definer.
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
  -- The new receipt trigger uses this existing closed owner executor after
  -- the unchanged caller-subject and trigger-context checks above.
  if tg_name='funding_slot_condition_complete' then
   perform app_private.assert_funding_slot_condition_receipt(new.id,true);return null;
  end if;
  if new.cause_principal_boundary_id is not null then
   if v_role is distinct from 'service_role' or auth.role() is distinct from 'service_role' or(auth.uid() is not null and auth.uid() is distinct from new.user_id) then
    raise exception using errcode='42501',message='FUNDING_PRINCIPAL_COMMIT_SUBJECT_FORBIDDEN';end if;
   perform app_private.assert_principal_boundary_complete(new.cause_principal_boundary_id);return null;end if;
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

drop trigger funding_slot_condition_complete on app_private.funding_condition_originals;
create constraint trigger funding_slot_condition_complete after insert on app_private.funding_condition_originals
 deferrable initially deferred for each row execute function app_private.verify_funding_integrity_at_commit();
drop function app_private.verify_funding_slot_condition_commit();

commit;
