begin;

--139 authoring only. Existing immutable130/133 phases gain an additive native
-- FINALIZE branch. No historical row, monetary number, RLS/ACL or public alias.
create temporary table funding_finalize_prior_check_assertion(
 phase text,hold_admission_id uuid,
 constraint expected_phase check(phase in('HOLD','RELEASE')),
 constraint expected_predecessor check((phase='HOLD' and hold_admission_id is null) or(phase='RELEASE' and hold_admission_id is not null))
);
do $assert_finalize_prior_checks$
begin
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_withdrawal_clock_admissions'::regclass and conname='funding_withdrawal_clock_admissions_phase_check') is distinct from
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_finalize_prior_check_assertion'::regclass and conname='expected_phase')
 or (select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_principal_boundary_preparations'::regclass and conname='funding_principal_boundary_preparations_phase_check') is distinct from
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_finalize_prior_check_assertion'::regclass and conname='expected_phase')
 or (select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_withdrawal_clock_admissions'::regclass and conname='funding_withdrawal_clock_admissions_check') is distinct from
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_finalize_prior_check_assertion'::regclass and conname='expected_predecessor') then
 raise exception using errcode='55000',message='FUNDING_FINALIZE_PRIOR_CONSTRAINT_UNEXPECTED';end if;
end;
$assert_finalize_prior_checks$;
drop table pg_temp.funding_finalize_prior_check_assertion;
alter table app_private.funding_withdrawal_clock_admissions drop constraint funding_withdrawal_clock_admissions_phase_check;
alter table app_private.funding_withdrawal_clock_admissions add constraint funding_withdrawal_clock_admissions_phase_check check(phase in('HOLD','RELEASE','FINALIZE'));
alter table app_private.funding_withdrawal_clock_admissions drop constraint funding_withdrawal_clock_admissions_check;
alter table app_private.funding_withdrawal_clock_admissions add constraint funding_withdrawal_clock_admissions_check
 check((phase='HOLD' and hold_admission_id is null) or(phase in('RELEASE','FINALIZE') and hold_admission_id is not null));
alter table app_private.funding_principal_boundary_preparations drop constraint funding_principal_boundary_preparations_phase_check;
alter table app_private.funding_principal_boundary_preparations add constraint funding_principal_boundary_preparations_phase_check check(phase in('HOLD','RELEASE','FINALIZE'));

create or replace function app_private.capture_funding_withdrawal_clock_admission(p_withdrawal uuid,p_phase text,p_request uuid)
returns table(admission_id uuid,effective_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;owner_id uuid;wallet_id uuid;hold_original uuid;
 snapshot jsonb;
begin
 -- Preserve the existing SQL-only service financial caller contract. This is
 -- not a member command and cannot be reached under authenticated SQL role,
 -- even if a forged JWT says service_role. No caller amount/time is accepted.
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='WITHDRAWAL_CLOCK_SERVICE_ROLE_REQUIRED'; end if;
 if p_withdrawal is null or p_request is null or p_phase not in('HOLD','RELEASE','FINALIZE') or p_phase is null then
  raise exception using errcode='22023',message='WITHDRAWAL_CLOCK_ADMISSION_INVALID'; end if;
 select r.user_id into owner_id from public.withdrawal_requests r where r.id=p_withdrawal;
 if owner_id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=owner_id for update;
 if request.id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 select a.* into original from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=request.id and a.phase=p_phase;
 if original.id is not null then
  if original.journal_request_id is distinct from p_request then
   raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REUSED'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(original.id);
  admission_id:=original.id;effective_at:=original.effective_at;return next;return;
 end if;
 -- Immutable phase replay precedes current fresh-admission requirements.
 -- Advisory/row locks do not refresh a REPEATABLE READ snapshot after waiting.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='WITHDRAWAL_CLOCK_FRESH_SNAPSHOT_REQUIRED'; end if;
 if request.currency<>'KRW' or request.fee_atomic<>0
  or(p_phase='HOLD' and(request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null))
  or(p_phase='RELEASE' and(request.status not in('REQUESTED','HELD','ADMIN_PROCESSING','REVIEWING','APPROVED','PROCESSING')
   or request.hold_ledger_transaction_id is null or request.release_ledger_transaction_id is not null
   or exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id)))
  or(p_phase='FINALIZE' and(request.status<>'EXTERNAL_SENT_RECORDED' or request.hold_ledger_transaction_id is null
   or request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null
   or not exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id and s.method=request.destination_type)
   or not exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=request.id and i.user_id=owner_id))) then
  raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_ADMISSION_ORIGINAL_REQUIRED'; end if;
 if p_phase in('RELEASE','FINALIZE') then
  select a.id into hold_original from app_private.funding_withdrawal_clock_admissions a
   where a.withdrawal_id=request.id and a.phase='HOLD';
  if hold_original is null then raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_HOLD_ADMISSION_REQUIRED'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(hold_original);
 end if;
 select w.id into wallet_id from public.wallet_accounts w where w.id=request.wallet_account_id
  and w.user_id=owner_id and w.currency='KRW' and w.closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND'; end if;
 -- Ensure controlled ledger accounts BEFORE the sole financial clock; an
 -- account uniqueness wait must not introduce a pre-admission effective time.
 perform 1 from app_private.ensure_withdrawal_hold_accounts(owner_id);
 if exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=request.id) then
  -- New waits precede the same sole130 clock. No command-provided amount/time.
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||owner_id::text,0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
  perform 1 from public.ledger_accounts a where a.code='PUTDUK:MINING_REWARD_EXPENSE:KRW' for key share;
  if not found then raise exception using errcode='55000',message='FUNDING_MINING_EXPENSE_ACCOUNT_REQUIRED';end if;
 end if;
 original.id:=gen_random_uuid();original.schema_version:=1;original.user_id:=owner_id;original.withdrawal_id:=request.id;
 original.phase:=p_phase;original.hold_admission_id:=hold_original;original.amount_atomic:=request.amount_atomic+request.fee_atomic;
 original.journal_request_id:=p_request;original.request_snapshot:=app_private.funding_withdrawal_request_snapshot(request);
 original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 original.effective_at:=clock_timestamp();
 -- A concurrent canonical control may start AFTER this statement began.
 -- Authorize against this SAME admitted financial clock, never statement time.
 if exists(select 1 from public.safe_mode_controls c
   where c.component in('GLOBAL','WITHDRAWAL') and c.is_paused and c.starts_at<=original.effective_at) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
 snapshot:=app_private.funding_withdrawal_clock_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.funding_withdrawal_clock_admissions select original.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(original.audit_id,owner_id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED','FUNDING_ENGINE_V1',original.id::text,
  'canonical source-bound withdrawal clock admission',p_request,snapshot,
  jsonb_build_object('input_digest',original.input_digest,'engine_contract',2),original.effective_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at,available_at,last_error_code)
 values(original.source_event_id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED.v1',1,'funding_engine_v1',original.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',original.audit_id,'input_digest',original.input_digest),p_request,p_request,
  'funding:'||original.id::text||':seal',original.effective_at,original.effective_at,'infinity','FUNDING_PRINCIPAL_CONDITION_ADAPTER_NOT_ENABLED');
 perform app_private.begin_principal_runtime_boundary(original.id);
 admission_id:=original.id;effective_at:=original.effective_at;return next;
end;
$$;


create or replace function app_private.assert_funding_withdrawal_clock_admission(p_original uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;journal public.ledger_transactions%rowtype;
 hold_original app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 select a.* into original from app_private.funding_withdrawal_clock_admissions a where a.id=p_original;
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 if original.id is null or request.user_id is distinct from original.user_id
  or original.amount_atomic is distinct from request.amount_atomic+request.fee_atomic
  or request.currency<>'KRW' or request.fee_atomic<>0
  or original.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(request)
  or original.effective_at>clock_timestamp()
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_withdrawal_clock_snapshot(original)) then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 if not exists(select 1 from public.audit_logs a where a.id=original.audit_id
   and a.actor_user_id=original.user_id and a.request_id=original.journal_request_id and a.created_at=original.effective_at)
  or not exists(select 1 from public.outbox_events e where e.id=original.source_event_id
   and e.request_id=original.journal_request_id and e.correlation_id=original.journal_request_id
   and e.occurred_at=original.effective_at and e.created_at=original.effective_at) then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.funding_withdrawal_clock_snapshot(original));
 select t.* into journal from public.ledger_transactions t
  where t.id=case when original.phase='HOLD' then request.hold_ledger_transaction_id when original.phase='RELEASE' then request.release_ledger_transaction_id else request.finalize_ledger_transaction_id end;
 if journal.id is null or journal.member_user_id is distinct from original.user_id or journal.currency<>'KRW'
  or journal.reference_type is distinct from 'withdrawal_request' or journal.reference_id is distinct from request.id
  or journal.request_id is distinct from original.journal_request_id or journal.posted_at is distinct from original.effective_at
  or journal.created_at is distinct from original.effective_at
  or journal.metadata->>'phase' is distinct from original.phase
  or journal.metadata->>'portion_clock_contract' is distinct from (case when original.phase='FINALIZE' then 'HOLD_CANCEL_FINALIZE_V1' else 'HOLD_CANCEL_V1' end)
  or journal.metadata->>'clock_admission_id' is distinct from original.id::text
  or journal.metadata->>'admitted_at_microseconds' is distinct from ((extract(epoch from original.effective_at)*1000000)::bigint)::text
  or not app_private.withdrawal_coverage_entries_verified(journal.id,original.user_id,original.amount_atomic,original.phase) then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_JOURNAL_MISSING'; end if;
 if original.phase='HOLD' then
  if journal.idempotency_key is distinct from request.idempotency_key||':hold' or journal.category<>'WITHDRAWAL' or journal.metadata->>'amount_atomic' is distinct from original.amount_atomic::text
   or request.hold_posted_at is distinct from original.effective_at then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_HOLD_MISMATCH'; end if;
 elsif original.phase='RELEASE' then
  select a.* into hold_original from app_private.funding_withdrawal_clock_admissions a where a.id=original.hold_admission_id;
  if hold_original.user_id is distinct from original.user_id or hold_original.withdrawal_id is distinct from original.withdrawal_id
   or hold_original.phase is distinct from 'HOLD' or original.effective_at<hold_original.effective_at
   or journal.category<>'REVERSAL' or journal.reversal_of_transaction_id is distinct from request.hold_ledger_transaction_id
   or request.hold_released_at is distinct from original.effective_at or request.status not in('CANCELLED','REJECTED') then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_RELEASE_MISMATCH'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(hold_original.id);
 else
  select a.* into hold_original from app_private.funding_withdrawal_clock_admissions a where a.id=original.hold_admission_id;
  if hold_original.user_id is distinct from original.user_id or hold_original.withdrawal_id is distinct from original.withdrawal_id
   or hold_original.phase is distinct from 'HOLD' or original.effective_at<hold_original.effective_at
   or journal.category<>'WITHDRAWAL' or journal.reversal_of_transaction_id is not null
   or request.ledger_finalized_at is distinct from original.effective_at or request.status not in('LEDGER_FINALIZED','COMPLETED')
   or request.release_ledger_transaction_id is not null
   or not exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=request.id and i.user_id=original.user_id)
   or not exists(select 1 from public.withdrawal_external_sends e where e.withdrawal_id=request.id and e.method=request.destination_type)
   or (select count(*) from public.wallet_ledger w where w.reference_type='withdrawal_request' and w.reference_id=request.id
     and w.user_id=original.user_id and w.wallet_account_id=request.wallet_account_id and w.entry_type='WITHDRAWAL'
     and w.direction='DEBIT' and w.amount_atomic=original.amount_atomic and w.created_at=original.effective_at)<>1 then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_CLOCK_FINALIZE_MISMATCH';end if;
  perform app_private.assert_funding_withdrawal_clock_admission(hold_original.id);
 end if;
end;
$$;


create or replace function app_private.assert_funding_withdrawal_clock_completion(p_original uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;journal public.ledger_transactions%rowtype;movement public.money_source_movements%rowtype;
 principal_count bigint;v_key text;
begin
 perform app_private.assert_funding_withdrawal_clock_admission(p_original);
 select a.* into original from app_private.funding_withdrawal_clock_admissions a where a.id=p_original;
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 select t.* into journal from public.ledger_transactions t
  where t.id=case when original.phase='HOLD' then request.hold_ledger_transaction_id when original.phase='RELEASE' then request.release_ledger_transaction_id else request.finalize_ledger_transaction_id end;
 if not exists(select 1 from public.transaction_receipts r where r.source_type='withdrawal_request' and r.source_id=request.id
   and r.user_id=original.user_id and r.currency='KRW' and r.amount_atomic=request.amount_atomic)
  or not exists(select 1 from public.outbox_events e join public.ledger_transactions h on h.id=request.hold_ledger_transaction_id
   where e.event_type='WITHDRAWAL_REQUESTED.v1' and e.schema_version=1 and e.aggregate_type='withdrawal_request'
    and e.aggregate_id=request.id and e.actor_user_id=original.user_id and e.request_id=h.request_id
    and e.idempotency_key=request.idempotency_key||':event'
    and e.payload->>'hold_ledger_transaction_id'=h.id::text and e.payload->>'amount_atomic'=request.amount_atomic::text
    and e.payload->>'fee_atomic'='0') then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_COMMAND_ORIGINAL_MISSING'; end if;
 if original.phase='RELEASE' then
  v_key:=left(journal.idempotency_key,length(journal.idempotency_key)-8);
  if right(journal.idempotency_key,8) is distinct from ':release'
   or (select count(*) from public.audit_logs a where a.action='release_withdrawal_hold'
     and a.target_type='withdrawal_request' and a.target_id=request.id::text and a.actor_user_id=journal.created_by
     and a.metadata->>'operation'='release_withdrawal_hold' and a.metadata->>'result_id'=journal.id::text
     and a.metadata->>'actor_user_id'=journal.created_by::text and a.metadata->>'amount_atomic'=request.amount_atomic::text
     and a.metadata->>'destination_id'=request.withdrawal_destination_id::text and a.metadata->>'currency'='KRW'
     and a.metadata->>'idempotency_key'=v_key)<>1
   or not exists(select 1 from public.outbox_events e where e.event_type='WITHDRAWAL_HOLD_RELEASED.v1'
     and e.schema_version=1 and e.aggregate_type='withdrawal_request' and e.aggregate_id=request.id
     and e.actor_user_id=journal.created_by and e.request_id=journal.request_id and e.idempotency_key=v_key||':event'
     and e.payload->>'release_ledger_transaction_id'=journal.id::text
     and e.payload->>'reason'=journal.metadata->>'reason' and e.payload->>'disposition'=request.status::text) then
   raise exception using errcode='55000',message='FUNDING_RELEASE_COMMAND_COMPLETION_MISSING'; end if;
 end if;
 if original.phase='FINALIZE' then
  v_key:=left(journal.idempotency_key,length(journal.idempotency_key)-9);
  if right(journal.idempotency_key,9) is distinct from ':finalize'
   or (select count(*) from public.audit_logs a where a.action='finalize_withdrawal_ledger' and a.target_type='withdrawal_request'
    and a.target_id=request.id::text and a.actor_user_id=journal.created_by and a.metadata->>'operation'='finalize_withdrawal_ledger'
    and a.metadata->>'result_id'=journal.id::text and a.metadata->>'actor_user_id'=journal.created_by::text
    and a.metadata->>'amount_atomic'=request.amount_atomic::text and a.metadata->>'destination_id'=request.withdrawal_destination_id::text
    and a.metadata->>'currency'='KRW' and a.metadata->>'idempotency_key'=v_key)<>1
   or not exists(select 1 from public.outbox_events e where e.event_type='WITHDRAWAL_COMPLETED.v1' and e.schema_version=1
    and e.aggregate_type='withdrawal_request' and e.aggregate_id=request.id and e.actor_user_id=journal.created_by
    and e.request_id=journal.request_id and e.idempotency_key=v_key||':event'
    and e.payload->>'finalize_ledger_transaction_id'=journal.id::text and e.payload->>'amount_atomic'=request.amount_atomic::text
    and e.occurred_at=original.effective_at and e.created_at=original.effective_at)
   or not exists(select 1 from public.transaction_receipts r where r.source_type='withdrawal_request' and r.source_id=request.id
    and r.user_id=original.user_id and r.status='COMPLETED' and r.ledger_transaction_id=journal.id and r.completed_at=original.effective_at) then
   raise exception using errcode='55000',message='FUNDING_FINALIZE_COMMAND_COMPLETION_MISSING';end if;
 end if;
 select count(*) into principal_count from public.money_source_movements m where m.ledger_transaction_id=journal.id
  and m.user_id=original.user_id and m.origin_code=case when original.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' when original.phase='RELEASE' then 'PRINCIPAL_RECOVERY_RELEASE' else 'PRINCIPAL_RECOVERY_FINALIZE' end;
 if principal_count=1 then
  select m.* into movement from public.money_source_movements m where m.ledger_transaction_id=journal.id
   and m.user_id=original.user_id and m.origin_code=case when original.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' when original.phase='RELEASE' then 'PRINCIPAL_RECOVERY_RELEASE' else 'PRINCIPAL_RECOVERY_FINALIZE' end;
  perform app_private.assert_principal_recovery_movement(movement);
  if original.phase='FINALIZE' and not exists(select 1 from public.outbox_events e where e.id=movement.source_event_id
   and e.event_type='PRINCIPAL_RECOVERY_FINALIZED.v1' and e.aggregate_id=journal.id and e.actor_user_id=original.user_id
   and e.request_id=original.journal_request_id and e.correlation_id=journal.correlation_id
   and e.occurred_at=original.effective_at and e.created_at=original.effective_at) then
   raise exception using errcode='55000',message='FUNDING_FINALIZE_SOURCE_CLOCK_MISMATCH';end if;
  if movement.amount_atomic is distinct from original.amount_atomic then
   raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_SOURCE_ORIGINAL_MISSING'; end if;
 elsif principal_count<>0 or app_private.non_principal_withdrawal_coverage_verified(request) is not true then
  raise exception using errcode='55000',message='FUNDING_WITHDRAWAL_SOURCE_ORIGINAL_MISSING';
 end if;
end;
$$;


-- Existing CREATE OR REPLACE preserves all prior fixed-path/owner/ACL.
commit;
